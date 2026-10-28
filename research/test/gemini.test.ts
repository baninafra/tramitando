import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { preguntarGemini } from '../src/gemini.js';

const esquema = z.object({ valor: z.number() });

describe('preguntarGemini', () => {
  it('extrae el JSON de un bloque ```json con texto alrededor', async () => {
    const runner = vi.fn(async () => 'Claro, acá va:\n```json\n{"valor":7}\n```\nListo.');
    const resultado = await preguntarGemini('prompt', esquema, { runner, logPath: null });
    expect(resultado).toEqual({ valor: 7 });
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('extrae el JSON aunque venga con texto antes y después', async () => {
    const runner = vi.fn(async () => 'La respuesta es {"valor":3} y nada más.');
    const resultado = await preguntarGemini('prompt', esquema, { runner, logPath: null });
    expect(resultado).toEqual({ valor: 3 });
  });

  it('reintenta una vez agregando el error de validación', async () => {
    const prompts: string[] = [];
    const runner = vi.fn(async (prompt: string) => {
      prompts.push(prompt);
      if (prompts.length === 1) return 'esto no es JSON';
      return '{"valor":1}';
    });

    const resultado = await preguntarGemini('prompt original', esquema, { runner, logPath: null });

    expect(resultado).toEqual({ valor: 1 });
    expect(runner).toHaveBeenCalledTimes(2);
    expect(prompts[0]).toBe('prompt original');
    expect(prompts[1]).toContain('prompt original');
    expect(prompts[1]).toContain('validación');
  });

  it('falla si después del reintento sigue inválido', async () => {
    const runner = vi.fn(async () => '{"valor":"no es número"}');
    await expect(
      preguntarGemini('prompt', esquema, { runner, logPath: null }),
    ).rejects.toThrow(/no devolvió un JSON válido/);
    expect(runner).toHaveBeenCalledTimes(2);
  });
});
