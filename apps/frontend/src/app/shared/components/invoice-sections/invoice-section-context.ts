/**
 * En qué pantalla se está pintando una sección de la captura fiscal.
 *
 * ## Por qué una bandera y no dos componentes
 *
 * Las mismas secciones existen dos veces: en «Nueva factura», donde se llenan
 * para un documento que va a gastar numeración autorizada, y en el editor de
 * perfiles, donde se preconfiguran para todas las facturas que nazcan de ese
 * perfil. Los campos son los mismos; lo que cambia es el significado de dejar
 * uno vacío y qué campos no tienen sentido siquiera.
 *
 * Dos componentes por sección es lo que había —marcado duplicado— y es lo que
 * produjo la divergencia que este plan corrige: un arreglo urgente se aplica en
 * la pantalla donde se reportó y la otra queda atrás sin que nadie lo note.
 *
 * ## Lo que la bandera NO debe usarse para decidir
 *
 * No decide nombres de campo del payload: eso lo hace la función de mapeo de
 * cada página (ver `invoice-section-field-map.ts` y el ADR-2 del plan). Un
 * componente de sección que arme payload según el contexto acabaría con la
 * lógica de dos DTO dentro de un control de UI.
 */
export type InvoiceSectionContext = 'invoice' | 'profile';

/** Se está capturando un documento real, no una preconfiguración. */
export function isInvoiceContext(context: InvoiceSectionContext): boolean {
  return context === 'invoice';
}

/** Se está preconfigurando un perfil, no emitiendo. */
export function isProfileContext(context: InvoiceSectionContext): boolean {
  return context === 'profile';
}
