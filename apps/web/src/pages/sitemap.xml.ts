// Sitemap con la fecha de modificación real de cada ficha. Más adelante: un sitemap por provincia.
import type { APIRoute } from 'astro';
import { urlsParaSitemap } from '../lib/data';

export const GET: APIRoute = async ({ site }) => {
  const urls = await urlsParaSitemap();
  const cuerpo = urls
    .map(({ url, modificada }) => `  <url><loc>${new URL(url, site).href}</loc><lastmod>${modificada}</lastmod></url>`)
    .join('\n');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${cuerpo}\n</urlset>\n`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
};
