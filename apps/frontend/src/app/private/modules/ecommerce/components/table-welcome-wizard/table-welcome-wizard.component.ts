import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  TableContextService,
  TableGuestIdentity,
} from '../../services/table-context.service';
import {
  GuestCheckoutDataModalComponent,
  GuestCheckoutData,
} from '../guest-checkout-data-modal/guest-checkout-data-modal.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { parseApiError } from '../../../../../core/utils/parse-api-error';

/**
 * Full-screen branded welcome wizard shown to a diner who arrives via a
 * QR-de-mesa scan (`?mesa=<public_token>`) and has not yet settled an identity
 * for the table (`table_context.isActive() && !identityChosen()`). Mounted by
 * `StoreEcommerceLayoutComponent`, which also owns the auth flow.
 *
 * Visual pattern is cloned from `store-unavailable-banner` (a `fixed inset-0`
 * blurred overlay with a centered card) — NOT imported, replicated so the
 * wizard can carry its own two-step body.
 *
 * Steps:
 *  - Step 1 (always): welcome + logo.
 *      · `menu_only` → single "Ver la carta" CTA that dismisses the wizard
 *        per-device (no HTTP identify — there is no tab to attach to).
 *      · any other mode → "Continuar" → step 2.
 *  - Step 2 (only when NOT `menu_only`): three identity options.
 *      1. Anonymous — rendered only if `allowAnonymous()`, highlighted when
 *         `anonymousDefault()`. Calls `identify('anonymous')`.
 *      2. Guest with data — reuses `GuestCheckoutDataModalComponent`; its
 *         `completed` output feeds `identify('guest', {...})`.
 *      3. Login/register — if already authenticated, offers
 *         "Continuar como {name}" → `identify('authenticated')`; otherwise
 *         emits `loginRequested` so the layout opens the shared auth-modal
 *         (the layout runs `identify('authenticated')` once auth succeeds).
 *
 * Zoneless-safe: pure signal/computed reads, `input()`/`output()`, no manual
 * change detection.
 */
@Component({
  selector: 'app-table-welcome-wizard',
  standalone: true,
  imports: [ButtonComponent, IconComponent, GuestCheckoutDataModalComponent],
  template: `
    <div
      class="tw-overlay fixed inset-0 z-[9990] overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="table-welcome-title"
    >
      <!-- Blurred scrim over the carta behind -->
      <div
        class="absolute inset-0 backdrop-blur-xl"
        aria-hidden="true"
        style="background: linear-gradient(160deg, rgba(15, 23, 42, 0.4) 0%, rgba(15, 23, 42, 0.62) 100%);"
      ></div>

      <div class="relative flex min-h-full items-center justify-center p-4 sm:p-6">
        <div
          class="tw-card w-full max-w-md rounded-3xl border border-white/15 bg-white/10 px-6 py-9 text-center shadow-2xl backdrop-blur-xl sm:px-9 sm:py-11"
        >
          <!-- Logo / branded fallback -->
          @if (storeLogo(); as logo) {
            <img
              [src]="logo"
              [alt]="storeName()"
              class="mx-auto mb-6 h-16 w-auto max-w-[70%] rounded-xl object-contain drop-shadow"
            />
          } @else {
            <div
              class="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl shadow-lg"
              style="background: var(--color-primary, #4f46e5);"
            >
              <app-icon name="utensils" [size]="32" class="text-white" />
            </div>
          }

          @if (step() === 1) {
            <!-- ── STEP 1: welcome ─────────────────────────────────── -->
            <h2
              id="table-welcome-title"
              class="text-2xl font-bold leading-tight text-white sm:text-3xl"
            >
              @if (storeName()) {
                ¡Bienvenido a {{ storeName() }}!
              } @else {
                ¡Bienvenido!
              }
            </h2>

            <p class="mt-4 text-base leading-relaxed text-white/85">
              @if (tableContext.isMenuOnly()) {
                Explora nuestra carta digital a tu ritmo.
              } @else {
                Estás en la
                <strong>Mesa {{ tableContext.tableName() }}</strong>. Cuéntanos
                quién eres para acompañarte durante tu visita.
              }
            </p>

            <div class="mt-8">
              @if (tableContext.isMenuOnly()) {
                <app-button
                  variant="primary"
                  size="lg"
                  [fullWidth]="true"
                  (clicked)="dismissMenuOnly()"
                >
                  Ver la carta
                </app-button>
              } @else {
                <app-button
                  variant="primary"
                  size="lg"
                  [fullWidth]="true"
                  (clicked)="goToStep2()"
                >
                  Continuar
                </app-button>
              }
            </div>
          } @else {
            <!-- ── STEP 2: identity ────────────────────────────────── -->
            <h2
              id="table-welcome-title"
              class="text-2xl font-bold leading-tight text-white"
            >
              ¿Cómo quieres continuar?
            </h2>
            <p class="mt-2 text-sm text-white/75">
              Elige una opción para tu mesa.
            </p>

            <div class="mt-7 flex flex-col gap-3 text-left">
              <!-- 1. Anonymous -->
              @if (tableContext.allowAnonymous()) {
                <button
                  type="button"
                  class="tw-option"
                  [class.tw-option--suggested]="tableContext.anonymousDefault()"
                  [disabled]="submitting()"
                  (click)="chooseAnonymous()"
                >
                  <span class="tw-option-icon">
                    <app-icon name="user-round" [size]="20" />
                  </span>
                  <span class="tw-option-body">
                    <span class="tw-option-title">
                      Continuar sin registrarme
                      @if (tableContext.anonymousDefault()) {
                        <span class="tw-badge">Sugerido</span>
                      }
                    </span>
                    <span class="tw-option-desc">
                      Empieza a pedir enseguida, sin dar tus datos.
                    </span>
                  </span>
                  <app-icon
                    name="chevron-right"
                    [size]="18"
                    class="tw-option-chevron"
                  />
                </button>
              }

              <!-- 2. Guest with data -->
              <button
                type="button"
                class="tw-option"
                [disabled]="submitting()"
                (click)="guestModal.open()"
              >
                <span class="tw-option-icon">
                  <app-icon name="clipboard-list" [size]="20" />
                </span>
                <span class="tw-option-body">
                  <span class="tw-option-title">Continuar como invitado</span>
                  <span class="tw-option-desc">
                    Deja tu nombre (y datos de factura si los quieres).
                  </span>
                </span>
                <app-icon
                  name="chevron-right"
                  [size]="18"
                  class="tw-option-chevron"
                />
              </button>

              <!-- 3. Login / register (or continue authenticated) -->
              @if (isAuthenticated()) {
                <button
                  type="button"
                  class="tw-option tw-option--suggested"
                  [disabled]="submitting()"
                  (click)="continueAuthenticated()"
                >
                  <span class="tw-option-icon">
                    <app-icon name="user-check" [size]="20" />
                  </span>
                  <span class="tw-option-body">
                    <span class="tw-option-title">{{ authContinueLabel() }}</span>
                    <span class="tw-option-desc">
                      Vincula esta visita a tu cuenta.
                    </span>
                  </span>
                  <app-icon
                    name="chevron-right"
                    [size]="18"
                    class="tw-option-chevron"
                  />
                </button>
              } @else {
                <button
                  type="button"
                  class="tw-option"
                  [disabled]="submitting()"
                  (click)="requestLogin()"
                >
                  <span class="tw-option-icon">
                    <app-icon name="log-in" [size]="20" />
                  </span>
                  <span class="tw-option-body">
                    <span class="tw-option-title">
                      Iniciar sesión / Registrarme
                    </span>
                    <span class="tw-option-desc">
                      Accede a tu historial y beneficios.
                    </span>
                  </span>
                  <app-icon
                    name="chevron-right"
                    [size]="18"
                    class="tw-option-chevron"
                  />
                </button>
              }
            </div>

            <button
              type="button"
              class="tw-back"
              [disabled]="submitting()"
              (click)="step.set(1)"
            >
              Volver
            </button>
          }
        </div>
      </div>
    </div>

    <!--
      Guest-data modal rendered OUTSIDE the animated overlay so its own
      z-[9999] app-modal always paints above the wizard scrim (z-[9990]).
      Its "completed" output emits GuestCheckoutData or null (null = cancelled).
    -->
    <app-guest-checkout-data-modal
      #guestModal
      [invoicingEnabled]="false"
      (completed)="onGuestCompleted($event)"
    />
  `,
  styles: `
    .tw-overlay {
      animation: tw-fade-in 0.25s ease-out;
    }
    .tw-card {
      animation: tw-card-in 0.3s ease-out;
    }

    .tw-option {
      display: flex;
      align-items: center;
      gap: 0.875rem;
      width: 100%;
      padding: 0.875rem 1rem;
      border-radius: 1rem;
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
      text-align: left;
      cursor: pointer;
      transition:
        background 0.15s ease,
        border-color 0.15s ease;
    }
    .tw-option:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.16);
      border-color: rgba(255, 255, 255, 0.35);
    }
    .tw-option:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .tw-option--suggested {
      border-color: var(--color-primary, #4f46e5);
      background: rgba(255, 255, 255, 0.14);
      box-shadow: 0 0 0 1px var(--color-primary, #4f46e5);
    }

    .tw-option-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      height: 2.25rem;
      width: 2.25rem;
      border-radius: 0.75rem;
      background: rgba(255, 255, 255, 0.14);
    }

    .tw-option-body {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      flex: 1 1 auto;
      min-width: 0;
    }
    .tw-option-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 600;
      font-size: 0.95rem;
    }
    .tw-option-desc {
      font-size: 0.8rem;
      color: rgba(255, 255, 255, 0.72);
    }

    .tw-option-chevron {
      flex: 0 0 auto;
      color: rgba(255, 255, 255, 0.55);
    }

    .tw-badge {
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 0.1rem 0.4rem;
      border-radius: 999px;
      background: var(--color-primary, #4f46e5);
      color: #fff;
    }

    .tw-back {
      margin-top: 1.25rem;
      background: transparent;
      border: none;
      color: rgba(255, 255, 255, 0.75);
      font-size: 0.85rem;
      cursor: pointer;
      text-decoration: underline;
    }
    .tw-back:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    @keyframes tw-fade-in {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
    @keyframes tw-card-in {
      from {
        opacity: 0;
        transform: translateY(12px) scale(0.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .tw-overlay,
      .tw-card {
        animation: none;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TableWelcomeWizardComponent {
  private readonly toast = inject(ToastService);
  /** Public so the template can read the diner-mode flags directly. */
  readonly tableContext = inject(TableContextService);

  // ── Inputs (from the layout) ────────────────────────────────────
  readonly storeLogo = input<string | null>(null);
  readonly storeName = input<string>('');
  /** Whether a customer is already logged in (the layout owns the authFacade). */
  readonly isAuthenticated = input<boolean>(false);
  /** Display name of the logged-in customer (for "Continuar como …"). */
  readonly authName = input<string>('');

  // ── Outputs ─────────────────────────────────────────────────────
  /** Asks the layout to open the shared auth-modal (login/register). */
  readonly loginRequested = output<void>();

  // ── Local state ─────────────────────────────────────────────────
  readonly step = signal<1 | 2>(1);
  /** Guards the identity buttons while a `identify()` POST is in flight. */
  readonly submitting = signal(false);

  readonly authContinueLabel = computed<string>(() => {
    const name = this.authName().trim();
    return name ? `Continuar como ${name}` : 'Continuar con mi cuenta';
  });

  goToStep2(): void {
    this.step.set(2);
  }

  /**
   * `menu_only`: there is no tab to attach an identity to, so dismiss the
   * wizard per-device without an HTTP identify. `markWelcomeSeen()` flips
   * `identityChosen` → the layout stops rendering the wizard.
   */
  dismissMenuOnly(): void {
    this.tableContext.markWelcomeSeen();
  }

  /** Anonymous identity: session stays anonymous (no customer). */
  async chooseAnonymous(): Promise<void> {
    await this.runIdentify(() => this.tableContext.identify('anonymous'));
  }

  /** Authenticated identity: attach the logged-in customer server-side. */
  async continueAuthenticated(): Promise<void> {
    await this.runIdentify(() => this.tableContext.identify('authenticated'));
  }

  /** Delegate login/register to the layout (it owns the auth-modal + facade). */
  requestLogin(): void {
    this.loginRequested.emit();
  }

  /**
   * Guest-modal result handler. `null` = the diner cancelled → stay on step 2.
   * Non-null → map to `TableGuestIdentity` and attach a guest customer.
   */
  async onGuestCompleted(data: GuestCheckoutData | null): Promise<void> {
    if (data === null) return;
    const guest: TableGuestIdentity = {
      first_name: (data.first_name ?? '').trim() || 'Invitado',
      last_name: data.last_name,
      email: data.email,
      phone: data.phone,
      document_type: data.document_type,
      document_number: data.document_number,
    };
    await this.runIdentify(() => this.tableContext.identify('guest', guest));
  }

  /**
   * Shared identify runner: single-flight guard + error toast. On success the
   * service flips `identityChosen` → the layout unmounts the wizard, so there
   * is nothing to close here.
   */
  private async runIdentify(
    run: () => Promise<unknown>,
  ): Promise<void> {
    if (this.submitting()) return;
    this.submitting.set(true);
    try {
      await run();
    } catch (err) {
      this.toast.error(parseApiError(err).userMessage);
    } finally {
      this.submitting.set(false);
    }
  }
}
