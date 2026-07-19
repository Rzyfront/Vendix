import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import { IconComponent } from '../icon/icon.component';
import type { IconName } from '../icon/icons.registry';
import {
  WompiService,
  WompiSubMethod,
  type WompiSubMethodConfig,
  type PseFinancialInstitution,
} from '../../services/wompi.service';
import type { WompiSlice } from './payment-collector.model';

/**
 * Wompi slice of the payment collector — isolates all Wompi sub-method state
 * (NEQUI phone, PSE fields, Bancolombia, card) behind a single `slice`
 * {@link WompiSlice} `model()`. The parent two-way binds `[(slice)]` and treats
 * a `null` value as "incomplete / invalid".
 *
 * It never processes a payment: it only collects the sub-method + the raw
 * provider payload the backend expects. The single read-only network call is
 * the PSE bank catalog, loaded on demand from an event handler (never in an
 * effect), which is safe under the collector's "no backend in effects" rule.
 */
@Component({
  selector: 'app-payment-wompi-fields',
  standalone: true,
  imports: [ReactiveFormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './payment-wompi-fields.component.html',
  styleUrl: './payment-wompi-fields.component.scss',
})
export class PaymentWompiFieldsComponent {
  private readonly wompiService = inject(WompiService);
  private readonly destroyRef = inject(DestroyRef);

  /** Two-way slice: `null` until a sub-method form is valid. */
  readonly slice = model<WompiSlice | null>(null);

  /** Sub-methods to render (card is excluded by default, like the POS). */
  readonly subMethods = input<WompiSubMethodConfig[]>(
    WompiService.SUB_METHODS.filter((m) => m.key !== WompiSubMethod.CARD),
  );

  /** Currently selected Wompi sub-method. */
  readonly selectedSub = signal<WompiSubMethod | null>(null);

  /** PSE bank options, lazy-loaded when PSE is picked. */
  readonly pseBankOptions = signal<{ value: string; label: string }[]>([]);

  readonly WompiSubMethod = WompiSubMethod;

  // NEQUI
  readonly nequiPhoneControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.pattern(/^3\d{9}$/)],
  });

  // PSE
  readonly pseForm = new FormGroup({
    userType: new FormControl<number>(0, { nonNullable: true, validators: [Validators.required] }),
    userLegalIdType: new FormControl('CC', { nonNullable: true, validators: [Validators.required] }),
    userLegalId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    financialInstitutionCode: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    paymentDescription: new FormControl('', { nonNullable: true }),
  });

  // Reactive validity bridges (never read `.valid`/`.status` inside a computed).
  private readonly nequiStatus = toSignal(
    this.nequiPhoneControl.statusChanges,
    { initialValue: this.nequiPhoneControl.status },
  );
  private readonly pseStatus = toSignal(this.pseForm.statusChanges, {
    initialValue: this.pseForm.status,
  });

  /** True when the current sub-method has all it needs. */
  readonly isValid = computed<boolean>(() => {
    const sub = this.selectedSub();
    if (!sub) return false;
    switch (sub) {
      case WompiSubMethod.NEQUI:
        return this.nequiStatus() === 'VALID';
      case WompiSubMethod.PSE:
        return this.pseStatus() === 'VALID';
      default:
        return true; // Card / Bancolombia need no extra input
    }
  });

  constructor() {
    // Keep the slice model in sync as the user types (event-driven, not backend).
    this.nequiPhoneControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.syncSlice());
    this.pseForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.syncSlice());
  }

  selectSub(sub: WompiSubMethod): void {
    this.selectedSub.set(sub);
    if (sub === WompiSubMethod.PSE && this.pseBankOptions().length === 0) {
      this.loadPseBanks();
    }
    this.syncSlice();
  }

  backToMethods(): void {
    this.selectedSub.set(null);
    this.slice.set(null);
  }

  iconFor(sub: WompiSubMethodConfig): IconName {
    return (sub.icon as IconName) ?? 'smartphone';
  }

  /** Recompute the slice model from the current sub-method + form state. */
  private syncSlice(): void {
    if (!this.isValid()) {
      this.slice.set(null);
      return;
    }
    const sub = this.selectedSub()!;
    this.slice.set({ subMethod: sub, payload: this.buildPayload(sub) });
  }

  private buildPayload(sub: WompiSubMethod): unknown {
    switch (sub) {
      case WompiSubMethod.NEQUI:
        return { type: 'NEQUI', phone_number: this.nequiPhoneControl.value };
      case WompiSubMethod.PSE: {
        const v = this.pseForm.getRawValue();
        return {
          type: 'PSE',
          user_type: v.userType,
          user_legal_id_type: v.userLegalIdType,
          user_legal_id: v.userLegalId,
          financial_institution_code: v.financialInstitutionCode,
          payment_description: v.paymentDescription || 'Pago Vendix',
        };
      }
      case WompiSubMethod.BANCOLOMBIA_TRANSFER:
        return { type: 'BANCOLOMBIA_TRANSFER' };
      default:
        return { type: sub };
    }
  }

  private loadPseBanks(): void {
    this.wompiService
      .getPseFinancialInstitutions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (institutions: PseFinancialInstitution[]) => {
          this.pseBankOptions.set(
            institutions.map((i) => ({
              value: i.financial_institution_code,
              label: i.financial_institution_name,
            })),
          );
        },
        error: () => {
          /* silent — user can retry by re-selecting PSE */
        },
      });
  }
}
