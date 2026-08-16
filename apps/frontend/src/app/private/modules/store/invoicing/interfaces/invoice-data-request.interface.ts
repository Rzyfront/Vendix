/**
 * SOLICITUDES DE FACTURA A NOMBRE DEL CLIENTE.
 *
 * Cuando una venta se cierra a consumidor final y el cliente después pide su
 * factura nominativa, entra por el enlace público post-venta y crea una fila en
 * `invoice_data_requests`. Un listener
 * (`invoice-data-request-submitted.listener.ts`) intenta convertirla sola: nota
 * crédito de la factura CF + factura nueva a nombre del cliente.
 *
 * Cuando esa conversión falla, la fila queda en `failed` y el propio listener
 * remata su log con «use the admin process endpoint to retry». Ese endpoint
 * —`POST /store/invoice-data-requests/:id/process`— existía sin un solo cliente,
 * igual que el listado. Es decir: el reintento del que habla el comentario era
 * imposible desde el producto, y un cliente que pidió su factura se quedaba
 * esperando en silencio, sin que nadie en la tienda pudiera siquiera verlo.
 */

/** `invoice_data_request_status_enum` de Prisma, verbatim. */
export type InvoiceDataRequestStatus =
  | 'pending'
  | 'submitted'
  | 'processing'
  | 'completed'
  | 'expired'
  | 'failed';

/** La orden original, tal como la proyecta `findByStore` con su `select`. */
export interface InvoiceDataRequestOrder {
  id: number;
  order_number: string | null;
  grand_total: string | number | null;
  created_at: string | null;
}

export interface InvoiceDataRequestRow {
  id: number;
  store_id: number;
  order_id: number;
  /** Factura CF original, si la venta llegó a emitir una. */
  invoice_id: number | null;
  /**
   * El token del enlace público. NO SE PINTA NUNCA: quien lo tenga puede
   * escribir los datos fiscales de esa venta. Se declara para que el tipo sea
   * fiel a lo que viaja, no para mostrarlo.
   */
  token: string;
  first_name: string | null;
  last_name: string | null;
  document_type: string | null;
  document_number: string | null;
  email: string | null;
  phone: string | null;
  status: InvoiceDataRequestStatus;
  submitted_at: string | null;
  processed_at: string | null;
  /** Factura nominativa resultante, cuando la conversión terminó bien. */
  new_invoice_id: number | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
  order?: InvoiceDataRequestOrder | null;
}
