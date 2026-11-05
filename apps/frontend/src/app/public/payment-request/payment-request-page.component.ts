import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Meta } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { BadgeComponent, ButtonComponent, IconComponent } from '../../shared/components';
import { CurrencyFormatService } from '../../shared/pipes/currency';
import { formatStoreDateTime } from '../../shared/utils/date.util';
import {
  PaymentRequestService,
  PaymentRequestStatus,
  PublicBankAccount,
  PublicPaymentMethod,
  PublicPaymentRequest,
} from './payment-request.service';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

const INSTRUCTION_LABELS: Array<[string, string]> = [
  ['bank_name', 'Banco'],
  ['account_type', 'Tipo de cuenta'],
  ['account_number', 'Número de cuenta'],
  ['account_holder', 'Titular'],
  ['redemption_phone', 'Teléfono'],
  ['instructions', 'Instrucciones'],
  ['voucher_instructions', 'Instrucciones'],
  ['notes', 'Notas'],
];

/**
 * Public payment page (`/pagar/:token`): shows the amount and the store's
 * online payment methods (Wompi, bank transfers with instructions, others).
 * A transfer is only a receipt: the store confirms it before it counts as paid.
 */
@Component({
  selector: 'app-payment-request-page',
  standalone: true,
  imports: [BadgeComponent, ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-4 bg-background px-4 py-6 text-text-primary">
      <header>
        <p class="text-xs font-semibold uppercase tracking-wide text-text-secondary">Pago en línea</p>
        <h1 class="text-xl font-bold">Completa tu pago</h1>
      </header>

      @switch (state()) {
        @case ('loading') {
          <section class="rounded-2xl border border-border bg-surface p-4 text-sm text-text-secondary" role="status">
            Cargando tu enlace de pago…
          </section>
        }
        @case ('unavailable') {
          <section class="rounded-2xl border border-error/25 bg-error/10 p-4" role="alert">
            <h2 class="text-base font-bold text-error">Este enlace no está disponible</h2>
            <p class="mt-1 text-sm text-text-secondary">
              Puede estar mal escrito o haber sido desactivado. Pide a la tienda un enlace nuevo.
            </p>
          </section>
        }
        @case ('error') {
          <section class="rounded-2xl border border-error/25 bg-error/10 p-4" role="alert">
            <h2 class="text-base font-bold text-error">No pudimos cargar el pago</h2>
            <p class="mt-1 text-sm text-text-secondary">Revisa tu conexión e intenta de nuevo.</p>
            <div class="mt-3">
              <app-button variant="secondary" size="sm" (clicked)="load()">Intentar de nuevo</app-button>
            </div>
          </section>
        }
        @default {
          @if (request(); as req) {
            <section class="rounded-2xl border border-border bg-surface p-4">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-xs font-semibold text-text-secondary">Valor a pagar</p>
                  <p class="text-3xl font-bold tabular-nums">{{ money(req.amount) }}</p>
                </div>
                <app-badge [variant]="statusVariant()" size="sm">{{ statusLabel() }}</app-badge>
              </div>
              <p class="mt-3 text-sm">{{ req.description }}</p>
              @if (req.status === 'pending' && req.expires_at) {
                <p class="mt-2 text-xs text-text-secondary">Disponible hasta {{ dateTime(req.expires_at) }}</p>
              }
            </section>

            @switch (req.status) {
              @case ('paid') {
                <section class="flex items-start gap-3 rounded-2xl border border-success/25 bg-success/10 p-4" role="status">
                  <app-icon name="check-circle" [size]="20" />
                  <div>
                    <h2 class="text-base font-bold">Pago recibido</h2>
                    <p class="mt-1 text-sm text-text-secondary">
                      Gracias. La tienda ya confirmó tu pago.
                    </p>
                    @if (req.paid_at) {
                      <p class="mt-1 text-xs text-text-secondary">Fecha: {{ dateTime(req.paid_at) }}</p>
                    }
                  </div>
                </section>
              }
              @case ('awaiting_confirmation') {
                <section class="flex items-start gap-3 rounded-2xl border border-warning/25 bg-warning/10 p-4" role="status">
                  <app-icon name="hourglass" [size]="20" />
                  <div>
                    <h2 class="text-base font-bold">Comprobante en revisión</h2>
                    <p class="mt-1 text-sm text-text-secondary">
                      La tienda está verificando tu transferencia. Te avisarán cuando la confirmen; no necesitas hacer nada más.
                    </p>
                  </div>
                </section>
              }
              @case ('expired') {
                <section class="flex items-start gap-3 rounded-2xl border border-error/25 bg-error/10 p-4" role="alert">
                  <app-icon name="clock" [size]="20" />
                  <div>
                    <h2 class="text-base font-bold text-error">Este enlace venció</h2>
                    <p class="mt-1 text-sm text-text-secondary">Pide a la tienda que te envíe un enlace nuevo.</p>
                  </div>
                </section>
              }
              @case ('cancelled') {
                <section class="flex items-start gap-3 rounded-2xl border border-error/25 bg-error/10 p-4" role="alert">
                  <app-icon name="x-circle" [size]="20" />
                  <div>
                    <h2 class="text-base font-bold text-error">Este pago fue cancelado</h2>
                    <p class="mt-1 text-sm text-text-secondary">Si aún quieres pagarlo, contacta a la tienda.</p>
                  </div>
                </section>
              }
              @default {
                @if (req.rejection_reason) {
                  <section class="rounded-2xl border border-error/25 bg-error/10 p-4" role="alert">
                    <h2 class="text-base font-bold text-error">La tienda rechazó tu comprobante</h2>
                    <p class="mt-1 text-sm text-text-secondary">{{ req.rejection_reason }}</p>
                    <p class="mt-1 text-sm text-text-secondary">Puedes enviar uno nuevo o pagar con otro medio.</p>
                  </section>
                }

                @if (actionError(); as message) {
                  <p class="rounded-xl border border-error/25 bg-error/10 p-3 text-sm text-error" role="alert">{{ message }}</p>
                }

                @if (req.methods.length === 0) {
                  <section class="rounded-2xl border border-border bg-surface p-4 text-sm text-text-secondary">
                    La tienda no tiene medios de pago en línea disponibles para este valor. Contáctala para pagar.
                  </section>
                }

                @for (method of req.methods; track $index) {
                  <section class="rounded-2xl border border-border bg-surface p-4">
                    <div class="flex items-center gap-3">
                      <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                        <app-icon [name]="method.kind === 'wompi' ? 'credit-card' : 'landmark'" [size]="18" />
                      </span>
                      <h2 class="min-w-0 flex-1 truncate text-base font-bold">{{ method.name }}</h2>
                    </div>

                    @if (method.kind === 'wompi') {
                      <p class="mt-3 text-sm text-text-secondary">
                        Paga con tarjeta, PSE o Nequi en la página segura de Wompi. Tu pago se confirma solo.
                      </p>
                      <div class="mt-3">
                        <app-button
                          [fullWidth]="true"
                          [loading]="busyWompi()"
                          [disabled]="busy()"
                          (clicked)="payWithWompi()"
                        >
                          Pagar {{ money(req.amount) }}
                        </app-button>
                      </div>
                    } @else {
                      @if (accountsOf(method).length > 0) {
                        <ul class="mt-3 grid gap-2">
                          @for (account of accountsOf(method); track account.id) {
                            <li class="flex items-center gap-3 rounded-xl border border-border bg-surface-secondary/40 p-3 text-sm">
                              @if (account.image_url) {
                                <img [src]="account.image_url" alt="" class="h-9 w-9 shrink-0 rounded-lg object-contain" />
                              }
                              <div class="min-w-0 flex-1">
                                <p class="text-xs font-semibold text-text-secondary">{{ account.bank_name }}</p>
                                @if (account.name) {
                                  <p class="truncate text-xs text-text-secondary">{{ account.name }}</p>
                                }
                                <p class="break-all font-medium tabular-nums">{{ account.account_number }}</p>
                              </div>
                            </li>
                          }
                        </ul>
                      } @else if (instructionRows(method).length > 0) {
                        <dl class="mt-3 grid gap-2 rounded-xl border border-border bg-surface-secondary/40 p-3 text-sm">
                          @for (row of instructionRows(method); track $index) {
                            <div class="flex flex-col sm:flex-row sm:justify-between sm:gap-3">
                              <dt class="text-xs font-semibold text-text-secondary">{{ row.label }}</dt>
                              <dd class="break-words font-medium sm:text-right">{{ row.value }}</dd>
                            </div>
                          }
                        </dl>
                      }

                      @if (method.kind === 'transfer') {
                        @if (openTransfer() === method.id) {
                          <form class="mt-3 grid gap-3" (submit)="submitTransfer($event, method)">
                            <p class="text-xs text-text-secondary">
                              Transfiere {{ money(req.amount) }} y adjunta el comprobante. La tienda lo revisará antes de confirmar.
                            </p>
                            <label class="grid gap-1 text-xs font-semibold">
                              Comprobante (imagen o PDF, máx. 5 MB)
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp,application/pdf"
                                class="min-h-11 rounded-xl border border-border bg-surface p-2 text-sm font-normal"
                                (change)="onFile($event)"
                              />
                            </label>
                            <label class="grid gap-1 text-xs font-semibold">
                              Referencia o número de aprobación (opcional)
                              <input
                                type="text"
                                maxlength="120"
                                autocomplete="off"
                                class="min-h-11 rounded-xl border border-border bg-surface px-3 text-base font-normal"
                                [value]="reference()"
                                (input)="onReference($event)"
                              />
                            </label>
                            <app-button type="submit" [fullWidth]="true" [loading]="busyTransfer()" [disabled]="busy() || !file()">
                              Enviar comprobante
                            </app-button>
                          </form>
                        } @else {
                          <div class="mt-3">
                            <app-button variant="secondary" [fullWidth]="true" [disabled]="busy()" (clicked)="openTransferForm(method)">
                              Ya transferí, enviar comprobante
                            </app-button>
                          </div>
                        }
                      }
                    }
                  </section>
                }
              }
            }
          }
        }
      }
    </main>
  `,
  styles: [
    `
      :host {
        display: block;
        background: var(--color-background);
      }
    `,
  ],
})
export class PaymentRequestPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(PaymentRequestService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);
  private readonly currency = inject(CurrencyFormatService);
  private readonly browserTimezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Bogota';

  private token = '';

  readonly state = signal<'loading' | 'loaded' | 'unavailable' | 'error'>('loading');
  readonly request = signal<PublicPaymentRequest | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly busyWompi = signal(false);
  readonly busyTransfer = signal(false);
  readonly busy = computed(() => this.busyWompi() || this.busyTransfer());
  readonly openTransfer = signal<number | undefined>(undefined);
  readonly file = signal<File | null>(null);
  readonly reference = signal('');
  /** Curated bank accounts per transfer method id, loaded once per page view. */
  readonly bankAccounts = signal<Record<number, PublicBankAccount[]>>({});

  readonly statusLabel = computed(() => {
    const labels: Record<PaymentRequestStatus, string> = {
      pending: 'Pendiente',
      awaiting_confirmation: 'En revisión',
      paid: 'Pagado',
      expired: 'Vencido',
      cancelled: 'Cancelado',
    };
    const status = this.request()?.status;
    return status ? labels[status] : '';
  });

  readonly statusVariant = computed<'success' | 'warning' | 'error' | 'neutral'>(() => {
    switch (this.request()?.status) {
      case 'paid':
        return 'success';
      case 'awaiting_confirmation':
        return 'warning';
      case 'expired':
      case 'cancelled':
        return 'error';
      default:
        return 'neutral';
    }
  });

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!TOKEN_PATTERN.test(this.token)) {
      this.state.set('unavailable');
      return;
    }
    // The token is a credential: never leak it through the Referer header.
    this.meta.updateTag({ name: 'referrer', content: 'no-referrer' });
    this.destroyRef.onDestroy(() => this.meta.removeTag("name='referrer'"));
    this.load();
  }

  load(): void {
    this.state.set('loading');
    this.api
      .get(this.token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (value) => {
          this.request.set(value);
          this.state.set('loaded');
          this.loadBankAccounts(value.methods);
        },
        error: (error: HttpErrorResponse) => {
          this.state.set(error.status === 404 ? 'unavailable' : 'error');
        },
      });
  }

  money(value: number): string {
    return this.currency.format(value);
  }

  dateTime(value: string): string {
    return formatStoreDateTime(value, this.browserTimezone, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  accountsOf(method: PublicPaymentMethod): PublicBankAccount[] {
    return method.id != null ? (this.bankAccounts()[method.id] ?? []) : [];
  }

  instructionRows(method: PublicPaymentMethod): Array<{ label: string; value: string }> {
    const source = (method.payment_instructions ?? {}) as Record<string, unknown>;
    return INSTRUCTION_LABELS.filter(([key]) => source[key]).map(([key, label]) => ({
      label,
      value: String(source[key]),
    }));
  }

  payWithWompi(): void {
    if (this.busy()) return;
    this.actionError.set(null);
    this.busyWompi.set(true);
    const returnUrl = this.document.location.href.split('#')[0];
    this.api
      .startWompi(this.token, returnUrl)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ checkout_url }) => {
          // Stay "busy" while the browser leaves for Wompi's hosted checkout.
          this.document.location.assign(checkout_url);
        },
        error: (error: HttpErrorResponse) => {
          this.busyWompi.set(false);
          this.handleActionError(error);
        },
      });
  }

  openTransferForm(method: PublicPaymentMethod): void {
    this.actionError.set(null);
    this.file.set(null);
    this.reference.set('');
    this.openTransfer.set(method.id);
  }

  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const picked = input.files?.[0] ?? null;
    this.actionError.set(null);
    if (picked && !RECEIPT_TYPES.includes(picked.type)) {
      this.file.set(null);
      input.value = '';
      this.actionError.set('El comprobante debe ser una imagen (JPG, PNG, WebP) o un PDF.');
      return;
    }
    if (picked && picked.size > MAX_RECEIPT_BYTES) {
      this.file.set(null);
      input.value = '';
      this.actionError.set('El comprobante supera los 5 MB. Elige un archivo más liviano.');
      return;
    }
    this.file.set(picked);
  }

  onReference(event: Event): void {
    this.reference.set((event.target as HTMLInputElement).value);
  }

  submitTransfer(event: Event, method: PublicPaymentMethod): void {
    event.preventDefault();
    const file = this.file();
    if (!file || this.busy()) return;
    this.actionError.set(null);
    this.busyTransfer.set(true);
    this.api
      .submitTransfer(this.token, file, this.reference(), method.id ?? null)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busyTransfer.set(false);
          this.openTransfer.set(undefined);
          this.load();
        },
        error: (error: HttpErrorResponse) => {
          this.busyTransfer.set(false);
          this.handleActionError(error);
        },
      });
  }

  private loadBankAccounts(methods: PublicPaymentMethod[]): void {
    for (const method of methods) {
      const id = method.id;
      if (method.kind !== 'transfer' || id == null || id in this.bankAccounts()) continue;
      this.api
        .bankAccounts(id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (accounts) => this.bankAccounts.update((all) => ({ ...all, [id]: accounts })),
          // Without the list the method instructions are still shown.
          error: () => this.bankAccounts.update((all) => ({ ...all, [id]: [] })),
        });
    }
  }

  private handleActionError(error: HttpErrorResponse): void {
    const code: string | undefined = error.error?.error_code;
    // The state changed under the customer (expired, paid, in review): show it.
    if (code && code !== 'PAYMENT_REQUEST_WOMPI_UNAVAILABLE' && code.startsWith('PAYMENT_REQUEST_') && error.status !== 400) {
      this.load();
      return;
    }
    const message: unknown = error.error?.message;
    this.actionError.set(
      typeof message === 'string' && message.length > 0
        ? message
        : 'No pudimos completar la acción. Intenta de nuevo.',
    );
  }
}
