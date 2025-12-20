import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormArray, Validators, ReactiveFormsModule } from '@angular/forms';

// Shared Components
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  IconComponent,
  SelectorComponent,
  SelectorOption,
  TextareaComponent,
} from '../../../../../../shared/components/index';

// Interfaces
import { Supplier, CreatePurchaseOrderDto, CreatePurchaseOrderItemDto } from '../../interfaces';

// Services (for product search)
import { ProductsService } from '../../../products/services/products.service';
import { InventoryService } from '../../services';

@Component({
  selector: 'app-purchase-order-create-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    IconComponent,
    SelectorComponent,
    TextareaComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      title="Nueva Orden de Compra"
      size="lg"
      size="lg"
      (closed)="onCancel()"
    >
      <form [formGroup]="form">
        <!-- Step 1: Basic Info -->
        <div class="space-y-6">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="mt-4 w-full">
              <label class="block text-sm font-medium text-text-secondary mb-1">Proveedor *</label>
              <app-selector
                [options]="supplier_options"
                formControlName="supplier_id"
                placeholder="Seleccionar proveedor"
              ></app-selector>
            </div>
            <div class="mt-4 w-full">
              <label class="block text-sm font-medium text-text-secondary mb-1">Almacén Destino *</label>
              <app-selector
                [options]="location_options"
                formControlName="location_id"
                placeholder="Seleccionar almacén"
              ></app-selector>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">Fecha de Orden</label>
              <app-input
                formControlName="order_date"
                type="date"
              ></app-input>
            </div>
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">Fecha Esperada de Entrega</label>
              <app-input
                formControlName="expected_date"
                type="date"
              ></app-input>
            </div>
          </div>

          <!-- Items Section -->
          <div class="border-t border-border pt-4">
            <div class="flex justify-between items-center mb-4">
              <h3 class="text-md font-semibold text-text-primary">Productos</h3>
              <app-button type="button" variant="secondary" size="sm" (clicked)="addItem()">
                <app-icon name="plus" [size]="14" class="mr-1"></app-icon>
                Agregar Producto
              </app-button>
            </div>

            <div formArrayName="items" class="space-y-3">
              <div
                *ngFor="let item of items.controls; let i = index"
                [formGroupName]="i"
                class="flex items-end gap-3 p-3 bg-muted/10 rounded-lg"
              >
                <div class="flex-1">
                  <label class="block text-xs text-text-secondary mb-1">Producto</label>
                  <app-input
                    formControlName="product_name"
                    placeholder="Buscar producto..."
                    size="sm"
                  ></app-input>
                </div>
                <div class="w-24">
                  <label class="block text-xs text-text-secondary mb-1">Cantidad</label>
                  <app-input
                    formControlName="quantity"
                    type="number"
                    size="sm"
                  ></app-input>
                </div>
                <div class="w-32">
                  <label class="block text-xs text-text-secondary mb-1">Precio Unit.</label>
                  <app-input
                    formControlName="unit_price"
                    type="number"
                    size="sm"
                  ></app-input>
                </div>
                <div class="w-28 text-right">
                  <label class="block text-xs text-text-secondary mb-1">Subtotal</label>
                  <span class="text-sm font-medium text-text-primary">
                    {{ formatCurrency(getItemSubtotal(i)) }}
                  </span>
                </div>
                <app-button
                  type="button"
                  variant="ghost"
                  size="sm"
                  (clicked)="removeItem(i)"
                  [disabled]="items.length === 1"
                >
                  <app-icon name="trash-2" [size]="16" class="text-red-500"></app-icon>
                </app-button>
              </div>
            </div>

            <!-- Totals -->
            <div class="mt-4 pt-4 border-t border-border">
              <div class="flex justify-end">
                <div class="w-64 space-y-2">
                  <div class="flex justify-between text-sm">
                    <span class="text-text-secondary">Subtotal:</span>
                    <span class="font-medium">{{ formatCurrency(calculateSubtotal()) }}</span>
                  </div>
                  <div class="flex justify-between text-sm">
                    <span class="text-text-secondary">Envío:</span>
                    <app-input
                      formControlName="shipping_cost"
                      type="number"
                      size="sm"
                      class="w-24"
                    ></app-input>
                  </div>
                  <div class="flex justify-between text-base font-semibold border-t border-border pt-2">
                    <span>Total:</span>
                    <span class="text-primary">{{ formatCurrency(calculateTotal()) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Notes -->
          <app-textarea
            label="Notas"
            formControlName="notes"
            [rows]="2"
            placeholder="Instrucciones especiales..."
            [control]="form.get('notes')"
          ></app-textarea>
        </div>


      </form>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button variant="secondary" type="button" (clicked)="onCancel()">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          type="button"
          (clicked)="onSubmit()"
          [loading]="isSubmitting"
          [disabled]="form.invalid || isSubmitting"
        >
          Crear Orden
        </app-button>
      </div>
    </app-modal>
  `,
})
export class PurchaseOrderCreateModalComponent implements OnInit {
  @Input() isOpen = false;
  @Input() suppliers: Supplier[] = [];
  @Input() isSubmitting = false;

  @Output() cancel = new EventEmitter<void>();
  @Output() save = new EventEmitter<CreatePurchaseOrderDto>();

  form: FormGroup;
  supplier_options: SelectorOption[] = [];
  location_options: SelectorOption[] = [];

  constructor(
    private fb: FormBuilder,
    private inventoryService: InventoryService
  ) {
    this.form = this.createForm();
  }

  ngOnInit(): void {
    this.loadLocations();
  }

  ngOnChanges(): void {
    this.supplier_options = this.suppliers.map((s) => ({
      value: s.id,
      label: s.name,
    }));
  }

  private createForm(): FormGroup {
    return this.fb.group({
      supplier_id: [null, Validators.required],
      location_id: [null, Validators.required],
      order_date: [new Date().toISOString().split('T')[0]],
      expected_date: [''],
      shipping_cost: [0],
      notes: [''],
      items: this.fb.array([this.createItemGroup()]),
    });
  }

  private createItemGroup(): FormGroup {
    return this.fb.group({
      product_id: [null, Validators.required],
      product_name: ['', Validators.required],
      quantity: [1, [Validators.required, Validators.min(1)]],
      unit_price: [0, [Validators.required, Validators.min(0)]],
    });
  }

  loadLocations(): void {
    this.inventoryService.getLocations().subscribe({
      next: (response) => {
        if (response.data) {
          this.location_options = response.data.map((l) => ({
            value: l.id,
            label: l.name,
          }));
        }
      },
    });
  }

  get items(): FormArray {
    return this.form.get('items') as FormArray;
  }

  addItem(): void {
    this.items.push(this.createItemGroup());
  }

  removeItem(index: number): void {
    if (this.items.length > 1) {
      this.items.removeAt(index);
    }
  }

  getItemSubtotal(index: number): number {
    const item = this.items.at(index);
    const quantity = item.get('quantity')?.value || 0;
    const unit_price = item.get('unit_price')?.value || 0;
    return quantity * unit_price;
  }

  calculateSubtotal(): number {
    return this.items.controls.reduce((sum, _, i) => sum + this.getItemSubtotal(i), 0);
  }

  calculateTotal(): number {
    const subtotal = this.calculateSubtotal();
    const shipping = this.form.get('shipping_cost')?.value || 0;
    return subtotal + Number(shipping);
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
    }).format(value || 0);
  }

  onCancel(): void {
    this.form.reset();
    this.items.clear();
    this.items.push(this.createItemGroup());
    this.cancel.emit();
  }

  onSubmit(): void {
    if (this.form.valid) {
      const form_value = this.form.value;

      const dto: CreatePurchaseOrderDto = {
        // organization_id handled by backend context
        supplier_id: form_value.supplier_id,
        location_id: form_value.location_id,
        order_date: form_value.order_date,
        expected_date: form_value.expected_date || undefined,
        shipping_cost: Number(form_value.shipping_cost) || 0,
        subtotal_amount: this.calculateSubtotal(),
        total_amount: this.calculateTotal(),
        notes: form_value.notes,
        items: form_value.items.map((item: any) => ({
          product_id: item.product_id || 1, // TODO: Proper product selection
          quantity: Number(item.quantity),
          unit_price: Number(item.unit_price),
        })),
      };

      this.save.emit(dto);
    }
  }
}
