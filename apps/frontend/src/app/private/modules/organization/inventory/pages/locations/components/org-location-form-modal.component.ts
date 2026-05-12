import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  SettingToggleComponent,
} from '../../../../../../../shared/components/index';

import {
  CreateOrgLocationRequest,
  OrgLocationRow,
  UpdateOrgLocationRequest,
} from '../../../services/org-inventory.service';

export interface OrgLocationStoreOption {
  value: number | string;
  label: string;
}

/**
 * ORG_ADMIN — Location create/edit modal.
 *
 * Mirrors the store-side `LocationFormModalComponent` but adds:
 *   - `store_id` selector (org-shared when null, store-scoped otherwise)
 *   - `is_central_warehouse` switch with inline warning + auto store_id clear
 *
 * Follows zoneless patterns: signal inputs/outputs, computed warning state,
 * and `effect()` to react to row changes.
 */
@Component({
  selector: 'app-org-location-form-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SettingToggleComponent,
    SelectorComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      [title]="location() ? 'Editar Ubicación' : 'Nueva Ubicación'"
      subtitle="Configura los detalles de la ubicación de inventario a nivel organización"
    >
      <form [formGroup]="form" (ngSubmit)="onSubmit()">
        <div class="space-y-6 max-h-[70vh] overflow-y-auto px-1">
          <!-- Basic Info -->
          <div class="grid grid-cols-2 gap-4">
            <div class="col-span-2 md:col-span-1">
              <label
                class="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5 ml-1"
                >Nombre *</label
              >
              <app-input
                formControlName="name"
                placeholder="Ej: Bodega Central"
                [error]="getError('name')"
              ></app-input>
            </div>
            <div class="col-span-2 md:col-span-1">
              <label
                class="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5 ml-1"
                >Código *</label
              >
              <app-input
                formControlName="code"
                placeholder="Ej: BOD-CENTRAL"
                [error]="getError('code')"
              ></app-input>
            </div>
          </div>

          <!-- Type + Active Toggle -->
          <div class="grid grid-cols-2 gap-4">
            <div class="col-span-2 md:col-span-1">
              <label
                class="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5 ml-1"
                >Tipo de Ubicación</label
              >
              <app-selector
                formControlName="type"
                [options]="typeOptions"
                placeholder="Seleccionar tipo"
              ></app-selector>
            </div>
            <div class="col-span-2 md:col-span-1 flex flex-col justify-end">
              <app-setting-toggle
                formControlName="is_active"
                label="Ubicación activa"
                description="Desactiva para ocultar esta ubicación"
              ></app-setting-toggle>
            </div>
          </div>

          <!-- Central Warehouse Toggle -->
          <div>
            <app-setting-toggle
              formControlName="is_central_warehouse"
              label="Bodega central de la organización"
              description="Marca esta ubicación como bodega central. Solo puede haber una por organización."
            ></app-setting-toggle>

            @if (isCentralWarehouse()) {
              <div
                class="mt-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
              >
                <app-icon
                  name="alert-triangle"
                  size="16"
                  class="mt-0.5 shrink-0 text-amber-600"
                ></app-icon>
                <span>
                  La bodega central no pertenece a una tienda específica. Solo
                  es accesible desde la vista organización y queda compartida
                  entre todas las tiendas.
                </span>
              </div>
            }
          </div>

          <!-- Store assignment (disabled when central warehouse) -->
          <div>
            <label
              class="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5 ml-1"
              >Tienda asignada</label
            >
            <app-selector
              formControlName="store_id"
              [options]="effectiveStoreOptions()"
              placeholder="Sin tienda (organización)"
            ></app-selector>
            <p class="mt-1 ml-1 text-[11px] text-text-tertiary">
              Deja vacío para una ubicación compartida a nivel organización.
            </p>
          </div>

          <!-- Default toggle -->
          <div>
            <app-setting-toggle
              formControlName="is_default"
              label="Bodega principal del store"
              description="Define esta ubicación como la bodega por defecto de la tienda asignada."
            ></app-setting-toggle>
          </div>
        </div>
      </form>

      <!-- Footer -->
      <div slot="footer" class="flex justify-end gap-3 w-full">
        <app-button variant="secondary" type="button" (clicked)="onCancel()">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          type="button"
          [loading]="isSubmitting()"
          [disabled]="form.invalid || isSubmitting()"
          (clicked)="onSubmit()"
        >
          {{ location() ? 'Guardar Cambios' : 'Crear Ubicación' }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class OrgLocationFormModalComponent {
  private fb = inject(FormBuilder);
  private destroyRef = inject(DestroyRef);

  readonly isOpen = input(false);
  readonly location = input<OrgLocationRow | null>(null);
  readonly isSubmitting = input(false);
  readonly storeOptions = input<OrgLocationStoreOption[]>([]);

  readonly isOpenChange = output<boolean>();
  readonly cancel = output<void>();
  readonly save = output<CreateOrgLocationRequest | UpdateOrgLocationRequest>();

  readonly typeOptions = [
    { value: 'warehouse', label: 'Almacén / Bodega' },
    { value: 'store', label: 'Tienda / Local' },
    { value: 'virtual', label: 'Virtual' },
    { value: 'transit', label: 'En Tránsito' },
  ];

  readonly form: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(255)]],
    code: ['', [Validators.required, Validators.maxLength(50)]],
    type: ['warehouse', [Validators.required]],
    is_active: [true],
    is_default: [false],
    is_central_warehouse: [false],
    store_id: [null as number | null],
  });

  // Tracks the current value of `is_central_warehouse` reactively without
  // pulling FormControl APIs into the template (signal-only).
  private readonly _isCentralSignal = signal(false);
  readonly isCentralWarehouse = computed(() => this._isCentralSignal());

  readonly effectiveStoreOptions = computed<OrgLocationStoreOption[]>(() => {
    const base = this.storeOptions();
    return [
      { value: '', label: 'Sin tienda (organización)' } as OrgLocationStoreOption,
      ...base,
    ];
  });

  constructor() {
    // Sync signal whenever the toggle value changes
    this.form
      .get('is_central_warehouse')!
      .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value: boolean) => {
        this._isCentralSignal.set(!!value);
        const storeIdCtrl = this.form.get('store_id');
        if (value) {
          // Central warehouse must NOT be tied to a store_id
          storeIdCtrl?.setValue('', { emitEvent: false });
          storeIdCtrl?.disable({ emitEvent: false });
          this.form.get('is_default')?.setValue(false, { emitEvent: false });
          this.form.get('is_default')?.disable({ emitEvent: false });
        } else {
          storeIdCtrl?.enable({ emitEvent: false });
          this.form.get('is_default')?.enable({ emitEvent: false });
        }
      });

    // React to opening/closing + selected row changes
    effect(() => {
      const loc = this.location();
      const open = this.isOpen();
      if (loc) {
        this.patchForm(loc);
      } else if (open && !loc) {
        this.form.reset({
          name: '',
          code: '',
          type: 'warehouse',
          is_active: true,
          is_default: false,
          is_central_warehouse: false,
          store_id: '',
        });
        this._isCentralSignal.set(false);
        this.form.get('store_id')?.enable({ emitEvent: false });
        this.form.get('is_default')?.enable({ emitEvent: false });
      }
    });
  }

  private patchForm(loc: OrgLocationRow): void {
    const isCentral = !!loc.is_central_warehouse;
    this.form.patchValue(
      {
        name: loc.name ?? '',
        code: loc.code ?? '',
        type: loc.type ?? 'warehouse',
        is_active: loc.is_active ?? true,
        is_default: !!loc.is_default,
        is_central_warehouse: isCentral,
        store_id: isCentral ? '' : loc.store_id ?? '',
      },
      { emitEvent: false },
    );
    this._isCentralSignal.set(isCentral);
    if (isCentral) {
      this.form.get('store_id')?.disable({ emitEvent: false });
      this.form.get('is_default')?.disable({ emitEvent: false });
    } else {
      this.form.get('store_id')?.enable({ emitEvent: false });
      this.form.get('is_default')?.enable({ emitEvent: false });
    }
  }

  getError(field: string): string {
    const control = this.form.get(field);
    if (control?.touched && control?.errors) {
      if (control.errors['required']) return 'Este campo es requerido';
      if (control.errors['maxlength']) return 'Texto demasiado largo';
    }
    return '';
  }

  onCancel(): void {
    this.cancel.emit();
  }

  onSubmit(): void {
    if (this.form.invalid) return;

    const raw = this.form.getRawValue();
    const isCentral = !!raw.is_central_warehouse;

    const storeIdRaw = raw.store_id;
    const storeId =
      isCentral || storeIdRaw === '' || storeIdRaw === null || storeIdRaw === undefined
        ? null
        : Number(storeIdRaw);

    const payload: CreateOrgLocationRequest = {
      name: String(raw.name).trim(),
      code: String(raw.code).trim(),
      type: raw.type ?? 'warehouse',
      is_active: !!raw.is_active,
      is_default: isCentral ? false : !!raw.is_default,
      is_central_warehouse: isCentral,
      store_id: storeId,
    };

    this.save.emit(payload);
  }
}
