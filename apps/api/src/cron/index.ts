/**
 * Tareas programadas (ver docs/arquitectura.md, sección "Tareas programadas").
 *
 * Los triggers viven en wrangler.jsonc. Despachamos por `controller.cron` en vez de usar Queues:
 * el volumen actual (300 fuentes por corrida) no lo justifica.
 */
import { monitorearFuentes } from '../monitor';
import type { Env } from '../env';
import { procesarVencimientos } from './vencimientos';

export const CRON_MONITOR_FUENTES = '0 6 * * 1';
export const CRON_VENCIMIENTOS = '0 5 * * *';

export async function tareasProgramadas(evento: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  void ctx;

  switch (evento.cron) {
    case CRON_MONITOR_FUENTES:
      await monitorearFuentes(env);
      break;
    case CRON_VENCIMIENTOS:
      await procesarVencimientos(env);
      break;
    default:
      console.warn(`Cron sin tarea asociada: ${evento.cron}`);
  }
}
