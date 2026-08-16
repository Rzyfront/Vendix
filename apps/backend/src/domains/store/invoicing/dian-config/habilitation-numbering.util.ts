/**
 * ¿Esta numeración es la de PRUEBA que la DIAN reparte para habilitarse, o es
 * numeración de PRODUCCIÓN con la que se factura de verdad?
 *
 * ── POR QUÉ HACE FALTA RESPONDERLO EN LECTURA ──────────────────────────────
 *
 * `invoice_resolutions` NO tiene columna de entorno. Nada en la tabla distingue
 * una resolución de prueba de una real: las dos tienen prefijo, rango, vigencia
 * y clave técnica, y las dos se leen igual desde el selector de resolución de la
 * pantalla de crear factura. Si una fila de habilitación entra sin marca, esa
 * pantalla puede ofrecerla y emitirse una factura real con numeración de pruebas
 * —y con la clave técnica que la DIAN le entrega a TODO el mundo—. Una factura
 * así no tiene validez fiscal y el consecutivo se gasta igual.
 *
 * Esta marca se DERIVA en cada lectura, no se persiste: no hay migración que
 * hacer y no hay una segunda copia del dato que pueda quedar desincronizada.
 *
 * ── QUÉ SE COMPRUEBA, Y POR QUÉ ESO ────────────────────────────────────────
 *
 * En habilitación la DIAN asigna a TODO contribuyente la MISMA numeración:
 * prefijo `SETP`, resolución `18760000001`, rango 990000000-995000000 y la MISMA
 * clave técnica. Está verificado contra el portal de habilitación de dos NIT
 * distintos y documentado en
 * `providers/fiscal-production-readiness.service.ts` (ver
 * `findResolutionsSharingTechnicalKey`), donde esa misma realidad es lo que
 * impide tratar la ClTec compartida como contaminación entre tenants.
 *
 * Se comprueban los dos datos que la DIAN ASIGNA —el número de la resolución y
 * la ventana de numeración—, no el prefijo:
 *
 *   · El número `18760000001` es el de la resolución de habilitación y no lo
 *     escoge el comerciante.
 *   · La ventana 990000000-995000000 es el bloque que la DIAN reserva para el
 *     ambiente de pruebas.
 *   · El prefijo `SETP` NO cuenta aquí, y es deliberado: es una cadena de cuatro
 *     letras que cualquiera puede teclear en una resolución propia, así que
 *     apoyarse en ella daría por «de pruebas» algo que factura de verdad —o al
 *     revés, dejaría pasar como producción un rango de habilitación cuyo
 *     prefijo alguien cambió al capturarlo a mano. Para el criterio por prefijo
 *     existe `isHabilitacionResolution` en
 *     `common/interfaces/fiscal-status.interface.ts`, que resuelve otra
 *     pregunta (¿puede este tenant pasar a producción?) y se conserva como está.
 *
 * ── POR QUÉ ES UN HELPER Y NO UN LITERAL REPETIDO ──────────────────────────
 *
 * Porque estos tres números ya viven sueltos en un comentario de
 * `fiscal-production-readiness.service.ts` y tecleados en media docena de specs.
 * El siguiente sitio que los necesite tiene que poder importarlos en vez de
 * volver a copiarlos: un literal copiado es un literal que alguien corrige en un
 * solo sitio.
 */

/** Número de la resolución de habilitación, igual para todo contribuyente. */
export const DIAN_HABILITATION_RESOLUTION_NUMBER = '18760000001';

/** Primer consecutivo del bloque que la DIAN reserva para pruebas. */
export const DIAN_HABILITATION_RANGE_FROM = 990000000;

/** Último consecutivo del bloque de pruebas. */
export const DIAN_HABILITATION_RANGE_TO = 995000000;

/**
 * Lo mínimo que hace falta para juzgar una numeración: de dónde salga —la
 * respuesta de `GetNumberingRange` o una fila de `invoice_resolutions`— da igual
 * mientras traiga estos campos.
 */
export interface HabilitationNumberingCandidate {
  resolution_number?: string | null;
  range_from?: number | null;
  range_to?: number | null;
}

/**
 * `true` cuando la numeración es la de habilitación (pruebas) y no una
 * autorización de facturación propia.
 *
 * Los dos criterios son ALTERNATIVOS a propósito. La DIAN reporta ambos juntos,
 * pero una fila capturada a mano puede haber perdido uno: exigir los dos
 * convertiría un dato incompleto en un «es de producción», que es justo el error
 * cuyo costo no se recupera. Con la disyunción, el dato incompleto se marca como
 * prueba, que a lo sumo obliga a mirar dos veces.
 */
export function isHabilitationNumbering(
  candidate: HabilitationNumberingCandidate | null | undefined,
): boolean {
  if (!candidate) return false;

  // Sólo dígitos: el número viaja como texto y una captura manual puede traerlo
  // con puntos o espacios (`18.760.000.001`). Normalizar no puede producir un
  // falso positivo — el único número que colisiona con éste es él mismo.
  const resolution_number = String(candidate.resolution_number ?? '').replace(
    /\D/g,
    '',
  );
  if (resolution_number === DIAN_HABILITATION_RESOLUTION_NUMBER) return true;

  // CONTENCIÓN, no solape: los dos extremos dentro de la ventana. Un rango que
  // sólo la roza no es la numeración de habilitación sino una anomalía, y
  // tratarla como prueba escondería el problema real detrás de una etiqueta que
  // parece explicarlo.
  return (
    isWithinHabilitationWindow(candidate.range_from) &&
    isWithinHabilitationWindow(candidate.range_to)
  );
}

function isWithinHabilitationWindow(value: number | null | undefined): boolean {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= DIAN_HABILITATION_RANGE_FROM &&
    value <= DIAN_HABILITATION_RANGE_TO
  );
}
