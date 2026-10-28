import type { APIRoute } from 'astro';
import { ErrorApi, pedirApi } from '../../lib/api';

const CAMPOS: Record<string, string> = {
  variante: 'variante_id',
  valor: 'valor_correcto',
  link: 'prueba_url',
  captura: 'prueba',
  'cf-turnstile-response': 'turnstile_token',
};

const BLOQUES: Record<string, string> = {
  oficinas: 'donde',
  otro: 'resumen',
};

function respuestaJson(datos: unknown, status: number): Response {
  return new Response(JSON.stringify(datos), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  let formulario: FormData;
  try {
    formulario = await request.formData();
  } catch {
    return respuestaJson({ error: { codigo: 'formulario_invalido', mensaje: 'No pudimos leer los datos del reporte.' } }, 400);
  }

  const salida = new FormData();
  for (const [nombre, valor] of formulario.entries()) {
    const destino = CAMPOS[nombre] ?? nombre;
    if (destino === 'bloque' && typeof valor === 'string') {
      const bloque = BLOQUES[valor] ?? valor;
      if (bloque) salida.set('bloque', bloque);
      continue;
    }
    if (valor instanceof File && valor.size === 0) continue;
    salida.append(destino, valor);
  }

  if (!salida.get('descripcion')) {
    const valor = formulario.get('valor_correcto');
    if (typeof valor === 'string' && valor.trim().length >= 5) salida.set('descripcion', valor.trim());
  }

  if (!salida.get('descripcion')) {
    return respuestaJson(
      { error: { codigo: 'descripcion_requerida', mensaje: 'Contanos qué está mal antes de enviar el reporte.' } },
      400,
    );
  }

  const headers = new Headers();
  const ip = request.headers.get('cf-connecting-ip') ?? clientAddress;
  if (ip) headers.set('CF-Connecting-IP', ip);

  try {
    const reporte = await pedirApi<{ id: number }>('/v1/reportes', {
      method: 'POST',
      body: salida,
      headers,
    });
    return respuestaJson(reporte, 201);
  } catch (error) {
    if (error instanceof ErrorApi) {
      return respuestaJson(
        { error: { codigo: error.codigo, mensaje: error.message } },
        error.status === 503 ? 502 : error.status,
      );
    }
    return respuestaJson(
      { error: { codigo: 'error_interno', mensaje: 'No pudimos enviar el reporte. Probá de nuevo en un rato.' } },
      502,
    );
  }
};
