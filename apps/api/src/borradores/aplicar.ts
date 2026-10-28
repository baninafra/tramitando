/**
 * Aplicación de un borrador aprobado.
 *
 * Arma todas las sentencias que publican una ficha (o activan un tema propuesto) y las devuelve
 * para que el llamador las ejecute en un único `D1Database.batch`, que es atómico. Para los ids que
 * todavía no existen se usan subconsultas por clave natural (slug, url), nunca lecturas intermedias.
 */
import { BorradorFicha, BorradorTema } from '@tramitando/shared';
import { reindexarTramite } from '../fts';

export interface BorradorAprobable {
  id: number;
  tipo: 'ficha_nueva' | 'actualizacion' | 'tema_nuevo';
  origen: 'ia' | 'reporte' | 'admin';
  catalogo_id: number | null;
  variante_id: number | null;
  reporte_id: number | null;
  payload: string;
}

/** Error de negocio al aplicar un borrador. `admin.ts` lo traduce a la respuesta HTTP. */
export class ErrorAplicacion extends Error {
  constructor(
    public readonly codigo: string,
    public readonly status: 404 | 409 | 422,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'ErrorAplicacion';
  }
}

const DIAS_REVISION = 90;

export function slugificar(texto: string): string {
  const limpio = texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return limpio || 'organismo';
}

/** Clave natural del organismo: nombre + jurisdicción, para no mezclar organismos homónimos. */
export function slugOrganismo(nombre: string, jurisdiccionId: string): string {
  return `${slugificar(nombre)}-${slugificar(jurisdiccionId)}`;
}

/** Parsea el payload guardado y, si vino uno editado, lo valida con el esquema que corresponde. */
export function validarPayload(tipo: BorradorAprobable['tipo'], payload: unknown): BorradorFicha | BorradorTema {
  const resultado = tipo === 'tema_nuevo' ? BorradorTema.safeParse(payload) : BorradorFicha.safeParse(payload);
  if (!resultado.success) {
    const problema = resultado.error.issues[0];
    const donde = problema?.path.join('.') || 'payload';
    throw new ErrorAplicacion('payload_invalido', 422, `El borrador no es válido en "${donde}": ${problema?.message ?? 'dato inválido'}`);
  }
  return resultado.data;
}

async function temasActivos(db: D1Database, slugs: string[]): Promise<Set<string>> {
  const marcadores = slugs.map(() => '?').join(', ');
  const { results } = await db
    .prepare(`SELECT slug FROM temas WHERE estado = 'activo' AND slug IN (${marcadores})`)
    .bind(...slugs)
    .all<{ slug: string }>();
  return new Set(results.map((t) => t.slug));
}

/**
 * Devuelve las sentencias para aplicar `payload` sobre `borrador`.
 * Lanza `ErrorAplicacion` si el borrador no se puede publicar (por ejemplo, tema sin aprobar).
 */
export async function aplicarBorrador(
  db: D1Database,
  borrador: BorradorAprobable,
  payload: BorradorFicha | BorradorTema,
  ahora: Date = new Date(),
): Promise<D1PreparedStatement[]> {
  const ahoraIso = ahora.toISOString();
  const sentencias: D1PreparedStatement[] = [];

  if (borrador.tipo === 'tema_nuevo') {
    const tema = payload as BorradorTema;
    sentencias.push(
      db
        .prepare(
          `INSERT INTO temas (slug, nombre, descripcion, tipo, padre_id, estado)
           VALUES (?, ?, ?, ?, (SELECT id FROM temas WHERE slug = ?), 'activo')
           ON CONFLICT(slug) DO UPDATE SET
             nombre = excluded.nombre,
             descripcion = excluded.descripcion,
             tipo = excluded.tipo,
             padre_id = excluded.padre_id,
             estado = 'activo'`,
        )
        .bind(tema.slug, tema.nombre, tema.descripcion, tema.tipo, tema.padre),
    );
    sentencias.push(
      db.prepare("UPDATE borradores SET estado = 'aprobado', revisado_en = ? WHERE id = ?").bind(ahoraIso, borrador.id),
    );
    return sentencias;
  }

  const ficha = payload as BorradorFicha;
  const slug = ficha.tramite.slug;
  const jurisdiccion = ficha.jurisdiccion_id;

  const activos = await temasActivos(db, ficha.tramite.temas);
  const faltantes = ficha.tramite.temas.filter((t) => !activos.has(t));
  if (faltantes.length > 0) {
    throw new ErrorAplicacion(
      'tema_no_activo',
      422,
      `Antes de publicar hay que aprobar el tema ${faltantes.map((t) => `"${t}"`).join(', ')}.`,
    );
  }

  const organismoSlug = slugOrganismo(ficha.organismo.nombre, jurisdiccion);
  const variantePorClave = `(SELECT v.id FROM variantes v
      WHERE v.tramite_id = (SELECT id FROM tramites WHERE slug = ?) AND v.jurisdiccion_id = ?)`;

  // 1. Trámite (el slug es estable; un cambio de nombre no lo toca).
  sentencias.push(
    db
      .prepare(
        `INSERT INTO tramites (slug, nombre, nombre_busqueda, resumen, sinonimos, estado)
         VALUES (?, ?, ?, ?, ?, 'activo')
         ON CONFLICT(slug) DO UPDATE SET
           nombre = excluded.nombre,
           nombre_busqueda = excluded.nombre_busqueda,
           resumen = excluded.resumen,
           sinonimos = excluded.sinonimos,
           estado = 'activo'`,
      )
      .bind(
        slug,
        ficha.tramite.nombre,
        ficha.tramite.nombre_busqueda,
        ficha.tramite.resumen,
        JSON.stringify(ficha.tramite.sinonimos),
      ),
  );

  // 2. Temas del trámite (el primero es el principal).
  sentencias.push(
    db.prepare('DELETE FROM tramite_temas WHERE tramite_id = (SELECT id FROM tramites WHERE slug = ?)').bind(slug),
  );
  ficha.tramite.temas.forEach((temaSlug, indice) => {
    sentencias.push(
      db
        .prepare(
          `INSERT INTO tramite_temas (tramite_id, tema_id, principal)
           VALUES ((SELECT id FROM tramites WHERE slug = ?), (SELECT id FROM temas WHERE slug = ?), ?)`,
        )
        .bind(slug, temaSlug, indice === 0 ? 1 : 0),
    );
  });

  // 3. Organismo por slug derivado del nombre + jurisdicción.
  sentencias.push(
    db
      .prepare(
        `INSERT INTO organismos (slug, nombre, sigla, jurisdiccion_id, web)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET
           nombre = excluded.nombre,
           sigla = excluded.sigla,
           web = excluded.web`,
      )
      .bind(organismoSlug, ficha.organismo.nombre, ficha.organismo.sigla, jurisdiccion, ficha.organismo.web),
  );

  // 4. Fuentes (upsert por URL).
  for (const fuente of ficha.fuentes) {
    sentencias.push(
      db
        .prepare(
          `INSERT INTO fuentes (url, titulo, organismo_id)
           VALUES (?, ?, (SELECT id FROM organismos WHERE slug = ?))
           ON CONFLICT(url) DO UPDATE SET
             titulo = excluded.titulo,
             organismo_id = excluded.organismo_id`,
        )
        .bind(fuente.url, fuente.titulo, organismoSlug),
    );
  }

  // 5. Variante: inserta o actualiza con version + 1 y renovación de la verificación.
  const proximaRevision = new Date(ahora.getTime() + DIAS_REVISION * 24 * 60 * 60 * 1000).toISOString();
  sentencias.push(
    db
      .prepare(
        `INSERT INTO variantes
           (tramite_id, jurisdiccion_id, organismo_id, estado, verificacion, contenido,
            verificado_en, proxima_revision, version, actualizado_en)
         VALUES
           ((SELECT id FROM tramites WHERE slug = ?), ?, (SELECT id FROM organismos WHERE slug = ?),
            'publicada', 'verificado', ?, ?, ?, 1, ?)
         ON CONFLICT(tramite_id, jurisdiccion_id) DO UPDATE SET
           organismo_id = excluded.organismo_id,
           estado = 'publicada',
           verificacion = 'verificado',
           contenido = excluded.contenido,
           verificado_en = excluded.verificado_en,
           proxima_revision = excluded.proxima_revision,
           version = variantes.version + 1,
           actualizado_en = excluded.actualizado_en`,
      )
      .bind(slug, jurisdiccion, organismoSlug, JSON.stringify(ficha.contenido), ahoraIso, proximaRevision, ahoraIso),
  );

  // 6. Costos: se reemplazan todos los de la variante.
  sentencias.push(db.prepare(`DELETE FROM costos WHERE variante_id = ${variantePorClave}`).bind(slug, jurisdiccion));
  ficha.costos.forEach((costo, orden) => {
    sentencias.push(
      db
        .prepare(
          `INSERT INTO costos
             (variante_id, modalidad, monto_centavos, gratis, vigente_desde, nota, fuente_id, orden)
           VALUES (${variantePorClave}, ?, ?, ?, ?, ?, (SELECT id FROM fuentes WHERE url = ?), ?)`,
        )
        .bind(
          slug,
          jurisdiccion,
          costo.modalidad,
          costo.monto_centavos,
          costo.gratis ? 1 : 0,
          costo.vigente_desde,
          costo.nota,
          costo.fuente_url,
          orden,
        ),
    );
  });

  // 7. Oficinas del organismo en la jurisdicción: se reemplazan.
  sentencias.push(
    db
      .prepare('DELETE FROM oficinas WHERE organismo_id = (SELECT id FROM organismos WHERE slug = ?) AND jurisdiccion_id = ?')
      .bind(organismoSlug, jurisdiccion),
  );
  for (const oficina of ficha.oficinas) {
    sentencias.push(
      db
        .prepare(
          `INSERT INTO oficinas
             (organismo_id, jurisdiccion_id, nombre, direccion, localidad, horario, fuente_id)
           VALUES
             ((SELECT id FROM organismos WHERE slug = ?), ?, ?, ?, ?, ?, (SELECT id FROM fuentes WHERE url = ?))`,
        )
        .bind(
          organismoSlug,
          jurisdiccion,
          oficina.nombre,
          oficina.direccion,
          oficina.localidad,
          oficina.horario,
          oficina.fuente_url,
        ),
    );
  }

  // 8. Fuentes por bloque.
  sentencias.push(db.prepare(`DELETE FROM variante_fuentes WHERE variante_id = ${variantePorClave}`).bind(slug, jurisdiccion));
  for (const fuente of ficha.fuentes) {
    for (const bloque of fuente.bloques) {
      sentencias.push(
        db
          .prepare(
            `INSERT INTO variante_fuentes (variante_id, fuente_id, bloque)
             VALUES (${variantePorClave}, (SELECT id FROM fuentes WHERE url = ?), ?)`,
          )
          .bind(slug, jurisdiccion, fuente.url, bloque),
      );
    }
  }

  // 9. Verificación del admin.
  const resultado = borrador.tipo === 'ficha_nueva' ? 'creada' : 'actualizada';
  sentencias.push(
    db
      .prepare(
        `INSERT INTO verificaciones (variante_id, autor, resultado, notas)
         VALUES (${variantePorClave}, 'admin', ?, ?)`,
      )
      .bind(slug, jurisdiccion, resultado, null),
  );

  // 10. Búsqueda.
  sentencias.push(...reindexarTramite(db, slug));

  // 11. Catálogo asociado.
  if (borrador.catalogo_id !== null) {
    sentencias.push(
      db
        .prepare(
          `UPDATE catalogo
             SET estado = 'publicado',
                 tramite_id = (SELECT id FROM tramites WHERE slug = ?),
                 variante_id = ${variantePorClave},
                 actualizado_en = ?
           WHERE id = ?`,
        )
        .bind(slug, slug, jurisdiccion, ahoraIso, borrador.catalogo_id),
    );
  }

  // 12. Las fuentes usadas quedan revisadas.
  const urls = ficha.fuentes.map((f) => f.url);
  sentencias.push(
    db
      .prepare(`UPDATE fuentes SET cambio_detectado_en = NULL WHERE url IN (${urls.map(() => '?').join(', ')})`)
      .bind(...urls),
  );

  // 13. Cerrar el borrador.
  sentencias.push(
    db.prepare("UPDATE borradores SET estado = 'aprobado', revisado_en = ? WHERE id = ?").bind(ahoraIso, borrador.id),
  );

  return sentencias;
}
