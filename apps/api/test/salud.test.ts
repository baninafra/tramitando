import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('API', () => {
  it('responde 404 con el formato de error acordado', async () => {
    const res = await SELF.fetch('https://api.test/no-existe');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { codigo: 'no_encontrado', mensaje: 'No encontramos lo que buscás.' } });
  });
});
