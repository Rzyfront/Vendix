import { Component, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { Coupon, CreateCouponRequest } from '../../interfaces/coupon.interface';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  TextareaComponent,
  SettingToggleComponent,
} from '../../../../../../../shared/components';

@Component({
  selector: 'app-coupon-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    SettingToggleComponent,
  ],
  template: `
    @if (visible()) {
    <app-modal
      [isOpen]="true"
      [title]="coupon() ? 'Editar Cupon' : 'Crear Cupon'"
      size="lg"
      (closed)="close.emit()"
    >
      <form [formGroup]="form" class="space-y-3">

        <!-- Code + Name -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <app-input
            label="Codigo"
            formControlName="code"
            placeholder="Ej: VERANO2026"
            [required]="true"
            customInputClass="font-mono uppercase"
            [suffixIcon]="true"
            [suffixClickable]="true"
            (suffixClick)="generateCode()"
            [error]="form.get('code')?.touched && form.get('code')?.invalid ? 'Minimo 3 caracteres' : ''"
          >
            <svg slot="suffix-icon" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </app-input>
          <div class="sm:col-span-2">
            <app-input
              label="Nombre"
              formControlName="name"
              placeholder="Ej: Descuento de verano"
              [required]="true"
              [error]="form.get('name')?.touched && form.get('name')?.invalid ? 'Minimo 2 caracteres' : ''"
            ></app-input>
          </div>
        </div>

        <!-- Description -->
        <app-textarea
          label="Descripcion"
          formControlName="description"
          placeholder="Descripcion del cupon (opcional)..."
          [rows]="2"
        ></app-textarea>

        <!-- Discount Type + Value + Applies To -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <app-selector
            label="Tipo de descuento"
            [options]="discountTypeOptions"
            formControlName="discount_type"
            [required]="true"
          ></app-selector>

          <app-input
            label="Valor"
            type="number"
            formControlName="discount_value"
            [required]="true"
            placeholder="0"
            [prefixIcon]="true"
            [min]="0"
            [max]="form.get('discount_type')?.value === 'PERCENTAGE' ? 100 : ''"
            [error]="form.get('discount_value')?.touched && form.get('discount_value')?.invalid ? 'Requerido, mayor a 0' : ''"
          >
            <span slot="prefix-icon">{{ form.get('discount_type')?.value === 'PERCENTAGE' ? '%' : '$' }}</span>
          </app-input>

          <app-selector
            label="Aplica a"
            [options]="appliesToOptions"
            formControlName="applies_to"
          ></app-selector>
        </div>

        <!-- Valid From + Valid Until + Min Purchase -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <app-input
            label="Valido desde"
            type="datetime-local"
            formControlName="valid_from"
            [required]="true"
            [error]="form.get('valid_from')?.touched && form.get('valid_from')?.invalid ? 'Requerido' : ''"
          ></app-input>
          <app-input
            label="Valido hasta"
            type="datetime-local"
            formControlName="valid_until"
            [required]="true"
            [error]="form.get('valid_until')?.touched && form.get('valid_until')?.invalid ? 'Requerido' : ''"
          ></app-input>
          <app-input
            label="Compra minima"
            type="number"
            formControlName="min_purchase_amount"
            placeholder="Sin minimo"
            [min]="0"
          ></app-input>
        </div>

        <!-- Max Discount + Max Uses + Uses Per Customer -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <app-input
            label="Descuento maximo"
            type="number"
            formControlName="max_discount_amount"
            placeholder="Sin limite"
            [min]="0"
          ></app-input>
          <app-input
            label="Limite de usos"
            type="number"
            formControlName="max_uses"
            placeholder="Sin limite"
            [min]="0"
          ></app-input>
          <app-input
            label="Usos por cliente"
            type="number"
            formControlName="max_uses_per_customer"
            placeholder="Sin limite"
            [min]="0"
          ></app-input>
        </div>

        <!-- Active toggle -->
        <div class="pt-2">
        <app-setting-toggle
          label="Cupon activo"
          description="Disponible para uso inmediato"
          formControlName="is_active"
        ></app-setting-toggle>
        </div>

      </form>

      <!-- Footer -->
      <div slot="footer" class="flex justify-end items-center gap-3">
        <app-button variant="outline" (clicked)="close.emit()">Cancelar</app-button>
        <app-button variant="primary" (clicked)="onSubmit()" [disabled]="form.invalid" [loading]="loading()">
          {{ coupon() ? 'Guardar cambios' : 'Crear Cupon' }}
        </app-button>
      </div>
    </app-modal>
    }
  `,
})
export class CouponModalComponent {
  visible = input<boolean>(false);
  coupon = input<Coupon | null>(null);
  loading = input<boolean>(false);

  close = output<void>();
  save = output<CreateCouponRequest>();

  private fb = inject(FormBuilder);

  discountTypeOptions: SelectorOption[] = [
    { value: 'PERCENTAGE', label: 'Porcentaje' },
    { value: 'FIXED_AMOUNT', label: 'Monto fijo' },
  ];

  appliesToOptions: SelectorOption[] = [
    { value: 'ALL_PRODUCTS', label: 'Todos los productos' },
    { value: 'SPECIFIC_PRODUCTS', label: 'Productos especificos' },
    { value: 'SPECIFIC_CATEGORIES', label: 'Categorias especificas' },
  ];

  form: FormGroup = this.fb.group({
    code: ['', [Validators.required, Validators.minLength(3)]],
    name: ['', [Validators.required, Validators.minLength(2)]],
    description: [''],
    discount_type: ['PERCENTAGE', Validators.required],
    discount_value: [null, [Validators.required, Validators.min(0.01)]],
    min_purchase_amount: [null],
    max_discount_amount: [null],
    max_uses: [null],
    max_uses_per_customer: [1],
    valid_from: ['', Validators.required],
    valid_until: ['', Validators.required],
    is_active: [true],
    applies_to: ['ALL_PRODUCTS'],
  });

  ngOnChanges() {
    const c = this.coupon();
    if (c) {
      this.form.patchValue({
        code: c.code,
        name: c.name,
        description: c.description || '',
        discount_type: c.discount_type,
        discount_value: Number(c.discount_value),
        min_purchase_amount: c.min_purchase_amount
          ? Number(c.min_purchase_amount)
          : null,
        max_discount_amount: c.max_discount_amount
          ? Number(c.max_discount_amount)
          : null,
        max_uses: c.max_uses,
        max_uses_per_customer: c.max_uses_per_customer,
        valid_from: this.toDatetimeLocal(c.valid_from),
        valid_until: this.toDatetimeLocal(c.valid_until),
        is_active: c.is_active,
        applies_to: c.applies_to,
      });
    } else if (!this.coupon()) {
      this.form.reset({
        discount_type: 'PERCENTAGE',
        is_active: true,
        applies_to: 'ALL_PRODUCTS',
        max_uses_per_customer: 1,
      });
    }
  }

  generateCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    this.form.patchValue({ code });
  }

  onSubmit() {
    if (this.form.invalid) return;
    const raw = this.form.getRawValue();
    const request: CreateCouponRequest = {
      code: raw.code.toUpperCase().trim(),
      name: raw.name,
      description: raw.description || undefined,
      discount_type: raw.discount_type,
      discount_value: raw.discount_value,
      min_purchase_amount: raw.min_purchase_amount || undefined,
      max_discount_amount: raw.max_discount_amount || undefined,
      max_uses: raw.max_uses || undefined,
      max_uses_per_customer: raw.max_uses_per_customer || undefined,
      valid_from: new Date(raw.valid_from).toISOString(),
      valid_until: new Date(raw.valid_until).toISOString(),
      is_active: raw.is_active,
      applies_to: raw.applies_to,
    };
    this.save.emit(request);
  }

  private toDatetimeLocal(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toISOString().slice(0, 16);
  }
}
