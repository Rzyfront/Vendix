import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
  ToastService,
  ToggleComponent,
} from '../../../../../../shared/components/index';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';
import {
  PaymentMethod,
  PaymentMethodCharge,
} from '../../interfaces/store-subscription.interface';
import { StoreSubscriptionService } from '../../services/store-subscription.service';
import { WompiCardWidgetComponent } from '../wompi-card-widget/wompi-card-widget.component';

/**
 * Fase 4 (Wompi recurrent migration) — payload emitted by
 * `app-wompi-card-widget` after a successful card tokenization. Mirrors
 * `WompiTokenizeResult` but kept as a local alias to avoid the modal
 * needing to know about the widget's exported types.
 */
interface TokenizedCard {
  card_token: string;
  acceptance_token: string;
  personal_auth_token: string;
  type: string;
  last4?: string;
  brand?: string;
  expiry_month?: string;
  expiry_year?: string;
  card_holder?: string;
}

export type PaymentMethodEditAction =
  | 'cancelled'
  | 'saved'
  | 'replaced'
  | 'deleted';

export interface PaymentMethodEditResult {
  action: PaymentMethodEditAction;
  updatedId?: string;
}

/**
 * S3.2 — "Configurar método de pago" modal.
 *
 * Replaces the previous stubbed `configureMethod()` handler (and the
 * scattered inline buttons on the cards list) with a single dedicated
 * surface that lets the user:
 *
 *  - Inspect read-only details (brand, last4, expiry, holder, state).
 *  - Toggle is_default with a guard ("debes elegir otra como default
 *    antes de quitar esta").
 *  - Replace the card via Wompi widget (tokenize -> POST /:id/replace).
 *  - Delete the card with a guard for the last-active-default case.
 *  - See the last 5 charges executed against this PM, with failure_reason
 *    when state=invalid or the most recent attempt failed.
 *
 * Closes by emitting `closedWithResult` so the parent can refresh the
 * list only when something actually changed.
 */
@Component({
  selector: 'app-payment-method-edit-modal',
  standalone: true,
  imports: [
    ModalComponent,
    ButtonComponent,
    IconComponent,
    ToggleComponent,
    CurrencyPipe,
    WompiCardWidgetComponent,
  ],
  templateUrl: './payment-method-edit-modal.component.html',
})
export class PaymentMethodEditModalComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly subscriptionService = inject(StoreSubscriptionService);
  private readonly toastService = inject(ToastService);

  // ─── Inputs / Outputs ────────────────────────────────────────────────

  readonly isOpen = model<boolean>(false);

  /** PM whose details we are editing. */
  readonly paymentMethod = input.required<PaymentMethod | null>();

  /**
   * Full list of active PMs in the store (the parent already loaded it).
   * Used to compute guards: "is this the only active card?" /
   * "is there another card we can promote to default?".
   */
  readonly allPaymentMethods = input<PaymentMethod[]>([]);

  readonly closedWithResult = output<PaymentMethodEditResult>();

  // ─── Local UI state ──────────────────────────────────────────────────

  readonly charges = signal<PaymentMethodCharge[]>([]);
  readonly chargesLoading = signal<boolean>(false);
  readonly chargesError = signal<boolean>(false);

  /** True while a default-toggle / delete / replace request is in flight. */
  readonly mutating = signal<boolean>(false);

  /** Wompi widget visibility — opens only on "Reemplazar método" click. */
  readonly showReplaceWidget = signal<boolean>(false);

  /**
   * Optimistic mirror of `paymentMethod().is_default` so the toggle
   * reflects the user's click immediately while the HTTP call resolves.
   */
  readonly isDefaultOptimistic = signal<boolean>(false);

  // ─── Computed ────────────────────────────────────────────────────────

  /** Other PMs that could absorb the default flag if we toggle it off here. */
  readonly otherActivePMs = computed(() => {
    const current = this.paymentMethod();
    if (!current) return [];
    return this.allPaymentMethods().filter(
      (pm) => pm.id !== current.id && pm.state !== 'invalid' && pm.state !== 'removed',
    );
  });

  /**
   * True when the current PM is is_default AND no other active PM exists.
   * In that case we must NOT allow toggling it off (subscriber would be
   * left with no default for billing) NOR deleting it.
   */
  readonly isOnlyActiveDefault = computed(() => {
    const current = this.paymentMethod();
    if (!current) return false;
    return current.is_default && this.otherActivePMs().length === 0;
  });

  /** Delete is allowed unless this is the last-active-default. */
  readonly canDelete = computed(() => {
    const current = this.paymentMethod();
    if (!current) return false;
    // Always allow deleting an `invalid` PM — it is not usable for billing
    // anyway, and forcing the user to keep a broken card is worse UX.
    if (current.state === 'invalid') return true;
    return !this.isOnlyActiveDefault();
  });

  /** Card display strings. */
  readonly brandLabel = computed(() => {
    const pm = this.paymentMethod();
    if (!pm) return '';
    const brand = (pm.brand || '').trim();
    const last4 = (pm.last4 || '').trim();
    const brandStr = brand
      ? brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase()
      : pm.type === 'card'
        ? 'Tarjeta'
        : 'Cuenta';
    return last4 ? `${brandStr} •••• ${last4}` : brandStr;
  });

  readonly expiryLabel = computed(() => {
    const pm = this.paymentMethod();
    if (!pm || !pm.expiry_month || !pm.expiry_year) return null;
    const m = (pm.expiry_month ?? '').padStart(2, '0');
    const y = (pm.expiry_year ?? '').slice(-2);
    return m && y ? `${m}/${y}` : null;
  });

  readonly createdAtLabel = computed(() => {
    const pm = this.paymentMethod();
    if (!pm?.created_at) return '';
    try {
      return formatDateOnlyUTC(pm.created_at);
    } catch {
      return '';
    }
  });

  readonly stateLabel = computed(() => {
    const state = this.paymentMethod()?.state;
    switch (state) {
      case 'invalid':
        return { text: 'No válida', cls: 'bg-red-100 text-red-700' };
      case 'replaced':
        return { text: 'Reemplazada', cls: 'bg-gray-100 text-gray-700' };
      case 'removed':
        return { text: 'Removida', cls: 'bg-gray-100 text-gray-700' };
      case 'active':
      default:
        return { text: 'Activa', cls: 'bg-green-100 text-green-700' };
    }
  });

  readonly hasCharges = computed(() => this.charges().length > 0);

  // ─── Effects ─────────────────────────────────────────────────────────

  constructor() {
    // Reload charges + sync optimistic toggle every time the modal opens
    // for a PM (or the bound PM identity changes).
    effect(() => {
      const pm = this.paymentMethod();
      const open = this.isOpen();
      if (open && pm) {
        this.isDefaultOptimistic.set(pm.is_default);
        this.loadCharges(pm.id);
      }
    });
  }

  // ─── Charges ─────────────────────────────────────────────────────────

  private loadCharges(pmId: string): void {
    this.chargesLoading.set(true);
    this.chargesError.set(false);
    this.subscriptionService
      .getPaymentMethodCharges(pmId, 5)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.charges.set(res?.data ?? []);
          this.chargesLoading.set(false);
        },
        error: () => {
          this.charges.set([]);
          this.chargesError.set(true);
          this.chargesLoading.set(false);
        },
      });
  }

  // ─── is_default toggle ───────────────────────────────────────────────

  /**
   * Triggered by app-toggle (ControlValueAccessor's `changed` output).
   * Three cases:
   *   1) User flips OFF on the only active default → block + revert.
   *   2) User flips OFF on a non-default → ignored (toggle stays off).
   *      That case shouldn't happen because the toggle reflects current
   *      state, but we defend anyway.
   *   3) User flips ON on a non-default → call setDefault, refresh.
   *   4) User flips OFF on an active default that has alternatives →
   *      we don't have a one-shot "unset default" endpoint; instead
   *      tell them to set another method as default explicitly.
   */
  onDefaultToggleChange(next: boolean): void {
    const pm = this.paymentMethod();
    if (!pm) return;

    if (!next && pm.is_default) {
      // Case 1 / 4: trying to unset default.
      this.toastService.info(
        this.isOnlyActiveDefault()
          ? 'Debes habilitar otro método antes de quitar el predeterminado.'
          : 'Selecciona otro método como predeterminado para reemplazarlo.',
      );
      // Revert UI.
      this.isDefaultOptimistic.set(true);
      return;
    }

    if (next && !pm.is_default) {
      this.mutating.set(true);
      this.subscriptionService
        .setDefaultPaymentMethod(pm.id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.mutating.set(false);
            this.toastService.success('Método predeterminado actualizado');
            this.closeWith({ action: 'saved', updatedId: pm.id });
          },
          error: () => {
            this.mutating.set(false);
            this.isDefaultOptimistic.set(false);
            this.toastService.error('No se pudo actualizar el método predeterminado');
          },
        });
      return;
    }

    // No-op cases: keep optimistic in sync with reality.
    this.isDefaultOptimistic.set(pm.is_default);
  }

  // ─── Replace ─────────────────────────────────────────────────────────

  openReplaceWidget(): void {
    this.showReplaceWidget.set(true);
  }

  onReplaceWidgetClose(open: boolean): void {
    this.showReplaceWidget.set(open);
  }

  onCardTokenized(event: TokenizedCard): void {
    const pm = this.paymentMethod();
    if (!pm) return;

    this.mutating.set(true);
    const payload = {
      card_token: event.card_token,
      acceptance_token: event.acceptance_token,
      personal_auth_token: event.personal_auth_token,
      type: event.type,
      last4: event.last4,
      brand: event.brand,
      expiry_month: event.expiry_month,
      expiry_year: event.expiry_year,
      card_holder: event.card_holder,
    };

    this.subscriptionService
      .replacePaymentMethod(pm.id, payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.mutating.set(false);
          this.showReplaceWidget.set(false);
          this.toastService.success('Método reemplazado exitosamente');
          this.closeWith({
            action: 'replaced',
            updatedId: res?.data?.id ?? pm.id,
          });
        },
        error: () => {
          this.mutating.set(false);
          this.showReplaceWidget.set(false);
          this.toastService.error('No se pudo reemplazar el método');
        },
      });
  }

  // ─── Delete ──────────────────────────────────────────────────────────

  deletePaymentMethod(): void {
    const pm = this.paymentMethod();
    if (!pm) return;

    if (!this.canDelete()) {
      this.toastService.info(
        'Debes habilitar otro método antes de eliminar el predeterminado.',
      );
      return;
    }

    // Skip confirm prompt if the method is already invalid — the user
    // already understands it is broken.
    if (pm.state !== 'invalid') {
      const ok = window.confirm(
        '¿Eliminar este método? Si tienes facturas pendientes ya no se cobrarán automáticamente con este método.',
      );
      if (!ok) return;
    }

    this.mutating.set(true);
    this.subscriptionService
      .removePaymentMethod(pm.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.mutating.set(false);
          this.toastService.success('Método eliminado');
          this.closeWith({ action: 'deleted', updatedId: pm.id });
        },
        error: (err: { error?: { message?: string } }) => {
          this.mutating.set(false);
          this.toastService.error(
            err?.error?.message ?? 'No se pudo eliminar el método',
          );
        },
      });
  }

  // ─── Charge row helpers (used by template) ───────────────────────────

  chargeStateBadge(state: string): { text: string; cls: string } {
    switch (state) {
      case 'succeeded':
        return { text: 'Exitoso', cls: 'bg-green-100 text-green-700' };
      case 'pending':
        return { text: 'Pendiente', cls: 'bg-yellow-100 text-yellow-700' };
      case 'failed':
        return { text: 'Fallido', cls: 'bg-red-100 text-red-700' };
      case 'refunded':
        return { text: 'Reembolsado', cls: 'bg-gray-100 text-gray-700' };
      default:
        return { text: state, cls: 'bg-gray-100 text-gray-700' };
    }
  }

  chargeDateLabel(charge: PaymentMethodCharge): string {
    const iso = charge.paid_at ?? charge.created_at;
    if (!iso) return '';
    try {
      return formatDateOnlyUTC(iso);
    } catch {
      return '';
    }
  }

  chargeAmountNumber(charge: PaymentMethodCharge): number {
    const n = parseFloat(charge.amount);
    return isNaN(n) ? 0 : n;
  }

  /** Truncated failure reason for the table cell. */
  chargeReasonShort(charge: PaymentMethodCharge): string | null {
    if (!charge.failure_reason) return null;
    const trimmed = charge.failure_reason.trim();
    return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
  }

  // ─── Close ───────────────────────────────────────────────────────────

  cancel(): void {
    this.closeWith({ action: 'cancelled' });
  }

  onModalClosed(): void {
    // ModalComponent emitted (closed) — escape / backdrop / X. Treat as cancel.
    if (this.isOpen()) {
      this.closeWith({ action: 'cancelled' });
    }
  }

  private closeWith(result: PaymentMethodEditResult): void {
    this.isOpen.set(false);
    this.closedWithResult.emit(result);
  }
}
