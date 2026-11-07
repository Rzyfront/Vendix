import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { ApiResponse, FileDownloadResult } from '../interfaces/workflow.interfaces';

export type SignatureMethod = 'otp_email' | 'otp_whatsapp';
export type SignatureRequestStatus =
  | 'pending'
  | 'partially_signed'
  | 'completed'
  | 'declined'
  | 'expired'
  | 'cancelled';
export type SignerStatus = 'pending' | 'viewed' | 'signed' | 'declined' | 'expired' | 'blocked';

export interface SignatureSignerView {
  id: number;
  name: string;
  document_number: string | null;
  role_label: string | null;
  method: SignatureMethod;
  /** Masked destination of the code. */
  destination: string;
  status: SignerStatus;
  viewed_at: string | null;
  otp_verified_at: string | null;
  signed_at: string | null;
  signed_ip: string | null;
  declined_reason: string | null;
}

export interface SignatureEventView {
  seq: number;
  type: string;
  signer_id: number | null;
  ip_address: string | null;
  occurred_at: string;
  payload: Record<string, unknown> | null;
  event_hash: string;
}

export interface SignatureRequestView {
  id: number;
  issued_document_id: number;
  status: SignatureRequestStatus;
  document_sha256: string;
  sealed_sha256: string | null;
  has_sealed_file: boolean;
  expires_at: string;
  created_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  chain: { valid: boolean; count: number; last_hash: string | null };
  signers: SignatureSignerView[];
  events: SignatureEventView[];
}

export type IssuedDocumentStatus =
  | 'rendering'
  | 'issued'
  | 'pending_signature'
  | 'signed'
  | 'voided'
  | 'superseded'
  | 'failed';

export interface SignableDocumentView {
  id: number;
  reference: string;
  title: string;
  status: IssuedDocumentStatus;
  requirement_key: string | null;
  issued_at: string | null;
  requests: SignatureRequestView[];
}

export interface SignerInput {
  name: string;
  document_number?: string;
  email?: string;
  phone?: string;
  role_label?: string;
  slot_key?: string;
  method: SignatureMethod;
}

/** Electronic signature (store side): issued documents of a request, send to sign, cancel, evidence. */
@Injectable({ providedIn: 'root' })
export class DocumentSignaturesApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/documents/signatures`;

  listByInstance(instanceId: number): Observable<SignableDocumentView[]> {
    return this.http
      .get<ApiResponse<SignableDocumentView[]>>(`${this.base}/instances/${instanceId}`)
      .pipe(map((res) => res.data));
  }

  create(issuedDocumentId: number, signers: SignerInput[]): Observable<SignatureRequestView> {
    return this.http
      .post<ApiResponse<SignatureRequestView>>(this.base, { issued_document_id: issuedDocumentId, signers })
      .pipe(map((res) => res.data));
  }

  cancel(requestId: number, reason: string): Observable<SignatureRequestView> {
    return this.http
      .post<ApiResponse<SignatureRequestView>>(`${this.base}/${requestId}/cancel`, { reason })
      .pipe(map((res) => res.data));
  }

  sealedDownload(requestId: number): Observable<FileDownloadResult> {
    return this.http
      .get<ApiResponse<FileDownloadResult>>(`${this.base}/${requestId}/sealed`)
      .pipe(map((res) => res.data));
  }
}
