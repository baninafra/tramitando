import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { limpiarBase, sembrarFichaPublicada, type FichaSembrada } from './fixtures/ingest';

const IP = '203.0.113.10';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);

function mockTurnstile(exito: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (entrada: string | URL | Request) => {
      const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.toString() : entrada.url;
      if (url.includes('siteverify')) {
        return new Response(JSON.stringify({ success: exito }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Fetch inesperado en el test: ${url}`);
    }),
  );
}

function formulario(opciones: {
  varianteId: number;
  pruebaUrl?: string | null;
  archivo?: File | null;
  ip?: string;
}): FormData {
  const form = new FormData();
  form.set('variante_id', String(opciones.varianteId));
  form.set('bloque', 'costo');
  form.set('descripcion', 'El costo que figura en la ficha no coincide con el oficial.');
  form.set('turnstile_token', 'token-de-prueba');
  if (opciones.pruebaUrl) form.set('prueba_url', opciones.pruebaUrl);
  if (opciones.archivo) form.set('prueba', opciones.archivo);
  return form;
}

function enviarReporte(form: FormData, ip = IP) {
  return SELF.fetch('https://api.test/v1/reportes', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': ip },
    body: form,
  });
}

describe('POST /v1/reportes', () => {
  let ficha: FichaSembrada;

  beforeEach(async () => {
    await limpiarBase();
    ficha = await sembrarFichaPublicada();
    mockTurnstile(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('acepta un reporte con link de prueba y guarda solo el hash de la IP', async () => {
    const res = await enviarReporte(
      formulario({ varianteId: ficha.varianteId, pruebaUrl: 'https://ejemplo.com/captura.png' }),
    );
    expect(res.status).toBe(201);

    const cuerpo = (await res.json()) as { id: number };
    expect(cuerpo.id).toBeGreaterThan(0);

    const fila = await env.DB.prepare('SELECT * FROM reportes WHERE id = ?')
      .bind(cuerpo.id)
      .first<{
        variante_id: number;
        bloque: string;
        prueba_url: string | null;
        prueba_r2_key: string | null;
        ip_hash: string;
        estado: string;
      }>();

    expect(fila).toMatchObject({
      variante_id: ficha.varianteId,
      bloque: 'costo',
      prueba_url: 'https://ejemplo.com/captura.png',
      prueba_r2_key: null,
      estado: 'pendiente',
    });
    expect(fila?.ip_hash).not.toContain(IP);
    expect(fila?.ip_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('acepta una imagen real y la guarda en R2', async () => {
    const archivo = new File([PNG], 'captura.png', { type: 'image/png' });
    const res = await enviarReporte(formulario({ varianteId: ficha.varianteId, archivo }));
    expect(res.status).toBe(201);

    const cuerpo = (await res.json()) as { id: number };
    const fila = await env.DB.prepare('SELECT prueba_url, prueba_r2_key FROM reportes WHERE id = ?')
      .bind(cuerpo.id)
      .first<{ prueba_url: string | null; prueba_r2_key: string | null }>();

    expect(fila?.prueba_url).toBeNull();
    expect(fila?.prueba_r2_key).toMatch(/^reportes\/[0-9a-f-]+\.png$/);

    const objeto = await env.PRUEBAS.get(fila?.prueba_r2_key ?? '');
    expect(objeto).not.toBeNull();
    expect(objeto?.httpMetadata?.contentType).toBe('image/png');
  });

  it.each([
    ['jpeg', new File([JPEG], 'captura.jpg', { type: 'image/jpeg' }), /\.jpg$/],
    ['webp', new File([WEBP], 'captura.webp', { type: 'image/webp' }), /\.webp$/],
  ])('detecta imágenes %s por sus magic numbers', async (_nombre, archivo, extension) => {
    const res = await enviarReporte(formulario({ varianteId: ficha.varianteId, archivo }));
    expect(res.status).toBe(201);

    const cuerpo = (await res.json()) as { id: number };
    const fila = await env.DB.prepare('SELECT prueba_r2_key FROM reportes WHERE id = ?')
      .bind(cuerpo.id)
      .first<{ prueba_r2_key: string | null }>();
    expect(fila?.prueba_r2_key).toMatch(extension);
  });

  it('rechaza un reporte sin prueba', async () => {
    const res = await enviarReporte(formulario({ varianteId: ficha.varianteId }));
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { codigo: string } }).toMatchObject({
      error: { codigo: 'prueba_requerida' },
    });
  });

  it('rechaza un archivo que dice ser imagen pero no lo es', async () => {
    const archivo = new File(['no soy una imagen'], 'falsa.png', { type: 'image/png' });
    const res = await enviarReporte(formulario({ varianteId: ficha.varianteId, archivo }));
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { codigo: string } }).toMatchObject({
      error: { codigo: 'prueba_invalida' },
    });
  });

  it('rechaza imágenes de más de 5 MB', async () => {
    const grande = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'grande.png', { type: 'image/png' });
    const res = await enviarReporte(formulario({ varianteId: ficha.varianteId, archivo: grande }));
    expect(res.status).toBe(400);
  });

  it('rechaza un Turnstile inválido', async () => {
    mockTurnstile(false);
    const res = await enviarReporte(
      formulario({ varianteId: ficha.varianteId, pruebaUrl: 'https://ejemplo.com/captura.png' }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { codigo: string } }).toMatchObject({
      error: { codigo: 'turnstile_invalido' },
    });
  });

  it('rechaza reportes sobre una variante que no existe', async () => {
    const res = await enviarReporte(
      formulario({ varianteId: 999999, pruebaUrl: 'https://ejemplo.com/captura.png' }),
    );
    expect(res.status).toBe(404);
  });

  it('limita a 5 reportes por IP por hora', async () => {
    for (let intento = 0; intento < 5; intento += 1) {
      const res = await enviarReporte(
        formulario({ varianteId: ficha.varianteId, pruebaUrl: 'https://ejemplo.com/captura.png' }),
      );
      expect(res.status).toBe(201);
    }

    const sexto = await enviarReporte(
      formulario({ varianteId: ficha.varianteId, pruebaUrl: 'https://ejemplo.com/captura.png' }),
    );
    expect(sexto.status).toBe(429);
    expect((await sexto.json()) as { error: { codigo: string } }).toMatchObject({
      error: { codigo: 'demasiados_reportes' },
    });

    const cantidad = await env.DB.prepare('SELECT COUNT(*) AS cantidad FROM reportes').first<{ cantidad: number }>();
    expect(cantidad?.cantidad).toBe(5);
  });

  it('el límite es por IP: otra IP puede reportar', async () => {
    for (let intento = 0; intento < 5; intento += 1) {
      await enviarReporte(formulario({ varianteId: ficha.varianteId, pruebaUrl: 'https://ejemplo.com/captura.png' }));
    }

    const otra = await enviarReporte(
      formulario({ varianteId: ficha.varianteId, pruebaUrl: 'https://ejemplo.com/captura.png' }),
      '198.51.100.7',
    );
    expect(otra.status).toBe(201);
  });
});
