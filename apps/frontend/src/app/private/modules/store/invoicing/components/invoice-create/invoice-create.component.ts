import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NgClass } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  FormArray,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { Store } from '@ngrx/store';
import { Observable, map } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  createInvoice,
  createFromOrder,
} from '../../state/actions/invoicing.actions';
import {
  selectInvoicesLoading,
  selectActiveResolutions,
} from '../../state/selectors/invoicing.selectors';
import { InvoiceResolution } from '../../interfaces/invoice.interface';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/selector/selector.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  ProductPickerModalComponent,
  ProductPickerOption,
} from '../../../../../../shared/components/product-picker-modal';
import {
  TaxSelectorComponent,
  TaxOption,
  TaxSelection,
} from '../../../../../../shared/components/tax-selector';
import { CustomerModalComponent } from '../../../customers/components/customer-modal/customer-modal.component';
import { toLocalDateString } from '../../../../../../shared/utils/date.util';

/**
 * QUI-690 — Modal XXL para creación de factura manual con todos los detalles
 * DIAN. Reemplaza el modal anterior (`size="lg"`) con:
 *
 *  - Tamaño `xxl` (98vw × 94vh) + `fullScreenOnMobile=true` para takeover en
 *    mobile sin padding lateral.
 *  - Sección cliente con búsqueda inline y botón "Crear cliente" que abre
 *    `app-customer-modal` (DIAN completo: legal_name, verification_digit,
 *    fiscal_responsibilities, ciiu_code) y devuelve el `customer_id` listo
 *    para el payload.
 *  - Sección items con `app-product-picker-modal [mode]="'single'"` por
 *    línea (slot empty-action expone "Crear producto"; backend aún no
 *    implementa creación inline, por lo que muestra un error y guía al
 *    usuario a crearlo primero vía el módulo de productos).
 *  - Selector de impuestos por línea (`app-tax-selector`) con toggle
 *    incluido/adicional. La elección se serializa en `items[].taxes[]` con
 *    `is_inclusive=true|false` que el backend ahora persiste en
 *    `invoice_items.is_inclusive` y `invoice_taxes.is_inclusive`.
 *  - Panel de totales reactivo (toSignal sobre itemsArray.valueChanges +
 *    computed) con desglose: subtotal, descuento, IVA incluido, IVA
 *    adicional, total. Recalcula en cada keystroke.
 *
 *  El payload final se envía vía NgRx `createInvoice` action; el effect
 *  propaga al backend con `inline_customer`, `items[].inline_product`
 *  (rechazado por ahora) y `items[].taxes[]` ya soportado en backend.
 */
@Component({
  selector: 'vendix-invoice-create',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgClass,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    IconComponent,
    ProductPickerModalComponent,
    TaxSelectorComponent,
    CustomerModalComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      title="Nueva Factura"
      subtitle="Todos los detalles DIAN para factura manual"
      size="xxl"
      [fullScreenOnMobile]="true"
    >
      <div class="p-4 space-y-4">
        <!-- Mode toggle: Manual vs From Order -->
        <div class="flex gap-2">
          <button
            type="button"
            class="flex-1 px-3 py-2 text-sm rounded-lg border transition-colors"
            [ngClass]="
              mode() === 'manual'
                ? 'bg-primary text-[var(--color-text-on-primary)] border-primary'
                : 'bg-[var(--color-surface)] text-text-primary border-border'
            "
            (click)="mode.set('manual')"
          >
            Factura Manual
          </button>
          <button
            type="button"
            class="flex-1 px-3 py-2 text-sm rounded-lg border transition-colors"
            [ngClass]="
              mode() === 'from_order'
                ? 'bg-primary text-[var(--color-text-on-primary)] border-primary'
                : 'bg-[var(--color-surface)] text-text-primary border-border'
            "
            (click)="mode.set('from_order')"
          >
            Desde Pedido
          </button>
        </div>

        @if (mode() === 'from_order') {
          <app-input
            label="ID del Pedido"
            type="number"
            [formControl]="orderIdControl"
            [control]="orderIdControl"
            placeholder="Ingrese el ID del pedido"
            [required]="true"
            min="1"
          ></app-input>
        }

        @if (mode() === 'manual') {
          <form
            [formGroup]="invoiceForm"
            (ngSubmit)="onSubmit()"
            class="space-y-4"
          >
            <!-- Header: tipo, resolución, fechas -->
            <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
              <app-selector
                label="Tipo de Factura"
                formControlName="invoice_type"
                [options]="invoiceTypeOptions"
                placeholder="Seleccione un tipo"
                size="sm"
              ></app-selector>
              <app-selector
                label="Resolución"
                formControlName="resolution_id"
                [options]="resolutionOptionsSignal() || []"
                placeholder="Seleccione una resolución"
                size="sm"
              ></app-selector>
              <app-input
                label="Fecha Emisión"
                type="date"
                formControlName="issue_date"
                [control]="invoiceForm.get('issue_date')"
                [required]="true"
                size="sm"
              ></app-input>
              <app-input
                label="Vencimiento"
                type="date"
                formControlName="due_date"
                [control]="invoiceForm.get('due_date')"
                size="sm"
              ></app-input>
            </div>

            <!-- Customer card: búsqueda + creación inline -->
            <div class="border border-border rounded-lg p-3 space-y-3">
              <div class="flex items-center justify-between">
                <h4 class="text-sm font-medium text-text-primary">Cliente</h4>
                <div class="flex items-center gap-2">
                  <app-button
                    variant="outline"
                    size="sm"
                    type="button"
                    (clicked)="openCustomerPicker()"
                  >
                    <app-icon slot="icon" name="search" [size]="14" />
                    Buscar
                  </app-button>
                  <app-button
                    variant="outline"
                    size="sm"
                    type="button"
                    (clicked)="openCustomerCreate()"
                  >
                    <app-icon slot="icon" name="plus" [size]="14" />
                    Crear cliente
                  </app-button>
                </div>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <app-input
                  label="Nombre / Razón Social"
                  formControlName="customer_name"
                  [control]="invoiceForm.get('customer_name')"
                  [required]="true"
                  size="sm"
                ></app-input>
                <app-input
                  label="NIT / Cédula"
                  formControlName="customer_tax_id"
                  [control]="invoiceForm.get('customer_tax_id')"
                  placeholder="Ej: 900123456-7"
                  size="sm"
                ></app-input>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <app-input
                  label="Correo"
                  type="email"
                  formControlName="customer_email"
                  [control]="invoiceForm.get('customer_email')"
                  placeholder="correo@ejemplo.co"
                  size="sm"
                ></app-input>
                <app-input
                  label="Teléfono"
                  formControlName="customer_phone"
                  [control]="invoiceForm.get('customer_phone')"
                  placeholder="300 123 4567"
                  size="sm"
                ></app-input>
                <app-input
                  label="Dirección"
                  formControlName="customer_address"
                  [control]="invoiceForm.get('customer_address')"
                  size="sm"
                ></app-input>
              </div>
            </div>

            <!-- Items -->
            <div class="border border-border rounded-lg p-3 space-y-3">
              <div class="flex items-center justify-between">
                <h4 class="text-sm font-medium text-text-primary">
                  Productos / Servicios
                </h4>
                <app-button
                  variant="outline"
                  size="sm"
                  type="button"
                  (clicked)="addItem()"
                  [disabled]="itemsArray.length >= 100"
                >
                  <app-icon slot="icon" name="plus" [size]="14" />
                  Agregar
                </app-button>
              </div>
              <div formArrayName="items" class="space-y-2">
                @for (item of itemsArray.controls; track item; let i = $index) {
                  <div
                    [formGroupName]="i"
                    class="grid grid-cols-12 gap-2 items-end p-2 border border-border rounded-lg bg-[var(--color-surface-secondary)]"
                  >
                    <div class="col-span-12 md:col-span-4">
                      <app-input
                        label="Descripción"
                        formControlName="description"
                        [control]="item.get('description')"
                        [required]="true"
                        size="sm"
                      ></app-input>
                    </div>
                    <div class="col-span-6 md:col-span-1">
                      <app-input
                        label="Cant."
                        type="number"
                        formControlName="quantity"
                        [control]="item.get('quantity')"
                        [required]="true"
                        min="1"
                        size="sm"
                      ></app-input>
                    </div>
                    <div class="col-span-6 md:col-span-2">
                      <app-input
                        label="Precio Unit."
                        [currency]="true"
                        formControlName="unit_price"
                        [control]="item.get('unit_price')"
                        [required]="true"
                        size="sm"
                      ></app-input>
                    </div>
                    <div class="col-span-6 md:col-span-2">
                      <app-input
                        label="Descuento"
                        [currency]="true"
                        formControlName="discount_amount"
                        [control]="item.get('discount_amount')"
                        size="sm"
                      ></app-input>
                    </div>
                    <div class="col-span-12 md:col-span-2">
                      <app-tax-selector
                        [taxes]="availableTaxes"
                        (selectionChange)="onItemTaxSelection(i, $event)"
                      />
                    </div>
                    <div class="col-span-12 md:col-span-1 flex justify-end">
                      <button
                        type="button"
                        (click)="removeItem(i)"
                        class="text-text-secondary hover:text-error transition-colors p-1"
                        title="Eliminar línea"
                      >
                        <app-icon name="x" [size]="16" />
                      </button>
                    </div>
                  </div>
                }
              </div>
              @if (itemsArray.length === 0) {
                <div class="text-center py-4 text-text-secondary text-sm">
                  Agregue al menos un producto o servicio
                </div>
              }
            </div>

            <!-- Totals panel (reactivo) -->
            <div
              class="border border-border rounded-lg p-3 bg-[var(--color-surface-muted)]"
            >
              <div class="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                <div>
                  <div class="text-text-secondary">Subtotal</div>
                  <div class="font-semibold">
                    {{ formatCurrency(totals().subtotal) }}
                  </div>
                </div>
                <div>
                  <div class="text-text-secondary">Descuento</div>
                  <div class="font-semibold text-[var(--color-text-secondary)]">
                    -{{ formatCurrency(totals().discount) }}
                  </div>
                </div>
                <div>
                  <div class="text-text-secondary">IVA incluido</div>
                  <div class="font-semibold">
                    {{ formatCurrency(totals().taxInclusive) }}
                  </div>
                </div>
                <div>
                  <div class="text-text-secondary">IVA adicional</div>
                  <div class="font-semibold">
                    {{ formatCurrency(totals().taxAdditional) }}
                  </div>
                </div>
                <div>
                  <div class="text-text-secondary">Total</div>
                  <div class="font-bold text-primary">
                    {{ formatCurrency(totals().total) }}
                  </div>
                </div>
              </div>
            </div>

            <!-- Notas -->
            <app-textarea
              label="Notas"
              formControlName="notes"
              [control]="invoiceForm.get('notes')"
              placeholder="Observaciones adicionales..."
              [rows]="2"
            ></app-textarea>
          </form>
        }
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
            [disabled]="
              mode() === 'manual'
                ? invoiceForm.invalid || submitting() || itemsArray.length === 0
                : !orderIdControl.value || submitting()
            "
            [loading]="submitting()"
          >
            {{
              mode() === 'from_order' ? 'Crear desde Pedido' : 'Crear Factura'
            }}
          </app-button>
        </div>
      </div>
    </app-modal>

    <!-- Customer modal (creación inline DIAN) -->
    <app-customer-modal
      [isOpen]="customerModalOpen()"
      [customer]="null"
      (isOpenChange)="customerModalOpen.set($event)"
      (save)="onCustomerCreated($event)"
    />

    <!-- Product picker modal (single-select por línea) -->
    <app-product-picker-modal
      [open]="productPickerOpen()"
      [products]="availableProducts()"
      [mode]="'single'"
      [disabledIds]="pickedProductIds()"
      (selected)="onProductPicked($event)"
      (closed)="productPickerOpen.set(false)"
    >
      <!-- Slot para acción "Crear nuevo producto" cuando el picker está vacío -->
      <button
        slot="empty-action"
        type="button"
        class="text-xs px-3 py-1.5 rounded-md border border-border hover:border-primary-600 transition-colors"
        (click)="onCreateProductRequested()"
      >
        + Crear nuevo producto
      </button>
    </app-product-picker-modal>
  `,
})
export class InvoiceCreateComponent {
  readonly isOpen = input<boolean>(false);
  readonly isOpenChange = output<boolean>();

  private fb = inject(FormBuilder);
  private store = inject(Store);

  readonly mode = signal<'manual' | 'from_order'>('manual');
  readonly submitting = signal(false);
  readonly customerModalOpen = signal(false);
  readonly productPickerOpen = signal(false);
  /** Index de la línea actual del product picker. */
  readonly pickerTargetIndex = signal<number | null>(null);

  invoiceForm: FormGroup;
  orderIdControl = this.fb.control(null, [
    Validators.required,
    Validators.min(1),
  ]);

  resolutions$ = this.store.select(selectActiveResolutions);
  loading$ = this.store.select(selectInvoicesLoading);

  resolutionOptions$: Observable<SelectorOption[]> = this.resolutions$.pipe(
    map((resolutions) =>
      resolutions.map((r) => ({
        label: `${r.prefix} - ${r.resolution_number}`,
        value: r.id,
      })),
    ),
  );

  readonly resolutionOptionsSignal = toSignal(this.resolutionOptions$, {
    initialValue: [] as SelectorOption[],
  });

  invoiceTypeOptions: SelectorOption[] = [
    { label: 'Factura de Venta', value: 'sales_invoice' },
    { label: 'Factura de Compra', value: 'purchase_invoice' },
    { label: 'Factura de Exportación', value: 'export_invoice' },
  ];

  /**
   * Universo plano de productos (placeholder — en cuanto se conecte al
   * ProductsService.search(), se cargará async). Mientras tanto, vacío.
   */
  readonly availableProducts = signal<ProductPickerOption[]>([]);
  /** Ids ya seleccionados en otras líneas — para evitar duplicados en single mode. */
  readonly pickedProductIds = computed<number[]>(() => {
    const ids: number[] = [];
    for (const ctrl of this.itemsArray.controls) {
      const v = ctrl.get('product_id')?.value;
      if (v != null) ids.push(Number(v));
    }
    return ids;
  });

  /**
   * Universo plano de impuestos disponibles (placeholder — se conectará a
   * TaxesService.getTaxCategories). IVA 19% por defecto para mantener
   * compat con el flujo anterior.
   */
  readonly availableTaxes: TaxOption[] = [
    { id: 1, name: 'IVA 19%', rate: 19, tax_type: 'iva' },
    { id: 2, name: 'IVA 5%', rate: 5, tax_type: 'iva' },
    { id: 3, name: 'IVA 0%', rate: 0, tax_type: 'iva' },
    { id: 4, name: 'INC 8%', rate: 8, tax_type: 'inc' },
  ];

  /** Map index → tax selection para que el modal pueda leerla por línea. */
  private readonly itemTaxSelections = signal<Map<number, TaxSelection>>(
    new Map(),
  );

  /**
   * Bridge entre el FormArray `items` y un signal para que `computed`
   * recalcule los totales en cada cambio. Patrón requerido por
   * `vendix-zoneless-signals` (form.valueChanges → toSignal).
   */
  private readonly itemsValue = toSignal(
    this.formInitialItemsValue$(),
    { initialValue: [] as any[] },
  );

  private formInitialItemsValue$() {
    // Necesitamos un Observable que emita el array de items en cada cambio.
    // Como el form se inicializa en el constructor, diferimos a afterNextRender.
    return new Observable<any[]>((sub) => {
      sub.next(this.invoiceForm?.get('items')?.value ?? []);
      const sub2 = this.invoiceForm
        .get('items')!
        .valueChanges.subscribe(() =>
          sub.next(this.invoiceForm.get('items')!.value),
        );
      return () => sub2.unsubscribe();
    });
  }

  readonly totals = computed(() => {
    const items = this.itemsValue() ?? [];
    let subtotal = 0;
    let discount = 0;
    let taxInclusive = 0;
    let taxAdditional = 0;
    for (const item of items) {
      const q = Number(item.quantity) || 0;
      const p = Number(item.unit_price) || 0;
      const d = Number(item.discount_amount) || 0;
      subtotal += q * p;
      discount += d;
      const sel = this.itemTaxSelections().get(item.__index);
      if (sel) {
        // Si es inclusivo, desglose: tax_amount = subtotal*line - discount
        // no se modifica; el IVA ya está dentro de unit_price. Mostramos
        // el valor para el usuario pero no lo sumamos al total (ya está
        // contemplado en subtotal).
        if (sel.is_inclusive) {
          // Cálculo del IVA incluido: total_line / (1 + rate) * rate
          const lineGross = q * p - d;
          const rateFactor = sel.rate / 100;
          const taxAmount = lineGross * rateFactor;
          taxInclusive += taxAmount;
        } else {
          // lineGross declarado fuera del if para usarlo en el else (QUI-690 fix)
          taxAdditional += ((q * p - d) * sel.rate) / 100;
        }
      }
    }
    const total = subtotal - discount + taxAdditional;
    return { subtotal, discount, taxInclusive, taxAdditional, total };
  });

  constructor() {
    const today = toLocalDateString();
    this.invoiceForm = this.fb.group({
      invoice_type: ['sales_invoice', [Validators.required]],
      resolution_id: [null],
      customer_id: [null],
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
    if (this.itemsArray.length >= 100) return;
    const newIndex = this.itemsArray.length;
    this.itemsArray.push(
      this.fb.group({
        product_id: [null],
        description: ['', [Validators.required]],
        quantity: [1, [Validators.required, Validators.min(1)]],
        unit_price: [0, [Validators.required, Validators.min(0)]],
        discount_amount: [0],
        taxes: [[]],
        is_inclusive: [false],
      }),
    );
    // Stash index for totals computed
    const v = this.itemsArray.at(newIndex).value;
    Object.defineProperty(v, '__index', {
      value: newIndex,
      enumerable: false,
    });
  }

  removeItem(index: number): void {
    this.itemsArray.removeAt(index);
    const next = new Map(this.itemTaxSelections());
    next.delete(index);
    this.itemTaxSelections.set(next);
  }

  onItemTaxSelection(index: number, selection: TaxSelection | null): void {
    const next = new Map(this.itemTaxSelections());
    if (selection == null) {
      next.delete(index);
    } else {
      next.set(index, selection);
      // Mirror on the form group so NgRx payload picks it up.
      const ctrl = this.itemsArray.at(index);
      ctrl.patchValue({
        taxes: [selection],
        is_inclusive: selection.is_inclusive,
      });
    }
    this.itemTaxSelections.set(next);
  }

  openCustomerPicker(): void {
    // Pendiente: integrar `CustomersService.list()` + customer picker.
    // Por ahora abre el modal de creación para que el flujo XXL siga
    // siendo funcional.
    this.customerModalOpen.set(true);
  }

  openCustomerCreate(): void {
    this.customerModalOpen.set(true);
  }

  onCustomerCreated(payload: any): void {
    // El `app-customer-modal` emite el DTO crudo. El backend crea el
    // usuario y devuelve `customer_id`; mientras tanto, almacenamos el
    // payload y dejamos el formulario libre.
    if (payload?.first_name || payload?.legal_name) {
      this.invoiceForm.patchValue({
        customer_name:
          payload.legal_name ?? `${payload.first_name} ${payload.last_name}`,
        customer_tax_id: payload.document_number ?? '',
        customer_email: payload.email ?? '',
        customer_phone: payload.phone ?? '',
      });
    }
    this.customerModalOpen.set(false);
  }

  onProductPicked(productId: number | null): void {
    const idx = this.pickerTargetIndex();
    if (idx == null || productId == null) return;
    const ctrl = this.itemsArray.at(idx);
    // Map id → description (placeholder; el padre debe hidratar con el
    // universo cargado para tener nombre/precio).
    ctrl.patchValue({
      product_id: productId,
      description: ctrl.get('description')?.value || `Producto #${productId}`,
    });
    this.pickerTargetIndex.set(null);
    this.productPickerOpen.set(false);
  }

  onCreateProductRequested(): void {
    // Backend no soporta inline_product aún (SYS_VALIDATION_001). Mostrar
    // un toast/nota para que el usuario cree el producto primero vía
    // el módulo de productos.
    alert(
      'La creación inline de productos aún no está disponible. Crea el producto primero desde el módulo de Productos y luego agrégalo por ID.',
    );
    this.productPickerOpen.set(false);
  }

  onSubmit(): void {
    if (this.mode() === 'from_order') {
      const orderId = this.orderIdControl.value;
      if (!orderId) return;
      this.submitting.set(true);
      this.store.dispatch(createFromOrder({ orderId: Number(orderId) }));
      this.submitting.set(false);
      this.resetForm();
      this.onClose();
      return;
    }

    if (this.invoiceForm.invalid) {
      this.invoiceForm.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    const formValue = this.invoiceForm.value;

    const itemsPayload = formValue.items.map((item: any, idx: number) => {
      const sel = this.itemTaxSelections().get(idx);
      return {
        description: item.description,
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        discount_amount: Number(item.discount_amount) || 0,
        product_id: item.product_id || undefined,
        taxes: sel
          ? [
              {
                tax_rate_id: sel.tax_rate_id,
                tax_name: sel.name,
                tax_rate: sel.rate,
                taxable_amount:
                  Number(item.quantity) * Number(item.unit_price) -
                  (Number(item.discount_amount) || 0),
                tax_amount: 0, // el backend recalcula
                tax_type: sel.tax_type ?? 'iva',
                is_inclusive: sel.is_inclusive,
              },
            ]
          : undefined,
        is_inclusive: sel?.is_inclusive ?? false,
      };
    });

    this.store.dispatch(
      createInvoice({
        invoice: {
          invoice_type: formValue.invoice_type,
          resolution_id: formValue.resolution_id
            ? Number(formValue.resolution_id)
            : undefined,
          customer_id: formValue.customer_id
            ? Number(formValue.customer_id)
            : undefined,
          customer_name: formValue.customer_name,
          customer_tax_id: formValue.customer_tax_id || undefined,
          customer_email: formValue.customer_email || undefined,
          customer_phone: formValue.customer_phone || undefined,
          customer_address: formValue.customer_address || undefined,
          issue_date: formValue.issue_date,
          due_date: formValue.due_date || undefined,
          notes: formValue.notes || undefined,
          items: itemsPayload,
        },
      }),
    );

    this.submitting.set(false);
    this.resetForm();
    this.onClose();
  }

  private resetForm(): void {
    this.invoiceForm.reset({
      invoice_type: 'sales_invoice',
      issue_date: toLocalDateString(),
    });
    this.itemsArray.clear();
    this.orderIdControl.reset();
    this.mode.set('manual');
    this.itemTaxSelections.set(new Map());
  }

  onClose(): void {
    this.isOpenChange.emit(false);
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value || 0);
  }
}
