import { dian_operation_mode_enum } from '@prisma/client';

/**
 * Composition of the DIAN enablement test set.
 *
 * ⚠️ LA COMPOSICIÓN NO SE DEDUCE DE LA NORMA: LA APROVISIONA LA DIAN POR SET.
 *
 * El portal de habilitación la muestra literalmente, en «Total de documentos
 * requeridos», y ese es el único dato autoritativo. Verificado el 2026-08-05
 * contra el portal de la plataforma (NIT 902056589, modo «Software propio»,
 * TestSetId 16bea3b2-eb83-40fe-a7cc-8d0f968b0713):
 *
 *     Documentos 50 · Facturas electrónicas 30 · Notas de débito 10 · Notas de crédito 10
 *
 * HISTORIA DEL DEFECTO — importa para no repetirlo:
 *
 * Este archivo nació para «corregir» un `TEST_SET_SIZE = 50` hardcodeado,
 * sustituyéndolo por 2 FV + 1 NC + 1 ND deducidos del art. 28 de la Resolución
 * 000165/2023 (y 6 + 2 + 2 del art. 55), y calificando el 50 de «composición
 * legacy 2019». Era una inferencia a partir del texto normativo en lugar de un
 * dato observado, y para una cuenta real resultó falsa.
 *
 * El fallo no dio ningún error: la DIAN acusó recibo del ZipKey, no clasificó el
 * lote de 4 documentos porque el set exige 50, y quedó ocho horas en
 * `NO_VERDICT`. Consultado por CUFE respondía `66 / TrackId no existe`. Nada en
 * la respuesta apuntaba al número de documentos.
 *
 * Peor: el comentario que declaraba «legacy» al 30/10/10 hacía que cada relectura
 * de este archivo confirmara la suposición equivocada.
 *
 * POR QUÉ AMBOS MODOS COMPARTEN CIFRAS: para `own_software` está verificado
 * arriba. Para `technological_provider` NO hay evidencia de portal alguna —el
 * 6 + 2 + 2 venía de la misma inferencia—, y la experiencia operativa es que la
 * DIAN pide 50 en todos los casos. Ante dos incógnitas se elige la única
 * observada. Si algún día un portal muestra otra cifra para un set, el dato va
 * capturado desde ese portal, no deducido de un artículo.
 *
 * @see docs/facturacion-electronica-dian-software-propio.md §4.3, §20.7
 */
export interface DianTestSetComposition {
  /** Facturas electrónicas de venta. */
  invoices: number;
  /** Notas débito. */
  debit_notes: number;
  /** Notas crédito. */
  credit_notes: number;
}

/**
 * Mínimo de documentos ACEPTADOS que la DIAN exige para aprobar el set.
 *
 * ⚠️ NO ES «CERO RECHAZOS», y esa suposición bloqueó una habilitación ya ganada.
 *
 * VERIFICADO contra el portal de habilitación el 2026-08-09 (NIT 902056589, modo
 * «Software propio»), sección «Total de documentos aceptados requeridos»:
 *
 *     Documentos 1 · Facturas electrónicas 1 · Notas de débito 0 · Notas de crédito 0
 *
 * Y verificado por el veredicto: el portal declaró «Su empresa ha superado
 * satisfactoriamente las pruebas de validación de su set de pruebas» con 30
 * facturas aceptadas y 167 documentos rechazados acumulados. Basta UNA factura
 * aceptada; los rechazos de notas no invalidan el set.
 *
 * Se lee del portal como la composición, por la misma razón: deducirlo del
 * articulado ya costó una habilitación (ver la historia del defecto arriba).
 */
export const DIAN_TEST_SET_MIN_ACCEPTED_DOCUMENTS = 1;

export const DIAN_TEST_SET_COMPOSITIONS: Record<
  dian_operation_mode_enum,
  DianTestSetComposition
> = {
  // VERIFICADO contra el portal de habilitación el 2026-08-05: 50 documentos.
  own_software: { invoices: 30, debit_notes: 10, credit_notes: 10 },
  // SIN evidencia de portal. Se iguala al único caso observado en vez de deducir
  // del art. 55, que es exactamente el error que costó la habilitación.
  technological_provider: { invoices: 30, debit_notes: 10, credit_notes: 10 },
};

/** Total consecutives a run consumes for the given mode. */
export function testSetSize(composition: DianTestSetComposition): number {
  return (
    composition.invoices + composition.debit_notes + composition.credit_notes
  );
}

/**
 * Resolves the composition for a configuration's operation mode, falling back to
 * `own_software` — el único modo con composición verificada contra un portal, y
 * el que usa hoy cada tenant de Vendix.
 */
export function resolveTestSetComposition(
  operation_mode: dian_operation_mode_enum | null | undefined,
): DianTestSetComposition {
  return (
    DIAN_TEST_SET_COMPOSITIONS[operation_mode ?? 'own_software'] ??
    DIAN_TEST_SET_COMPOSITIONS.own_software
  );
}

/**
 * Composition as the clients need it: counts, total and a rendered label.
 *
 * WHY IT LEAVES THE BACKEND: the composition was only ever used inside
 * `runTestSet`, so both UIs printed a hardcoded "50 documentos" — the legacy 2019
 * number. That text misinformed about the one thing that matters here, how many
 * consecutives of the resolution a run burns. A number the client cannot derive
 * is a number the client will hardcode and let drift.
 */
export interface DianTestSetCompositionView extends DianTestSetComposition {
  /** Consecutives the run consumes. */
  total: number;
  /** e.g. "2 facturas + 1 nota crédito + 1 nota débito". */
  label: string;
}

export function buildTestSetCompositionView(
  operation_mode: dian_operation_mode_enum | null | undefined,
): DianTestSetCompositionView {
  const composition = resolveTestSetComposition(operation_mode);
  return {
    ...composition,
    total: testSetSize(composition),
    label: describeComposition(composition),
  };
}

/**
 * Human-readable composition, for error messages and audit evidence.
 * e.g. "2 facturas + 1 nota crédito + 1 nota débito".
 */
export function describeComposition(
  composition: DianTestSetComposition,
): string {
  return [
    `${composition.invoices} factura${composition.invoices === 1 ? '' : 's'}`,
    `${composition.credit_notes} nota${composition.credit_notes === 1 ? '' : 's'} crédito`,
    `${composition.debit_notes} nota${composition.debit_notes === 1 ? '' : 's'} débito`,
  ].join(' + ');
}
