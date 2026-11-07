import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../environments/environment';

export type SigningState = 'pending' | 'signed' | 'declined' | 'blocked';

export interface SigningView {
  state: SigningState;
  store: { name: string };
  document: { title: string; reference: string };
  signer: {
    name: string;
    role_label: string | null;
    method: 'otp_email' | 'otp_whatsapp';
    /** Masked destination of the code. */
    destination: string;
    otp_verified: boolean;
    attempts_remaining: number;
  };
  consent: { text: string; version: string };
  pdf_url: string | null;
  expires_at: string;
}

export interface OtpSent {
  sent: boolean;
  destination: string;
  expires_in_seconds: number;
  resend_after_seconds: number;
  attempts_remaining: number;
}

/** Anonymous client of `ecommerce/documents/sign/:token` (store resolved by the domain). */
@Injectable({ providedIn: 'root' })
export class DocumentSigningService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/ecommerce/documents/sign`;

  private url(token: string, path = ''): string {
    return `${this.base}/${encodeURIComponent(token)}${path}`;
  }

  get(token: string): Observable<SigningView> {
    return this.http.get<{ data: SigningView }>(this.url(token)).pipe(map((res) => res.data));
  }

  sendOtp(token: string): Observable<OtpSent> {
    return this.http.post<{ data: OtpSent }>(this.url(token, '/otp'), {}).pipe(map((res) => res.data));
  }

  verifyOtp(token: string, code: string): Observable<unknown> {
    return this.http.post(this.url(token, '/otp/verify'), { code });
  }

  /** `signaturePng` is the data URL (or bare base64) of the drawn stroke. */
  sign(token: string, signaturePng: string, consent: boolean): Observable<{ signed: boolean; completed: boolean }> {
    return this.http
      .post<{ data: { signed: boolean; completed: boolean } }>(this.url(token, '/sign'), {
        signature_png: signaturePng,
        consent,
      })
      .pipe(map((res) => res.data));
  }

  decline(token: string, reason: string): Observable<unknown> {
    return this.http.post(this.url(token, '/decline'), { reason });
  }
}
