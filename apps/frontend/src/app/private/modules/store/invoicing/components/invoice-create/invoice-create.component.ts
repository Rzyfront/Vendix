import { Component, Output, EventEmitter, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormArray, Validators, ReactiveFormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { Observable, map } from 'rxjs';
import { createInvoice, createFromOrder } from '../../state/actions/invoicing.actions';
import { selectInvoicesLoading, selectActiveResolutions } from '../../state/selectors/invoicing.selectors';
import { InvoiceResolution } from '../../interfaces/invoice.interface';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { SelectorComponent, SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

@Component({
  selector: 'vendix-invoice-create',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      title="Nueva Factura"
      size="lg"
    >
      <div class="p-4">
        <!-- Mode toggle: Manual vs From Order -->
        <div class="flex gap-2 mb-4">
          <button
            type="button"
            class="flex-1 px-3 py-2 text-sm rounded-lg border transition-colors"
            [class.bg-primary]="mode === 'manual'"
            [class.text-white]="mode === 'manual'"
            [class.border-primary]="mode === 'manual'"
            [class.bg-surface]="mode !== 'manual'"
            [class.text-text-primary]="mode !== 'manual'"
            [class.border-border]="mode !== 'manual'"
            (click)="mode = 'manual'"
          >
            Factura Manual
          </button>
          <button
            type="button"
            class="flex-1 px-3 py-2 text-sm rounded-lg border transition-colors"
            [class.bg-primary]="mode === 'from_order'"
            [class.text-white]="mode === 'from_order'"
            [class.border-primary]="mode === 'from_order'"
            [class.bg-surface]="mode !== 'from_order'"
            [class.text-text-primary]="mode !== 'from_order'"
            [class.border-border]="mode !== 'from_order'"
            (click)="mode = 'from_order'"
          >
            Desde Pedido
          </button>
        </div>

        <!-- From Order Mode -->
        <div *ngIf="mode === 'from_order'" class="space-y-4">
          <app-input
            label="ID del Pedido"
            type="number"
            [formControl]="orderIdControl"
            [control]="orderIdControl"
            placeholder="Ingrese el ID del pedido"
            [required]="true"
            min="1"
          ></app-input>
        </div>

        <!-- Manual Mode -->
        <form *ngIf="mode === 'manual'" [formGroup]="invoiceForm" (ngSubmit)="onSubmit()" class="space-y-4">

          <!-- Invoice Type -->
          <app-selector
            label="Tipo de Factura"
            formControlName="invoice_type"
            [options]="invoiceTypeOptions"
            placeholder="Seleccione un tipo"
          ></app-selector>

          <!-- Resolution -->
          <app-selector
            label="Resolución"
            formControlName="resolution_id"
            [options]="(resolutionOptions$ | async) || []"
            placeholder="Seleccione una resolución"
          ></app-selector>

          <!-- Customer Info -->
          <div class="border border-border rounded-lg p-3 space-y-3">
            <h4 class="text-sm font-medium text-text-primary">Datos del Cliente</h4>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <app-input
                label="Nombre / Razón Social"
                formControlName="customer_name"
                [control]="invoiceForm.get('customer_name')"
                placeholder="Nombre del cliente"
                [required]="true"
              ></app-input>

              <app-input
                label="NIT / Cédula"
                formControlName="customer_tax_id"
                [control]="invoiceForm.get('customer_tax_id')"
                placeholder="Ej: 900123456-7"
              ></app-input>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <app-input
                label="Correo Electrónico"
                type="email"
                formControlName="customer_email"
                [control]="invoiceForm.get('customer_email')"
                placeholder="correo@ejemplo.com"
              ></app-input>

              <app-input
                label="Teléfono"
                formControlName="customer_phone"
                [control]="invoiceForm.get('customer_phone')"
                placeholder="300 123 4567"
              ></app-input>
            </div>

            <app-input
              label="Dirección"
              formControlName="customer_address"
              [control]="invoiceForm.get('customer_address')"
              placeholder="Dirección del cliente"
            ></app-input>
          </div>

          <!-- Dates -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              label="Fecha de Emisión"
              type="date"
              formControlName="issue_date"
              [control]="invoiceForm.get('issue_date')"
              [required]="true"
            ></app-input>

            <app-input
              label="Fecha de Vencimiento"
              type="date"
              formControlName="due_date"
              [control]="invoiceForm.get('due_date')"
            ></app-input>
          </div>

          <!-- Items -->
          <div class="border border-border rounded-lg p-3 space-y-3">
            <div class="flex items-center justify-between">
              <h4 class="text-sm font-medium text-text-primary">Productos / Servicios</h4>
              <app-button variant="outline" size="sm" type="button" (clicked)="addItem()">
                <app-icon slot="icon" name="plus" [size]="14"></app-icon>
                Agregar
              </app-button>
            </div>

            <div formArrayName="items" class="space-y-3">
              <div *ngFor="let item of itemsArray.controls; let i = index" [formGroupName]="i"
                class="border border-gray-200 rounded-lg p-3 space-y-2 relative">
                <button type="button" (click)="removeItem(i)"
                  class="absolute top-2 right-2 text-gray-400 hover:text-red-500 transition-colors">
                  <app-icon name="x" [size]="16"></app-icon>
                </button>

                <app-input
                  label="Producto / Servicio"
                  formControlName="product_name"
                  [control]="item.get('product_name')"
                  placeholder="Nombre del producto"
                  [required]="true"
                ></app-input>

                <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <app-input
                    label="Cantidad"
                    type="number"
                    formControlName="quantity"
                    [control]="item.get('quantity')"
                    [required]="true"
                    min="1"
                  ></app-input>

                  <app-input
                    label="Precio Unit."
                    [currency]="true"
                    formControlName="unit_price"
                    [control]="item.get('unit_price')"
                    [required]="true"
                  ></app-input>

                  <app-input
                    label="Descuento"
                    [currency]="true"
                    formControlName="discount_amount"
                    [control]="item.get('discount_amount')"
                  ></app-input>

                  <app-input
                    label="% IVA"
                    type="number"
                    formControlName="tax_rate"
                    [control]="item.get('tax_rate')"
                    min="0"
                    step="0.01"
                  ></app-input>
                </div>
              </div>
            </div>

            <div *ngIf="itemsArray.length === 0" class="text-center py-4 text-text-secondary text-sm">
              Agregue al menos un producto o servicio
            </div>
          </div>

          <!-- Notes -->
          <app-textarea
            label="Notas"
            formControlName="notes"
            [control]="invoiceForm.get('notes')"
            placeholder="Observaciones adicionales..."
            [rows]="3"
          ></app-textarea>

        </form>
      </div>

      <!-- Footer -->
      <div slot="footer">
        <div class="flex items-center justify-end gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100">
          <app-button
            variant="outline"
            (clicked)="onClose()">
            Cancelar
          </app-button>

          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="mode === 'manual' ? (invoiceForm.invalid || submitting) : (!orderIdControl.value || submitting)"
            [loading]="submitting">
            {{ mode === 'from_order' ? 'Crear desde Pedido' : 'Crear Factura' }}
          </app-button>
        </div>
      </div>
    </app-modal>
  `
})
export class InvoiceCreateComponent {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();

  private fb = inject(FormBuilder);
  private store = inject(Store);

  mode: 'manual' | 'from_order' = 'manual';
  submitting = false;

  invoiceForm: FormGroup;
  orderIdControl = this.fb.control(null, [Validators.required, Validators.min(1)]);

  resolutions$: Observable<InvoiceResolution[]>;
  resolutionOptions$: Observable<SelectorOption[]>;
  loading$: Observable<boolean>;

  invoiceTypeOptions: SelectorOption[] = [
    { label: 'Factura de Venta', value: 'sales_invoice' },
    { label: 'Factura de Compra', value: 'purchase_invoice' },
    { label: 'Factura de Exportación', value: 'export_invoice' },
  ];

  constructor() {
    this.resolutions$ = this.store.select(selectActiveResolutions);
    this.loading$ = this.store.select(selectInvoicesLoading);

    this.resolutionOptions$ = this.resolutions$.pipe(
      map(resolutions => resolutions.map(r => ({
        label: `${r.prefix} - ${r.resolution_number}`,
        value: r.id,
      }))),
    );

    const today = new Date().toISOString().split('T')[0];

    this.invoiceForm = this.fb.group({
      invoice_type: ['sales_invoice', [Validators.required]],
      resolution_id: [null],
      customer_name: ['', [Validators.required, Validators.minLength(2)]],
      customer_tax_id: [''],
      customer_email: [''],
      customer_phone: [''],
      customer_address: [''],
      issue_date: [today, [Validators.required]],
      due_date: [''],
      notes: [''],
      items: this.fb.array([]),
    });
  }

  get itemsArray(): FormArray {
    return this.invoiceForm.get('items') as FormArray;
  }

  addItem(): void {
    this.itemsArray.push(this.fb.group({
      product_name: ['', [Validators.required]],
      quantity: [1, [Validators.required, Validators.min(1)]],
      unit_price: [0, [Validators.required, Validators.min(0)]],
      discount_amount: [0],
      tax_rate: [19],
    }));
  }

  removeItem(index: number): void {
    this.itemsArray.removeAt(index);
  }

  onSubmit(): void {
    if (this.mode === 'from_order') {
      const orderId = this.orderIdControl.value;
      if (!orderId) return;
      this.submitting = true;
      this.store.dispatch(createFromOrder({ orderId: Number(orderId) }));
      this.submitting = false;
      this.resetForm();
      this.onClose();
      return;
    }

    if (this.invoiceForm.invalid) {
      this.invoiceForm.markAllAsTouched();
      return;
    }

    this.submitting = true;
    const formValue = this.invoiceForm.value;

    this.store.dispatch(createInvoice({
      invoice: {
        invoice_type: formValue.invoice_type,
        resolution_id: formValue.resolution_id ? Number(formValue.resolution_id) : undefined,
        customer_name: formValue.customer_name,
        customer_tax_id: formValue.customer_tax_id || undefined,
        customer_email: formValue.customer_email || undefined,
        customer_phone: formValue.customer_phone || undefined,
        customer_address: formValue.customer_address || undefined,
        issue_date: formValue.issue_date,
        due_date: formValue.due_date || undefined,
        notes: formValue.notes || undefined,
        items: formValue.items.map((item: any) => ({
          product_name: item.product_name,
          quantity: Number(item.quantity),
          unit_price: Number(item.unit_price),
          discount_amount: Number(item.discount_amount) || 0,
          tax_rate: Number(item.tax_rate) || 0,
        })),
      },
    }));

    this.submitting = false;
    this.resetForm();
    this.onClose();
  }

  private resetForm(): void {
    this.invoiceForm.reset({
      invoice_type: 'sales_invoice',
      issue_date: new Date().toISOString().split('T')[0],
    });
    this.itemsArray.clear();
    this.orderIdControl.reset();
    this.mode = 'manual';
  }

  onClose(): void {
    this.isOpenChange.emit(false);
  }
}
