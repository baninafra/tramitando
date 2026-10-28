import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { z } from 'zod';
import { rutaDatos } from './rutas.js';

export type RunnerGemini = (prompt: string) => Promise<string>;

export interface OpcionesGemini {
  /** Reemplaza la llamada real a `agy-delegate` (tests). */
  runner?: RunnerGemini;
  /** Ruta del JSONL de llamadas. `null` desactiva el registro. */
  logPath?: string | null;
  timeoutMs?: number;
}

const MAX_PARALELAS = 4;
const TIMEOUT_CLI_MS = 10 * 60 * 1000;
// DeepSeek suele contestar en menos de un minuto; sin cuota se cuelga en vez de dar error.
const TIMEOUT_OPENCODE_MS = 4 * 60 * 1000;

class Semaforo {
  private activos = 0;
  private cola: (() => void)[] = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.activos < this.max) {
      this.activos += 1;
      return;
    }
    await new Promise<void>((resolver) => this.cola.push(resolver));
    this.activos += 1;
  }

  release(): void {
    this.activos -= 1;
    const siguiente = this.cola.shift();
    if (siguiente) siguiente();
  }
}

const semaforo = new Semaforo(MAX_PARALELAS);

/**
 * Runner por defecto: `agy-delegate -m gemini-3.8-flash-low --timeout 10m -`.
 * Sin `--yolo` ni `--dangerously-skip-permissions`: Gemini solo lee lo que le mandamos por stdin.
 */
export function runnerAgy(prompt: string, timeoutMs = TIMEOUT_CLI_MS): Promise<string> {
  if (process.platform === 'win32') return runnerAgyWsl(INSTRUCCION_SIN_HERRAMIENTAS + prompt, timeoutMs);
  const args = ['-m', MODELO, '--timeout', '10m', '-'];
  return new Promise<string>((resolver, rechazar) => {
    const hijo = spawn('agy-delegate', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const temporizador = setTimeout(() => {
      hijo.kill();
      rechazar(new Error(`agy-delegate no respondió en ${timeoutMs} ms`));
    }, timeoutMs);

    hijo.stdout?.setEncoding('utf8');
    hijo.stderr?.setEncoding('utf8');
    hijo.stdout?.on('data', (trozo: string) => {
      stdout += trozo;
    });
    hijo.stderr?.on('data', (trozo: string) => {
      stderr += trozo;
    });
    hijo.on('error', (error) => {
      clearTimeout(temporizador);
      rechazar(error);
    });
    hijo.on('close', (codigo) => {
      clearTimeout(temporizador);
      if (codigo !== 0) {
        rechazar(new Error(`agy-delegate terminó con código ${codigo}: ${stderr.trim()}`));
        return;
      }
      try {
        resolver(respuestaDelSobre(stdout));
      } catch (error) {
        rechazar(error);
      }
    });
    hijo.stdin?.end(INSTRUCCION_SIN_HERRAMIENTAS + prompt);
  });
}

const MODELO = 'gemini-3.8-flash-low';

/**
 * Último respaldo, sin cuota: Qwen 3.5 9B local con llama-server (el de UniCore-IA), en el puerto
 * de `TRAMITANDO_QWEN_URL` (por defecto 8643, distinto del 8642 que usa unicore). Lo levanta
 * research/scripts/qwen-servidor.sh. Se elige con `TRAMITANDO_LLM=qwen`.
 */
export const URL_QWEN_9B = process.env.TRAMITANDO_QWEN_URL ?? 'http://127.0.0.1:8643/v1/chat/completions';
export const URL_QWEN_2B = process.env.TRAMITANDO_QWEN_2B_URL ?? 'http://127.0.0.1:8644/v1/chat/completions';

export async function runnerQwen(prompt: string, timeoutMs = TIMEOUT_CLI_MS, url = URL_QWEN_9B): Promise<string> {
  const respuesta = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
      // Sin razonamiento largo: la tarea es clasificar y extraer, y el 9B piensa lento.
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  if (!respuesta.ok) throw new Error(`Qwen respondió ${respuesta.status}: ${(await respuesta.text()).slice(0, 300)}`);
  const datos = (await respuesta.json()) as { choices?: { message?: { content?: string } }[] };
  const texto = datos.choices?.[0]?.message?.content ?? '';
  if (!texto.trim()) throw new Error('Qwen devolvió una respuesta vacía');
  return texto.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

/**
 * DeepSeek v4.1 free vía opencode (`TRAMITANDO_LLM=deepseek`). Igual que Gemini en este pipeline: no navega
 * ni edita (research/opencode-fichas/opencode.json niega todo); el prompt va como archivo adjunto porque
 * con las páginas oficiales pasa el límite de la línea de comandos de Windows.
 */
export function runnerOpencode(prompt: string, timeoutMs = TIMEOUT_OPENCODE_MS): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'tramitando-opencode-'));
  const archivoPrompt = join(dir, 'prompt.md');
  writeFileSync(archivoPrompt, prompt, 'utf8');
  const limpiar = () => rmSync(dir, { recursive: true, force: true });
  const modelo = process.env.TRAMITANDO_OPENCODE_MODELO ?? 'opencode/deepseek-v4.1-flash-free';
  return new Promise<string>((resolver, rechazar) => {
    // El mensaje va antes de -f: -f es un array y se tragaría lo que venga después.
    const hijo = spawn(
      'opencode',
      ['run', '"Seguí las instrucciones del archivo adjunto y respondé solo con el JSON."', '-m', modelo, '--variant', process.env.TRAMITANDO_OPENCODE_VARIANTE ?? 'low', '-f', `"${archivoPrompt}"`],
      { cwd: rutaDatos('..', 'opencode-fichas'), shell: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    const temporizador = setTimeout(() => {
      // Con shell: true, kill() mata solo la consola y opencode queda vivo ocupando RAM: se mata el árbol entero.
      if (process.platform === 'win32' && hijo.pid) spawn('taskkill', ['/PID', String(hijo.pid), '/T', '/F'], { stdio: 'ignore' });
      else hijo.kill();
      limpiar();
      rechazar(new Error(`opencode no respondió en ${timeoutMs} ms`));
    }, timeoutMs);
    hijo.stdout?.setEncoding('utf8');
    hijo.stderr?.setEncoding('utf8');
    hijo.stdout?.on('data', (t: string) => (stdout += t));
    hijo.stderr?.on('data', (t: string) => (stderr += t));
    hijo.on('error', (e) => {
      clearTimeout(temporizador);
      limpiar();
      rechazar(e);
    });
    hijo.on('close', (codigo) => {
      clearTimeout(temporizador);
      limpiar();
      if (codigo === 0 && stdout.trim()) resolver(stdout.trim());
      else rechazar(new Error(`opencode terminó con código ${codigo}: ${(stderr.trim() || stdout.trim()).slice(0, 300)}`));
    });
  });
}

const PROVEEDORES = {
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', clave: 'GROQ_API_KEY', modelo: 'qwen/qwen3.8-27b' },
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', clave: 'OPENROUTER_API_KEY', modelo: '' },
} as const;

/** El proveedor cortó por cuota o límite de pedidos: el script espera y vuelve a probar. */
export class SinCuota extends Error {}

/**
 * APIs compatibles con OpenAI en la nube, solo modelos gratis: Groq (`TRAMITANDO_LLM=groq`, Qwen 3.8) y
 * OpenRouter (`TRAMITANDO_LLM=openrouter`, modelo en TRAMITANDO_OPENROUTER_MODELO, terminado en `:free`).
 * La clave sale del entorno (los scripts la leen de C:/tramitando-estado/claves.env, fuera del repo).
 */
export async function runnerCompatible(prompt: string, proveedor: keyof typeof PROVEEDORES, timeoutMs = TIMEOUT_OPENCODE_MS): Promise<string> {
  const p = PROVEEDORES[proveedor];
  const clave = process.env[p.clave];
  if (!clave) throw new Error(`Falta ${p.clave}`);
  const modelo = (proveedor === 'groq' ? process.env.TRAMITANDO_GROQ_MODELO : process.env.TRAMITANDO_OPENROUTER_MODELO) ?? p.modelo;
  if (proveedor === 'openrouter' && !modelo.endsWith(':free')) throw new Error(`Solo modelos gratis de OpenRouter (:free): ${modelo}`);
  const cuerpo = JSON.stringify({
    model: modelo,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: 4096,
    response_format: { type: 'json_object' },
    ...(proveedor === 'groq' ? { reasoning_effort: 'none' } : {}),
  });
  let respuesta: Response;
  // Los planes gratis limitan pedidos por minuto: se espera lo que diga retry-after (hasta 1 min) y se reintenta.
  for (let intento = 0; ; intento += 1) {
    respuesta = await fetch(p.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${clave}` },
      signal: AbortSignal.timeout(timeoutMs),
      body: cuerpo,
    });
    if (respuesta.status !== 429 || intento >= 3) break;
    const segundos = Math.min(60, Number(respuesta.headers.get('retry-after')) || 20);
    await new Promise((r) => setTimeout(r, segundos * 1000));
  }
  if (respuesta.status === 429 || respuesta.status === 402) throw new SinCuota(`${proveedor} sin cuota (${respuesta.status})`);
  if (!respuesta.ok) throw new Error(`${proveedor} respondió ${respuesta.status}: ${(await respuesta.text()).slice(0, 300)}`);
  const datos = (await respuesta.json()) as { choices?: { message?: { content?: string } }[] };
  const texto = datos.choices?.[0]?.message?.content ?? '';
  if (!texto.trim()) throw new Error(`${proveedor} devolvió una respuesta vacía`);
  return texto.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

/** El codex.exe que trae la app de Codex (la carpeta cambia con cada versión): el más nuevo. */
function rutaCodex(): string {
  if (process.env.TRAMITANDO_CODEX) return process.env.TRAMITANDO_CODEX;
  const base = join(process.env.LOCALAPPDATA ?? '', 'OpenAI', 'Codex', 'bin');
  const versiones = readdirSync(base)
    .map((d) => join(base, d, 'codex.exe'))
    .filter((f) => existsSync(f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!versiones[0]) throw new Error(`No encontré codex.exe en ${base}`);
  return versiones[0];
}

/**
 * Codex (`TRAMITANDO_LLM=codex`, por defecto gpt-6-luna con razonamiento bajo) con la sesión de la app de
 * Codex. Igual que los demás: no navega ni edita (sandbox de solo lectura, sin repo, sin guardar la sesión);
 * el prompt va por stdin y la respuesta sale del archivo de -o.
 */
export function runnerCodex(prompt: string, timeoutMs = TIMEOUT_OPENCODE_MS): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'tramitando-codex-'));
  const archivoSalida = join(dir, 'respuesta.txt');
  const limpiar = () => rmSync(dir, { recursive: true, force: true });
  const modelo = process.env.TRAMITANDO_CODEX_MODELO ?? 'gpt-6-luna';
  return new Promise<string>((resolver, rechazar) => {
    const hijo = spawn(
      rutaCodex(),
      ['exec', '-m', modelo, '-c', 'model_reasoning_effort=low', '-s', 'read-only', '--skip-git-repo-check', '--ephemeral', '-o', archivoSalida, '-'],
      { cwd: dir, stdio: ['pipe', 'ignore', 'pipe'] },
    );
    let stderr = '';
    const temporizador = setTimeout(() => {
      if (process.platform === 'win32' && hijo.pid) spawn('taskkill', ['/PID', String(hijo.pid), '/T', '/F'], { stdio: 'ignore' });
      else hijo.kill();
      limpiar();
      rechazar(new Error(`codex no respondió en ${timeoutMs} ms`));
    }, timeoutMs);
    hijo.stderr?.setEncoding('utf8');
    hijo.stderr?.on('data', (t: string) => (stderr = (stderr + t).slice(-2000)));
    hijo.on('error', (e) => {
      clearTimeout(temporizador);
      limpiar();
      rechazar(e);
    });
    hijo.on('close', (codigo) => {
      clearTimeout(temporizador);
      let texto = '';
      try {
        texto = existsSync(archivoSalida) ? readFileSync(archivoSalida, 'utf8').trim() : '';
      } finally {
        limpiar();
      }
      if (codigo === 0 && texto) resolver(texto);
      else rechazar(new Error(`codex terminó con código ${codigo}: ${stderr.trim().slice(-300)}`));
    });
    hijo.stdin?.end(prompt);
  });
}

/** C:\a\b → /mnt/c/a/b */
export function rutaWsl(ruta: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(ruta);
  if (!m) throw new Error(`No es una ruta de Windows: ${ruta}`);
  return `/mnt/${(m[1] as string).toLowerCase()}/${(m[2] as string).replace(/\\/g, '/')}`;
}

/**
 * En Windows, `agy` corre dentro de WSL y el wrapper le pasa el prompt como argumento de la línea de
 * comandos de Windows, que se corta a ~32 000 caracteres. Para prompts largos (páginas oficiales) el
 * prompt va a un archivo temporal y un script dentro de WSL lo lee. Mismos flags que agy-delegate:
 * modelo fijo, salida JSON, sin permisos extra (nunca --dangerously-skip-permissions).
 */
function runnerAgyWsl(prompt: string, timeoutMs: number): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'tramitando-agy-'));
  const archivoPrompt = join(dir, 'prompt.txt');
  const script = join(dir, 'correr.sh');
  writeFileSync(archivoPrompt, prompt, 'utf8');
  writeFileSync(
    script,
    '#!/usr/bin/env bash\nexec agy --model "$1" --print-timeout 10m --output-format json -p "$(cat "$2")" </dev/null\n',
    'utf8',
  );
  const distro = process.env.TRAMITANDO_WSL_DISTRO ?? 'Ubuntu';
  const limpiar = () => rmSync(dir, { recursive: true, force: true });
  return new Promise<string>((resolver, rechazar) => {
    const hijo = spawn('wsl.exe', ['-d', distro, '--', 'bash', '-l', rutaWsl(script), MODELO, rutaWsl(archivoPrompt)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const temporizador = setTimeout(() => {
      hijo.kill();
      limpiar();
      rechazar(new Error(`agy no respondió en ${timeoutMs} ms`));
    }, timeoutMs);
    hijo.stdout?.setEncoding('utf8');
    hijo.stderr?.setEncoding('utf8');
    hijo.stdout?.on('data', (t: string) => (stdout += t));
    hijo.stderr?.on('data', (t: string) => (stderr += t));
    hijo.on('error', (e) => {
      clearTimeout(temporizador);
      limpiar();
      rechazar(e);
    });
    hijo.on('close', (codigo) => {
      clearTimeout(temporizador);
      limpiar();
      try {
        resolver(respuestaDelSobre(stdout));
      } catch (error) {
        rechazar(codigo === 0 ? error : new Error(`agy terminó con código ${codigo}: ${stderr.trim() || stdout.trim()}`));
      }
    });
  });
}

/** Gemini no tiene permisos: si intenta abrir una URL o correr algo, agy lo rechaza y la respuesta llega vacía. */
const INSTRUCCION_SIN_HERRAMIENTAS =
  'IMPORTANTE: no uses ninguna herramienta, no abras URLs y no ejecutes comandos. Todo el contenido que necesitás ya está en este mensaje. Respondé directamente.\n\n';

/**
 * agy-delegate imprime un sobre JSON `{ status, response, denied_actions?, ... }`. Devuelve `response`.
 * Si stdout no es un sobre (versiones viejas de agy), lo devuelve tal cual.
 */
export function respuestaDelSobre(stdout: string): string {
  let sobre: unknown;
  try {
    sobre = JSON.parse(stdout.trim());
  } catch {
    return stdout;
  }
  if (!sobre || typeof sobre !== 'object' || !('response' in sobre)) return stdout;
  const { response, denied_actions: denegadas } = sobre as { response?: unknown; denied_actions?: { action?: string }[] };
  const texto = typeof response === 'string' ? response : '';
  if (texto.trim() === '') {
    const acciones = (denegadas ?? []).map((d) => d.action).filter(Boolean).join(', ');
    throw new Error(`Gemini devolvió una respuesta vacía${acciones ? ` (intentó usar: ${acciones})` : ''}`);
  }
  return texto;
}

function parsearJson(texto: string): unknown {
  const limpio = texto.trim();
  try {
    return JSON.parse(limpio);
  } catch {
    // Sigue con los bloques y el escaneo.
  }

  const bloques = [...texto.matchAll(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/g)];
  for (const bloque of bloques) {
    const contenido = bloque[1]?.trim();
    if (!contenido) continue;
    try {
      return JSON.parse(contenido);
    } catch {
      // Prueba el siguiente bloque.
    }
  }

  for (let inicio = 0; inicio < texto.length; inicio += 1) {
    const caracter = texto[inicio];
    if (caracter !== '{' && caracter !== '[') continue;
    const cierre = caracter === '{' ? '}' : ']';
    let profundidad = 0;
    let enCadena = false;
    let escapado = false;
    for (let i = inicio; i < texto.length; i += 1) {
      const c = texto[i] as string;
      if (enCadena) {
        if (escapado) escapado = false;
        else if (c === '\\') escapado = true;
        else if (c === '"') enCadena = false;
        continue;
      }
      if (c === '"') {
        enCadena = true;
      } else if (c === caracter) {
        profundidad += 1;
      } else if (c === cierre) {
        profundidad -= 1;
        if (profundidad === 0) {
          try {
            return JSON.parse(texto.slice(inicio, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new Error('La respuesta de Gemini no contiene JSON válido');
}

function registrarLlamada(
  ruta: string | null,
  datos: { duracion_ms: number; ok: boolean; error?: string; bytes: number; prompt_bytes: number },
): void {
  if (!ruta) return;
  try {
    mkdirSync(dirname(ruta), { recursive: true });
    appendFileSync(
      ruta,
      `${JSON.stringify({ fecha: new Date().toISOString(), ...datos })}\n`,
      'utf8',
    );
  } catch {
    // El registro no debe romper la investigación.
  }
}

/**
 * Pregunta a Gemini y valida la respuesta con zod. Si la validación falla, reintenta una vez
 * agregando el error al prompt. Nunca habilita navegación ni escritura para el modelo.
 */
export async function preguntarGemini<T>(
  prompt: string,
  esquema: z.ZodType<T>,
  opciones: OpcionesGemini = {},
): Promise<T> {
  const runner =
    opciones.runner ??
    (process.env.TRAMITANDO_LLM === 'qwen'
      ? (p: string) => runnerQwen(p, opciones.timeoutMs)
      : process.env.TRAMITANDO_LLM === 'deepseek' || process.env.TRAMITANDO_LLM === 'opencode'
        ? (p: string) => runnerOpencode(p, opciones.timeoutMs)
        : process.env.TRAMITANDO_LLM === 'codex'
          ? (p: string) => runnerCodex(p, opciones.timeoutMs)
          : process.env.TRAMITANDO_LLM === 'groq' || process.env.TRAMITANDO_LLM === 'openrouter'
            ? (p: string) => runnerCompatible(p, process.env.TRAMITANDO_LLM as 'groq' | 'openrouter', opciones.timeoutMs)
            : (p: string) => runnerAgy(p, opciones.timeoutMs));
  const logPath = opciones.logPath === undefined ? rutaDatos('log-gemini.jsonl') : opciones.logPath;
  let promptActual = prompt;
  let ultimoError: unknown;

  for (let intento = 0; intento < 2; intento += 1) {
    const inicio = Date.now();
    let respuesta = '';
    await semaforo.acquire();
    try {
      respuesta = await runner(promptActual);
    } catch (error) {
      ultimoError = error;
      registrarLlamada(logPath, {
        duracion_ms: Date.now() - inicio,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        bytes: 0,
        prompt_bytes: promptActual.length,
      });
      semaforo.release();
      throw error;
    }
    semaforo.release();

    try {
      const valor = parsearJson(respuesta);
      const resultado = esquema.safeParse(valor);
      if (resultado.success) {
        registrarLlamada(logPath, {
          duracion_ms: Date.now() - inicio,
          ok: true,
          bytes: respuesta.length,
          prompt_bytes: promptActual.length,
        });
        return resultado.data;
      }
      ultimoError = resultado.error;
    } catch (error) {
      ultimoError = error;
    }

    registrarLlamada(logPath, {
      duracion_ms: Date.now() - inicio,
      ok: false,
      error: ultimoError instanceof Error ? ultimoError.message : String(ultimoError),
      bytes: respuesta.length,
      prompt_bytes: promptActual.length,
    });

    if (intento === 0) {
      const detalle = ultimoError instanceof Error ? ultimoError.message : String(ultimoError);
      promptActual = `${prompt}\n\nTu respuesta anterior no pasó la validación: ${detalle}\nRespondé de nuevo SOLO con el JSON válido que cumple el esquema pedido.`;
    }
  }

  throw new Error(
    `Gemini no devolvió un JSON válido: ${ultimoError instanceof Error ? ultimoError.message : String(ultimoError)}`,
  );
}
