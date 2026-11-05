export type PaymentRequestStatus = 'pending' | 'awaiting_confirmation' | 'paid' | 'expired' | 'cancelled';

/** Row of GET /store/payment-requests (the token hash and the S3 key never come back). */
export interface PaymentRequest {
  id: number;
  purpose: string;
  amount: number | string;
  currency: string;
  description: string;
  status: PaymentRequestStatus;
  expires_at: string | null;
  transfer_store_payment_method_id: number | null;
  transfer_reference: string | null;
  transfer_submitted_at: string | null;
  rejection_reason: string | null;
  confirmed_at: string | null;
  paid_at: string | null;
  created_at: string;
  has_receipt: boolean;
}

/** GET /store/payment-requests/:id: the row plus a short-lived presigned receipt URL. */
export interface PaymentRequestDetail extends PaymentRequest {
  receipt_url: string | null;
}

export interface PaymentRequestPage {
  data: PaymentRequest[];
  total: number;
  totalPages: number;
}

export const PAYMENT_REQUEST_STATUS_LABELS: Record<PaymentRequestStatus, string> = {
  pending: 'Pendiente',
  awaiting_confirmation: 'En revisión',
  paid: 'Pagada',
  expired: 'Vencida',
  cancelled: 'Cancelada',
};

export const PAYMENT_REQUEST_PURPOSE_LABELS: Record<string, string> = {
  service_deposit: 'Anticipo de reserva',
};
