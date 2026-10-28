/**
 * Reportes de usuarios sobre una ficha publicada (`POST /v1/reportes`).
 *
 * El reporte siempre queda pendiente: nunca modifica la ficha. Guarda una prueba (un link o una
 * imagen en R2), el hash de la IP con sal y, si el usuario lo dejó, su email.
 */
import { NuevoReporte } from '@tramitando/shared';
import { Hono } from 'hono';
import type { Env } from '../env';
import { error } from '../util/errores';
import { hashearIp } from '../util/hash';
import { verificarTurnstile } from '../util/turnstile';

export const reportes = new Hono<{ Bindings: Env }>();

const MAXIMO_BYTES = 5 * 1024 * 1024;
const MAXIMO_REPORTES_POR_HORA = 5;

interface ImagenDetectada {
  tipo: 'image/jpeg' | 'image/png' | 'image/webp';
  extension: 'jpg' | 'png' | 'webp';
}

function detectarImagen(bytes: Uint8Array): ImagenDetectada | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { tipo: 'image/jpeg', extension: 'jpg' };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { tipo: 'image/png', extension: 'png' };
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { tipo: 'image/webp', extension: 'webp' };
  }
  return null;
}

function campoTexto(formulario: FormData, nombre: string): string | null {
  const valor = formulario.get(nombre);
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  return limpio === '' ? null : limpio;
}

reportes.post('/', async (c) => {
  let formulario: FormData;
  try {
    formulario = await c.req.formData();
  } catch {
    return error(c, 400, 'formulario_invalido', 'No pudimos leer los datos del reporte.');
  }

  const varianteTexto = campoTexto(formulario, 'variante_id');
  const varianteId = varianteTexto === null ? Number.NaN : Number(varianteTexto);

  const reporte = NuevoReporte.safeParse({
    variante_id: varianteId,
    bloque: campoTexto(formulario, 'bloque') ?? '',
    descripcion: campoTexto(formulario, 'descripcion') ?? '',
    valor_correcto: campoTexto(formulario, 'valor_correcto'),
    prueba_url: campoTexto(formulario, 'prueba_url'),
    email: campoTexto(formulario, 'email'),
    turnstile_token: campoTexto(formulario, 'turnstile_token') ?? '',
  });

  if (!reporte.success) {
    return error(c, 400, 'datos_invalidos', 'Revisá los datos del reporte e intentá de nuevo.');
  }

  const variante = await c.env.DB.prepare('SELECT id, estado FROM variantes WHERE id = ?')
    .bind(reporte.data.variante_id)
    .first<{ id: number; estado: string }>();
  if (!variante || variante.estado !== 'publicada') {
    return error(c, 404, 'variante_no_encontrada', 'No encontramos esa ficha.');
  }

  const archivo = formulario.get('prueba');
  const tieneArchivo = archivo instanceof File && archivo.size > 0;
  if (!reporte.data.prueba_url && !tieneArchivo) {
    return error(c, 400, 'prueba_requerida', 'Adjuntá una imagen o pegá un link como prueba.');
  }

  let imagen: ImagenDetectada | null = null;
  let bytes: Uint8Array | null = null;

  if (tieneArchivo && archivo instanceof File) {
    if (archivo.size > MAXIMO_BYTES) {
      return error(c, 400, 'prueba_invalida', 'La imagen no puede pesar más de 5 MB.');
    }

    const tipoDeclarado = archivo.type.toLowerCase().split(';')[0]?.trim() ?? '';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(tipoDeclarado)) {
      return error(c, 400, 'prueba_invalida', 'La prueba tiene que ser una imagen JPG, PNG o WebP.');
    }

    bytes = new Uint8Array(await archivo.arrayBuffer());
    imagen = detectarImagen(bytes);
    if (!imagen || bytes.length > MAXIMO_BYTES) {
      return error(c, 400, 'prueba_invalida', 'La prueba tiene que ser una imagen JPG, PNG o WebP.');
    }
  }

  const ip = c.req.header('CF-Connecting-IP')?.trim() ?? '';
  const turnstileOk = await verificarTurnstile(c.env.TURNSTILE_SECRET, reporte.data.turnstile_token, ip || null);
  if (!turnstileOk) {
    return error(c, 403, 'turnstile_invalido', 'No pudimos verificar que no seas un robot. Probá de nuevo.');
  }

  const ipHash = await hashearIp(ip, c.env.IP_SALT);
  const desde = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recientes = await c.env.DB.prepare('SELECT COUNT(*) AS cantidad FROM reportes WHERE ip_hash = ? AND creado_en >= ?')
    .bind(ipHash, desde)
    .first<{ cantidad: number }>();
  if ((recientes?.cantidad ?? 0) >= MAXIMO_REPORTES_POR_HORA) {
    return error(c, 429, 'demasiados_reportes', 'Ya enviaste varios reportes. Esperá un rato y probá de nuevo.');
  }

  let pruebaR2Key: string | null = null;
  if (bytes && imagen) {
    pruebaR2Key = `reportes/${crypto.randomUUID()}.${imagen.extension}`;
    await c.env.PRUEBAS.put(pruebaR2Key, bytes, {
      httpMetadata: { contentType: imagen.tipo },
    });
  }

  const insertado = await c.env.DB.prepare(
    `INSERT INTO reportes
       (variante_id, bloque, descripcion, valor_correcto, prueba_url, prueba_r2_key, email, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      reporte.data.variante_id,
      reporte.data.bloque,
      reporte.data.descripcion,
      reporte.data.valor_correcto,
      reporte.data.prueba_url,
      pruebaR2Key,
      reporte.data.email,
      ipHash,
    )
    .run();

  return c.json({ id: insertado.meta.last_row_id }, 201);
});
