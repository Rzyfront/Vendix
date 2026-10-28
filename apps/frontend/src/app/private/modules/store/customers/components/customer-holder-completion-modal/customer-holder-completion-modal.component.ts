/**
 * «Datos del cliente incompletos»: reusable modal shown when a customer cannot
 * be the holder of an electronic invoice (order detail 409, POS holder-check).
 *
 * It shows the backend message, the data the customer ALREADY has (with its
 * value) and the data that is missing, and asks ONLY for the missing fields
 * («Corregir otros datos» opens the rest). The form is prefilled from the 409
 * `details.current`; payloads without it (POS holder-check) load the customer.
 * It saves through the EXISTING `CustomersService.updateCustomer`
 * (PATCH store/customers/:id).
 *
 * The component never retries an emission or a check itself: it emits
 *  - `saved`: the customer was updated (parent retries / re-checks),
 *  - `useFinalConsumer`: the user explicitly accepted Consumidor final
 *    (only offered when `issue().cf_overridable`).
 *
 * Zoneless: signals + `model()`; form status bridged with `toSignal`.
 */

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
} from '@angular/forms';
import { startWith } from 'rxjs';

import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { AlertBannerComponent } from '../../../../../../shared/components/alert-banner/alert-banner.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { SelectorComponent } from '../../../../../../shared/components/selector/selector.component';
import { DOCUMENT_TYPES } from '../../../../../../shared/constants/document-types';
import { computeNitDv, isValidNitDv } from '../../../../../../shared/utils/nit.util';
import type { UpdateCustomerRequest } from '../../models/customer.model';
import { CustomersService } from '../../services/customers.service';
import {
  effectiveMissingFields,
  holderCurrentFrom,
  isNameMissing,
  missingFieldLabels,
  presentHolderData,
  type HolderCurrentData,
  type HolderIssue,
  type HolderMissingField,
} from './holder-issue.model';

/** Name rule of the DIAN holder: legal name, OR first AND last name. */
function nameGroupValidator(group: AbstractControl): ValidationErrors | null {
  const legal = String(group.get('legal_name')?.value ?? '').trim();
  const first = String(group.get('first_name')?.value ?? '').trim();
  const last = String(group.get('last_name')?.value ?? '').trim();
  return legal || (first && last) ? null : { nameRequired: true };
}

@Component({
  selector: 'app-customer-holder-completion-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    AlertBannerComponent,
    ButtonComponent,
    InputComponent,
    ModalComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      size="md"
      title="Datos del cliente incompletos"
      [subtitle]="customerLabel()"
      [closeOnBackdrop]="false"
      [canClose]="canCloseFn"
    >
      @if (issue(); as data) {
        <div class="space-y-4">
          <app-alert-banner
            [variant]="data.cf_blocker ? 'danger' : 'warning'"
            tone="token"
            icon="alert-triangle"
          >
            {{ data.message }}
          </app-alert-banner>

          @if (present().length > 0) {
            <div>
              <p class="mb-1 text-xs font-semibold uppercase tracking-wider text-text-secondary">
                Datos que ya tiene
              </p>
              <dl class="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                @for (row of present(); track row.label) {
                  <div class="flex min-w-0 gap-1">
                    <dt class="shrink-0 text-text-secondary">{{ row.label }}:</dt>
                    <dd class="truncate font-medium text-text-primary">{{ row.value }}</dd>
                  </div>
                }
              </dl>
            </div>
          }

          @if (labels().length > 0) {
            <div>
              <p class="mb-1 text-xs font-semibold uppercase tracking-wider text-text-secondary">
                Datos que faltan
              </p>
              <ul class="flex flex-wrap gap-2">
                @for (label of labels(); track label) {
                  <li class="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-text-primary">
                    {{ label }}
                  </li>
                }
              </ul>
              @if (nameMissing()) {
                <p class="mt-2 text-[11px] leading-tight text-text-secondary">
                  Se necesita razón social, o nombres y apellidos.
                </p>
              }
            </div>
          }

          @if (loadFailed()) {
            <app-alert-banner variant="danger" icon="alert-triangle">
              No pudimos cargar los datos del cliente. Completa los campos a mano.
            </app-alert-banner>
          }

          <form [formGroup]="form" (ngSubmit)="onSave()" class="space-y-3">
            @if (show('document_type') || show('document_number')) {
              <div class="grid grid-cols-1 gap-3" [class.sm:grid-cols-3]="isNit()" [class.sm:grid-cols-2]="!isNit()">
                @if (show('document_type')) {
                  <app-selector
                    label="Tipo de documento *"
                    placeholder="Tipo"
                    formControlName="document_type"
                    [options]="documentTypeOptions"
                  ></app-selector>
                }
                @if (show('document_number')) {
                  <app-input
                    label="Número de documento"
                    formControlName="document_number"
                    [control]="form.controls.document_number"
                    [required]="true"
                    customWrapperClass="mt-0"
                  ></app-input>
                  @if (isNit()) {
                    <app-input
                      label="DV"
                      formControlName="verification_digit"
                      [control]="form.controls.verification_digit"
                      [maxlength]="1"
                      [error]="dvError()"
                      customWrapperClass="mt-0"
                    ></app-input>
                  }
                }
              </div>
            }

            @if (show('legal_name')) {
              <app-input
                label="Razón social"
                formControlName="legal_name"
                [control]="form.controls.legal_name"
                placeholder="Solo si es persona jurídica"
                customWrapperClass="mt-0"
              ></app-input>
            }
            @if (show('first_name') || show('last_name')) {
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                @if (show('first_name')) {
                  <app-input
                    label="Nombres"
                    formControlName="first_name"
                    [control]="form.controls.first_name"
                    customWrapperClass="mt-0"
                  ></app-input>
                }
                @if (show('last_name')) {
                  <app-input
                    label="Apellidos"
                    formControlName="last_name"
                    [control]="form.controls.last_name"
                    customWrapperClass="mt-0"
                  ></app-input>
                }
              </div>
            }
            @if (showNameError()) {
              <p class="text-xs text-error">
                Indica la razón social, o los nombres y apellidos.
              </p>
            }
            @if (!editAll()) {
              <button
                type="button"
                class="text-xs font-medium text-primary hover:underline"
                (click)="editAll.set(true)"
              >
                Corregir otros datos del cliente
              </button>
            }
          </form>

          @if (saveError()) {
            <app-alert-banner variant="danger" icon="alert-triangle">
              {{ saveError() }}
            </app-alert-banner>
          }
        </div>
      }

      <div slot="footer">
        <div class="flex flex-col-reverse items-stretch justify-end gap-2 sm:flex-row sm:items-center">
          <app-button variant="ghost" [disabled]="busy()" (clicked)="onCancel()">
            Cancelar
          </app-button>
          @if (issue()?.cf_overridable) {
            <app-button variant="outline" [disabled]="busy() || saving()" (clicked)="onUseFinalConsumer()">
              {{ finalConsumerLabel() }}
            </app-button>
          }
          <app-button
            variant="primary"
            [disabled]="!canSave()"
            [loading]="saving()"
            (clicked)="onSave()"
          >
            Guardar y continuar
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class CustomerHolderCompletionModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly customersService = inject(CustomersService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  readonly issue = input<HolderIssue | null>(null);
  /** The parent is retrying the emission/check after a save: lock the buttons. */
  readonly busy = input<boolean>(false);
  /** Label of the secondary action (the POS says «Seguir como Consumidor final»). */
  readonly finalConsumerLabel = input<string>('Emitir como Consumidor final');

  readonly saved = output<void>();
  readonly useFinalConsumer = output<void>();

  readonly saving = signal(false);
  readonly saveError = signal('');
  readonly loadFailed = signal(false);
  /** Data on file: from the 409 `details.current`, or the loaded customer. */
  readonly current = signal<HolderCurrentData | null>(null);
  /** «Corregir otros datos»: also show the fields that are already complete. */
  readonly editAll = signal(false);

  protected readonly documentTypeOptions = DOCUMENT_TYPES.map((t) => ({
    value: t.code,
    label: t.label,
  }));

  protected readonly form = this.fb.nonNullable.group(
    {
      document_type: [''],
      document_number: [''],
      verification_digit: [''],
      legal_name: [''],
      first_name: [''],
      last_name: [''],
    },
    { validators: [nameGroupValidator] },
  );

  private readonly formStatus = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );
  private readonly formValue = toSignal(
    this.form.valueChanges.pipe(startWith(this.form.getRawValue())),
    { initialValue: this.form.getRawValue() },
  );

  protected readonly isNit = computed(() => this.formValue().document_type === 'NIT');
  /** Backend list + the document type when it is also empty. */
  readonly missing = computed(() =>
    effectiveMissingFields(this.issue()?.missing_fields ?? [], this.current()),
  );
  protected readonly labels = computed(() => missingFieldLabels(this.missing()));
  readonly present = computed(() => presentHolderData(this.current(), this.missing()));
  protected readonly nameMissing = computed(() => isNameMissing(this.missing()));
  protected readonly customerLabel = computed(() => this.issue()?.customer_name ?? '');

  protected readonly dvError = computed(() => {
    const v = this.formValue();
    if (v.document_type !== 'NIT' || !v.verification_digit || !v.document_number) {
      return '';
    }
    return isValidNitDv(v.document_number, v.verification_digit)
      ? ''
      : 'El dígito de verificación no coincide con el NIT.';
  });

  protected readonly showNameError = computed(() => {
    this.formStatus();
    return this.form.hasError('nameRequired') && this.form.dirty;
  });

  /** Document type and number are always needed; the name via the group rule. */
  protected readonly canSave = computed(() => {
    const v = this.formValue();
    return (
      !!v.document_type &&
      !!String(v.document_number ?? '').trim() &&
      this.formStatus() === 'VALID' &&
      this.dvError() === '' &&
      !this.saving() &&
      !this.busy()
    );
  });

  protected readonly canCloseFn = (): boolean => !this.saving();

  /** Only the missing fields are asked; «Corregir otros datos» shows them all. */
  show(field: HolderMissingField): boolean {
    return this.editAll() || this.missing().includes(field);
  }

  constructor() {
    // Each opening reloads the customer so the form starts from the live record.
    effect(() => {
      const open = this.isOpen();
      const issue = this.issue();
      if (open && issue) {
        untracked(() => this.loadCustomer(issue));
      }
    });
  }

  protected onSave(): void {
    this.form.markAllAsDirty();
    const issue = this.issue();
    if (!issue || !this.canSave()) return;

    const v = this.form.getRawValue();
    const documentNumber = v.document_number.trim();
    const payload: UpdateCustomerRequest = {
      document_type: v.document_type,
      document_number: documentNumber,
    };
    if (v.document_type === 'NIT') {
      payload.verification_digit =
        v.verification_digit.trim() || computeNitDv(documentNumber) || undefined;
    }
    if (v.legal_name.trim()) payload.legal_name = v.legal_name.trim();
    if (v.first_name.trim()) payload.first_name = v.first_name.trim();
    if (v.last_name.trim()) payload.last_name = v.last_name.trim();

    this.saving.set(true);
    this.saveError.set('');
    this.customersService
      .updateCustomer(issue.customer_id, payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.isOpen.set(false);
          this.saved.emit();
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.saveError.set(extractApiErrorMessage(err));
        },
      });
  }

  protected onUseFinalConsumer(): void {
    this.isOpen.set(false);
    this.useFinalConsumer.emit();
  }

  protected onCancel(): void {
    if (this.saving()) return;
    this.isOpen.set(false);
  }

  /** Prefills from the 409 data; without it (POS) loads the customer record. */
  private loadCustomer(issue: HolderIssue): void {
    this.saveError.set('');
    this.loadFailed.set(false);
    this.editAll.set(false);
    if (issue.current) {
      this.applyCurrent(issue.current);
      return;
    }
    this.applyCurrent(null);
    this.customersService
      .getCustomer(issue.customer_id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: unknown) => {
          // Tolerate an `{ data }` envelope as well as the bare record.
          const record =
            response && typeof response === 'object' && 'data' in response
              ? (response as { data: unknown }).data
              : response;
          this.applyCurrent(holderCurrentFrom(record));
        },
        error: () => this.loadFailed.set(true),
      });
  }

  private applyCurrent(current: HolderCurrentData | null): void {
    this.current.set(current);
    this.form.reset({
      document_type: current?.document_type ?? '',
      document_number: current?.document_number ?? '',
      verification_digit: current?.verification_digit ?? '',
      legal_name: current?.legal_name ?? '',
      first_name: current?.first_name ?? '',
      last_name: current?.last_name ?? '',
    });
  }
}
