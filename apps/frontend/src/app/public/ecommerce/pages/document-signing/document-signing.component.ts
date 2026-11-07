import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { parseApiError } from '../../../../core/utils/parse-api-error';
import { TextareaComponent } from '../../../../shared/components/textarea/textarea.component';
import { DocumentSigningService, SigningView } from './document-signing.service';
import { SignaturePadComponent } from './signature-pad.component';

type PageState = 'loading' | 'ready' | 'not_found' | 'error';
type Outcome = 'signed' | 'declined' | null;

const OTP_LENGTH = 6;

/**
 * Public signing page (`/firmar/:token`, mobile first, no login): the document,
 * the signer, a one-time code by e-mail or WhatsApp, the consent text, the
 * drawn signature and the option to decline. An unknown, expired or cancelled
 * link only says "Este enlace no está disponible".
 */
@Component({
  selector: 'app-document-signing',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TextareaComponent, SignaturePadComponent],
  template: `
    <main class="mx-auto w-full max-w-xl px-4 py-6 sm:py-10">
      @switch (state()) {
        @case ('loading') {
          <p class="py-10 text-center text-text-secondary" role="status">Cargando documento...</p>
        }
        @case ('not_found') {
          <h1 class="text-xl font-semibold text-text-primary">Este enlace no está disponible</h1>
          <p class="mt-2 text-text-secondary">
            Puede haber vencido o haber sido cancelado. Pide a quien te envió el documento un enlace nuevo.
          </p>
        }
        @case ('error') {
          <h1 class="text-xl font-semibold text-text-primary">No pudimos cargar el documento</h1>
          <p class="mt-2 text-text-secondary" role="alert">{{ errorMessage() }}</p>
        }
        @default {
          @if (view(); as v) {
            <p class="text-sm text-text-secondary">{{ v.store.name }}</p>
            <h1 class="mt-1 text-2xl font-semibold text-text-primary" data-testid="document-title">
              {{ v.document.title }}
            </h1>
            <p class="text-sm text-text-secondary">{{ v.document.reference }}</p>
            <p class="break-all text-xs text-text-secondary" data-testid="document-sha256">
              Huella SHA-256: <span class="font-mono">{{ v.document.sha256 }}</span>
            </p>

            @if (outcome() === 'signed' || v.state === 'signed') {
              <section class="mt-6 rounded-2xl border border-border bg-surface p-5" data-testid="signed" role="status">
                <h2 class="text-xl font-semibold text-[var(--color-success)]">Documento firmado</h2>
                <p class="mt-2 text-text-secondary">
                  Recibimos tu firma. {{ v.store.name }} guardará el documento firmado y su evidencia.
                </p>
              </section>
            } @else if (outcome() === 'declined' || v.state === 'declined') {
              <section class="mt-6 rounded-2xl border border-border bg-surface p-5" data-testid="declined" role="status">
                <h2 class="text-xl font-semibold text-text-primary">Firma rechazada</h2>
                <p class="mt-2 text-text-secondary">Ya no se puede firmar este documento con este enlace.</p>
              </section>
            } @else if (v.state === 'blocked') {
              <section class="mt-6 rounded-2xl border border-border bg-surface p-5" data-testid="blocked" role="alert">
                <h2 class="text-xl font-semibold text-error">Enlace bloqueado</h2>
                <p class="mt-2 text-text-secondary">
                  Superaste el número de intentos del código. Pide a quien te envió el documento un enlace nuevo.
                </p>
              </section>
            } @else {
              <section class="mt-5 rounded-2xl border border-border bg-surface p-4" aria-label="Documento">
                @if (v.pdf_url) {
                  <a
                    class="flex h-12 items-center justify-center rounded-xl border border-border px-4 text-base font-semibold text-primary"
                    [href]="v.pdf_url"
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="open-pdf"
                  >
                    Abrir el documento (PDF)
                  </a>
                }
                <dl class="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt class="text-text-secondary">Firmante</dt>
                    <dd class="font-semibold text-text-primary" data-testid="signer-name">{{ v.signer.name }}</dd>
                  </div>
                  @if (v.signer.role_label) {
                    <div>
                      <dt class="text-text-secondary">Rol</dt>
                      <dd class="text-text-primary">{{ v.signer.role_label }}</dd>
                    </div>
                  }
                </dl>
              </section>

              <section class="mt-5 rounded-2xl border border-border bg-surface p-4" aria-label="Código">
                <h2 class="text-lg font-semibold text-text-primary">1. Verifica tu identidad</h2>
                @if (verified()) {
                  <p class="mt-2 text-sm font-medium text-[var(--color-success)]" role="status" data-testid="otp-verified">
                    Código verificado.
                  </p>
                } @else {
                  <p class="mt-1 text-sm text-text-secondary">
                    Te enviaremos un código de {{ otpLength }} dígitos por
                    {{ v.signer.method === 'otp_email' ? 'correo' : 'WhatsApp' }} a {{ destination() }}.
                  </p>
                  <button
                    type="button"
                    class="mt-3 h-12 w-full rounded-xl border border-border px-4 text-base font-semibold text-primary disabled:opacity-60"
                    [disabled]="sendingCode()"
                    (click)="sendCode()"
                  >
                    {{ sendingCode() ? 'Enviando...' : codeSent() ? 'Reenviar código' : 'Enviar código' }}
                  </button>
                  @if (codeSent()) {
                    <label class="mt-3 block text-sm text-text-secondary" for="otp-code">Código recibido</label>
                    <input
                      id="otp-code"
                      type="text"
                      inputmode="numeric"
                      autocomplete="one-time-code"
                      [attr.maxlength]="otpLength"
                      class="mt-1 h-12 w-full rounded-xl border border-border bg-background px-3 text-center text-xl tracking-[0.4em] text-text-primary"
                      [ngModel]="code()"
                      (ngModelChange)="onCode($event)"
                    />
                    <p class="mt-1 text-xs text-text-secondary" data-testid="attempts">
                      Intentos restantes: {{ attemptsRemaining() }}
                    </p>
                    <button
                      type="button"
                      class="mt-3 h-12 w-full rounded-xl bg-primary px-4 text-base font-semibold text-white disabled:opacity-60"
                      [disabled]="verifying() || code().length !== otpLength"
                      (click)="verifyCode()"
                    >
                      {{ verifying() ? 'Verificando...' : 'Verificar código' }}
                    </button>
                  }
                }
                @if (otpError()) {
                  <p class="mt-2 text-sm text-error" role="alert" data-testid="otp-error">{{ otpError() }}</p>
                }
              </section>

              @if (verified()) {
                <section class="mt-5 rounded-2xl border border-border bg-surface p-4" aria-label="Firma">
                  <h2 class="text-lg font-semibold text-text-primary">2. Firma</h2>
                  <label class="mt-2 flex items-start gap-3 text-sm text-text-primary">
                    <input
                      type="checkbox"
                      class="mt-1 h-5 w-5 shrink-0"
                      data-testid="consent"
                      [ngModel]="consent()"
                      (ngModelChange)="consent.set($event === true)"
                    />
                    <span data-testid="consent-text">{{ v.consent.text }}</span>
                  </label>
                  <div class="mt-4">
                    <app-signature-pad (signatureChange)="stroke.set($event)" />
                  </div>
                  <button
                    type="button"
                    class="mt-4 h-12 w-full rounded-xl bg-primary px-4 text-base font-semibold text-white disabled:opacity-60"
                    [disabled]="!canSign()"
                    (click)="sign()"
                  >
                    {{ signing() ? 'Firmando...' : 'Firmar' }}
                  </button>
                  @if (signError()) {
                    <p class="mt-2 text-sm text-error" role="alert">{{ signError() }}</p>
                  }
                </section>
              }

              <section class="mt-5" aria-label="Rechazar">
                @if (!declining()) {
                  <button
                    type="button"
                    class="h-12 w-full rounded-xl border border-border px-4 text-base font-semibold text-error"
                    (click)="declining.set(true)"
                  >
                    Rechazar
                  </button>
                } @else {
                  <div class="rounded-2xl border border-border bg-surface p-4">
                    <app-textarea
                      label="Motivo del rechazo"
                      [rows]="3"
                      [error]="declineError()"
                      [ngModel]="declineReason()"
                      [ngModelOptions]="{ standalone: true }"
                      (ngModelChange)="onReason($event)"
                    />
                    <div class="mt-3 flex gap-3">
                      <button
                        type="button"
                        class="h-12 flex-1 rounded-xl border border-border px-4 text-base font-semibold text-text-primary"
                        (click)="declining.set(false)"
                      >
                        Volver
                      </button>
                      <button
                        type="button"
                        class="h-12 flex-1 rounded-xl bg-error px-4 text-base font-semibold text-white disabled:opacity-60"
                        [disabled]="declineSending()"
                        (click)="decline()"
                      >
                        {{ declineSending() ? 'Enviando...' : 'Rechazar documento' }}
                      </button>
                    </div>
                  </div>
                }
              </section>
            }
          }
        }
      }
    </main>
  `,
})
export class DocumentSigningComponent implements OnInit {
  private readonly api = inject(DocumentSigningService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private token = '';

  readonly otpLength = OTP_LENGTH;
  readonly state = signal<PageState>('loading');
  readonly view = signal<SigningView | null>(null);
  readonly errorMessage = signal('');
  readonly outcome = signal<Outcome>(null);

  readonly codeSent = signal(false);
  readonly sendingCode = signal(false);
  readonly destinationOverride = signal<string | null>(null);
  readonly code = signal('');
  readonly verifying = signal(false);
  readonly verifiedNow = signal(false);
  readonly attemptsLeft = signal<number | null>(null);
  readonly otpError = signal('');

  readonly consent = signal(false);
  readonly stroke = signal<string | null>(null);
  readonly signing = signal(false);
  readonly signError = signal('');

  readonly declining = signal(false);
  readonly declineReason = signal('');
  readonly declineError = signal('');
  readonly declineSending = signal(false);

  readonly verified = computed(() => this.verifiedNow() || this.view()?.signer.otp_verified === true);
  readonly destination = computed(() => this.destinationOverride() ?? this.view()?.signer.destination ?? '');
  readonly attemptsRemaining = computed(
    () => this.attemptsLeft() ?? this.view()?.signer.attempts_remaining ?? 0,
  );
  readonly canSign = computed(
    () => this.consent() && this.stroke() !== null && !this.signing() && this.verified(),
  );

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    this.api
      .get(this.token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (view) => {
          this.view.set(view);
          this.state.set('ready');
        },
        error: (error: HttpErrorResponse) => this.onLoadError(error),
      });
  }

  onCode(value: string | null): void {
    this.code.set((value ?? '').replace(/\D/g, '').slice(0, OTP_LENGTH));
    this.otpError.set('');
  }

  onReason(value: string | null): void {
    this.declineReason.set(value ?? '');
    this.declineError.set('');
  }

  sendCode(): void {
    if (this.sendingCode()) return;
    this.sendingCode.set(true);
    this.otpError.set('');
    this.api
      .sendOtp(this.token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (sent) => {
          this.sendingCode.set(false);
          this.codeSent.set(true);
          this.destinationOverride.set(sent.destination);
          this.attemptsLeft.set(sent.attempts_remaining);
        },
        error: (error: HttpErrorResponse) => {
          this.sendingCode.set(false);
          this.onActionError(error, (message) => this.otpError.set(message));
        },
      });
  }

  verifyCode(): void {
    if (this.verifying() || this.code().length !== OTP_LENGTH) return;
    this.verifying.set(true);
    this.otpError.set('');
    this.api
      .verifyOtp(this.token, this.code())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.verifying.set(false);
          this.verifiedNow.set(true);
        },
        error: (error: HttpErrorResponse) => {
          this.verifying.set(false);
          const remaining = parseApiError(error).details?.attempts_remaining;
          if (typeof remaining === 'number') this.attemptsLeft.set(remaining);
          this.code.set('');
          this.onActionError(error, (message) => this.otpError.set(message));
        },
      });
  }

  sign(): void {
    const png = this.stroke();
    if (!this.canSign() || png === null) return;
    this.signing.set(true);
    this.signError.set('');
    this.api
      .sign(this.token, png, this.consent())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.signing.set(false);
          this.outcome.set('signed');
        },
        error: (error: HttpErrorResponse) => {
          this.signing.set(false);
          this.onActionError(error, (message) => this.signError.set(message));
        },
      });
  }

  decline(): void {
    const reason = this.declineReason().trim();
    if (reason.length < 3) {
      this.declineError.set('Escribe el motivo del rechazo.');
      return;
    }
    if (this.declineSending()) return;
    this.declineSending.set(true);
    this.api
      .decline(this.token, reason)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.declineSending.set(false);
          this.outcome.set('declined');
        },
        error: (error: HttpErrorResponse) => {
          this.declineSending.set(false);
          this.onActionError(error, (message) => this.declineError.set(message));
        },
      });
  }

  private onLoadError(error: HttpErrorResponse): void {
    if (error.status === 404) {
      this.state.set('not_found');
      return;
    }
    this.errorMessage.set(this.messageOf(error));
    this.state.set('error');
  }

  /** A 404 mid-way (the link expired or was cancelled) ends on the generic page. */
  private onActionError(error: HttpErrorResponse, show: (message: string) => void): void {
    if (error.status === 404) {
      this.state.set('not_found');
      return;
    }
    if (parseApiError(error).errorCode === 'SIGNATURE_BLOCKED') {
      this.view.update((v) => (v ? { ...v, state: 'blocked' } : v));
      return;
    }
    show(this.messageOf(error));
  }

  private messageOf(error: HttpErrorResponse): string {
    if (error.status === 429) return 'Demasiados intentos; espera un momento e inténtalo de nuevo.';
    if (error.status === 0) return 'Sin conexión. Revisa tu internet e intenta de nuevo.';
    const message = (error.error as { message?: unknown } | null)?.message;
    return typeof message === 'string' && message.trim() ? message : parseApiError(error).userMessage;
  }
}
