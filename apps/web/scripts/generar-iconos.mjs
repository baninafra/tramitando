// Copia los íconos de Lucide que usa el sitio a src/components/iconos.ts.
// Correr de nuevo si se agrega un ícono: node scripts/generar-iconos.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const nombres = ['search', 'circle-check', 'clock', 'circle-minus', 'external-link', 'flag', 'map-pin', 'printer', 'message-circle', 'chevron-right', 'info', 'triangle-alert', 'calendar', 'banknote', 'list-checks', 'building-2', 'x', 'file-text', 'car', 'id-card', 'briefcase', 'users', 'receipt', 'globe', 'hourglass', 'user-check', 'footprints', 'lightbulb', 'link', 'shield-check', 'heart-handshake', 'mail', 'arrow-left', 'share-2', 'monitor', 'store', 'arrow-up-right'];

const salida = {};
for (const n of nombres) {
  const svg = readFileSync(`node_modules/lucide-static/icons/${n}.svg`, 'utf8');
  salida[n] = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>')).replace(/\s*\n\s*/g, '');
}
// El sello de la marca (círculo con check del logo), distinto del circle-check de Lucide.
salida['sello'] = '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>';

writeFileSync('src/components/iconos.ts',
  `// Generado por scripts/generar-iconos.mjs a partir de lucide-static (ISC). No editar a mano.\n` +
  `export const iconos = ${JSON.stringify(salida, null, 2)} as const;\n\nexport type NombreIcono = keyof typeof iconos;\n`);
console.log(Object.keys(salida).length, 'íconos');
