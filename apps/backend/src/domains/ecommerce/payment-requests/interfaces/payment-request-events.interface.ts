/** Emitted when a customer uploads a transfer receipt on `/pagar/:token`; the admin must confirm it. */
export interface PaymentRequestReceiptSubmittedEvent {
  store_id: number;
  payment_request_id: number;
  amount: number;
  purpose: string;
  description: string | null;
}
