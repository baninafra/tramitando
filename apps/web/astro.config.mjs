// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  // Dominio previsto (todavía no está registrado). Se usa para URLs canónicas y para compartir.
  site: 'https://tramitando.com.ar',
  output: 'server',
  trailingSlash: 'never',
  adapter: cloudflare({
    // Sin transformación de imágenes: el sitio solo usa SVG.
    imageService: 'passthrough',
    // Sin estado local persistido en .wrangler/ (todavía no hay bindings que lo necesiten).
    persistState: false,
  }),
  build: { inlineStylesheets: 'auto', format: 'file' },
});
