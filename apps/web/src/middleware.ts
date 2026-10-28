import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { configurarApi } from './lib/api';

export const onRequest = defineMiddleware((_contexto, next) => {
  configurarApi(env);
  return next();
});
