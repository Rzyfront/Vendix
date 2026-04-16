import { Component, Input, Output, EventEmitter, OnInit, inject } from '@angular/core';

import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import {
  Promotion,
  CreatePromotionDto,
  UpdatePromotionDto,
} from '../../interfaces/promotion.interface';
import {
  MultiSelectorComponent,
  MultiSelectorOption,
} from '../../../../../../../shared/components/multi-selector/multi-selector.component';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  TextareaComponent,
  SettingToggleComponent,
} from '../../../../../../../shared/components';
import { ProductsService } from '../../../../products/services/products.service';
import { CategoriesService } from '../../../../products/services/categories.service';

@Component({
  selector: 'app-promotion-form-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MultiSelectorComponent,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    SettingToggleComponent
],
  template: `
    <app-modal
      [isOpen]="true"
      [title]="promotion ? 'Editar Promocion' : 'Nueva Promocion'"
      size="lg"
      (closed)="close.emit()"
    >
      <form [formGroup]="form" class="space-y-3">

        <!-- Name + Code -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div class="sm:col-span-2">
            <app-input
              label="Nombre"
              formControlName="name"
              placeholder="Ej: Descuento de bienvenida"
              [required]="true"
              [error]="form.get('name')?.touched && form.get('name')?.invalid ? 'El nombre es requerido' : ''"
            ></app-input>
          </div>
          <app-input
            label="Codigo (cupon)"
            formControlName="code"
            placeholder="Ej: BIENVENIDO20"
            customInputClass="font-mono uppercase"
          ></app-input>
        </div>

        <!-- Description -->
        <app-textarea
          label="Descripcion"
          formControlName="description"
          placeholder="Descripcion de la promocion..."
          [rows]="2"
        ></app-textarea>

        <!-- Type + Value + Scope -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <app-selector
            label="Tipo"
            [options]="typeOptions"
            formControlName="type"
            [required]="true"
          ></app-selector>

          <app-input
            label="Valor"
            type="number"
            formControlName="value"
            [required]="true"
            placeholder="0"
            [prefixIcon]="true"
            [min]="0"
            [max]="form.get('type')?.value === 'percentage' ? 100 : ''"
            [error]="form.get('value')?.touched && form.get('value')?.invalid ? 'El valor es requerido y debe ser mayor a 0' : ''"
          >
            <span slot="prefix-icon">{{ form.get('type')?.value === 'percentage' ? '%' : '$' }}</span>
          </app-input>

          <app-selector
            label="Alcance"
            [options]="scopeOptions"
            formControlName="scope"
          ></app-selector>
        </div>

        <!-- Product Selector (when scope is product) -->
        @if (form.get('scope')?.value === 'product') {
          <app-multi-selector
            label="Productos"
            [options]="productOptions"
            formControlName="product_ids"
            placeholder="Buscar productos..."
          ></app-multi-selector>
        }

        <!-- Category Selector (when scope is category) -->
        @if (form.get('scope')?.value === 'category') {
          <app-multi-selector
            label="Categorias"
            [options]="categoryOptions"
            formControlName="category_ids"
            placeholder="Buscar categorias..."
          ></app-multi-selector>
        }

        <!-- Dates + Min purchase -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <app-input
            label="Fecha inicio"
            type="date"
            formControlName="start_date"
            [required]="true"
            [error]="form.get('start_date')?.touched && form.get('start_date')?.invalid ? 'La fecha de inicio es requerida' : ''"
          ></app-input>
          <app-input
            label="Fecha fin"
            type="date"
            formControlName="end_date"
          ></app-input>
          <app-input
            label="Compra minima"
            type="number"
            formControlName="min_purchase_amount"
            placeholder="0"
            [min]="0"
          ></app-input>
        </div>

        <!-- Limits row -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          @if (form.get('type')?.value === 'percentage') {
            <app-input
              label="Descuento maximo"
              type="number"
              formControlName="max_discount_amount"
              placeholder="Sin limite"
              [min]="0"
            ></app-input>
          }
          <app-input
            label="Limite de usos"
            type="number"
            formControlName="usage_limit"
            placeholder="Sin limite"
            [min]="0"
          ></app-input>
          <app-input
            label="Limite por cliente"
            type="number"
            formControlName="per_customer_limit"
            placeholder="Sin limite"
            [min]="0"
          ></app-input>
        </div>

        <!-- Auto-apply + Priority -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
          <app-setting-toggle
            label="Aplicar automaticamente"
            description="Se aplica sin necesidad de codigo"
            formControlName="is_auto_apply"
          ></app-setting-toggle>
          <app-input
            label="Prioridad"
            type="number"
            formControlName="priority"
            placeholder="0"
            [min]="0"
          ></app-input>
        </div>

      </form>

      <!-- Footer -->
      <div slot="footer" class="flex justify-end items-center gap-3">
        <app-button variant="outline" (clicked)="close.emit()">Cancelar</app-button>
        <app-button variant="primary" (clicked)="onSubmit()" [disabled]="form.invalid">
          {{ promotion ? 'Guardar cambios' : 'Crear Promocion' }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class PromotionFormModalComponent implements OnInit {
  @Input() promotion: Promotion | null = null;
  @Output() save = new EventEmitter<CreatePromotionDto | UpdatePromotionDto>();
  @Output() close = new EventEmitter<void>();

  private productsService = inject(ProductsService);
  private categoriesService = inject(CategoriesService);

  form!: FormGroup;
  productOptions: MultiSelectorOption[] = [];
  categoryOptions: MultiSelectorOption[] = [];

  typeOptions: SelectorOption[] = [
    { value: 'percentage', label: 'Porcentaje' },
    { value: 'fixed_amount', label: 'Monto fijo' },
  ];

  scopeOptions: SelectorOption[] = [
    { value: 'order', label: 'Orden completa' },
    { value: 'product', label: 'Producto especifico' },
    { value: 'category', label: 'Categoria' },
  ];

  constructor(private fb: FormBuilder) {}

  ngOnInit(): void {
    this.form = this.fb.group({
      name: [this.promotion?.name || '', Validators.required],
      description: [this.promotion?.description || ''],
      code: [this.promotion?.code || ''],
      type: [this.promotion?.type || 'percentage', Validators.required],
      value: [this.promotion?.value || null, [Validators.required, Validators.min(0.01)]],
      scope: [this.promotion?.scope || 'order'],
      start_date: [this.promotion?.start_date?.split('T')[0] || '', Validators.required],
      end_date: [this.promotion?.end_date?.split('T')[0] || ''],
      min_purchase_amount: [this.promotion?.min_purchase_amount || null],
      max_discount_amount: [this.promotion?.max_discount_amount || null],
      usage_limit: [this.promotion?.usage_limit || null],
      per_customer_limit: [this.promotion?.per_customer_limit || null],
      is_auto_apply: [this.promotion?.is_auto_apply ?? false],
      priority: [this.promotion?.priority ?? 0],
      product_ids: [this.promotion?.promotion_products?.map(pp => pp.product_id) || []],
      category_ids: [this.promotion?.promotion_categories?.map(pc => pc.category_id) || []],
    });

    // Load product and category options for multi-selectors
    this.productsService.getProducts({ limit: 500 }).subscribe(res => {
      this.productOptions = res.data.map(p => ({ value: p.id, label: p.name, description: p.sku }));
    });
    this.categoriesService.getCategories().subscribe(cats => {
      this.categoryOptions = cats.map(c => ({ value: c.id, label: c.name }));
    });
  }

  onSubmit(): void {
    if (this.form.invalid) return;

    const raw = this.form.getRawValue();

    // Clean up empty optional fields
    const dto: any = { ...raw };
    if (!dto.description) delete dto.description;
    if (!dto.code) delete dto.code;
    if (!dto.end_date) delete dto.end_date;
    if (dto.min_purchase_amount === null) delete dto.min_purchase_amount;
    if (dto.max_discount_amount === null) delete dto.max_discount_amount;
    if (dto.usage_limit === null) delete dto.usage_limit;
    if (dto.per_customer_limit === null) delete dto.per_customer_limit;

    // Clean up scope-specific IDs
    if (dto.scope === 'product') {
      delete dto.category_ids;
    } else if (dto.scope === 'category') {
      delete dto.product_ids;
    } else {
      delete dto.product_ids;
      delete dto.category_ids;
    }

    this.save.emit(dto);
  }
}
