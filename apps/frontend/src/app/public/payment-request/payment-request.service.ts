import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

export type PaymentRequestStatus =
  | 'pending'
  | 'awaiting_confirmation'
  | 'paid'
  | 'expired'
  | 'cancelled';

export type PaymentMethodKind = 'wompi' | 'transfer' | 'info';

export interface PaymentInstructions {
  bank_name?: string;
  account_holder?: string;
  account_number?: string;
  account_type?: string;
  instructions?: string;
  voucher_instructions?: string;
  redemption_phone?: string;
  notes?: string;
}

export interface PublicPaymentMethod {
  /** Only present for transfers: tells the store which account was paid. */
  id?: number;
  kind: PaymentMethodKind;
  name: string;
  logo_url: string | null;
  payment_instructions?: PaymentInstructions;
}

/** Bank account the store curated for a transfer method (same list as the checkout, QUI-728). */
export interface PublicBankAccount {
  id: number;
  name: string | null;
  bank_name: string;
  account_number: string;
  image_url: string | null;
}

export interface PublicPaymentRequest {
  amount: number;
  currency: string;
  /** IANA timezone of the store: dates on the page are printed in the store's clock. */
  timezone?: string | null;
  description: string;
  status: PaymentRequestStatus;
  expires_at: string | null;
  paid_at: string | null;
  rejection_reason: string | null;
  has_receipt: boolean;
  methods: PublicPaymentMethod[];
}

interface Envelope<T> {
  success: boolean;
  data: T;
}

/** Public payment page API: the token in the URL is the only credential. */
@Injectable({ providedIn: 'root' })
export class PaymentRequestService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/ecommerce/payment-requests`;

  get(token: string): Observable<PublicPaymentRequest> {
    return this.http
      .get<Envelope<PublicPaymentRequest>>(`${this.apiUrl}/${token}`, {
        headers: { 'Cache-Control': 'no-cache' },
      })
      .pipe(map((res) => res.data));
  }

  startWompi(token: string, returnUrl: string): Observable<{ checkout_url: string }> {
    return this.http
      .post<Envelope<{ checkout_url: string }>>(`${this.apiUrl}/${token}/wompi`, {
        return_url: returnUrl,
      })
      .pipe(map((res) => res.data));
  }

  /** Accounts of a transfer method; an empty list means "show the method instructions". */
  bankAccounts(methodId: number): Observable<PublicBankAccount[]> {
    return this.http
      .get<Envelope<PublicBankAccount[]>>(
        `${environment.apiUrl}/ecommerce/checkout/payment-methods/${methodId}/bank-accounts`,
      )
      .pipe(map((res) => res.data ?? []));
  }

  submitTransfer(
    token: string,
    file: File,
    reference: string,
    methodId: number | null,
  ): Observable<{ status: PaymentRequestStatus }> {
    const form = new FormData();
    form.append('file', file);
    if (reference.trim()) form.append('reference', reference.trim());
    if (methodId) form.append('method_id', String(methodId));
    return this.http
      .post<Envelope<{ status: PaymentRequestStatus }>>(`${this.apiUrl}/${token}/transfer`, form)
      .pipe(map((res) => res.data));
  }
}
