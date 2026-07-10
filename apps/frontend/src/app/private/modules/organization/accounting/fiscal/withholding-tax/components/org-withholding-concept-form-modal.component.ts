import { Component, effect, inject, input, output } from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import {
  ButtonComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  SettingToggleComponent,
} from '../../../../../../../shared/components/index';

import {
  OrgCreateConceptDto,
  OrgWithholdingConcept,
} from '../interfaces/org-withholding.interface';

/**
 * ORG_ADMIN — Withholding concept create/edit modal.
 *
 * Mirrors the org supplier modal pattern (`app-modal` wrapper + Reactive Form +
 * shared `app-selector`/`app-setting-toggle`). Exposes the fiscal-typing fields
 * the backend DTO accepts (Bloque B):
 *   - `withholding_type` (retefuente | reteiva | reteica)
 *   - `supplier_type_filter` (any | gran_contribuyente | regimen_simple | persona_natural)
 *   - `account_code` (optional PUC text)
 *
 * `rate` is stored as a fraction (0-1) on the backend; the form shows a
 * percentage and converts on patch/submit, consistent with the list display.
 */
@Component({
  selector: 'app-org-withholding-concept-form-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    SettingToggleComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      [title]="concept() ? 'Editar Concepto' : 'Nuevo Concepto'"
      subtitle="Configura el concepto de retención y su tipificación fiscal"
    >
      <form [formGroup]="form" (ngSubmit)="onSubmit()">
        <div class="space-y-4 max-h-[70vh] overflow-y-auto px-1">
          <!-- Identification -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <app-input
              label="Código *"
              formControlName="code"
              placeholder="Ej: 365"
              [error]="getError('code')"
            ></app-input>
            <app-input
              label="Nombre *"
              formControlName="name"
              placeholder="Ej: Compras generales"
              [error]="getError('name')"
            ></app-input>
          </div>

          <!-- Rate + threshold -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <app-input
              label="Tasa % *"
              formControlName="rate_pct"
              type="number"
              placeholder="Ej: 2.5"
              [error]="getError('rate_pct')"
            ></app-input>
            <app-input
              label="Umbral UVT"
              formControlName="min_uvt_threshold"
              type="number"
              placeholder="Ej: 27"
            ></app-input>
          </div>

          <!-- Fiscal typing -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <app-selector
              label="Tipo de Retención *"
              formControlName="withholding_type"
              [options]="withholdingTypeOptions"
              placeholder="Seleccionar"
            ></app-selector>
            <app-selector
              label="Aplica a"
              formControlName="supplier_type_filter"
              [options]="supplierTypeFilterOptions"
              placeholder="Seleccionar"
            ></app-selector>
          </div>

          <!-- applies_to (free context label) + PUC -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <app-input
              label="Contexto (applies_to)"
              formControlName="applies_to"
              placeholder="Ej: compras, servicios"
            ></app-input>
            <app-input
              label="Cuenta PUC"
              formControlName="account_code"
              placeholder="Opcional. Ej: 236540"
            ></app-input>
          </div>

          <!-- Active Toggle -->
          <app-setting-toggle
            formControlName="is_active"
            label="Concepto activo"
            description="Desactiva para ocultar este concepto de los cálculos"
          ></app-setting-toggle>
        </div>
      </form>

      <!-- Footer -->
      <div slot="footer">
        <div
          class="flex items-center justify-end gap-3 p-3 bg-[var(--color-surface-secondary)] rounded-b-xl border-t border-border"
        >
          <app-button variant="outline" type="button" (clicked)="onCancel()">
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            type="button"
            [loading]="isSubmitting()"
            [disabled]="form.invalid || isSubmitting()"
            (clicked)="onSubmit()"
          >
            {{ concept() ? 'Guardar Cambios' : 'Crear Concepto' }}
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class OrgWithholdingConceptFormModalComponent {
  private fb = inject(FormBuilder);

  readonly isOpen = input(false);
  readonly concept = input<OrgWithholdingConcept | null>(null);
  readonly isSubmitting = input(false);

  readonly isOpenChange = output<boolean>();
  readonly cancel = output<void>();
  readonly save = output<OrgCreateConceptDto>();

  readonly withholdingTypeOptions: SelectorOption[] = [
    { value: 'retefuente', label: 'Retención en la fuente' },
    { value: 'reteiva', label: 'Retención de IVA' },
    { value: 'reteica', label: 'Retención de ICA' },
  ];

  readonly supplierTypeFilterOptions: SelectorOption[] = [
    { value: 'any', label: 'Cualquiera' },
    { value: 'gran_contribuyente', label: 'Gran Contribuyente' },
    { value: 'regimen_simple', label: 'Régimen Simple' },
    { value: 'persona_natural', label: 'Persona Natural' },
  ];

  readonly form: FormGroup = this.fb.group({
    code: ['', [Validators.required, Validators.maxLength(50)]],
    name: ['', [Validators.required, Validators.maxLength(200)]],
    rate_pct: [null, [Validators.required, Validators.min(0), Validators.max(100)]],
    min_uvt_threshold: [null],
    withholding_type: ['retefuente', [Validators.required]],
    supplier_type_filter: ['any'],
    applies_to: [''],
    account_code: [''],
    is_active: [true],
  });

  constructor() {
    effect(() => {
      const concept = this.concept();
      const open = this.isOpen();
      if (concept) {
        this.patchForm(concept);
      } else if (open && !concept) {
        this.form.reset({
          code: '',
          name: '',
          rate_pct: null,
          min_uvt_threshold: null,
          withholding_type: 'retefuente',
          supplier_type_filter: 'any',
          applies_to: '',
          account_code: '',
          is_active: true,
        });
      }
    });
  }

  private patchForm(concept: OrgWithholdingConcept): void {
    this.form.patchValue(
      {
        code: concept.code ?? '',
        name: concept.name ?? '',
        rate_pct:
          concept.rate === null || concept.rate === undefined
            ? null
            : Number((Number(concept.rate) * 100).toFixed(4)),
        min_uvt_threshold: concept.min_uvt_threshold ?? null,
        withholding_type: concept.withholding_type ?? 'retefuente',
        supplier_type_filter: concept.supplier_type_filter ?? 'any',
        applies_to: concept.applies_to ?? '',
        account_code: concept.account_code ?? '',
        is_active: concept.is_active ?? true,
      },
      { emitEvent: false },
    );
  }

  getError(field: string): string {
    const control = this.form.get(field);
    if (control?.touched && control?.errors) {
      if (control.errors['required']) return 'Este campo es requerido';
      if (control.errors['maxlength']) return 'Texto demasiado largo';
      if (control.errors['min']) return 'Debe ser mayor o igual a 0';
      if (control.errors['max']) return 'No puede superar 100';
    }
    return '';
  }

  onCancel(): void {
    this.cancel.emit();
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();

    const payload: OrgCreateConceptDto = {
      code: String(raw.code).trim(),
      name: String(raw.name).trim(),
      rate: Number(raw.rate_pct) / 100,
      min_uvt_threshold:
        raw.min_uvt_threshold === null || raw.min_uvt_threshold === ''
          ? 0
          : Number(raw.min_uvt_threshold),
      applies_to: raw.applies_to ? String(raw.applies_to).trim() : '',
      supplier_type_filter: raw.supplier_type_filter || 'any',
      withholding_type: raw.withholding_type || 'retefuente',
      account_code: raw.account_code ? String(raw.account_code).trim() : undefined,
      is_active: !!raw.is_active,
    };

    this.save.emit(payload);
  }
}
