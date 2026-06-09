import {
  Component,
  inject,
  signal,
  computed,
  effect,
  input,
  output,
  model,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { startWith } from 'rxjs/operators';

import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  ToggleComponent,
  ToastService,
} from '../../../../../shared/components';
import type { SelectorOption } from '../../../../../shared/components';
import { WithholdingTaxService } from '../services/withholding-tax.service';
import {
  WithholdingConcept,
  CreateConceptDto,
} from '../interfaces/withholding.interface';

interface ConceptFormControls {
  code: FormControl<string>;
  name: FormControl<string>;
  rate: FormControl<number | null>;
  min_uvt_threshold: FormControl<number | null>;
  withholding_type: FormControl<'retefuente' | 'reteiva' | 'reteica'>;
  applies_to: FormControl<string>;
  supplier_type_filter: FormControl<
    'any' | 'gran_contribuyente' | 'regimen_simple' | 'persona_natural'
  >;
  account_code: FormControl<string>;
  is_active: FormControl<boolean>;
}

@Component({
  selector: 'app-withholding-concept-form-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    ToggleComponent,
  ],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      (cancel)="onCancel()"
      size="md"
      [title]="
        concept() ? 'Editar Concepto de Retención' : 'Nuevo Concepto de Retención'
      "
    >
      <form [formGroup]="form" class="space-y-4">
        <!-- Code + Name -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <app-input
            label="Código"
            placeholder="Ej: 365"
            formControlName="code"
            [required]="true"
          ></app-input>
          <app-input
            label="Nombre"
            placeholder="Ej: Compras generales"
            formControlName="name"
            [required]="true"
          ></app-input>
        </div>

        <!-- Withholding type + Applies to -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <app-selector
            label="Tipo de Retención"
            [options]="withholdingTypeOptions"
            formControlName="withholding_type"
            [required]="true"
          ></app-selector>
          <app-selector
            label="Aplica a"
            placeholder="Seleccionar..."
            [options]="appliesToOptions"
            formControlName="applies_to"
            [required]="true"
          ></app-selector>
        </div>

        <!-- Rate + Min UVT -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <app-input
            label="Tasa (%)"
            type="number"
            placeholder="Ej: 2.5"
            helperText="Porcentaje. Internamente se guarda como fracción (2.5% → 0.025)."
            formControlName="rate"
            [required]="true"
          ></app-input>
          <app-input
            label="Umbral mínimo (UVT)"
            type="number"
            placeholder="0"
            formControlName="min_uvt_threshold"
          ></app-input>
        </div>

        <!-- Supplier type filter + Account code -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <app-selector
            label="Tipo de tercero al que aplica"
            [options]="supplierTypeOptions"
            formControlName="supplier_type_filter"
          ></app-selector>
          <app-input
            label="Cuenta PUC (opcional)"
            placeholder="Ej: 236525"
            helperText="Cuenta contable destino de la retención."
            formControlName="account_code"
          ></app-input>
        </div>

        <!-- Active -->
        @if (concept()) {
          <div class="flex items-center gap-3 pt-1">
            <app-toggle formControlName="is_active" label="Activo"></app-toggle>
            <span class="text-xs text-text-muted">
              Desactivar oculta el concepto sin eliminarlo.
            </span>
          </div>
        }
      </form>

      <div
        slot="footer"
        class="flex justify-end gap-3 pt-4 border-t border-border mt-4"
      >
        <app-button variant="outline" (clicked)="onCancel()">Cancelar</app-button>
        <app-button
          variant="primary"
          (clicked)="onSave()"
          [disabled]="!canSave()"
          [loading]="saving()"
        >
          <app-icon name="save" [size]="16" slot="icon"></app-icon>
          {{ concept() ? 'Guardar Cambios' : 'Crear Concepto' }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class WithholdingConceptFormModalComponent {
  private destroyRef = inject(DestroyRef);
  private service = inject(WithholdingTaxService);
  private toast = inject(ToastService);

  /** Two-way modal visibility. */
  readonly isOpen = model<boolean>(false);
  /** Concept being edited; `null` means create mode. */
  readonly concept = input<WithholdingConcept | null>(null);
  /** Emitted after a successful create/update so the parent can refresh. */
  readonly saved = output<void>();

  readonly saving = signal(false);

  readonly withholdingTypeOptions: SelectorOption[] = [
    { value: 'retefuente', label: 'Retefuente' },
    { value: 'reteiva', label: 'ReteIVA' },
    { value: 'reteica', label: 'ReteICA' },
  ];

  readonly appliesToOptions: SelectorOption[] = [
    { value: 'purchase', label: 'Compras' },
    { value: 'service', label: 'Servicios' },
    { value: 'rent', label: 'Arrendamientos' },
    { value: 'fees', label: 'Honorarios' },
    { value: 'other', label: 'Otros' },
  ];

  readonly supplierTypeOptions: SelectorOption[] = [
    { value: 'any', label: 'Cualquiera' },
    { value: 'gran_contribuyente', label: 'Gran contribuyente' },
    { value: 'regimen_simple', label: 'Régimen simple' },
    { value: 'persona_natural', label: 'Persona natural' },
  ];

  readonly form = new FormGroup<ConceptFormControls>({
    code: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    rate: new FormControl<number | null>(null, {
      validators: [Validators.required, Validators.min(0), Validators.max(100)],
    }),
    min_uvt_threshold: new FormControl<number | null>(0),
    withholding_type: new FormControl<'retefuente' | 'reteiva' | 'reteica'>(
      'retefuente',
      { nonNullable: true, validators: [Validators.required] },
    ),
    applies_to: new FormControl('purchase', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    supplier_type_filter: new FormControl<
      'any' | 'gran_contribuyente' | 'regimen_simple' | 'persona_natural'
    >('any', { nonNullable: true }),
    account_code: new FormControl('', { nonNullable: true }),
    is_active: new FormControl(true, { nonNullable: true }),
  });

  /** Bridge reactive-form validity into a signal (zoneless-safe). */
  private readonly status = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );

  readonly canSave = computed(() => this.status() === 'VALID' && !this.saving());

  constructor() {
    // Re-hydrate the form whenever the modal opens or the edited concept changes.
    effect(() => {
      const open = this.isOpen();
      const editing = this.concept();
      if (!open) return;

      if (editing) {
        this.form.reset({
          code: editing.code ?? '',
          name: editing.name ?? '',
          rate:
            editing.rate != null ? Number((editing.rate * 100).toFixed(4)) : null,
          min_uvt_threshold: editing.min_uvt_threshold ?? 0,
          withholding_type: editing.withholding_type ?? 'retefuente',
          applies_to: editing.applies_to ?? 'purchase',
          supplier_type_filter:
            (editing.supplier_type_filter as ConceptFormControls['supplier_type_filter']['value']) ??
            'any',
          account_code: editing.account_code ?? '',
          is_active: editing.is_active ?? true,
        });
      } else {
        this.resetForm();
      }
    });
  }

  onSave(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    const raw = this.form.getRawValue();

    // Build DTO. `is_active` is NOT part of the backend create/update contract
    // (whitelist + forbidNonWhitelisted) — activation is toggled via deactivate
    // on the list. Rate is sent as a fraction (2.5% → 0.025).
    const dto: CreateConceptDto = {
      code: raw.code.trim(),
      name: raw.name.trim(),
      rate: Number(((raw.rate ?? 0) / 100).toFixed(6)),
      min_uvt_threshold: Number(raw.min_uvt_threshold ?? 0),
      applies_to: raw.applies_to,
      supplier_type_filter: raw.supplier_type_filter,
      withholding_type: raw.withholding_type,
    };
    const accountCode = raw.account_code?.trim();
    if (accountCode) {
      dto.account_code = accountCode;
    }

    const editing = this.concept();
    const request$ = editing
      ? this.service.updateConcept(editing.id, dto)
      : this.service.createConcept(dto);

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toast.success(
          editing ? 'Concepto actualizado' : 'Concepto creado exitosamente',
        );
        this.saving.set(false);
        this.saved.emit();
        this.close();
      },
      error: (err: any) => {
        this.saving.set(false);
        const message =
          err?.error?.message ?? 'No se pudo guardar el concepto de retención';
        this.toast.error(
          Array.isArray(message) ? message.join(', ') : message,
        );
      },
    });
  }

  onCancel(): void {
    this.close();
  }

  private close(): void {
    this.isOpen.set(false);
  }

  private resetForm(): void {
    this.form.reset({
      code: '',
      name: '',
      rate: null,
      min_uvt_threshold: 0,
      withholding_type: 'retefuente',
      applies_to: 'purchase',
      supplier_type_filter: 'any',
      account_code: '',
      is_active: true,
    });
  }
}
