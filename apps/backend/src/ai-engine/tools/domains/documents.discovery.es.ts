/** Discovery phrases (colloquial Colombian Spanish) for the document-saving tools (T44). */
const phrases = (noun: string): string[] => [
  `guarda esta factura en ${noun} #123`,
  `asocia el archivo que te mandé a ${noun}`,
  `deja este documento guardado en ${noun}`,
  `adjunta el PDF que subí a ${noun}`,
  `quiero que el comprobante quede en la ficha de ${noun}`,
  `súbele este archivo a ${noun} para que no se pierda`,
];

export const DOCUMENTS_DISCOVERY_QUERIES_ES: Record<string, string[]> = {
  attach_document_to_customer: phrases('el cliente'),
  attach_document_to_order: phrases('la orden'),
  attach_document_to_purchase_order: phrases('la orden de compra'),
  attach_document_to_supplier: phrases('el proveedor'),
  attach_document_to_expense: phrases('el gasto'),
  attach_document_to_product: phrases('el producto'),
};
