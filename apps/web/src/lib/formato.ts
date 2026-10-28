// Formatos argentinos del manual de marca: montos "$ 12.500", fechas "14/10/2026".

/** "$ 12.500" o "$ 1.250,50". Usa espacio duro entre el signo y el número para que no se corte. */
export function formatoMonto(monto: number): string {
  const [entero, dec] = monto.toFixed(2).split('.');
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `$ ${miles}${dec === '00' ? '' : `,${dec}`}`;
}

/** "2026-10-14" → "14/10/2026". */
export function formatoFecha(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export const anio = (iso: string) => iso.slice(0, 4);
