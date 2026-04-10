export interface InvoiceDataRequestEvent {
  store_id: number;
  request_id: number;
  order_id: number;
  token: string;
  status: string;
  customer_name?: string;
  document_number?: string;
}
