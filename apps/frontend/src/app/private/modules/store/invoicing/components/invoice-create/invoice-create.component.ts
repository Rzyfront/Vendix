import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  model,
  signal,
} from '@angular/core';
import { NgClass } from '@angular/common';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';
import { Actions, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { Observable, Subject, Subscription, of, startWith, take } from 'rxjs';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  map,
  switchMap,
} from 'rxjs/operators';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  MutationFailure,
  createFromOrder,
  createFromOrderFailure,
  createFromOrderSuccess,
  createInvoice,
  createInvoiceFailure,
  createInvoiceSuccess,
} from '../../state/actions/invoicing.actions';
import { selectActiveResolutions } from '../../state/selectors/invoicing.selectors';
import {
  applyBackendValidationErrors,
  clearBackendError,
} from '../../utils/invoicing-errors.util';
import {
  CreateCustomerRequest,
  CreateInvoiceDto,
  Invoice,
  InvoiceResolution,
} from '../../interfaces/invoice.interface';
import {
  InvoiceEmitReadiness,
  InvoiceEmitReadinessService,
} from '../../services/invoice-emit-readiness.service';
import { toEmitRequirements } from '../../utils/invoice-emit-requirements';

import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { SelectorComponent } from '../../../../../../shared/components/selector/selector.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { ToggleComponent } from '../../../../../../shared/components/toggle/toggle.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  ProductPickerModalComponent,
  ProductPickerOption,
} from '../../../../../../shared/components/product-picker-modal';
import {
  TaxOption,
  TaxSelection,
} from '../../../../../../shared/components/tax-selector';
import {
  SaveRequirement,
  SaveRequirementsModalComponent,
} from '../../../../../../shared/components/index';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { toLocalDateString } from '../../../../../../shared/utils/date.util';
import {
  FISCAL_RESPONSIBILITIES,
  FISCAL_RESPONSIBILITY_LABELS,
} from '../../../../../../shared/constants/fiscal-responsibilities.constants';
import { getDianSchemeIdForDocumentType } from '../../../../../../shared/constants/dian-document-types.constants';

import { CustomerModalComponent } from '../../../customers/components/customer-modal/customer-modal.component';
import { CustomersService } from '../../../customers/services/customers.service';
import { Customer } from '../../../customers/models/customer.model';
import { ProductsService } from '../../../products/services/products.service';
import {
  PaginatedResponse,
  Product,
  ProductState,
} from '../../../products/interfaces/product.interface';

import { InvoiceFormSectionComponent } from './invoice-form-section.component';
import { InvoiceResolutionBannerComponent } from './invoice-resolution-banner.component';
import { InvoiceLineTaxesComponent } from './invoice-line-taxes.component';
import { InvoiceTaxCatalogService } from './invoice-tax-catalog.service';
import {
  AIU_COMPONENT_OPTIONS,
  DOCUMENT_TYPE_NIT_CODE,
  DOCUMENT_TYPE_OPTIONS,
  FOREIGN_CURRENCY_OPTIONS,
  INVOICE_TYPE_OPTIONS,
  OPERATION_TYPE_AIU,
  OPERATION_TYPE_OPTIONS,
  OPERATION_TYPE_STANDARD,
  PAYMENT_FORM_CASH,
  PAYMENT_FORM_CREDIT,
  PAYMENT_FORM_OPTIONS,
  PAYMENT_MEANS_OPTIONS,
  TAX_REGIME_OPTIONS,
  UNIT_CODE_DEFAULT,
  UNIT_CODE_OPTIONS,
  invoiceTypeLabel,
  safeTaxType,
  toFiscalDocumentType,
} from './invoice-dian-catalogs';

// ─────────────────────────────────────────────────────────────
// Contrato de salida
// ─────────────────────────────────────────────────────────────

/**
 * Payload REAL que acepta `CreateInvoiceDto` del backend.
 *
 * Se declara aquí y no en `interfaces/invoice.interface.ts` porque ese espejo
 * todavía no incorpora los campos DIAN de esta fase, y ampliarlo es trabajo de
 * otro dueño. Como es un tipo con nombre (no un literal fresco), TypeScript deja
 * asignarlo a `CreateInvoiceDto` sin quejarse de las propiedades de más — y el
 * backend las acepta todas, campo por campo.
 *
 * REGLA DURA: sólo entra aquí lo que el DTO declara. `forbidNonWhitelisted` está
 * activo, así que una propiedad inventada no se ignora: devuelve 400 nombrando
 * un campo que el usuario nunca vio en la pantalla.
 */
interface InvoiceCreatePayload {
  invoice_type: 'sales_invoice' | 'export_invoice';
  customer_id?: number;
  customer_name?: string;
  customer_tax_id?: string;
  customer_email?: string;
  customer_phone?: string;
  customer_document_type?: string;
  customer_verification_digit?: string;
  customer_tax_regime?: string;
  customer_fiscal_responsibilities?: string[];
  customer_address?: string;
  inline_customer?: CreateCustomerRequest;
  issue_date: string;
  due_date?: string;
  withholding_amount?: number;
  payment_form?: string;
  payment_means_code?: string;
  operation_type?: string;
  foreign_currency?: string;
  foreign_total_amount?: number;
  exchange_rate?: number;
  exchange_rate_date?: string;
  notes?: string;
  items: InvoiceCreateItemPayload[];
}

interface InvoiceCreateItemPayload {
  product_id?: number;
  description: string;
  quantity: number;
  unit_price: number;
  discount_amount?: number;
  unit_code?: string;
  account_code?: string;
  aiu_component?: 'administracion' | 'imprevistos' | 'utilidad';
  taxes?: {
    tax_rate_id: number;
    tax_name: string;
    tax_rate: number;
    taxable_amount: number;
    tax_amount: number;
    tax_type?: string;
    is_inclusive: boolean;
  }[];
}

/** Valor de una línea tal como sale del `FormArray`. */
interface InvoiceItemFormValue {
  row_uid: string;
  product_id: number | null;
  product_name: string;
  description: string;
  quantity: number | string;
  unit_code: string;
  unit_price: number | string;
  discount_amount: number | string;
  taxes: TaxSelection[];
  account_code: string;
  aiu_component: string;
}

/** Aritmética de una línea, ya desglosada. */
interface LineMath {
  /** `cantidad × precio − descuento`, tal como lo teclea el usuario. */
  gross: number;
  /** Base gravable (`cbc:LineExtensionAmount`): el bruto sin impuesto incluido. */
  base: number;
  taxInclusive: number;
  taxAdditional: number;
  total: number;
}

/** Una retención declarada en la sección de retenciones (sólo UI). */
interface WithholdingRowValue {
  concept: string;
  rate: number | string;
  base: number | string;
}

type SectionId =
  | 'documento'
  | 'adquiriente'
  | 'lineas'
  | 'impuestos'
  | 'aiu'
  | 'retenciones'
  | 'divisa'
  | 'contabilidad';

/** Qué controles de cabecera pertenecen a cada sección, para contar errores. */
const SECTION_FIELDS: Record<SectionId, string[]> = {
  documento: [
    'invoice_type',
    'issue_date',
    'due_date',
    'payment_form',
    'payment_means_code',
    'operation_type',
    'notes',
  ],
  adquiriente: [
    'customer_name',
    'customer_tax_id',
    'customer_document_type',
    'customer_verification_digit',
    'customer_tax_regime',
    'customer_fiscal_responsibilities',
    'customer_email',
    'customer_phone',
    'customer_address',
  ],
  lineas: ['items'],
  impuestos: [],
  aiu: [],
  retenciones: ['withholding_amount'],
  divisa: [
    'foreign_currency',
    'exchange_rate',
    'exchange_rate_date',
    'foreign_total_amount',
  ],
  contabilidad: [],
};

/**
 * MODAL DE FACTURA AVANZADA (superficie fiscal).
 *
 * ─── LAS DOS SUPERFICIES ────────────────────────────────────────────────────
 *
 * El POS captura lo mínimo y NUNCA bloquea una venta. Esta pantalla hace lo
 * contrario a propósito: captura todo lo que la DIAN puede exigir —AIU,
 * retenciones, divisa, multi-impuesto por línea, subcuenta contable,
 * vencimiento— y BLOQUEA explicando, porque cada factura que sale mal consume un
 * consecutivo autorizado que no se recupera.
 *
 * ─── LO QUE ESTA PANTALLA YA NO HACE ────────────────────────────────────────
 *
 * **No deja elegir la resolución.** Era un `app-selector` sobre
 * `resolution_id`. Elegir mal no da error: da una factura numerada con el rango
 * equivocado. El backend siempre supo cuál usar (`toFiscalDocumentType`), así
 * que ahora la resolución se INFORMA en un banner y no se envía. Ver
 * `vendix-invoice-resolution-banner`.
 *
 * **No inventa el catálogo de impuestos.** Eran cuatro tarifas escritas a mano.
 * Ahora se carga el catálogo COMPLETO de la tienda y cada línea admite VARIOS
 * impuestos, que es como se factura de verdad en Colombia (IVA + INC).
 *
 * **No ofrece un selector de productos vacío.** `availableProducts` era un
 * arreglo vacío y "crear producto" era un `alert()`.
 *
 * **No cierra antes de saber si guardó.** Espera `...Success` / `...Failure`, y
 * si falla se queda abierto con el motivo a la vista y las líneas intactas.
 *
 * **No indexa las filas por posición.** La identidad de una fila es `row_uid`, y
 * los impuestos viven DENTRO del `FormGroup` de la línea (no en un `Map`
 * paralelo que se desincroniza al borrar una fila).
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
    ToggleComponent,
    IconComponent,
    ProductPickerModalComponent,
    CustomerModalComponent,
    SaveRequirementsModalComponent,
    InvoiceFormSectionComponent,
    InvoiceResolutionBannerComponent,
    InvoiceLineTaxesComponent,
  ],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      (cancel)="onClose()"
      (opened)="onOpened()"
      title="Nueva factura"
      subtitle="Captura fiscal completa — DIAN"
      size="xxl"
      [fullScreenOnMobile]="true"
    >
      <div class="p-4 space-y-3">
        <!-- Banner de error: persistente a propósito. El usuario tiene que
             poder leerlo MIENTRAS corrige. -->
        @if (submitError()) {
          <div
            role="alert"
            class="rounded-lg border border-error bg-error-light p-3"
          >
            <div class="flex items-start gap-2">
              <app-icon name="alert-triangle" [size]="16" class="text-error" />
              <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-error">
                  No se pudo crear la factura
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

        <!-- Modo: manual vs desde pedido -->
        <div class="flex gap-2">
          <button
            type="button"
            class="flex-1 px-3 py-2 text-sm rounded-lg border transition-colors"
            [ngClass]="modeClass('manual')"
            (click)="setMode('manual')"
          >
            Factura manual
          </button>
          <button
            type="button"
            class="flex-1 px-3 py-2 text-sm rounded-lg border transition-colors"
            [ngClass]="modeClass('from_order')"
            (click)="setMode('from_order')"
          >
            Desde pedido
          </button>
        </div>

        @if (mode() === 'from_order') {
          <app-input
            label="ID del pedido"
            type="number"
            [formControl]="orderIdControl"
            [control]="orderIdControl"
            [error]="fieldError('order_id')"
            placeholder="Ingrese el ID del pedido"
            [required]="true"
            min="1"
          ></app-input>
        }

        @if (mode() === 'manual') {
          <!-- La resolución NO se elige: se informa. -->
          <vendix-invoice-resolution-banner
            [resolution]="activeResolution()"
            [documentLabel]="documentLabel()"
          />

          <form [formGroup]="invoiceForm" class="space-y-2">
            <!-- ── 1. DOCUMENTO ─────────────────────────────────────── -->
            <vendix-invoice-form-section
              title="Documento"
              icon="file-text"
              [summary]="documentSummary()"
              [errorCount]="sectionErrors().documento"
              [expanded]="isSectionOpen('documento')"
              (expandedChange)="setSection('documento', $event)"
            >
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <app-selector
                  label="Tipo de documento"
                  formControlName="invoice_type"
                  [options]="invoiceTypeOptions"
                  [errorText]="fieldError('invoice_type') ?? ''"
                  size="sm"
                  (valueChange)="onInvoiceTypeChange()"
                ></app-selector>
                <app-input
                  label="Fecha de emisión"
                  type="date"
                  formControlName="issue_date"
                  [control]="control('issue_date')"
                  [error]="fieldError('issue_date')"
                  [required]="true"
                  size="sm"
                  (inputChange)="syncDueDate()"
                ></app-input>
                <app-selector
                  label="Tipo de operación"
                  formControlName="operation_type"
                  [options]="operationTypeOptions"
                  [errorText]="fieldError('operation_type') ?? ''"
                  size="sm"
                  (valueChange)="onOperationTypeChange()"
                ></app-selector>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                <app-selector
                  label="Forma de pago"
                  formControlName="payment_form"
                  [options]="paymentFormOptions"
                  [errorText]="fieldError('payment_form') ?? ''"
                  size="sm"
                  (valueChange)="onPaymentFormChange()"
                ></app-selector>
                <app-selector
                  label="Medio de pago"
                  formControlName="payment_means_code"
                  [options]="paymentMeansOptions"
                  [errorText]="fieldError('payment_means_code') ?? ''"
                  size="sm"
                ></app-selector>
                <app-input
                  label="Vencimiento"
                  type="date"
                  formControlName="due_date"
                  [control]="control('due_date')"
                  [error]="dueDateError()"
                  [required]="isCredit()"
                  [helperText]="dueDateHelp()"
                  size="sm"
                ></app-input>
              </div>

              <app-textarea
                class="block mt-3"
                label="Notas"
                formControlName="notes"
                [control]="control('notes')"
                [error]="fieldError('notes')"
                placeholder="Observaciones que se imprimen en el documento..."
                [rows]="2"
              ></app-textarea>
            </vendix-invoice-form-section>

            <!-- ── 2. ADQUIRIENTE ───────────────────────────────────── -->
            <vendix-invoice-form-section
              title="Adquiriente"
              icon="user-round"
              [summary]="customerSummary()"
              [errorCount]="sectionErrors().adquiriente"
              [expanded]="isSectionOpen('adquiriente')"
              (expandedChange)="setSection('adquiriente', $event)"
            >
              <!-- Búsqueda real contra el módulo de clientes -->
              <div class="relative mb-3">
                <div class="flex items-end gap-2">
                  <div class="flex-1">
                    <label
                      class="block text-xs font-medium text-[var(--color-text-secondary)] mb-1"
                    >
                      Buscar cliente existente
                    </label>
                    <input
                      type="text"
                      class="w-full px-3 py-2 text-sm border border-border rounded-lg bg-[var(--color-surface)] text-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
                      placeholder="Nombre, correo o documento..."
                      autocomplete="off"
                      [value]="customerQuery()"
                      (input)="onCustomerQuery($event)"
                    />
                  </div>
                  <app-button
                    variant="outline"
                    size="sm"
                    type="button"
                    (clicked)="openCustomerCreate()"
                  >
                    <app-icon slot="icon" name="plus" [size]="14" />
                    Crear
                  </app-button>
                </div>

                @if (customerResults().length > 0) {
                  <div
                    class="absolute z-[10000] left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-[var(--color-surface)] shadow-lg"
                  >
                    @for (found of customerResults(); track found.id) {
                      <button
                        type="button"
                        class="w-full px-3 py-2 text-left hover:bg-primary-50 transition-colors"
                        (click)="selectCustomer(found)"
                      >
                        <span
                          class="block text-sm text-text-primary truncate"
                          >{{ customerDisplayName(found) }}</span
                        >
                        <span
                          class="block text-xs text-[var(--color-text-secondary)] truncate"
                        >
                          {{ found.document_number || 'sin documento' }} ·
                          {{ found.email || 'sin correo' }}
                        </span>
                      </button>
                    }
                  </div>
                }
              </div>

              @if (linkedCustomerLabel(); as linked) {
                <div
                  class="mb-3 flex items-center justify-between gap-2 rounded-lg border border-border bg-[var(--color-surface-secondary)] px-3 py-2"
                >
                  <span class="text-xs text-text-primary truncate">
                    Vinculado a <strong>{{ linked }}</strong>
                  </span>
                  <button
                    type="button"
                    class="text-xs text-[var(--color-text-secondary)] hover:text-error"
                    (click)="unlinkCustomer()"
                  >
                    Desvincular
                  </button>
                </div>
              }

              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <app-input
                  label="Nombre / Razón social"
                  formControlName="customer_name"
                  [control]="control('customer_name')"
                  [error]="fieldError('customer_name')"
                  [required]="true"
                  size="sm"
                ></app-input>
                <app-input
                  label="Correo"
                  type="email"
                  formControlName="customer_email"
                  [control]="control('customer_email')"
                  [error]="fieldError('customer_email')"
                  placeholder="cliente@dominio.com"
                  helperText="Es la dirección a la que se entrega la factura electrónica."
                  size="sm"
                ></app-input>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
                <app-selector
                  label="Tipo de identificación"
                  formControlName="customer_document_type"
                  [options]="documentTypeOptions"
                  [errorText]="fieldError('customer_document_type') ?? ''"
                  size="sm"
                ></app-selector>
                <app-input
                  label="Número de documento"
                  formControlName="customer_tax_id"
                  [control]="control('customer_tax_id')"
                  [error]="fieldError('customer_tax_id')"
                  placeholder="900123456"
                  size="sm"
                ></app-input>
                <app-input
                  label="DV"
                  formControlName="customer_verification_digit"
                  [control]="control('customer_verification_digit')"
                  [error]="fieldError('customer_verification_digit')"
                  [disabled]="!isNitCustomer()"
                  [maxlength]="1"
                  helperText="Si lo omites, el servidor lo calcula."
                  size="sm"
                ></app-input>
                <app-input
                  label="Teléfono"
                  formControlName="customer_phone"
                  [control]="control('customer_phone')"
                  [error]="fieldError('customer_phone')"
                  size="sm"
                ></app-input>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <app-selector
                  label="Régimen tributario"
                  formControlName="customer_tax_regime"
                  [options]="taxRegimeOptions"
                  [errorText]="fieldError('customer_tax_regime') ?? ''"
                  placeholder="Sin declarar"
                  size="sm"
                ></app-selector>
                <app-input
                  label="Dirección fiscal"
                  formControlName="customer_address"
                  [control]="control('customer_address')"
                  [error]="fieldError('customer_address')"
                  size="sm"
                ></app-input>
              </div>

              <!--
                El «id» no es decorativo: es el ancla del CTA «Ir a
                responsabilidades» del modal de requisitos. Estas casillas no
                llevan «formControlName» en el DOM (el control se manipula desde
                el TS), así que sin ancla el botón abriría la sección y no
                desplazaría a ninguna parte.

                Sin comillas invertidas a propósito: este comentario vive DENTRO
                del template literal del componente, y una comilla invertida lo
                cerraría en seco — el archivo deja de parsear con un «',' expected»
                que apunta a esta línea y no explica nada.
              -->
              <fieldset id="customer_fiscal_responsibilities" class="mt-3">
                <legend
                  class="text-xs font-medium text-[var(--color-text-secondary)] mb-1"
                >
                  Responsabilidades fiscales (RUT)
                </legend>
                <div
                  class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5"
                >
                  @for (code of fiscalResponsibilities; track code) {
                    <label class="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        class="rounded border-border"
                        [checked]="hasResponsibility(code)"
                        (change)="toggleResponsibility(code)"
                      />
                      <span
                        class="text-xs text-text-primary leading-tight truncate"
                        [title]="responsibilityLabels[code]"
                      >
                        {{ responsibilityLabels[code] }}
                      </span>
                    </label>
                  }
                </div>
                @if (fieldError('customer_fiscal_responsibilities'); as err) {
                  <p class="mt-1 text-xs text-error">{{ err }}</p>
                }
              </fieldset>
            </vendix-invoice-form-section>

            <!-- ── 3. LÍNEAS ────────────────────────────────────────── -->
            <vendix-invoice-form-section
              title="Líneas"
              icon="list"
              [badge]="itemCount() + (itemCount() === 1 ? ' línea' : ' líneas')"
              [summary]="linesSummary()"
              [errorCount]="sectionErrors().lineas"
              [expanded]="isSectionOpen('lineas')"
              (expandedChange)="setSection('lineas', $event)"
            >
              <div formArrayName="items" class="space-y-2">
                @for (item of itemControls(); track rowUid(item); let i = $index) {
                  <div
                    [formGroupName]="i"
                    class="rounded-lg border border-border bg-[var(--color-surface-secondary)] p-2 space-y-2"
                  >
                    <div class="grid grid-cols-12 gap-2 items-end">
                      <div class="col-span-12 md:col-span-4">
                        <app-input
                          label="Descripción"
                          formControlName="description"
                          [control]="item.get('description')"
                          [error]="itemError(i, 'description')"
                          [required]="true"
                          size="sm"
                        ></app-input>
                      </div>
                      <div class="col-span-6 md:col-span-2">
                        <app-input
                          label="Cantidad"
                          type="number"
                          formControlName="quantity"
                          [control]="item.get('quantity')"
                          [error]="itemError(i, 'quantity')"
                          [required]="true"
                          min="0.0001"
                          step="any"
                          size="sm"
                        ></app-input>
                      </div>
                      <div class="col-span-6 md:col-span-2">
                        <app-selector
                          label="Unidad"
                          formControlName="unit_code"
                          [options]="unitCodeOptions"
                          [errorText]="itemError(i, 'unit_code') ?? ''"
                          size="sm"
                        ></app-selector>
                      </div>
                      <div class="col-span-6 md:col-span-2">
                        <app-input
                          label="Precio unitario"
                          [currency]="true"
                          formControlName="unit_price"
                          [control]="item.get('unit_price')"
                          [error]="itemError(i, 'unit_price')"
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
                          [error]="itemError(i, 'discount_amount')"
                          size="sm"
                        ></app-input>
                      </div>
                    </div>

                    <div class="grid grid-cols-12 gap-2 items-center">
                      <div class="col-span-12 md:col-span-3">
                        <button
                          type="button"
                          class="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-md border border-border hover:border-primary-600 transition-colors text-left"
                          (click)="openProductPicker(item)"
                        >
                          <app-icon name="package" [size]="14" />
                          <span class="flex-1 min-w-0 truncate">
                            {{ productLabel(item) }}
                          </span>
                        </button>
                      </div>

                      <div class="col-span-12 md:col-span-5">
                        <vendix-invoice-line-taxes
                          formControlName="taxes"
                          [taxes]="availableTaxes()"
                        />
                      </div>

                      @if (isAiu()) {
                        <div class="col-span-8 md:col-span-3">
                          <app-selector
                            formControlName="aiu_component"
                            [options]="aiuComponentOptions"
                            [errorText]="itemError(i, 'aiu_component') ?? ''"
                            placeholder="Componente AIU"
                            size="sm"
                          ></app-selector>
                        </div>
                      } @else {
                        <div class="col-span-8 md:col-span-3">
                          <span
                            class="text-xs text-[var(--color-text-secondary)]"
                          >
                            {{ lineSummary(i) }}
                          </span>
                        </div>
                      }

                      <div class="col-span-4 md:col-span-1 flex justify-end">
                        <button
                          type="button"
                          (click)="removeItem(i)"
                          class="text-[var(--color-text-secondary)] hover:text-error transition-colors p-1"
                          title="Eliminar línea"
                        >
                          <app-icon name="x" [size]="16" />
                        </button>
                      </div>
                    </div>
                  </div>
                }
              </div>

              @if (itemCount() === 0) {
                <p
                  class="text-center py-4 text-sm text-[var(--color-text-secondary)]"
                >
                  Una factura sin líneas no es una factura: quemaría un
                  consecutivo autorizado para declarar un total de cero.
                </p>
              }

              <div class="flex justify-end mt-2">
                <app-button
                  variant="outline"
                  size="sm"
                  type="button"
                  (clicked)="addItem()"
                  [disabled]="itemCount() >= 100"
                >
                  <app-icon slot="icon" name="plus" [size]="14" />
                  Agregar línea
                </app-button>
              </div>
            </vendix-invoice-form-section>

            <!-- ── 4. IMPUESTOS ─────────────────────────────────────── -->
            <!--
              El id «taxes_section» es el ancla del CTA de los hallazgos de
              impuesto. NO se usa «taxes» a secas: cada línea ya tiene un
              formControlName="taxes" y el selector lo encontraría PRIMERO,
              desplazando a la primera línea en vez de al desglose agregado que
              el hallazgo está discutiendo.
            -->
            <vendix-invoice-form-section
              id="taxes_section"
              title="Impuestos"
              icon="percent"
              [summary]="taxSummary()"
              [errorCount]="sectionErrors().impuestos"
              [expanded]="isSectionOpen('impuestos')"
              (expandedChange)="setSection('impuestos', $event)"
            >
              <p class="text-xs text-[var(--color-text-secondary)] mb-2">
                Los impuestos se declaran POR LÍNEA, en la sección Líneas. Aquí
                se ve el agregado que el servidor va a recomputar: el importe
                que se envía es siempre cero y la DIAN recibe el que calcula el
                motor fiscal, no el que se escriba en pantalla.
              </p>

              @if (taxBreakdown().length === 0) {
                <p class="text-sm text-[var(--color-text-secondary)]">
                  Ninguna línea declara impuesto. Sólo es correcto si la
                  operación es realmente excluida o exenta.
                </p>
              } @else {
                <div class="overflow-x-auto">
                  <table class="w-full text-xs">
                    <thead>
                      <tr
                        class="text-left text-[var(--color-text-secondary)] border-b border-border"
                      >
                        <th class="py-1 pr-2">Impuesto</th>
                        <th class="py-1 pr-2">Tarifa</th>
                        <th class="py-1 pr-2">Aplicación</th>
                        <th class="py-1 pr-2 text-right">Base</th>
                        <th class="py-1 text-right">Importe</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (row of taxBreakdown(); track row.key) {
                        <tr class="border-b border-border last:border-0">
                          <td class="py-1 pr-2 text-text-primary">
                            {{ row.name }}
                          </td>
                          <td class="py-1 pr-2">{{ row.rate }}%</td>
                          <td class="py-1 pr-2">
                            {{ row.isInclusive ? 'Incluido' : 'Adicional' }}
                          </td>
                          <td class="py-1 pr-2 text-right">
                            {{ formatCurrency(row.base) }}
                          </td>
                          <td class="py-1 text-right font-medium">
                            {{ formatCurrency(row.amount) }}
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }

              @if (availableTaxes().length === 0) {
                <p class="mt-2 text-xs text-warning">
                  El catálogo de impuestos de la tienda está vacío o no se pudo
                  cargar. Configúralo en Ajustes → Impuestos.
                </p>
              }
            </vendix-invoice-form-section>

            <!-- ── 5. AIU ───────────────────────────────────────────── -->
            <vendix-invoice-form-section
              title="AIU"
              icon="calculator"
              [optional]="true"
              [summary]="aiuSummary()"
              [errorCount]="sectionErrors().aiu"
              [expanded]="isSectionOpen('aiu')"
              (expandedChange)="setSection('aiu', $event)"
            >
              @if (!isAiu()) {
                <p class="text-sm text-[var(--color-text-secondary)]">
                  El documento no está declarado como AIU. Cambia el tipo de
                  operación a <strong>AIU (09)</strong> en la sección Documento
                  para marcar cada línea como administración, imprevistos o
                  utilidad.
                </p>
              } @else {
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  @for (row of aiuBreakdown(); track row.key) {
                    <div
                      class="rounded-lg border border-border p-2 bg-[var(--color-surface)]"
                    >
                      <p class="text-xs text-[var(--color-text-secondary)]">
                        {{ row.label }}
                      </p>
                      <p class="text-sm font-semibold text-text-primary">
                        {{ formatCurrency(row.amount) }}
                      </p>
                    </div>
                  }
                </div>

                @if (aiuUnassigned() > 0) {
                  <p class="mt-2 text-xs text-error">
                    Hay {{ aiuUnassigned() }} línea(s) sin componente AIU. La
                    DIAN valida la coherencia entre el
                    <code>CustomizationID</code> 09 y el desglose de las líneas:
                    una línea sin marcar hace que rechace el documento entero.
                  </p>
                }
                <p class="mt-2 text-xs text-[var(--color-text-secondary)]">
                  En el régimen AIU la base gravable del IVA es únicamente la
                  utilidad. Declara el impuesto sobre las líneas de utilidad y
                  deja sin impuesto las de administración e imprevistos.
                </p>
              }
            </vendix-invoice-form-section>

            <!-- ── 6. RETENCIONES ───────────────────────────────────── -->
            <vendix-invoice-form-section
              title="Retenciones"
              icon="hand-coins"
              [optional]="true"
              [summary]="withholdingSummary()"
              [errorCount]="sectionErrors().retenciones"
              [expanded]="isSectionOpen('retenciones')"
              (expandedChange)="setSection('retenciones', $event)"
            >
              <p class="text-xs text-[var(--color-text-secondary)] mb-2">
                La retención NO reduce el total que se declara a la DIAN
                (<code>PayableAmount</code> se valida sin mirar la retención):
                reduce lo que efectivamente se cobra. Se envía como un único
                importe positivo en <code>withholding_amount</code>, nunca como
                un impuesto negativo.
              </p>

              <label class="flex items-center gap-2 mb-3 cursor-pointer">
                <app-toggle formControlName="manual_withholding" />
                <span class="text-xs text-text-primary">
                  Escribir el importe a mano en vez de calcularlo por concepto
                </span>
              </label>

              @if (isManualWithholding()) {
                <app-input
                  label="Retención total"
                  [currency]="true"
                  formControlName="withholding_amount"
                  [control]="control('withholding_amount')"
                  [error]="fieldError('withholding_amount')"
                  size="sm"
                ></app-input>
              } @else {
                <div formArrayName="withholdings" class="space-y-2">
                  @for (
                    row of withholdingControls();
                    track withholdingUid(row);
                    let i = $index
                  ) {
                    <div [formGroupName]="i" class="grid grid-cols-12 gap-2 items-end">
                      <div class="col-span-12 md:col-span-5">
                        <app-input
                          label="Concepto"
                          formControlName="concept"
                          [control]="row.get('concept')"
                          placeholder="Retefuente por servicios"
                          size="sm"
                        ></app-input>
                      </div>
                      <div class="col-span-4 md:col-span-2">
                        <app-input
                          label="Tarifa %"
                          type="number"
                          formControlName="rate"
                          [control]="row.get('rate')"
                          min="0"
                          max="100"
                          step="any"
                          size="sm"
                        ></app-input>
                      </div>
                      <div class="col-span-5 md:col-span-3">
                        <app-input
                          label="Base"
                          [currency]="true"
                          formControlName="base"
                          [control]="row.get('base')"
                          size="sm"
                        ></app-input>
                      </div>
                      <div
                        class="col-span-3 md:col-span-2 flex items-center justify-between gap-1 pb-1"
                      >
                        <span class="text-xs font-medium text-text-primary">
                          {{ formatCurrency(withholdingRowAmount(i)) }}
                        </span>
                        <button
                          type="button"
                          class="text-[var(--color-text-secondary)] hover:text-error p-1"
                          title="Quitar retención"
                          (click)="removeWithholding(i)"
                        >
                          <app-icon name="x" [size]="14" />
                        </button>
                      </div>
                    </div>
                  }
                </div>

                <div class="flex items-center justify-between mt-2">
                  <app-button
                    variant="outline"
                    size="sm"
                    type="button"
                    (clicked)="addWithholding()"
                  >
                    <app-icon slot="icon" name="plus" [size]="14" />
                    Agregar retención
                  </app-button>
                  <span class="text-sm font-semibold text-text-primary">
                    Total retenido: {{ formatCurrency(effectiveWithholding()) }}
                  </span>
                </div>
              }
            </vendix-invoice-form-section>

            <!-- ── 7. DIVISA ────────────────────────────────────────── -->
            <vendix-invoice-form-section
              title="Divisa"
              icon="globe"
              [optional]="true"
              [summary]="currencySummary()"
              [errorCount]="sectionErrors().divisa"
              [expanded]="isSectionOpen('divisa')"
              (expandedChange)="setSection('divisa', $event)"
            >
              <div
                class="rounded-lg border border-border bg-[var(--color-surface-secondary)] p-2 mb-3 flex items-start gap-2"
              >
                <app-icon
                  name="info"
                  [size]="14"
                  class="text-primary shrink-0 mt-0.5"
                />
                <p class="text-xs text-text-primary">
                  <strong>La factura se emite siempre en pesos colombianos.</strong>
                  La divisa extranjera sólo DECLARA la conversión
                  (<code>cac:PaymentAlternativeExchangeRate</code>) y no cambia
                  el importe legal: el valor exigible sigue siendo el total en
                  COP. Res. DIAN 000042/2020, art. 73.
                </p>
              </div>

              <label class="flex items-center gap-2 mb-3 cursor-pointer">
                <app-toggle formControlName="use_foreign_currency" />
                <span class="text-xs text-text-primary">
                  Declarar la conversión a una divisa extranjera
                </span>
              </label>

              @if (usesForeignCurrency()) {
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <app-selector
                    label="Divisa"
                    formControlName="foreign_currency"
                    [options]="foreignCurrencyOptions"
                    [errorText]="fieldError('foreign_currency') ?? ''"
                    [required]="true"
                    size="sm"
                  ></app-selector>
                  <app-input
                    label="Tasa del día (COP por unidad)"
                    type="number"
                    formControlName="exchange_rate"
                    [control]="control('exchange_rate')"
                    [error]="fieldError('exchange_rate')"
                    [required]="true"
                    min="0"
                    step="any"
                    size="sm"
                  ></app-input>
                  <app-input
                    label="Fecha de la TRM"
                    type="date"
                    formControlName="exchange_rate_date"
                    [control]="control('exchange_rate_date')"
                    [error]="fieldError('exchange_rate_date')"
                    size="sm"
                  ></app-input>
                </div>

                <div
                  class="mt-3 rounded-lg border border-border p-2 flex items-center justify-between"
                >
                  <span class="text-xs text-[var(--color-text-secondary)]">
                    Equivalente declarado ({{ foreignCurrencyCode() }})
                  </span>
                  <span class="text-sm font-semibold text-text-primary">
                    {{ foreignTotalLabel() }}
                  </span>
                </div>
                @if (fieldError('foreign_total_amount'); as err) {
                  <p class="mt-1 text-xs text-error">{{ err }}</p>
                }
              }
            </vendix-invoice-form-section>

            <!-- ── 8. CONTABILIDAD ──────────────────────────────────── -->
            <vendix-invoice-form-section
              title="Contabilidad"
              icon="book"
              [optional]="true"
              [summary]="accountingSummary()"
              [errorCount]="sectionErrors().contabilidad"
              [expanded]="isSectionOpen('contabilidad')"
              (expandedChange)="setSection('contabilidad', $event)"
            >
              <p class="text-xs text-[var(--color-text-secondary)] mb-3">
                Dejarlo vacío es el camino normal: el mapeo automático de cuentas
                decide con qué PUC se contabiliza cada línea. Sólo forza la
                subcuenta cuando esta factura tenga que salirse de ese mapeo.
              </p>

              <div class="flex items-end gap-2 mb-3">
                <div class="flex-1">
                  <app-input
                    label="Cuenta PUC por defecto"
                    formControlName="default_account_code"
                    [control]="control('default_account_code')"
                    placeholder="Ej. 413505"
                    [maxlength]="20"
                    size="sm"
                  ></app-input>
                </div>
                <app-button
                  variant="outline"
                  size="sm"
                  type="button"
                  (clicked)="applyDefaultAccountCode()"
                >
                  Aplicar a todas
                </app-button>
              </div>

              <!--
                Aquí NO se repite formArrayName="items". El mismo FormArray
                declarado dos veces en la misma plantilla registra dos
                contenedores sobre el mismo control y engancha un segundo
                accessor a cada campo: los dos se sincronizan casi siempre, y
                "casi siempre" es la peor garantía posible en la pantalla que
                gasta numeración autorizada. Se enlaza el control directamente.
              -->
              <div class="space-y-2">
                @for (item of itemControls(); track rowUid(item); let i = $index) {
                  <div class="grid grid-cols-12 gap-2 items-end">
                    <div class="col-span-12 md:col-span-7">
                      <span class="block text-xs text-text-primary truncate">
                        {{ lineLabel(i) }}
                      </span>
                    </div>
                    <div class="col-span-12 md:col-span-5">
                      <app-input
                        [formControl]="accountControl(item)"
                        [control]="accountControl(item)"
                        [error]="itemError(i, 'account_code')"
                        placeholder="Cuenta PUC (opcional)"
                        [maxlength]="20"
                        size="sm"
                      ></app-input>
                    </div>
                  </div>
                }
              </div>

              @if (itemCount() === 0) {
                <p class="text-sm text-[var(--color-text-secondary)]">
                  Agrega líneas para asignarles cuenta.
                </p>
              }
            </vendix-invoice-form-section>
          </form>

          <!-- Totales: siempre visibles, nunca dentro de una sección plegada -->
          <div
            class="rounded-lg border border-border p-3 bg-[var(--color-surface-muted)]"
          >
            <div class="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
              <div>
                <div class="text-[var(--color-text-secondary)]">
                  Base gravable
                </div>
                <div class="font-semibold">
                  {{ formatCurrency(totals().base) }}
                </div>
              </div>
              <div>
                <div class="text-[var(--color-text-secondary)]">Descuento</div>
                <div class="font-semibold">
                  -{{ formatCurrency(totals().discount) }}
                </div>
              </div>
              <div>
                <div class="text-[var(--color-text-secondary)]">
                  Impuesto incluido
                </div>
                <div class="font-semibold">
                  {{ formatCurrency(totals().taxInclusive) }}
                </div>
              </div>
              <div>
                <div class="text-[var(--color-text-secondary)]">
                  Impuesto adicional
                </div>
                <div class="font-semibold">
                  {{ formatCurrency(totals().taxAdditional) }}
                </div>
              </div>
              <div>
                <div class="text-[var(--color-text-secondary)]">
                  Total del documento
                </div>
                <div class="font-bold text-primary">
                  {{ formatCurrency(totals().total) }}
                </div>
              </div>
              <div>
                <div class="text-[var(--color-text-secondary)]">
                  Neto a recibir
                </div>
                <div class="font-semibold">
                  {{ formatCurrency(totals().total - effectiveWithholding()) }}
                </div>
              </div>
            </div>
            <p class="mt-2 text-[11px] text-[var(--color-text-secondary)]">
              Cifras de referencia. El servidor recalcula el documento entero con
              aritmética decimal y su resultado es el que se declara.
            </p>
          </div>
        }
      </div>

      <div slot="footer">
        <div
          class="flex items-center justify-between gap-3 p-3 bg-[var(--color-surface-secondary)] rounded-b-xl border-t border-border"
        >
          <span class="text-xs text-[var(--color-text-secondary)] min-w-0 truncate">
            {{ submitHint() }}
          </span>
          <div class="flex items-center gap-3 shrink-0">
            <app-button variant="outline" (clicked)="onClose()">
              Cancelar
            </app-button>
            <!--
              Se apaga también con el borrador ya creado: en ese estado el modal
              sigue abierto sólo para enseñar lo que la puerta de emisión
              encontró, y pulsar de nuevo crearía una factura gemela. El pie de
              la izquierda explica por qué está apagado — un botón mudo sin
              motivo es un callejón sin salida.
            -->
            <app-button
              variant="primary"
              (clicked)="onSubmit()"
              [disabled]="
                submitting() || checkingEmitReadiness() || draftCreated()
              "
              [loading]="submitting() || checkingEmitReadiness()"
            >
              {{ mode() === 'from_order' ? 'Crear desde pedido' : 'Crear factura' }}
            </app-button>
          </div>
        </div>
      </div>
    </app-modal>

    <app-customer-modal
      [isOpen]="customerModalOpen()"
      [customer]="null"
      (isOpenChange)="customerModalOpen.set($event)"
      (save)="onCustomerCreated($event)"
    />

    <!--
      El picker no proyecta contenido: "crear producto" es su propio output.
      Un botón con slot="…" aquí dentro se descartaría en silencio.
    -->
    <app-product-picker-modal
      [open]="productPickerOpen()"
      [products]="availableProducts()"
      [loading]="productsLoading()"
      [mode]="'single'"
      [disabledIds]="pickedProductIds()"
      (selected)="onProductPicked($event)"
      (productCreateRequested)="onCreateProductRequested()"
      (closed)="productPickerOpen.set(false)"
    />

    <!--
      LA PUERTA DE EMISIÓN, ANTES DE «VALIDAR».

      Va DESPUÉS del modal de captura en el orden del DOM a propósito: los dos
      son app-modal y comparten z-index, así que el último declarado es el que
      queda encima. Se pinta sobre el formulario todavía abierto para que los
      CTA de «Ir al campo» enfoquen el dato REAL que la DIAN va a rechazar, y no
      un formulario ya limpiado.
    -->
    <app-save-requirements-modal
      [(isOpen)]="emitRequirementsOpen"
      [requirements]="emitRequirements()"
      (action)="onEmitRequirementAction($event)"
    />
  `,
})
export class InvoiceCreateComponent {
  /**
   * Visibilidad. `model()` publica su propio `isOpenChange`: declarar un
   * `output()` con ese nombre al lado crearía DOS canales para un mismo estado
   * y dejaría el modelo interno desincronizado (ver `vendix-frontend-modal`).
   */
  readonly isOpen = model<boolean>(false);

  private readonly fb = inject(FormBuilder);
  private readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly actions$ = inject(Actions);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toastService = inject(ToastService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly productsService = inject(ProductsService);
  private readonly customersService = inject(CustomersService);
  private readonly taxCatalog = inject(InvoiceTaxCatalogService);
  private readonly emitReadinessService = inject(InvoiceEmitReadinessService);

  // ── Catálogos estáticos ─────────────────────────────────────
  readonly invoiceTypeOptions = INVOICE_TYPE_OPTIONS;
  readonly operationTypeOptions = OPERATION_TYPE_OPTIONS;
  readonly paymentFormOptions = PAYMENT_FORM_OPTIONS;
  readonly paymentMeansOptions = PAYMENT_MEANS_OPTIONS;
  readonly documentTypeOptions = DOCUMENT_TYPE_OPTIONS;
  readonly taxRegimeOptions = TAX_REGIME_OPTIONS;
  readonly unitCodeOptions = UNIT_CODE_OPTIONS;
  readonly aiuComponentOptions = AIU_COMPONENT_OPTIONS;
  readonly foreignCurrencyOptions = FOREIGN_CURRENCY_OPTIONS;
  readonly fiscalResponsibilities = FISCAL_RESPONSIBILITIES;
  readonly responsibilityLabels = FISCAL_RESPONSIBILITY_LABELS;

  // ── Estado de UI ────────────────────────────────────────────
  readonly mode = signal<'manual' | 'from_order'>('manual');
  readonly submitting = signal(false);
  readonly customerModalOpen = signal(false);
  readonly productPickerOpen = signal(false);
  readonly productsLoading = signal(false);
  /** Fila (por `row_uid`) a la que apunta el picker abierto. */
  private readonly pickerTargetUid = signal<string | null>(null);

  private readonly openSections = signal<Set<SectionId>>(
    new Set<SectionId>(['documento', 'adquiriente', 'lineas']),
  );

  readonly submitError = signal<string | null>(null);
  readonly submitErrorDetails = signal<string[]>([]);
  private readonly backendFieldErrors = signal<Record<string, string>>({});

  // ── Puerta de emisión (`GET /store/invoicing/:id/emit-readiness`) ──
  //
  // Todo señal, nada de booleanos planos: en Zoneless un campo mutado dentro de
  // un `subscribe` no repinta la plantilla y el modal no llegaría a abrirse.

  /** Filas que pinta el modal compartido de requisitos. */
  readonly emitRequirements = signal<SaveRequirement[]>([]);
  readonly emitRequirementsOpen = signal(false);
  /** `true` mientras se consulta la puerta, para no dejar el pie mudo. */
  readonly checkingEmitReadiness = signal(false);

  /**
   * Id del borrador creado EN ESTA SESIÓN del modal.
   *
   * Existe por una razón de seguridad, no de presentación: cuando la puerta
   * devuelve un veredicto negativo el formulario se queda abierto con los datos
   * a la vista, y en ese estado el botón «Crear factura» crearía una SEGUNDA
   * factura con la misma captura y un segundo consecutivo. Mientras esto no sea
   * `null`, enviar está cerrado.
   */
  private readonly createdInvoiceId = signal<number | null>(null);

  /** Lo lee la plantilla para apagar «Crear factura» sin exponer el id. */
  readonly draftCreated = computed(() => this.createdInvoiceId() !== null);

  /**
   * El formulario se construye como inicializador de campo, ANTES de los
   * puentes reactivos de abajo. Cuando vivía en el cuerpo del constructor, el
   * `toSignal` de los totales se suscribía primero y leía `this.invoiceForm`
   * todavía `undefined`, dejando la señal en error para el resto de la vida del
   * componente.
   */
  readonly invoiceForm: FormGroup = this.fb.group({
    // Documento
    invoice_type: ['sales_invoice', [Validators.required]],
    issue_date: [toLocalDateString(), [Validators.required]],
    due_date: [{ value: toLocalDateString(), disabled: true }],
    payment_form: [PAYMENT_FORM_CASH],
    payment_means_code: ['10'],
    operation_type: [OPERATION_TYPE_STANDARD],
    notes: [''],

    // Adquiriente
    customer_id: [null],
    customer_name: ['', [Validators.required, Validators.minLength(2)]],
    customer_document_type: [DOCUMENT_TYPE_NIT_CODE],
    customer_tax_id: [''],
    customer_verification_digit: [''],
    customer_tax_regime: [''],
    customer_fiscal_responsibilities: [[] as string[]],
    customer_email: ['', [Validators.email]],
    customer_phone: [''],
    customer_address: [''],

    // Retenciones (los tres primeros son SÓLO UI)
    manual_withholding: [false],
    withholding_amount: [0],
    withholdings: this.fb.array([]),

    // Divisa
    use_foreign_currency: [false],
    foreign_currency: [''],
    exchange_rate: [null],
    exchange_rate_date: [''],

    // Contabilidad (sólo UI: se derrama sobre `items[].account_code`)
    default_account_code: [''],

    items: this.fb.array([]),
  });

  readonly orderIdControl = this.fb.control<number | null>(null, [
    Validators.required,
    Validators.min(1),
  ]);

  /**
   * IDENTIDAD REAL DE LA FILA. Indexar por posición no es identidad: al borrar
   * la línea 0, lo que estaba archivado bajo la clave 1 pasaba a apuntar al
   * control 0 y el dato se movía solo de fila. `row_uid` es un control más del
   * `FormGroup`, así que sobrevive al snapshot del valor y a cualquier
   * reordenamiento; nunca se envía al backend.
   */
  private nextRowUid = 0;
  private nextWithholdingUid = 0;

  // ── Puentes formulario → señal ──────────────────────────────
  //
  // `invoiceForm.value` / `.invalid` / `.status` son propiedades planas.
  // Leerlas dentro de un `computed` lo congelaría en el estado inicial y el
  // botón de guardar no volvería a habilitarse nunca.

  private readonly itemsValue = toSignal(
    this.itemsArray.valueChanges as Observable<InvoiceItemFormValue[]>,
    { initialValue: [] as InvoiceItemFormValue[] },
  );

  private readonly withholdingsValue = toSignal(
    this.withholdingsArray.valueChanges as Observable<WithholdingRowValue[]>,
    { initialValue: [] as WithholdingRowValue[] },
  );

  private readonly formValue = toSignal(
    this.invoiceForm.valueChanges.pipe(startWith(this.invoiceForm.value)),
    { initialValue: this.invoiceForm.value as Record<string, unknown> },
  );

  private readonly formStatus = toSignal(
    this.invoiceForm.statusChanges.pipe(startWith(this.invoiceForm.status)),
    { initialValue: this.invoiceForm.status },
  );

  private readonly orderIdValue = toSignal(
    this.orderIdControl.valueChanges.pipe(
      startWith(this.orderIdControl.value),
    ),
    { initialValue: this.orderIdControl.value },
  );

  /**
   * Controles de las líneas. Devuelve una COPIA del arreglo: `FormArray.push`
   * muta `controls` en sitio, y un `computed` que devolviera la misma
   * referencia nunca notificaría a la plantilla.
   */
  readonly itemControls = computed<FormGroup[]>(() => {
    this.itemsValue();
    return [...this.itemsArray.controls] as FormGroup[];
  });

  readonly withholdingControls = computed<FormGroup[]>(() => {
    this.withholdingsValue();
    return [...this.withholdingsArray.controls] as FormGroup[];
  });

  readonly itemCount = computed(() => this.itemControls().length);

  // ── Lecturas derivadas del formulario ───────────────────────

  private readonly rawValue = computed<Record<string, any>>(() => {
    // `formValue()` sólo dispara la recomputación; el valor bueno es el CRUDO,
    // porque `due_date` está deshabilitado en contado y `form.value` omite los
    // controles deshabilitados.
    this.formValue();
    return this.invoiceForm.getRawValue() as Record<string, any>;
  });

  readonly invoiceType = computed<string>(
    () => this.rawValue()['invoice_type'] ?? 'sales_invoice',
  );

  readonly documentLabel = computed(() => invoiceTypeLabel(this.invoiceType()));

  readonly isCredit = computed(
    () => this.rawValue()['payment_form'] === PAYMENT_FORM_CREDIT,
  );

  readonly isAiu = computed(
    () => this.rawValue()['operation_type'] === OPERATION_TYPE_AIU,
  );

  readonly isNitCustomer = computed(
    () => this.rawValue()['customer_document_type'] === DOCUMENT_TYPE_NIT_CODE,
  );

  readonly isManualWithholding = computed(
    () => this.rawValue()['manual_withholding'] === true,
  );

  readonly usesForeignCurrency = computed(
    () => this.rawValue()['use_foreign_currency'] === true,
  );

  readonly foreignCurrencyCode = computed<string>(
    () => this.rawValue()['foreign_currency'] || 'divisa',
  );

  private readonly responsibilitiesValue = computed<string[]>(() => {
    const value = this.rawValue()['customer_fiscal_responsibilities'];
    return Array.isArray(value) ? value : [];
  });

  // ── Resolución activa (banner) ──────────────────────────────

  private readonly activeResolutions = toSignal(
    this.store.select(selectActiveResolutions),
    { initialValue: [] as InvoiceResolution[] },
  );

  /**
   * La MISMA fila que `InvoiceNumberGenerator` va a consumir: activa y del tipo
   * de documento que corresponde a `invoice_type`. Filas antiguas sin
   * `document_type` se aceptan como factura de venta, igual que hace el backend
   * (la columna es NOT NULL, pero el tipo del frontend la declara opcional para
   * los consumidores que la ensanchan).
   */
  readonly activeResolution = computed<InvoiceResolution | null>(() => {
    const target = toFiscalDocumentType(this.invoiceType());
    const candidates = this.activeResolutions().filter((res) => {
      const documentType = res.document_type ?? 'sales_invoice';
      return documentType === target;
    });
    if (candidates.length === 0) return null;
    // Con varias activas, la que aún tiene numeración disponible manda.
    const usable = candidates.find(
      (res) => Number(res.current_number) < Number(res.range_to),
    );
    return usable ?? candidates[0];
  });

  // ── Catálogos cargados ──────────────────────────────────────

  readonly availableTaxes = signal<TaxOption[]>([]);

  readonly availableProducts = signal<ProductPickerOption[]>([]);
  /** `id → producto`, para hidratar descripción y precio al elegirlo. */
  private readonly productsById = new Map<number, Product>();
  private productsLoaded = false;
  private taxesLoaded = false;

  readonly pickedProductIds = computed<number[]>(() =>
    this.itemsValue()
      .map((item) => item.product_id)
      .filter((id): id is number => id != null)
      .map(Number),
  );

  // ── Búsqueda de clientes ────────────────────────────────────

  readonly customerQuery = signal('');
  readonly customerResults = signal<Customer[]>([]);
  readonly linkedCustomerLabel = signal<string | null>(null);
  private readonly customerSearch$ = new Subject<string>();
  /** Payload de creación inline; viaja como `inline_customer`. */
  private readonly inlineCustomer = signal<CreateCustomerRequest | null>(null);

  // ── Aritmética ──────────────────────────────────────────────

  /**
   * Desglose por línea.
   *
   * El bruto que se teclea NO es la base gravable: cuando el impuesto va
   * incluido en el precio, la base es el bruto despejado
   * (`bruto / (1 + Σtarifas incluidas)`). El backend persiste exactamente eso en
   * `subtotal_amount` —la Σ de los `cbc:LineExtensionAmount`—, así que el panel
   * de totales tiene que hablar el mismo idioma o el usuario ve una cifra en
   * pantalla y otra en la factura.
   */
  readonly lineMath = computed<LineMath[]>(() =>
    this.itemsValue().map((item) => {
      const quantity = Number(item.quantity) || 0;
      const price = Number(item.unit_price) || 0;
      const discount = Number(item.discount_amount) || 0;
      const gross = Math.max(quantity * price - discount, 0);
      const taxes = Array.isArray(item.taxes) ? item.taxes : [];

      let inclusiveRate = 0;
      let additionalRate = 0;
      for (const tax of taxes) {
        const rate = Number(tax.rate) || 0;
        if (tax.is_inclusive) inclusiveRate += rate;
        else additionalRate += rate;
      }

      const base = inclusiveRate > 0 ? gross / (1 + inclusiveRate / 100) : gross;
      const taxInclusive = gross - base;
      const taxAdditional = (base * additionalRate) / 100;
      return {
        gross,
        base,
        taxInclusive,
        taxAdditional,
        total: base + taxInclusive + taxAdditional,
      };
    }),
  );

  readonly totals = computed(() => {
    const items = this.itemsValue();
    const math = this.lineMath();
    let base = 0;
    let discount = 0;
    let taxInclusive = 0;
    let taxAdditional = 0;
    let total = 0;
    for (let i = 0; i < math.length; i++) {
      base += math[i].base;
      taxInclusive += math[i].taxInclusive;
      taxAdditional += math[i].taxAdditional;
      total += math[i].total;
      discount += Number(items[i]?.discount_amount) || 0;
    }
    return { base, discount, taxInclusive, taxAdditional, total };
  });

  /** Agregado por `(impuesto, tarifa, aplicación)`, igual que `invoice_taxes`. */
  readonly taxBreakdown = computed(() => {
    const items = this.itemsValue();
    const math = this.lineMath();
    const rows = new Map<
      string,
      {
        key: string;
        name: string;
        rate: number;
        isInclusive: boolean;
        base: number;
        amount: number;
      }
    >();

    for (let i = 0; i < items.length; i++) {
      const taxes = Array.isArray(items[i]?.taxes) ? items[i].taxes : [];
      const lineBase = math[i]?.base ?? 0;
      for (const tax of taxes) {
        const rate = Number(tax.rate) || 0;
        const key = tax.tax_rate_id + '|' + rate + '|' + tax.is_inclusive;
        const existing = rows.get(key);
        const amount = (lineBase * rate) / 100;
        if (existing) {
          existing.base += lineBase;
          existing.amount += amount;
        } else {
          rows.set(key, {
            key,
            name: tax.name,
            rate,
            isInclusive: tax.is_inclusive,
            base: lineBase,
            amount,
          });
        }
      }
    }
    return [...rows.values()];
  });

  readonly aiuBreakdown = computed(() => {
    const items = this.itemsValue();
    const math = this.lineMath();
    const buckets: Record<string, number> = {
      administracion: 0,
      imprevistos: 0,
      utilidad: 0,
    };
    for (let i = 0; i < items.length; i++) {
      const component = items[i]?.aiu_component;
      if (component && component in buckets) {
        buckets[component] += math[i]?.base ?? 0;
      }
    }
    return AIU_COMPONENT_OPTIONS.map((option) => ({
      key: String(option.value),
      label: option.label,
      amount: buckets[String(option.value)] ?? 0,
    }));
  });

  readonly aiuUnassigned = computed(
    () => this.itemsValue().filter((item) => !item.aiu_component).length,
  );

  /** Retención efectiva: la calculada por conceptos, o la escrita a mano. */
  readonly effectiveWithholding = computed<number>(() => {
    if (this.isManualWithholding()) {
      return Math.max(Number(this.rawValue()['withholding_amount']) || 0, 0);
    }
    return this.withholdingsValue().reduce((sum, row) => {
      return sum + rowWithholding(row);
    }, 0);
  });

  /** Total en la divisa declarada. Derivado: no se teclea, para no contradecirse. */
  readonly foreignTotal = computed<number | null>(() => {
    if (!this.usesForeignCurrency()) return null;
    const rate = Number(this.rawValue()['exchange_rate']);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    return this.totals().total / rate;
  });

  // ── Resúmenes de cabecera de sección ────────────────────────

  readonly documentSummary = computed(() => {
    const credit = this.isCredit() ? 'Crédito' : 'Contado';
    const operation = this.isAiu() ? ' · AIU' : '';
    return this.documentLabel() + ' · ' + credit + operation;
  });

  readonly customerSummary = computed(() => {
    const name = (this.rawValue()['customer_name'] as string) || '';
    const document = (this.rawValue()['customer_tax_id'] as string) || '';
    if (!name) return 'Sin adquiriente';
    return document ? name + ' · ' + document : name;
  });

  readonly linesSummary = computed(() =>
    this.itemCount() === 0
      ? 'Sin líneas'
      : 'Total ' + this.formatCurrency(this.totals().total),
  );

  readonly taxSummary = computed(() => {
    const rows = this.taxBreakdown();
    if (rows.length === 0) return 'Sin impuestos declarados';
    const amount = this.totals().taxInclusive + this.totals().taxAdditional;
    return rows.length + ' concepto(s) · ' + this.formatCurrency(amount);
  });

  readonly aiuSummary = computed(() =>
    this.isAiu() ? 'Operación AIU (09)' : 'No aplica',
  );

  readonly withholdingSummary = computed(() => {
    const amount = this.effectiveWithholding();
    return amount > 0 ? this.formatCurrency(amount) : 'Sin retenciones';
  });

  readonly currencySummary = computed(() =>
    this.usesForeignCurrency()
      ? 'COP + conversión a ' + this.foreignCurrencyCode()
      : 'Pesos colombianos (COP)',
  );

  readonly accountingSummary = computed(() => {
    const assigned = this.itemsValue().filter((item) =>
      (item.account_code ?? '').trim(),
    ).length;
    return assigned === 0
      ? 'Mapeo automático'
      : assigned + ' línea(s) con cuenta forzada';
  });

  readonly foreignTotalLabel = computed(() => {
    const value = this.foreignTotal();
    if (value == null) return 'Declara la tasa del día';
    return (
      value.toLocaleString('es-CO', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) +
      ' ' +
      this.foreignCurrencyCode()
    );
  });

  // ── Errores por sección ─────────────────────────────────────

  /**
   * Cuántos campos están mal en cada sección AHORA MISMO.
   *
   * Cuenta dos cosas distintas: lo que rechazó el backend
   * (`backendFieldErrors`) y lo que el usuario ya tocó y dejó inválido. Sin
   * esto, un modal con ocho secciones plegadas puede esconder el campo que
   * impide guardar y el usuario no tiene forma de encontrarlo.
   *
   * Se recomputa cuando cambian `formStatus()` o `formValue()`: la validez de un
   * `FormControl` no es una señal, así que hace falta un disparador explícito.
   */
  readonly sectionErrors = computed<Record<SectionId, number>>(() => {
    this.formStatus();
    this.formValue();
    const backend = this.backendFieldErrors();

    const counts: Record<SectionId, number> = {
      documento: 0,
      adquiriente: 0,
      lineas: 0,
      impuestos: 0,
      aiu: 0,
      retenciones: 0,
      divisa: 0,
      contabilidad: 0,
    };

    for (const section of Object.keys(SECTION_FIELDS) as SectionId[]) {
      for (const field of SECTION_FIELDS[section]) {
        if (field === 'items') continue;
        if (backend[field]) {
          counts[section] += 1;
          continue;
        }
        const control = this.invoiceForm.get(field);
        if (control && control.invalid && control.touched) {
          counts[section] += 1;
        }
      }
    }

    // Las líneas se cuentan aparte: sus errores viven en `items.<i>.<campo>`.
    for (const path of Object.keys(backend)) {
      if (path.startsWith('items.')) {
        counts[path.endsWith('.account_code') ? 'contabilidad' : 'lineas'] += 1;
      }
    }
    for (const group of this.itemControls()) {
      for (const name of ['description', 'quantity', 'unit_price']) {
        const control = group.get(name);
        if (control && control.invalid && control.touched) {
          counts.lineas += 1;
        }
      }
    }
    if (this.isAiu() && this.aiuUnassigned() > 0) {
      counts.aiu += 1;
    }
    return counts;
  });

  /** Lo que falta para poder emitir, en una frase. */
  readonly submitHint = computed(() => {
    if (this.checkingEmitReadiness()) {
      return 'Comprobando si el documento puede emitirse…';
    }
    if (this.createdInvoiceId() !== null) {
      return 'La factura ya se creó. Ciérrala y ábrela desde el listado para corregirla.';
    }
    if (this.mode() === 'from_order') {
      return this.orderIdValue()
        ? 'Se facturará el pedido indicado.'
        : 'Indica el ID del pedido.';
    }
    if (this.itemCount() === 0) return 'Agrega al menos una línea.';
    if (!this.activeResolution()) {
      return 'No hay resolución activa: el servidor rechazará la factura.';
    }
    if (this.isCredit() && !this.rawValue()['due_date']) {
      return 'Venta a crédito: declara la fecha de vencimiento.';
    }
    if (this.formStatus() !== 'VALID') return 'Revisa los campos marcados.';
    return 'Todo listo para emitir.';
  });

  /** Suscripciones que limpian el error del backend cuando el usuario corrige. */
  private backendErrorSubs = new Subscription();
  private erroredControls: { path: string; control: AbstractControl }[] = [];

  constructor() {
    this.currencyService.loadCurrency();
    this.destroyRef.onDestroy(() => this.backendErrorSubs.unsubscribe());

    // EL MODAL ESPERA EL DESENLACE. Sin esto, "cerrar" significaba únicamente
    // "se despachó la acción", que es cierto tanto cuando la factura se creó
    // como cuando el backend la rechazó.
    this.actions$
      .pipe(
        ofType(createInvoiceSuccess, createFromOrderSuccess),
        takeUntilDestroyed(),
      )
      // Las dos acciones declaran `props<{ invoice: Invoice }>()`, así que la
      // factura creada —y con ella su `id`— viaja en el propio desenlace. Es la
      // primera vez que existe un id que consultarle a la puerta de emisión.
      .subscribe(({ invoice }) => this.onCreateSucceeded(invoice));

    this.actions$
      .pipe(ofType(createInvoiceFailure), takeUntilDestroyed())
      .subscribe((failure) => this.onCreateFailed(failure, this.invoiceForm));

    this.actions$
      .pipe(ofType(createFromOrderFailure), takeUntilDestroyed())
      .subscribe((failure) => this.onCreateFailed(failure, null));

    // Búsqueda de clientes. `switchMap` cancela la petición anterior: un
    // tecleo rápido no puede dejar que una respuesta vieja pise a una nueva.
    this.customerSearch$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term) =>
          term.trim().length < 2
            ? of([] as Customer[])
            : this.customersService
                .getCustomers(1, 10, { search: term.trim() })
                .pipe(
                  map((response) => response?.data ?? []),
                  catchError(() => of([] as Customer[])),
                ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((results) => this.customerResults.set(results));
  }

  get itemsArray(): FormArray {
    return this.invoiceForm.get('items') as FormArray;
  }

  get withholdingsArray(): FormArray {
    return this.invoiceForm.get('withholdings') as FormArray;
  }

  // ── Ciclo de vida del modal ─────────────────────────────────

  /** Los catálogos se cargan al ABRIR, no al construir: el modal vive montado. */
  onOpened(): void {
    // Red de seguridad: si el padre bajó `isOpen` sin pasar por `onClose()`, el
    // id del borrador anterior seguiría cerrando el envío para siempre. Abrir
    // es siempre el comienzo de una factura nueva.
    this.createdInvoiceId.set(null);
    this.emitRequirements.set([]);
    this.emitRequirementsOpen.set(false);
    this.checkingEmitReadiness.set(false);

    this.loadTaxCatalog();
    this.loadProducts();
    if (this.itemsArray.length === 0) {
      this.addItem();
    }
  }

  private loadTaxCatalog(): void {
    if (this.taxesLoaded) return;
    this.taxesLoaded = true;
    this.taxCatalog
      .load()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((taxes) => this.availableTaxes.set(taxes));
  }

  private loadProducts(): void {
    if (this.productsLoaded) return;
    this.productsLoaded = true;
    this.productsLoading.set(true);
    this.productsService
      .getProducts({
        limit: 200,
        state: ProductState.ACTIVE,
        is_sellable: true,
      })
      .pipe(
        // Un catálogo que no carga NO tumba el modal: se puede facturar
        // escribiendo la descripción a mano, que es exactamente lo que el
        // backend permite (`product_id` es opcional).
        catchError(() =>
          of({ data: [] } as unknown as PaginatedResponse<Product>),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((response) => {
        this.productsLoading.set(false);
        const products = response?.data ?? [];
        this.productsById.clear();
        for (const product of products) {
          this.productsById.set(product.id, product);
        }
        this.availableProducts.set(
          products.map((product) => ({
            id: product.id,
            name: product.name,
            category: product.category?.name ?? product.categories?.[0]?.name,
            imageUrl: product.image_url,
            isSellable: product.is_sellable,
            isCombo: product.is_combo,
          })),
        );
      });
  }

  // ── Lectura desde la plantilla ──────────────────────────────

  control(name: string): AbstractControl | null {
    return this.invoiceForm.get(name);
  }

  rowUid(item: AbstractControl): string {
    return (item.get('row_uid')?.value as string) ?? '';
  }

  withholdingUid(row: AbstractControl): string {
    return (row.get('row_uid')?.value as string) ?? '';
  }

  /** El control de cuenta de una línea, para enlazarlo fuera de `items`. */
  accountControl(item: AbstractControl): FormControl {
    return item.get('account_code') as FormControl;
  }

  fieldError(path: string): string | undefined {
    return this.backendFieldErrors()[path];
  }

  itemError(index: number, field: string): string | undefined {
    return this.fieldError('items.' + index + '.' + field);
  }

  /**
   * El vencimiento tiene un error propio que NO viene del backend: una venta a
   * crédito sin plazo es una contradicción, y el servidor la rechaza con
   * `SYS_VALIDATION_001` DESPUÉS de haber recorrido medio flujo. Decirlo aquí
   * ahorra el viaje.
   */
  dueDateError(): string | undefined {
    const backend = this.fieldError('due_date');
    if (backend) return backend;
    const control = this.control('due_date');
    if (!this.isCredit() || !control?.touched) return undefined;
    const value = control.value as string;
    if (!value) {
      return 'Una venta a crédito sin plazo no es una omisión: es una contradicción. Declara el vencimiento o cambia la forma de pago a contado.';
    }
    if (value < String(this.rawValue()['issue_date'] ?? '')) {
      return 'El vencimiento no puede ser anterior a la fecha de emisión.';
    }
    return undefined;
  }

  dueDateHelp(): string {
    return this.isCredit()
      ? 'Obligatorio en venta a crédito.'
      : 'En contado vence el mismo día de la emisión.';
  }

  isSectionOpen(section: SectionId): boolean {
    return this.openSections().has(section);
  }

  setSection(section: SectionId, open: boolean): void {
    const next = new Set(this.openSections());
    if (open) next.add(section);
    else next.delete(section);
    this.openSections.set(next);
  }

  modeClass(mode: 'manual' | 'from_order'): string {
    return this.mode() === mode
      ? 'bg-primary text-[var(--color-text-on-primary)] border-primary'
      : 'bg-[var(--color-surface)] text-text-primary border-border';
  }

  productLabel(item: AbstractControl): string {
    const name = item.get('product_name')?.value as string;
    return name || 'Vincular producto';
  }

  lineLabel(index: number): string {
    const item = this.itemsValue()[index];
    const description = (item?.description ?? '').trim();
    return description || 'Línea ' + (index + 1);
  }

  lineSummary(index: number): string {
    const math = this.lineMath()[index];
    if (!math) return '';
    return this.formatCurrency(math.total);
  }

  withholdingRowAmount(index: number): number {
    const row = this.withholdingsValue()[index];
    return row ? rowWithholding(row) : 0;
  }

  hasResponsibility(code: string): boolean {
    return this.responsibilitiesValue().includes(code);
  }

  customerDisplayName(customer: Customer): string {
    return (
      customer.legal_name ||
      [customer.first_name, customer.last_name].filter(Boolean).join(' ') ||
      customer.email ||
      'Cliente #' + customer.id
    );
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(value || 0);
  }

  // ── Edición ─────────────────────────────────────────────────

  setMode(mode: 'manual' | 'from_order'): void {
    if (this.submitting()) return;
    this.mode.set(mode);
    this.clearSubmitError();
  }

  onInvoiceTypeChange(): void {
    // El banner depende del tipo: cambiarlo cambia la resolución que se va a
    // consumir, y eso el usuario tiene que verlo antes de emitir.
    this.clearSubmitError();
  }

  onOperationTypeChange(): void {
    if (this.isAiu()) {
      this.setSection('aiu', true);
    } else {
      // Fuera de AIU el componente no aplica: dejarlo puesto mandaría un campo
      // que el backend sólo entiende con `operation_type = '09'`.
      for (const group of this.itemControls()) {
        group.get('aiu_component')?.setValue('', { emitEvent: false });
      }
      this.itemsArray.updateValueAndValidity();
    }
  }

  onPaymentFormChange(): void {
    this.syncDueDate();
  }

  /**
   * El vencimiento en contado NO es un campo vacío: es la fecha de emisión.
   *
   * En contado el control se deshabilita y se muestra igualado a la emisión —
   * que es literalmente lo que el backend persiste (`resolveDueDate` devuelve
   * `issue_date` cuando no hay plazo). En crédito se habilita y pasa a ser
   * obligatorio.
   */
  syncDueDate(): void {
    const control = this.control('due_date');
    if (!control) return;
    const issueDate = String(this.invoiceForm.get('issue_date')?.value ?? '');

    if (this.invoiceForm.get('payment_form')?.value === PAYMENT_FORM_CREDIT) {
      control.setValidators([Validators.required]);
      if (control.disabled) {
        control.enable({ emitEvent: false });
        control.setValue('', { emitEvent: false });
      }
    } else {
      control.clearValidators();
      control.setValue(issueDate, { emitEvent: false });
      if (control.enabled) {
        control.disable({ emitEvent: false });
      }
    }
    control.updateValueAndValidity();
  }

  addItem(): void {
    if (this.itemsArray.length >= 100) return;
    this.nextRowUid += 1;
    this.itemsArray.push(
      this.fb.group({
        row_uid: ['row-' + this.nextRowUid],
        product_id: [null],
        product_name: [''],
        description: ['', [Validators.required]],
        // `@Min(0.0001)` en el backend: la columna es `Decimal(12,4)` y un cero
        // colado produce una línea con base gravable cero que nadie puede
        // cobrar y que la DIAN acepta igual.
        quantity: [1, [Validators.required, Validators.min(0.0001)]],
        unit_code: [UNIT_CODE_DEFAULT],
        unit_price: [0, [Validators.required, Validators.min(0)]],
        discount_amount: [0, [Validators.min(0)]],
        taxes: [[] as TaxSelection[]],
        account_code: [''],
        aiu_component: [''],
      }),
    );
  }

  removeItem(index: number): void {
    this.itemsArray.removeAt(index);
  }

  addWithholding(): void {
    this.nextWithholdingUid += 1;
    this.withholdingsArray.push(
      this.fb.group({
        row_uid: ['wh-' + this.nextWithholdingUid],
        concept: [''],
        rate: [0],
        // La base por defecto es la base gravable del documento, que es sobre
        // lo que se retiene en la práctica. Editable porque hay conceptos que
        // retienen sobre otra base.
        base: [Math.round(this.totals().base)],
      }),
    );
  }

  removeWithholding(index: number): void {
    this.withholdingsArray.removeAt(index);
  }

  toggleResponsibility(code: string): void {
    const control = this.invoiceForm.get('customer_fiscal_responsibilities');
    if (!control) return;
    const current = this.responsibilitiesValue();
    const next = current.includes(code)
      ? current.filter((entry) => entry !== code)
      : [...current, code];
    control.setValue(next);
    control.markAsTouched();
  }

  applyDefaultAccountCode(): void {
    const code = String(
      this.invoiceForm.get('default_account_code')?.value ?? '',
    ).trim();
    for (const group of this.itemControls()) {
      group.get('account_code')?.setValue(code, { emitEvent: false });
    }
    this.itemsArray.updateValueAndValidity();
  }

  // ── Clientes ────────────────────────────────────────────────

  onCustomerQuery(event: Event): void {
    const term = (event.target as HTMLInputElement).value;
    this.customerQuery.set(term);
    this.customerSearch$.next(term);
  }

  /**
   * Vincular a un cliente existente rellena TODA la identidad fiscal, no sólo
   * el nombre. El `document_type` del cliente es la sigla interna (`CC`,
   * `NIT`); el contrato de la factura quiere el CÓDIGO DIAN, y confundirlos le
   * amputa el dígito de verificación a una cédula (`dianPartyId()` recorta el
   * último dígito sólo cuando el tipo es NIT).
   */
  selectCustomer(customer: Customer): void {
    const address = customer.addresses?.[0];
    this.invoiceForm.patchValue({
      customer_id: customer.id,
      customer_name: this.customerDisplayName(customer),
      customer_document_type:
        getDianSchemeIdForDocumentType(customer.document_type) ||
        DOCUMENT_TYPE_NIT_CODE,
      customer_tax_id: customer.document_number ?? '',
      customer_verification_digit: customer.verification_digit ?? '',
      customer_tax_regime: customer.tax_regime ?? '',
      customer_fiscal_responsibilities: customer.fiscal_responsibilities ?? [],
      customer_email: customer.email ?? '',
      customer_phone: customer.phone ?? '',
      customer_address: address
        ? [address.address_line1, address.city, address.state_province]
            .filter(Boolean)
            .join(', ')
        : '',
    });
    this.inlineCustomer.set(null);
    this.linkedCustomerLabel.set(this.customerDisplayName(customer));
    this.customerResults.set([]);
    this.customerQuery.set('');
  }

  unlinkCustomer(): void {
    this.invoiceForm.get('customer_id')?.setValue(null);
    this.inlineCustomer.set(null);
    this.linkedCustomerLabel.set(null);
  }

  openCustomerCreate(): void {
    this.customerModalOpen.set(true);
  }

  /**
   * El modal de clientes emite el `CreateCustomerRequest` completo (espejo de
   * `CreateCustomerDto`). Viaja tal cual como `inline_customer`: el backend
   * materializa la fila `users` DENTRO de la misma transacción de la factura y
   * usa el `customer_id` resultante. Los campos de cabecera se rellenan además
   * para que el usuario vea a quién le está facturando.
   */
  onCustomerCreated(payload: CreateCustomerRequest): void {
    this.customerModalOpen.set(false);
    if (!payload) return;

    const name =
      payload.legal_name ||
      [payload.first_name, payload.last_name].filter(Boolean).join(' ');

    this.invoiceForm.patchValue({
      customer_id: null,
      customer_name: name,
      customer_document_type:
        getDianSchemeIdForDocumentType(payload.document_type) ||
        DOCUMENT_TYPE_NIT_CODE,
      customer_tax_id: payload.document_number ?? '',
      customer_verification_digit: payload.verification_digit ?? '',
      customer_tax_regime: payload.tax_regime ?? '',
      customer_fiscal_responsibilities: payload.fiscal_responsibilities ?? [],
      customer_email: payload.email ?? '',
      customer_phone: payload.phone ?? '',
    });
    this.inlineCustomer.set(payload);
    this.linkedCustomerLabel.set(name ? name + ' (se creará al emitir)' : null);
  }

  // ── Productos ───────────────────────────────────────────────

  openProductPicker(item: AbstractControl): void {
    this.pickerTargetUid.set(this.rowUid(item));
    this.productPickerOpen.set(true);
  }

  onProductPicked(productId: number | null): void {
    const uid = this.pickerTargetUid();
    this.productPickerOpen.set(false);
    this.pickerTargetUid.set(null);
    if (uid == null || productId == null) return;

    const group = this.itemControls().find((item) => this.rowUid(item) === uid);
    if (!group) return;

    const product = this.productsById.get(productId);
    const patch: Record<string, unknown> = {
      product_id: productId,
      product_name: product?.name ?? 'Producto #' + productId,
    };
    if (product) {
      // La descripción sólo se pisa si el usuario no escribió una: la suya
      // manda, porque es la que la DIAN publica en `cbc:Description`.
      if (!String(group.get('description')?.value ?? '').trim()) {
        patch['description'] = product.name;
      }
      // `base_price` y NO `final_price`: `final_price` ya lleva impuesto dentro
      // y el precio unitario que se captura es la base. Mandar el precio con
      // impuesto y además declarar el impuesto como adicional lo cobraría dos
      // veces.
      if (!Number(group.get('unit_price')?.value)) {
        patch['unit_price'] = Number(product.base_price) || 0;
      }
    }
    group.patchValue(patch);
  }

  onCreateProductRequested(): void {
    // El backend acepta `inline_product` en el DTO pero lo rechaza en runtime a
    // propósito (`ProductsService.create` no es transaccional todavía). Decirlo
    // aquí evita que el usuario descubra el límite con un 400.
    this.productPickerOpen.set(false);
    this.toastService.info(
      'La creación de productos desde la factura todavía no está disponible. Créalo en el módulo de Productos y vuelve a abrir el selector.',
      undefined,
      5000,
    );
  }

  // ── Envío ───────────────────────────────────────────────────

  onSubmit(): void {
    if (this.submitting()) return;

    // El borrador de esta sesión YA existe: el modal sigue abierto sólo porque
    // la puerta de emisión encontró algo que enseñar sobre él. Volver a pulsar
    // no corrige nada — crea una factura gemela y quema un segundo consecutivo
    // autorizado, que es exactamente lo que esta pantalla existe para evitar.
    if (this.createdInvoiceId() !== null) {
      this.toastService.info(
        'Esta factura ya se creó. Ciérrala y ábrela desde el listado para corregirla antes de validarla.',
        undefined,
        5000,
      );
      return;
    }

    this.clearSubmitError();

    if (this.mode() === 'from_order') {
      const orderId = this.orderIdControl.value;
      if (!orderId) {
        this.orderIdControl.markAsTouched();
        return;
      }
      this.submitting.set(true);
      this.store.dispatch(createFromOrder({ orderId: Number(orderId) }));
      return;
    }

    // El vencimiento se recalcula ANTES de validar: si el usuario cambió la
    // forma de pago sin tocar el campo, lo que se ve y lo que se envía tienen
    // que seguir siendo la misma cosa.
    this.syncDueDate();
    this.invoiceForm.markAllAsTouched();

    const blockers = this.collectBlockers();
    if (blockers.length > 0) {
      this.submitError.set(
        'La factura no se envió: hay datos que la DIAN rechazaría y el consecutivo autorizado no se recupera.',
      );
      this.submitErrorDetails.set(blockers);
      this.expandSectionsWithErrors();
      return;
    }

    this.submitting.set(true);
    this.store.dispatch(createInvoice({ invoice: this.buildPayload() }));
  }

  /**
   * TODO lo que impide emitir, en una sola pasada.
   *
   * Se enumera en vez de deshabilitar el botón: un botón apagado sin explicación
   * es un callejón sin salida, y con ocho secciones plegables el campo culpable
   * puede estar fuera de la vista.
   */
  private collectBlockers(): string[] {
    const blockers: string[] = [];
    const raw = this.rawValue();

    if (!raw['customer_name']) {
      blockers.push('El adquiriente necesita nombre o razón social.');
    }
    if (this.itemsArray.length === 0) {
      blockers.push('La factura necesita al menos una línea.');
    }
    if (!this.activeResolution()) {
      blockers.push(
        'No hay resolución activa para ' +
          this.documentLabel().toLowerCase() +
          '. El servidor no tendría de dónde tomar el consecutivo.',
      );
    }
    if (this.isCredit() && !raw['due_date']) {
      blockers.push(
        'La venta es a crédito y no tiene fecha de vencimiento. Declara el plazo o cámbiala a contado.',
      );
    }
    if (
      this.isCredit() &&
      raw['due_date'] &&
      String(raw['due_date']) < String(raw['issue_date'])
    ) {
      blockers.push(
        'El vencimiento es anterior a la fecha de emisión. Corrige una de las dos.',
      );
    }
    if (this.isAiu() && this.aiuUnassigned() > 0) {
      blockers.push(
        'La operación es AIU (09) y hay líneas sin componente. La DIAN valida la coherencia entre el CustomizationID y el desglose de las líneas.',
      );
    }
    if (this.usesForeignCurrency()) {
      if (!raw['foreign_currency']) {
        blockers.push('Declaraste conversión a divisa pero no elegiste cuál.');
      }
      if (!(Number(raw['exchange_rate']) > 0)) {
        blockers.push(
          'La conversión a divisa necesita la tasa del día (pesos por unidad de divisa).',
        );
      }
    }

    this.itemControls().forEach((group, index) => {
      const label = this.lineLabel(index);
      if (!String(group.get('description')?.value ?? '').trim()) {
        blockers.push(
          label +
            ': falta la descripción. Es lo único que el adquiriente lee en el documento.',
        );
      }
      if (!(Number(group.get('quantity')?.value) >= 0.0001)) {
        blockers.push(label + ': la cantidad debe ser mayor que cero.');
      }
      if (Number(group.get('unit_price')?.value) < 0) {
        blockers.push(label + ': el precio unitario no puede ser negativo.');
      }
      if (Number(group.get('discount_amount')?.value) < 0) {
        blockers.push(label + ': el descuento no puede ser negativo.');
      }
    });

    const email = String(raw['customer_email'] ?? '').trim();
    if (email && this.invoiceForm.get('customer_email')?.hasError('email')) {
      blockers.push(
        'El correo del adquiriente no es válido. Es la dirección a la que se entrega la factura electrónica.',
      );
    }

    return blockers;
  }

  /** Abre toda sección que tenga algo mal, para que el error sea alcanzable. */
  private expandSectionsWithErrors(): void {
    const errors = this.sectionErrors();
    const next = new Set(this.openSections());
    for (const section of Object.keys(errors) as SectionId[]) {
      if (errors[section] > 0) next.add(section);
    }
    this.openSections.set(next);
  }

  /**
   * Payload EXACTO del contrato. Todo lo que no está en `CreateInvoiceDto` se
   * queda fuera: `row_uid`, `product_name`, `manual_withholding`,
   * `use_foreign_currency`, `withholdings[]` y `default_account_code` son estado
   * de esta pantalla, y mandarlos devolvería un 400 por `forbidNonWhitelisted`
   * nombrando campos que el usuario nunca vio.
   *
   * `resolution_id` tampoco viaja: el backend elige la resolución por tipo de
   * documento y esta pantalla ya no ofrece contradecirlo.
   *
   * `currency` tampoco: el backend lo fija en COP y declararlo aquí crearía una
   * segunda representación del mismo valor legal.
   */
  private buildPayload(): CreateInvoiceDto {
    const raw = this.rawValue();
    const math = this.lineMath();

    const items: InvoiceCreateItemPayload[] = (
      raw['items'] as InvoiceItemFormValue[]
    ).map((item, index) => {
      const quantity = Number(item.quantity) || 0;
      const unitPrice = Number(item.unit_price) || 0;
      const discount = Number(item.discount_amount) || 0;
      const base = math[index]?.base ?? 0;
      const taxes = Array.isArray(item.taxes) ? item.taxes : [];

      const payload: InvoiceCreateItemPayload = {
        description: String(item.description ?? '').trim(),
        quantity,
        unit_price: unitPrice,
      };
      if (item.product_id) payload.product_id = Number(item.product_id);
      if (discount > 0) payload.discount_amount = discount;
      if (item.unit_code) payload.unit_code = item.unit_code;
      const accountCode = String(item.account_code ?? '').trim();
      if (accountCode) payload.account_code = accountCode;
      if (this.isAiu() && item.aiu_component) {
        payload.aiu_component = item.aiu_component as
          | 'administracion'
          | 'imprevistos'
          | 'utilidad';
      }
      if (taxes.length > 0) {
        payload.taxes = taxes.map((tax) => ({
          tax_rate_id: tax.tax_rate_id,
          tax_name: tax.name,
          tax_rate: Number(tax.rate) || 0,
          taxable_amount: round2(base),
          // CERO A PROPÓSITO. El backend recalcula toda la aritmética con
          // `Prisma.Decimal` y su resultado manda. El único caso que rechaza
          // (`INVOICING_CALC_001`) es un importe distinto de cero SIN tarifa de
          // la que derivarlo, y acá siempre viaja la tarifa.
          tax_amount: 0,
          tax_type: safeTaxType(tax.tax_type),
          is_inclusive: tax.is_inclusive,
        }));
      }
      // `is_inclusive` de línea se OMITE a propósito: el backend lo deriva del
      // primer impuesto de la línea, y declararlo aquí crearía una segunda
      // fuente que puede contradecir a la primera cuando la línea lleva un
      // impuesto incluido y otro adicional.
      return payload;
    });

    const invoiceType = raw['invoice_type'] as 'sales_invoice' | 'export_invoice';
    const payload: InvoiceCreatePayload = {
      invoice_type: invoiceType,
      issue_date: String(raw['issue_date']),
      items,
    };

    // ── Documento
    if (raw['due_date']) payload.due_date = String(raw['due_date']);
    if (raw['payment_form']) payload.payment_form = String(raw['payment_form']);
    if (raw['payment_means_code']) {
      payload.payment_means_code = String(raw['payment_means_code']);
    }
    if (raw['operation_type']) {
      payload.operation_type = String(raw['operation_type']);
    }
    const notes = String(raw['notes'] ?? '').trim();
    if (notes) payload.notes = notes;

    // ── Adquiriente
    if (raw['customer_id']) payload.customer_id = Number(raw['customer_id']);
    const inline = this.inlineCustomer();
    if (!raw['customer_id'] && inline) {
      // `inline_customer` sólo se manda cuando NO hay `customer_id`: el backend
      // lo ignora si ambos vienen, y mandar los dos esconde cuál mandó.
      payload.inline_customer = inline;
    }
    const name = String(raw['customer_name'] ?? '').trim();
    if (name) payload.customer_name = name;
    const taxId = String(raw['customer_tax_id'] ?? '').trim();
    if (taxId) payload.customer_tax_id = taxId;
    const email = String(raw['customer_email'] ?? '').trim();
    if (email) payload.customer_email = email;
    const phone = String(raw['customer_phone'] ?? '').trim();
    if (phone) payload.customer_phone = phone;
    if (raw['customer_document_type']) {
      payload.customer_document_type = String(raw['customer_document_type']);
    }
    // El DV sólo tiene sentido en NIT; en cualquier otro tipo es un dígito
    // suelto que el backend valida igual y que no significa nada.
    const dv = String(raw['customer_verification_digit'] ?? '').trim();
    if (dv && this.isNitCustomer()) payload.customer_verification_digit = dv;
    const regime = String(raw['customer_tax_regime'] ?? '').trim();
    if (regime) payload.customer_tax_regime = regime;
    const responsibilities = this.responsibilitiesValue();
    if (responsibilities.length > 0) {
      payload.customer_fiscal_responsibilities = responsibilities;
    }
    const address = String(raw['customer_address'] ?? '').trim();
    if (address) payload.customer_address = address;

    // ── Retenciones
    const withholding = round2(this.effectiveWithholding());
    if (withholding > 0) payload.withholding_amount = withholding;

    // Si el comerciante DESGLOSÓ cada retención (no sólo el agregado), el
    // backend valida y persiste fila a fila. Vacío u omitido ≡ sólo el
    // agregado: la validación automática del tenant al ACEPTAR cubre ese caso.
    const withheldRows = this.withholdingsValue()
      .filter(
        (row) =>
          row.role &&
          row.concept_id != null &&
          Number(row.base_amount) > 0 &&
          Number(row.rate) >= 0,
      )
      .map((row) => ({
        role: row.role,
        concept_id: Number(row.concept_id),
        base_amount: Number(row.base_amount),
        rate: Number(row.rate),
        amount:
          row.amount != null && Number(row.amount) >= 0
            ? Number(row.amount)
            : undefined,
      }));
    if (withheldRows.length > 0) {
      payload.withholdings = withheldRows;
    }

    // ── Divisa
    if (this.usesForeignCurrency()) {
      const currency = String(raw['foreign_currency'] ?? '').trim();
      const rate = Number(raw['exchange_rate']);
      if (currency) payload.foreign_currency = currency;
      if (Number.isFinite(rate) && rate > 0) {
        payload.exchange_rate = rate;
        const foreignTotal = this.foreignTotal();
        if (foreignTotal != null) {
          payload.foreign_total_amount = round2(foreignTotal);
        }
      }
      const rateDate = String(raw['exchange_rate_date'] ?? '').trim();
      if (rateDate) payload.exchange_rate_date = rateDate;
    }

    return payload;
  }

  /**
   * La factura existe. ANTES DE CERRAR se le pregunta al backend qué le falta
   * para poder emitirse.
   *
   * Por qué acá y no antes: `emit-readiness` juzga un documento persistido, y
   * hasta este instante no había ninguno. Por qué acá y no en «Validar»: para
   * cuando el usuario pulsa Validar, el consecutivo autorizado ya está en juego
   * — y un rechazo de la DIAN lo quema sin devolución.
   */
  private onCreateSucceeded(invoice: Invoice | null | undefined): void {
    if (!this.submitting()) return;
    this.submitting.set(false);
    this.clearSubmitError();

    const invoiceId = Number(invoice?.id);
    if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
      // Sin id no hay puerta que consultar. Se conserva EXACTAMENTE el cierre
      // de siempre: esta puerta es asesora y no puede dejar el modal colgado.
      this.finishAndClose();
      return;
    }

    this.createdInvoiceId.set(invoiceId);
    this.checkingEmitReadiness.set(true);

    // `check()` NUNCA lanza y puede completar SIN emitir (red caída, 403, cuerpo
    // irreconocible). Por eso el desenlace se decide en `complete` y no en
    // `next`: si no hubo veredicto, la pantalla se comporta igual que antes de
    // que esta puerta existiera.
    let blocked = false;
    this.emitReadinessService
      .check(invoiceId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (readiness) => {
          blocked = this.presentEmitReadiness(readiness);
        },
        complete: () => {
          this.checkingEmitReadiness.set(false);
          if (!blocked) this.finishAndClose();
        },
      });
  }

  /**
   * Abre el modal de requisitos si el documento NO puede emitirse. Devuelve
   * `true` cuando lo abrió, que es la señal para dejar el formulario en pie.
   *
   * `fiscal_document === null` no entra por acá como problema: significa que el
   * tipo de documento no viaja a la DIAN, así que no hay nada que prevalidar y
   * `toEmitRequirements` no produce ni una fila por ese motivo.
   */
  private presentEmitReadiness(readiness: InvoiceEmitReadiness): boolean {
    if (readiness.emittable) return false;

    const rows = toEmitRequirements(readiness);
    if (rows.length === 0) {
      // Veredicto negativo sin un solo hallazgo que mostrar. Abrir un modal
      // vacío culparía al usuario de algo que nadie sabe nombrar.
      return false;
    }

    this.emitRequirements.set(rows);
    this.emitRequirementsOpen.set(true);

    // Se abren de una vez las secciones dueñas de cada requisito: al cerrar el
    // modal el usuario tiene que caer sobre los campos señalados y no sobre un
    // acordeón plegado que los esconde.
    for (const row of rows) {
      const action = row.action;
      if (action?.target && action.kind !== 'navigate') {
        this.setSection(this.sectionOfTarget(action.target), true);
      }
    }
    return true;
  }

  /** Cierre limpio: el borrador ya no se puede tocar desde este formulario. */
  private finishAndClose(): void {
    this.resetForm();
    this.createdInvoiceId.set(null);
    this.isOpen.set(false);
  }

  /**
   * CTA de una fila de requisitos.
   *
   * `navigate` lleva a la pantalla donde vive el arreglo (Resoluciones);
   * `focus`/`scroll` abren la sección plegada dueña del campo y lo traen a la
   * vista. El mapa sólo emite acciones cuyo destino existe de verdad, así que
   * acá no hace falta adivinar nada.
   */
  onEmitRequirementAction(requirement: SaveRequirement): void {
    const action = requirement.action;
    this.emitRequirementsOpen.set(false);
    if (!action?.target) return;

    if (action.kind === 'navigate') {
      void this.router.navigateByUrl(action.target);
      return;
    }

    this.revealFormTarget(action.target);
  }

  /**
   * Trae a la vista el control que nombra un requisito.
   *
   * `target` llega en una de dos formas: el control name de cabecera
   * (`customer_email`) o la ruta de línea `items.<i>.<control>` — la MISMA
   * convención que ya usa `itemError()`, para no inventar un segundo formato.
   *
   * Primero se abre la sección dueña del campo: con ocho secciones plegables,
   * desplazarse hasta un nodo que está dentro de un acordeón cerrado no
   * enseña nada. El acceso al DOM va en el siguiente frame porque el nodo no
   * existe hasta que Angular repinta la sección recién abierta.
   */
  private revealFormTarget(target: string): void {
    const line = /^items\.(\d+)\.(.+)$/.exec(target);
    const controlName = line ? line[2] : target;
    const lineIndex = line ? Number(line[1]) : 0;

    this.setSection(this.sectionOfTarget(target), true);

    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }
    window.requestAnimationFrame(() => {
      // `formControlName` y `formArrayName` son atributos estáticos de la
      // plantilla, así que llegan al DOM en minúsculas y se pueden consultar.
      const nodes = document.querySelectorAll<HTMLElement>(
        `[formcontrolname="${controlName}"], [formarrayname="${controlName}"], #${controlName}`,
      );
      // Los campos de línea repiten el mismo `formControlName` en cada fila: el
      // índice del hallazgo es lo que distingue la línea 3 de la primera.
      const node = nodes[line ? lineIndex : 0] ?? nodes[0];
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      node?.focus?.();
    });
  }

  /** Qué sección plegable es dueña de un destino de requisito. */
  private sectionOfTarget(target: string): SectionId {
    if (target === 'items' || target.startsWith('items.')) return 'lineas';
    if (target === 'taxes_section') return 'impuestos';
    for (const section of Object.keys(SECTION_FIELDS) as SectionId[]) {
      if (SECTION_FIELDS[section].includes(target)) return section;
    }
    return 'documento';
  }

  /**
   * El backend rechazó la factura: el modal SIGUE ABIERTO, con el motivo a la
   * vista y sin tocar una sola línea de lo que el usuario escribió. Perder
   * veinte líneas por un 400 es inaceptable.
   *
   * Cuando el rechazo es del `ValidationPipe` (`SYS_VALIDATION_001`), cada
   * mensaje se pone sobre su `FormControl` para que el usuario vea QUÉ campo
   * está mal EN el campo, y no en un toast genérico. El toast lo emite el
   * effect; aquí no se duplica.
   */
  private onCreateFailed(
    failure: MutationFailure,
    form: FormGroup | null,
  ): void {
    if (!this.submitting()) return;
    this.submitting.set(false);
    this.submitError.set(failure.error);

    if (failure.errorCode !== 'SYS_VALIDATION_001' || !form) {
      this.submitErrorDetails.set([]);
      return;
    }

    const applied = applyBackendValidationErrors(form, failure.details);
    this.backendFieldErrors.set(applied.fieldErrors);
    this.submitErrorDetails.set(applied.unmatched);
    this.erroredControls = applied.touchedControls;
    this.watchForCorrection(applied.touchedControls);
    this.expandSectionsWithErrors();
  }

  /**
   * Un error del backend en un control lo deja inválido. Se limpia en cuanto el
   * usuario toca ese campo — si no, el formulario quedaría marcado para siempre
   * sobre un dato que ya se corrigió.
   */
  private watchForCorrection(
    controls: { path: string; control: AbstractControl }[],
  ): void {
    for (const { path, control } of controls) {
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
    this.itemsArray.clear();
    this.withholdingsArray.clear();
    this.invoiceForm.reset({
      invoice_type: 'sales_invoice',
      issue_date: toLocalDateString(),
      due_date: toLocalDateString(),
      payment_form: PAYMENT_FORM_CASH,
      payment_means_code: '10',
      operation_type: OPERATION_TYPE_STANDARD,
      notes: '',
      customer_id: null,
      customer_name: '',
      customer_document_type: DOCUMENT_TYPE_NIT_CODE,
      customer_tax_id: '',
      customer_verification_digit: '',
      customer_tax_regime: '',
      customer_fiscal_responsibilities: [],
      customer_email: '',
      customer_phone: '',
      customer_address: '',
      manual_withholding: false,
      withholding_amount: 0,
      use_foreign_currency: false,
      foreign_currency: '',
      exchange_rate: null,
      exchange_rate_date: '',
      default_account_code: '',
    });
    this.syncDueDate();
    this.orderIdControl.reset();
    this.mode.set('manual');
    this.pickerTargetUid.set(null);
    this.inlineCustomer.set(null);
    this.linkedCustomerLabel.set(null);
    this.customerQuery.set('');
    this.customerResults.set([]);
    this.openSections.set(
      new Set<SectionId>(['documento', 'adquiriente', 'lineas']),
    );
  }

  onClose(): void {
    if (this.submitting()) return;
    this.clearSubmitError();

    // Si el borrador ya existe, cerrar TIENE que limpiar: el formulario dejó de
    // describir algo editable, y reabrirlo con esos datos invitaría a crear la
    // misma factura dos veces.
    if (this.createdInvoiceId() !== null) {
      this.finishAndClose();
      return;
    }
    this.isOpen.set(false);
  }
}

/** Importe retenido de una fila: `base × tarifa`, nunca negativo. */
function rowWithholding(row: WithholdingRowValue): number {
  const rate = Number(row?.rate) || 0;
  const base = Number(row?.base) || 0;
  if (rate <= 0 || base <= 0) return 0;
  return (base * rate) / 100;
}

/** Dos decimales. Evita que el artefacto de coma flotante viaje al backend. */
function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}
