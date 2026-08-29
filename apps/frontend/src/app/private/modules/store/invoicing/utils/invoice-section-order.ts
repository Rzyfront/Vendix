/**
 * El ORDEN de las secciones de la captura fiscal, en UN solo lugar.
 *
 * ## Por qué existe
 *
 * Las mismas secciones se presentan dos veces: en «Nueva factura», donde se
 * llenan por documento, y en el editor de perfiles, donde se preconfiguran. Un
 * perfil es el espejo de una factura, y un espejo que ordena las cosas de otra
 * manera no es un espejo: obliga a aprender dos mapas de lo mismo.
 *
 * Cuando el orden vivía en las dos plantillas, divergió — AIU iba quinta en la
 * emisión y tercera en el perfil, y nadie lo notó hasta que alguien preguntó
 * por qué había que volver atrás a corregir líneas ya capturadas.
 *
 * ## Por qué AIU va ANTES de Líneas
 *
 * La configuración AIU decide qué componente lleva cada línea y qué porción es
 * gravable. Capturar primero las líneas y configurar el AIU después obliga a
 * recorrer las líneas otra vez, y ese segundo recorrido es donde se olvida
 * marcar una: una línea sin componente en un documento AIU declara una base
 * gravable distinta de la del contrato.
 *
 * ## Qué NO decide esta constante
 *
 * No decide visibilidad. Una sección puede estar en el orden y estar oculta por
 * el tipo de operación (AIU sólo se ve en operación 09) o por el tipo de
 * documento (Retenciones desaparece en una exportación sin filas). Eso lo
 * deciden las pantallas, que son las que conocen el estado del formulario.
 */

/**
 * Orden canónico. El vocabulario es el mismo de `INVOICE_SECTION_HELP`, para
 * que una sección tenga UN nombre en todo el flujo: el que usa su ayuda, el que
 * usa su id de plegado y el que usa el mapeo de errores del backend.
 */
export const INVOICE_SECTION_ORDER = [
  'perfil',
  'documento',
  'adquiriente',
  'aiu',
  'lineas',
  'impuestos',
  'retenciones',
  'divisa',
  'contabilidad',
  'formato',
  'notas_internas',
  'previsualizacion',
  'historial',
] as const;

/** Una sección del flujo fiscal, en el vocabulario canónico. */
export type InvoiceSectionId = (typeof INVOICE_SECTION_ORDER)[number];

/** En qué pantalla(s) vive cada sección. */
export type InvoiceSectionScreen = 'invoice' | 'profile' | 'both';

/**
 * Pertenencia por sección, y el porqué de cada exclusión.
 *
 *  - `perfil` — el selector de perfil sólo existe al emitir: un perfil no se
 *    preconfigura con otro perfil.
 *  - `adquiriente` — el cliente es del documento, no de la configuración.
 *    Precargar un adquiriente sería el peor default imaginable en una pantalla
 *    que gasta numeración autorizada.
 *  - `formato`, `notas_internas`, `previsualizacion`, `historial` — hoy sólo
 *    están en el perfil. Las tres primeras son candidatas a subir a la emisión
 *    (ver Fase E del plan); `historial` no: una factura no tiene versiones,
 *    tiene notas de ajuste.
 *
 * `divisa` SÍ está en las dos: el perfil guarda la divisa, no la tasa. La tasa
 * es del día de cada factura.
 */
export const INVOICE_SECTION_MEMBERSHIP = {
  perfil: 'invoice',
  documento: 'both',
  adquiriente: 'invoice',
  aiu: 'both',
  lineas: 'both',
  impuestos: 'both',
  retenciones: 'both',
  divisa: 'both',
  contabilidad: 'both',
  formato: 'profile',
  notas_internas: 'both',
  previsualizacion: 'profile',
  historial: 'profile',
} as const satisfies Record<InvoiceSectionId, InvoiceSectionScreen>;

/**
 * Las secciones de una pantalla, como TIPO. Cada página declara su `SectionId`
 * a partir de aquí, así que añadir una sección al orden y olvidarse de darle
 * ayuda, contador de errores o estado de plegado no compila.
 */
export type SectionsOf<S extends 'invoice' | 'profile'> = {
  [K in InvoiceSectionId]: (typeof INVOICE_SECTION_MEMBERSHIP)[K] extends S | 'both'
    ? K
    : never;
}[InvoiceSectionId];

/** Las secciones de «Nueva factura». */
export type InvoiceScreenSectionId = SectionsOf<'invoice'>;

/** Las secciones del editor de perfiles. */
export type ProfileScreenSectionId = SectionsOf<'profile'>;

/** El orden de una pantalla concreta, ya filtrado. */
export function sectionsFor<S extends 'invoice' | 'profile'>(
  screen: S,
): readonly SectionsOf<S>[] {
  return INVOICE_SECTION_ORDER.filter((section) => {
    const membership = INVOICE_SECTION_MEMBERSHIP[section];
    return membership === 'both' || membership === screen;
  }) as readonly SectionsOf<S>[];
}
