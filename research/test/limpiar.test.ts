import { describe, expect, it } from 'vitest';
import { motivoParaSacar } from '../src/pasos/limpiar';

const e = (nombre_oficial: string, url = 'https://x.gob.ar/algo/', temas_sugeridos?: string[]) => ({ nombre_oficial, url, temas_sugeridos });

describe('limpiar', () => {
  it('saca noticias, fechas y páginas de error', () => {
    expect(motivoParaSacar(e('Avanza la pavimentación de calle Algarrobo'))).toBe('noticia');
    expect(motivoParaSacar(e('Algo', 'https://x.gob.ar/2024/03/algo/'))).toBe('noticia');
    expect(motivoParaSacar(e('marzo 2024'))).toBe('basura');
    expect(motivoParaSacar(e('No se encontró la página – Unquillo'))).toBe('basura');
    expect(motivoParaSacar(e('Too many requests'))).toBe('basura');
  });

  it('deja lo que nombra un trámite aunque parezca noticia', () => {
    expect(motivoParaSacar(e('Se abrió la inscripción a las colonias de verano'))).toBeNull();
    expect(motivoParaSacar(e('Oblea de estacionamiento para taxi'))).toBeNull();
    expect(motivoParaSacar(e('Antenas - Actualización del Responsable Administrativo'))).toBeNull();
    expect(motivoParaSacar(e('Calendario Impositivo', 'https://x.gob.ar/noticias/calendario/'))).toBeNull();
  });

  it('con sinTema saca lo que quedó sin tema y no nombra un trámite', () => {
    expect(motivoParaSacar(e('Museo Dámaso Arce', undefined, []), true)).toBe('sin tema');
    expect(motivoParaSacar(e('Museo Dámaso Arce', undefined, []))).toBeNull();
    expect(motivoParaSacar(e('Museo Dámaso Arce', undefined, undefined), true)).toBeNull();
    expect(motivoParaSacar(e('Turnos del hospital', undefined, []), true)).toBeNull();
  });
});
