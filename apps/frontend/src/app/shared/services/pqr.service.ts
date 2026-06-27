import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface CreatePqrPublicDto {
  pqr_type: 'PETITION' | 'COMPLAINT' | 'CLAIM';
  name: string;
  email: string;
  phone?: string;
  subject: string;
  description: string;
  /**
   * Optional urgency hint. The public endpoint accepts only P1-P4 —
   * P0 is reserved for the support team's own triage. Defaults to P3
   * server-side when omitted.
   */
  priority?: PqrPriority;
  /**
   * When the requester is an authenticated store-admin / org-admin,
   * pass the owning `organization_id` so the org-admin PQR oversight
   * view can filter by tenant. Without this, the row is parked under
   * the Vendix platform org (legacy default for anonymous visitors).
   */
  organization_id?: number;
  /**
   * When the requester is a single store (store-admin acting on
   * behalf of their own tienda), pass the `store_id` so the
   * org-admin table can render the "Tienda" column.
   */
  store_id?: number;
  /**
   * Structured requester fields — preferred over the legacy `name` +
   * `email` + `phone` triplet. When populated, the backend stores
   * them in dedicated columns so the detail page renders them
   * directly. Legacy callers (public storefront, ecommerce) keep
   * working — the backend fills the structured columns from the
   * legacy `name` / `email` / `phone` as fallback.
   */
  requester_first_name?: string;
  requester_last_name?: string;
  requester_email?: string;
  requester_phone?: string;
  requester_document_type?: string;
  requester_document_num?: string;
}

export interface PqrCreateResponse {
  success: boolean;
  data: {
    // Numeric id is used by the store-admin navigation to the detail
    // page (route param `:id`). ticket_number is the human-readable
    // format shown to the user (PQR-{orgId}-{counter}).
    id: number;
    ticket_number: string;
    message: string;
  };
}

/**
 * Public view of a PQR returned by `GET /pqr/:ticket_number`. Only fields
 * safe for anonymous tracking are exposed (no description, no tags, no IP).
 */
export interface PublicPqrView {
  ticket_number: string;
  title: string;
  status: PqrStatus;
  pqr_type: 'PETITION' | 'COMPLAINT' | 'CLAIM';
  priority: PqrPriority;
  created_at: string | null;
  updated_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  public_responses: Array<{
    id: number;
    content: string;
    author_name: string;
    author_type: string;
    created_at: string | null;
  }>;
}

export interface PqrTrackResponse {
  success: boolean;
  data: PublicPqrView;
}

export type PqrType = 'PETITION' | 'COMPLAINT' | 'CLAIM';
export type PqrStatus =
  | 'NEW'
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'WAITING_RESPONSE'
  | 'RESOLVED'
  | 'CLOSED'
  | 'REOPENED';
export type PqrPriority = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';

@Injectable({ providedIn: 'root' })
export class PqrService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  /**
   * Public endpoint — no auth required. Submits a PQR (Petición /
   * Queja / Reclamo) and returns the generated ticket number so the
   * frontend can navigate to the thank-you page.
   */
  createPublic(dto: CreatePqrPublicDto): Observable<PqrCreateResponse> {
    return this.http.post<PqrCreateResponse>(`${this.apiUrl}/pqr`, dto);
  }

  /**
   * Public tracking — looks up a PQR by ticket_number. Returns a sanitized
   * view (no internal comments, no requester IP). Throttled server-side.
   */
  track(ticketNumber: string): Observable<PqrTrackResponse> {
    return this.http.get<PqrTrackResponse>(
      `${this.apiUrl}/pqr/${encodeURIComponent(ticketNumber)}`,
    );
  }
}