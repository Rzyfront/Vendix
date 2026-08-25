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
import { NgClass } from '@angular/common';

import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { Actions, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { Subscription, startWith, take } from 'rxjs';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Invoice } from '../../interfaces/invoice.interface';
import {
  createCreditNote,
  createCreditNoteFailure,
  createCreditNoteSuccess,
  createDebitNote,
  createDebitNoteFailure,
  createDebitNoteSuccess,
  MutationFailure,
} from '../../state/actions/invoicing.actions';
import {
  applyBackendValidationErrors,
  clearBackendError,
} from '../../utils/invoicing-errors.util';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { remainingChars, showCharCounter } from '../../utils/char-limit.util';

/**
 * F.3: tope de `reason` — `CreateCreditNoteDto`/`CreateDebitNoteDto.reason`
 * llevan `@MaxLength(500)` en el backend (create-credit-note.dto.ts:59/139).
 * No es el mismo campo que `notes` (5000, CAD11/DAD11): este modal no
 * captura `notes` hoy, así que ese tope no tiene control de UI que acotar.
 */
const REASON_LIMIT = 500;

/**
 * Nota crédito / débito sobre una factura existente.
 *
 * Igual que el modal de creación, este modal **no cierra hasta saber si el
 * backend aceptó la nota**. Antes despachaba y cerraba en el mismo tick, de
 * modo que un rechazo (nota sobre factura no aceptada, motivo demasiado corto,
 * resolución sin numeración disponible) se veía exactamente igual que un éxito.
 */
@Component({
  selector: 'vendix-credit-note-create',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgClass,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    TextareaComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      (cancel)="onClose()"
      [title]="
        noteType() === 'credit' ? 'Nueva Nota Crédito' : 'Nueva Nota Débito'
      "
      size="md"
    >
      <div class="p-4">
        @if (submitError()) {
          <div
            role="alert"
            class="mb-4 rounded-lg border border-error bg-error-light p-3"
          >
            <div class="flex items-start gap-2">
              <app-icon name="alert-triangle" [size]="16" class="text-error" />
              <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-error">
                  {{
                    noteType() === 'credit'
                      ? 'No se pudo crear la nota crédito'
                      : 'No se pudo crear la nota débito'
                  }}
                </p>
                <p class="text-sm text-error">{{ submitError() }}</p>
                @if (submitErrorDetails().length) {
                  <ul class="mt-1 list-disc pl-4 text-xs text-error space-y-0.5">
                    @for (detail of submitErrorDetails(); track detail) {
                      <li>{{ detail }}</li>
                    }
                  </ul>
                }
              </div>
            </div>
          </div>
        }

        <!-- Note Type Selector -->
        <div class="flex gap-2 mb-4">
          <button
            type="button"
            class="flex-1 px-3 py-2 text-sm rounded-lg border transition-colors"
            [ngClass]="
              noteType() === 'credit'
                ? 'bg-primary text-[var(--color-text-on-primary)] border-primary'
                : 'bg-[var(--color-surface)] text-text-primary border-border'
            "
            (click)="setNoteType('credit')"
          >
            Nota Crédito
          </button>
          <button
            type="button"
            class="flex-1 px-3 py-2 text-sm rounded-lg border transition-colors"
            [ngClass]="
              noteType() === 'debit'
                ? 'bg-primary text-[var(--color-text-on-primary)] border-primary'
                : 'bg-[var(--color-surface)] text-text-primary border-border'
            "
            (click)="setNoteType('debit')"
          >
            Nota Débito
          </button>
        </div>

        <!-- Source Invoice Info -->
        @if (sourceInvoice()) {
          <div
            class="mb-4 p-3 bg-[var(--color-info-light)] rounded-lg border border-border text-sm"
          >
            <div class="font-medium text-[var(--color-info)] mb-1">
              Factura de referencia
            </div>
            <div class="text-[var(--color-info)]">
              {{ sourceInvoice()!.invoice_number }} -
              {{ sourceInvoice()!.customer_name || 'Sin cliente' }}
              ({{ formatAmount(sourceInvoice()!.total_amount) }})
            </div>
          </div>
        }

        <form [formGroup]="noteForm" (ngSubmit)="onSubmit()" class="space-y-4">
          <div>
            <app-textarea
              label="Razón / Motivo"
              formControlName="reason"
              [control]="noteForm.get('reason')"
              [error]="fieldError('reason')"
              placeholder="Explique el motivo de la nota..."
              [rows]="3"
              [required]="true"
            ></app-textarea>
            <!--
              «app-textarea» no reenvía «maxlength» al «textarea» nativo, así
              que este contador es la única señal en pantalla del tope real
              (500) — lo hace cumplir «Validators.maxLength» en el formulario,
              no el navegador cortando el tecleo.
            -->
            @if (showCharCounter(noteForm.get('reason')!.value, reasonLimit)) {
              <p
                class="text-[10px] text-right leading-tight"
                [class.text-destructive]="
                  remainingChars(noteForm.get('reason')!.value, reasonLimit) <= 0
                "
                [class.text-text-secondary]="
                  remainingChars(noteForm.get('reason')!.value, reasonLimit) > 0
                "
              >
                {{ remainingChars(noteForm.get('reason')!.value, reasonLimit) }}
                caracteres restantes
              </p>
            }
          </div>
        </form>
      </div>

      <!-- Footer -->
      <div slot="footer">
        <div
          class="flex items-center justify-end gap-3 p-3 bg-[var(--color-surface-secondary)] rounded-b-xl border-t border-border"
        >
          <app-button variant="outline" (clicked)="onClose()">
            Cancelar
          </app-button>

          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="!canSubmit()"
            [loading]="submitting()"
          >
            {{
              noteType() === 'credit'
                ? 'Crear Nota Crédito'
                : 'Crear Nota Débito'
            }}
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class CreditNoteCreateComponent {
  /**
   * `model()` ya publica su propio `isOpenChange`; declarar un `output()` con
   * ese nombre al lado creaba dos canales para el mismo estado.
   */
  readonly isOpen = model<boolean>(false);
  readonly sourceInvoice = input<Invoice | null>(null);

  readonly noteType = signal<'credit' | 'debit'>('credit');
  readonly submitting = signal(false);
  readonly submitError = signal<string | null>(null);
  readonly submitErrorDetails = signal<string[]>([]);
  private readonly backendFieldErrors = signal<Record<string, string>>({});

  private fb = inject(FormBuilder);
  private store = inject(Store);
  private actions$ = inject(Actions);
  private destroyRef = inject(DestroyRef);
  private currencyService = inject(CurrencyFormatService);

  readonly noteForm: FormGroup = this.fb.group({
    reason: [
      '',
      [Validators.required, Validators.minLength(5), Validators.maxLength(REASON_LIMIT)],
    ],
  });

  /** F.3: contador de caracteres, expuesto para la plantilla. */
  readonly reasonLimit = REASON_LIMIT;
  readonly remainingChars = remainingChars;
  readonly showCharCounter = showCharCounter;

  /**
   * `noteForm.invalid` es una propiedad plana: leerla dentro de un `computed`
   * lo congela en el estado inicial. El estado se puentea como señal.
   */
  private readonly formStatus = toSignal(
    this.noteForm.statusChanges.pipe(startWith(this.noteForm.status)),
    { initialValue: this.noteForm.status },
  );

  readonly canSubmit = computed(
    () =>
      !this.submitting() &&
      this.formStatus() === 'VALID' &&
      this.sourceInvoice() != null,
  );

  private backendErrorSubs = new Subscription();
  private erroredControls: { path: string; control: AbstractControl }[] = [];

  constructor() {
    this.currencyService.loadCurrency();
    this.destroyRef.onDestroy(() => this.backendErrorSubs.unsubscribe());

    this.actions$
      .pipe(
        ofType(createCreditNoteSuccess, createDebitNoteSuccess),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.onNoteSucceeded());

    this.actions$
      .pipe(
        ofType(createCreditNoteFailure, createDebitNoteFailure),
        takeUntilDestroyed(),
      )
      .subscribe((failure) => this.onNoteFailed(failure));
  }

  fieldError(path: string): string | undefined {
    return this.backendFieldErrors()[path];
  }

  setNoteType(type: 'credit' | 'debit'): void {
    if (this.submitting()) {
      return;
    }
    this.noteType.set(type);
    this.clearSubmitError();
  }

  onSubmit(): void {
    const sourceInv = this.sourceInvoice();
    if (this.submitting()) {
      return;
    }
    if (this.noteForm.invalid || !sourceInv) {
      this.noteForm.markAllAsTouched();
      return;
    }

    this.clearSubmitError();
    this.submitting.set(true);
    const reason = this.noteForm.value.reason;
    const originalInvoiceId = sourceInv.id;

    if (this.noteType() === 'credit') {
      this.store.dispatch(
        createCreditNote({
          dto: { related_invoice_id: originalInvoiceId, reason },
        }),
      );
    } else {
      this.store.dispatch(
        createDebitNote({
          dto: { related_invoice_id: originalInvoiceId, reason },
        }),
      );
    }
  }

  private onNoteSucceeded(): void {
    if (!this.submitting()) {
      return;
    }
    this.submitting.set(false);
    this.clearSubmitError();
    this.resetForm();
    this.isOpen.set(false);
  }

  /** El backend rechazó la nota: el modal sigue abierto con el motivo escrito. */
  private onNoteFailed(failure: MutationFailure): void {
    if (!this.submitting()) {
      return;
    }
    this.submitting.set(false);
    this.submitError.set(failure.error);

    if (failure.errorCode !== 'SYS_VALIDATION_001') {
      this.submitErrorDetails.set([]);
      return;
    }

    const applied = applyBackendValidationErrors(this.noteForm, failure.details);
    this.backendFieldErrors.set(applied.fieldErrors);
    this.submitErrorDetails.set(applied.unmatched);
    this.erroredControls = applied.touchedControls;
    for (const { path, control } of applied.touchedControls) {
      this.backendErrorSubs.add(
        control.valueChanges.pipe(take(1)).subscribe(() => {
          clearBackendError(control);
          this.backendFieldErrors.update((current) => {
            const next = { ...current };
            delete next[path];
            return next;
          });
        }),
      );
    }
  }

  formatAmount(value: number): string {
    return this.currencyService.format(Number(value) || 0);
  }

  private clearSubmitError(): void {
    this.submitError.set(null);
    this.submitErrorDetails.set([]);
    this.backendFieldErrors.set({});
    this.backendErrorSubs.unsubscribe();
    this.backendErrorSubs = new Subscription();
    for (const { control } of this.erroredControls) {
      clearBackendError(control);
    }
    this.erroredControls = [];
  }

  private resetForm(): void {
    this.noteForm.reset();
    this.noteType.set('credit');
  }

  onClose(): void {
    if (this.submitting()) {
      return;
    }
    this.clearSubmitError();
    this.isOpen.set(false);
  }
}
