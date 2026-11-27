import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Public config of Vexi for this store (`GET ecommerce/vexi/config`). */
export interface VexiPublicConfig {
  enabled: boolean;
  name: 'Vexi';
  greeting: string;
  /** Digits of the store's WhatsApp for the order handoff, or null. */
  whatsapp_number: string | null;
  store_name: string | null;
}

export interface VexiPublicSession {
  session_id: string;
  token: string;
  expires_at: string;
}

export interface VexiOrderCardItem {
  product_id: number;
  variant_id: number | null;
  name: string;
  variant_name: string | null;
  sku: string | null;
  quantity: number;
  unit_price: number;
}

export type VexiPublicCard =
  | { kind: 'order'; items: VexiOrderCardItem[] }
  | { kind: 'booking'; product_id: number; name: string; slug: string | null }
  | {
      kind: 'request';
      pqr_type: 'PETITION' | 'COMPLAINT' | 'CLAIM' | 'SUGGESTION';
      subject: string;
      description: string;
    };

export interface VexiPublicReply {
  reply: string;
  cards: VexiPublicCard[];
}

export interface VexiPublicContext {
  app_type?: string;
  route?: string;
  product_id?: number;
  cart?: Array<{ product_id: number; variant_id?: number; quantity: number }>;
}

/** Widget state for a refused request; `null` for anything else. */
export type VexiPublicErrorState =
  | 'rate_limited'
  | 'daily_cap'
  | 'disabled'
  | 'unavailable'
  | 'session_expired';

export function vexiPublicErrorState(error: unknown): VexiPublicErrorState | null {
  if (!(error instanceof HttpErrorResponse)) return null;
  const code = (error.error as { error_code?: string } | null)?.error_code;
  switch (code) {
    case 'VEXI_PUBLIC_DAILY_CAP':
      return 'daily_cap';
    case 'VEXI_PUBLIC_RATE_LIMITED':
      return 'rate_limited';
    case 'VEXI_PUBLIC_DISABLED':
      return 'disabled';
    case 'VEXI_PUBLIC_UNAVAILABLE':
      return 'unavailable';
    case 'VEXI_PUBLIC_SESSION_INVALID':
      return 'session_expired';
  }
  return error.status === 429 ? 'rate_limited' : null;
}

/**
 * Vexi público F2 — the storefront chat API. Text only: there is no voice,
 * audio or TTS call here by decision (D1). `x-store-id` is added by the
 * tenant interceptor; the backend resolves the store from the domain.
 */
@Injectable({ providedIn: 'root' })
export class VexiPublicApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/ecommerce/vexi`;

  getConfig(): Observable<VexiPublicConfig> {
    return this.http
      .get<{ data: VexiPublicConfig }>(`${this.base}/config`)
      .pipe(map((r) => r.data));
  }

  createSession(appType: string): Observable<VexiPublicSession> {
    return this.http
      .post<{ data: VexiPublicSession }>(`${this.base}/sessions`, {
        consent: true,
        app_type: appType,
      })
      .pipe(map((r) => r.data));
  }

  sendMessage(
    session: Pick<VexiPublicSession, 'session_id' | 'token'>,
    message: string,
    context?: VexiPublicContext,
  ): Observable<VexiPublicReply> {
    return this.http
      .post<{ data: VexiPublicReply }>(
        `${this.base}/sessions/${encodeURIComponent(session.session_id)}/messages`,
        { message, ...(context ? { context } : {}) },
        { headers: new HttpHeaders({ 'x-vexi-session': session.token }) },
      )
      .pipe(map((r) => r.data));
  }
}
