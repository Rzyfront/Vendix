/**
 * Reconoce la numeración de HABILITACIÓN: la que la DIAN reparte IGUAL a todo
 * contribuyente para el set de pruebas.
 *
 * ─── POR QUÉ ESTO EXISTE ────────────────────────────────────────────────────
 *
 * En habilitación la DIAN no autoriza un rango propio por comerciante: asigna a
 * TODOS el mismo prefijo `SETP`, la misma resolución `18760000001`, el mismo
 * rango 990000000-995000000 y —esto es lo grave— la MISMA clave técnica. Está
 * documentado en el backend, verificado contra dos NIT distintos, en
 * `providers/fiscal-production-readiness.service.ts`.
 *
 * Y `invoice_resolutions` NO TIENE COLUMNA DE ENTORNO. Nada en la base
 * distingue una resolución de prueba de una real. Si una fila de habilitación
 * queda registrada —hoy se teclea a mano, y desde la sincronización con
 * `GetNumberingRange` puede entrar de un clic— el selector de la pantalla de
 * crear factura la ofrece como cualquier otra, y sale una factura REAL numerada
 * con un rango de pruebas. Este predicado es la única señal que existe.
 *
 * ─── POR QUÉ NO SE MIRA EL PREFIJO ──────────────────────────────────────────
 *
 * `SETP` es una cadena que cualquiera puede teclear en una resolución propia, y
 * al revés: la DIAN podría devolverlo con otra caja. Lo que identifica de verdad
 * son el número de resolución y el rango, que son los que la DIAN fija.
 *
 * El sesgo del predicado es DELIBERADO: ante la duda, marcar. Un falso positivo
 * degrada una resolución legítima a segundo lugar de la lista y el usuario puede
 * elegirla igual — molesto y reversible. Un falso negativo emite una factura
 * real con numeración de pruebas y con la clave técnica que la DIAN le dio a
 * todo el mundo: consecutivo autorizado gastado que no se recupera.
 */

/** La resolución fija que la DIAN asigna a todo el mundo en habilitación. */
export const DIAN_HABILITATION_RESOLUTION_NUMBER = '18760000001';

/** Rango de pruebas, idéntico para todo contribuyente. */
export const DIAN_HABILITATION_RANGE_FROM = 990000000;
export const DIAN_HABILITATION_RANGE_TO = 995000000;

/** Lo mínimo que hace falta leer de una fila para clasificarla. */
export interface HabilitationNumberingCandidate {
  resolution_number?: string | number | null;
  range_from?: string | number | null;
  range_to?: string | number | null;
}

/** `true` cuando la fila es numeración de pruebas, no numeración autorizada. */
export function isHabilitationNumbering(
  candidate: HabilitationNumberingCandidate | null | undefined,
): boolean {
  if (!candidate) return false;

  const resolutionNumber = String(candidate.resolution_number ?? '').trim();
  if (resolutionNumber === DIAN_HABILITATION_RESOLUTION_NUMBER) return true;

  const from = Number(candidate.range_from);
  const to = Number(candidate.range_to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return false;

  // Contención, no intersección: un rango de producción que apenas rozara la
  // ventana seguiría siendo de producción. Lo que delata a la numeración de
  // pruebas es caer ENTERA dentro del tramo que la DIAN reservó para ella.
  return (
    from >= DIAN_HABILITATION_RANGE_FROM && to <= DIAN_HABILITATION_RANGE_TO
  );
}
