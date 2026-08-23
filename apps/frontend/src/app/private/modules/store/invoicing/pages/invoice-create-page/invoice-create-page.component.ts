import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
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
  loadResolutions,
} from '../../state/actions/invoicing.actions';
import { selectActiveResolutions } from '../../state/selectors/invoicing.selectors';
import {
  applyBackendValidationErrors,
  clearBackendError,
  extractValidationMessages,
} from '../../utils/invoicing-errors.util';
import {
  InvoiceLineMath,
  computeLineMath,
  lineDiscountExceedsSubtotal,
} from '../../utils/invoice-line-math';
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
import { isHabilitationNumbering } from '../../../../../../shared/utils/habilitation-numbering.util';

import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/selector/selector.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { ToggleComponent } from '../../../../../../shared/components/toggle/toggle.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  TaxOption,
  TaxSelection,
} from '../../../../../../shared/components/tax-selector';
import {
  DialogService,
  SaveRequirement,
  SaveRequirementsModalComponent,
  StickyHeaderActionButton,
  StickyHeaderComponent,
} from '../../../../../../shared/components/index';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import {
  formatDateOnlyUTC,
  toLocalDateString,
} from '../../../../../../shared/utils/date.util';
import {
  computeNitDv,
  isValidNitDv,
} from '../../../../../../shared/utils/nit.util';
import {
  FISCAL_RESPONSIBILITIES,
  FISCAL_RESPONSIBILITY_LABELS,
} from '../../../../../../shared/constants/fiscal-responsibilities.constants';
import { getDianSchemeIdForDocumentType } from '../../../../../../shared/constants/dian-document-types.constants';

import { CustomerModalComponent } from '../../../customers/components/customer-modal/customer-modal.component';
import { CustomersService } from '../../../customers/services/customers.service';
import { Customer } from '../../../customers/models/customer.model';

import { InvoiceProductOption } from '../../services/invoice-product-lookup.service';

// Los satélites de la captura (secciones, banner, sub-modales y catálogos)
// siguen viviendo en `components/invoice-create/`: son piezas del formulario,
// no de la página, y el POS u otra superficie podría montarlas sin esta vista.
import { InvoiceFormSectionComponent } from '../../components/invoice-create/invoice-form-section.component';
import { InvoiceResolutionBannerComponent } from '../../components/invoice-create/invoice-resolution-banner.component';
import { InvoiceLineTaxesComponent } from '../../components/invoice-create/invoice-line-taxes.component';
import { InvoiceItemPickerModalComponent } from '../../components/invoice-create/invoice-item-picker-modal.component';
import {
  InvoiceCustomItemDraft,
  InvoiceCustomItemModalComponent,
} from '../../components/invoice-create/invoice-custom-item-modal.component';
import { InvoiceOrderSelectComponent } from '../../components/invoice-create/invoice-order-select.component';
import { InvoiceTaxCatalogService } from '../../components/invoice-create/invoice-tax-catalog.service';
import {
  InvoiceAiuSettings,
  InvoiceAiuSettingsService,
} from '../../components/invoice-create/invoice-aiu-settings.service';
import {
  InvoiceWithholdingCatalogService,
  WithholdingConceptOption,
} from '../../components/invoice-create/invoice-withholding-catalog.service';
import {
  ExchangeRateQuote,
  ExchangeRateService,
} from '../../services/exchange-rate.service';
import {
  InvoiceProfileCatalogEntry,
  InvoiceProfileService,
} from '../../services/invoice-profile.service';
import type { ProfileAiuConfig } from '../../../../../../core/utils/invoice-profile-config.contract';
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
} from '../../components/invoice-create/invoice-dian-catalogs';

/**
 * Centinela de «sin perfil» del selector, o sea el flujo manual.
 *
 * Es `0` y no `null` porque `SelectorOption.value` sólo admite `string | number`:
 * sin un valor representable, la opción «configuración de la tienda» no podría
 * existir y el usuario no tendría manera de VOLVER al flujo manual después de
 * elegir un perfil — la preselección del predeterminado se volvería una
 * restricción, que es justo lo que ADR-9 descarta.
 *
 * Nunca sale en el payload: `buildPayload` manda `profile_id` sólo cuando hay un
 * perfil real del catálogo, y el `@Min(1)` del backend rechazaría el `0`.
 */
const PROFILE_NONE = 0;

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
  /**
   * Rango de numeración con el que se emite ESTE documento.
   *
   * Vuelve a viajar desde que la pantalla ofrece elegirlo. Omitirlo sigue siendo
   * válido —el backend cae a su propia búsqueda por tipo de documento—, pero la
   * vista siempre manda uno explícito para que lo numerado coincida con lo que
   * el usuario leyó en el banner antes de emitir.
   */
  resolution_id?: number;
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
  /**
   * Retenciones DECLARADAS explícitamente por el cliente al crear la factura.
   * Vacío u omitido ⇒ sólo el agregado (`withholding_amount`) y el cálculo
   * automático del tenant al aceptar.
   */
  withholdings?: InvoiceWithholdingInput[];
  payment_form?: string;
  payment_means_code?: string;
  operation_type?: string;
  /**
   * Objeto del contrato AIU de ESTE documento (regla CAV03).
   *
   * Omitido ⇒ el backend hereda el de `store_settings.invoicing.aiu`. Se manda
   * sólo cuando el usuario lo escribió, nunca vacío: una cadena vacía persiste
   * un override y rompe la herencia.
   */
  aiu_contract_object?: string;
  /**
   * Perfil de facturación con el que se timbra ESTE documento.
   *
   * Omitido ⇒ flujo manual: el backend resuelve el AIU desde
   * `store_settings.invoicing.aiu`, igual que antes de que existieran los
   * perfiles. Presente ⇒ congela `(profile_id, profile_version)` en la factura y
   * deriva la base gravable de esa versión, sin leer el setting ni como
   * respaldo.
   *
   * Viaja SÓLO si el perfil está en el catálogo activo del tipo de operación
   * vigente. Mandar uno de otro tipo devolvería 409 `INVOICING_PROFILE_008`
   * nombrando un campo que el usuario ya no ve en pantalla, y mandar el
   * centinela `0` un 400 por `@Min(1)`.
   */
  profile_id?: number;
  foreign_currency?: string;
  foreign_total_amount?: number;
  exchange_rate?: number;
  exchange_rate_date?: string;
  notes?: string;
  items: InvoiceCreateItemPayload[];
}

interface InvoiceWithholdingInput {
  role: 'practiced' | 'suffered';
  concept_id: number;
  base_amount: number;
  rate: number;
  amount?: number;
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
    /** Ausente cuando el impuesto elegido no tiene fila real en `tax_rates`. */
    tax_rate_id?: number;
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

/** Una retención declarada en la sección de retenciones (sólo UI). */
interface WithholdingRowValue {
  /** Nombre visible del concepto. Etiqueta: NO viaja al backend. */
  concept: string;
  /**
   * `id` de `withholding_concepts`. Es el campo que el backend exige
   * (`InvoiceWithholdingInputDto.concept_id`); una fila sin él se descarta del
   * payload porque no hay forma de resolver su tipo ni su cuenta PUC.
   */
  concept_id: number | null;
  /** 'practiced' (la tienda retiene) | 'suffered' (a la tienda le retienen). */
  role: 'practiced' | 'suffered';
  /**
   * Tarifa en PORCENTAJE (2.5 = 2,5 %), que es como la teclea el contador.
   * El backend la espera en fracción; se convierte al armar el payload.
   */
  rate: number | string;
  base: number | string;
}

/**
 * Las DOS anchuras de clave técnica que emite la DIAN, ambas hex de un hash:
 * 40 (SHA-1, la del Anexo Técnico 1.9 §11.2 y la de habilitación) y 64
 * (SHA-256, la que devolvió `GetNumberingRange` el 16/08/2026 para la
 * resolución de producción 18764113258848).
 *
 * Era un `40` suelto, y esa suposición pintaba «la DIAN emite exactamente 40»
 * sobre una clave de 64 perfectamente válida — un aviso falso justo encima del
 * botón que gasta numeración. Espeja `TECHNICAL_KEY_LENGTHS` del backend
 * (`fiscal-document-requirements.ts`); si allá se añade una anchura, aquí
 * también.
 */
const DIAN_TECHNICAL_KEY_LENGTHS = [40, 64] as const;

/** Destino único al salir de la captura, se emita o no. */
const INVOICES_LIST_ROUTE = '/admin/invoicing/invoices';

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
  aiu: ['aiu_contract_object'],
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
 * VISTA DE FACTURA AVANZADA (superficie fiscal).
 *
 * ─── POR QUÉ ES UNA RUTA Y NO UN MODAL ──────────────────────────────────────
 *
 * Fue un `app-modal` durante toda su vida y era la decisión equivocada para
 * ocho secciones plegables, tres sub-modales y un formulario que puede tardar
 * varios minutos en llenarse. Tres consecuencias concretas se cerraron al
 * convertirla en vista:
 *
 *  1. **El cuerpo del modal era `overflow-y-auto`**, y eso RECORTA todo panel
 *     absoluto que se despliegue cerca del borde. El desplegable de impuestos
 *     de una línea se cortaba aunque saliera con `z-[10000]`: `z-index` no
 *     vence a `overflow`.
 *  2. **La captura no era enlazable ni recuperable.** Un refresco accidental
 *     con veinte líneas escritas no dejaba ni URL a la que volver.
 *  3. **Había dos maneras de llegar a lo mismo.** Ahora hay una sola:
 *     `/admin/invoicing/invoices/new`.
 *
 * La ruta vive FUERA del `ModuleTabsShellComponent` a propósito: ese shell pinta
 * su propio `app-sticky-header` con las pestañas del módulo, y anidarla dentro
 * apilaría dos cabeceras. Por eso la ruta replica los providers de NgRx, igual
 * que hace el POS.
 *
 * ─── LAS DOS SUPERFICIES ────────────────────────────────────────────────────
 *
 * El POS captura lo mínimo y NUNCA bloquea una venta. Esta pantalla hace lo
 * contrario a propósito: captura todo lo que la DIAN puede exigir —AIU,
 * retenciones, divisa, multi-impuesto por línea, subcuenta contable,
 * vencimiento— y BLOQUEA explicando, porque cada factura que sale mal consume un
 * consecutivo autorizado que no se recupera.
 *
 * ─── LA RESOLUCIÓN SE ELIGE, PERO SÓLO ENTRE LAS QUE NO PUEDEN FALLAR ───────
 *
 * Durante un tiempo esta pantalla NO dejó elegir la resolución, y el motivo era
 * bueno: elegir mal no da error, da una factura numerada con el rango
 * equivocado, y del otro lado queda un hueco de numeración que hay que
 * explicarle a la DIAN. Se informaba en un banner y `resolution_id` no viajaba.
 *
 * El selector vuelve porque un comerciante con varios rangos autorizados a la
 * vez necesita decidir con cuál factura, y quitarle la decisión no elimina el
 * problema: lo mueve a un lugar donde no puede verlo. Lo que cambia es que
 * **la equivocación ya no es alcanzable desde la lista**: sólo se ofrecen
 * resoluciones del tipo de documento correcto, activas, vigentes HOY y con
 * numeración disponible. Una vencida o agotada no aparece, y si no queda
 * ninguna el selector dice POR QUÉ en vez de quedarse mudo.
 *
 * El banner NO desaparece: el selector elige y el banner sigue informando
 * prefijo, consecutivo disponible y vigencia de lo elegido.
 *
 * ─── LO QUE ESTA PANTALLA SIGUE SIN HACER ───────────────────────────────────
 *
 * **No inventa el catálogo de impuestos.** Eran cuatro tarifas escritas a mano.
 * Ahora se carga el catálogo COMPLETO de la tienda y cada línea admite VARIOS
 * impuestos, que es como se factura de verdad en Colombia (IVA + INC).
 *
 * **No busca productos contra una copia en memoria.** Se precargaba UNA página
 * de 200 y se filtraba en el navegador, así que el producto 201 de una tienda
 * era infacturable sin un solo error que lo explicara. Ahora el selector
 * consulta el inventario en el servidor en cada término, y ofrece productos Y
 * servicios.
 *
 * **No obliga a que el concepto exista en el inventario.** Una línea se puede
 * declarar como ÍTEM PERSONALIZADO —descripción, cantidad, unidad, precio,
 * varios impuestos y descuento— sin crear nada en el catálogo. El backend ya lo
 * admitía (`product_id` es opcional); lo que faltaba era la pantalla.
 *
 * **No pide el id del pedido.** «Desde pedido» tenía un `<input type=number>`
 * sobre la clave primaria, un dato que no aparece en ninguna pantalla del
 * comerciante. Ahora se busca por número de pedido, cliente o id.
 *
 * **No cierra antes de saber si guardó.** Espera `...Success` / `...Failure`, y
 * si falla se queda abierto con el motivo a la vista y las líneas intactas.
 *
 * **No indexa las filas por posición.** La identidad de una fila es `row_uid`, y
 * los impuestos viven DENTRO del `FormGroup` de la línea (no en un `Map`
 * paralelo que se desincroniza al borrar una fila).
 */
@Component({
  selector: 'vendix-invoice-create-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgClass,
    ReactiveFormsModule,
    StickyHeaderComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    ToggleComponent,
    IconComponent,
    CustomerModalComponent,
    SaveRequirementsModalComponent,
    InvoiceFormSectionComponent,
    InvoiceResolutionBannerComponent,
    InvoiceLineTaxesComponent,
    InvoiceItemPickerModalComponent,
    InvoiceCustomItemModalComponent,
    InvoiceOrderSelectComponent,
  ],
  template: `
    <div class="w-full max-w-[1400px] mx-auto">
      <!--
        El sticky header va en la RAÍZ de la página, no dentro del contenedor
        con padding: «sticky top-0» se ancla al contenedor padre y desde dentro
        de uno acolchado se queda pegado con salto.

        Sin botón de retroceso a propósito. El de la cabecera es un RouterLink
        puro y saldría sin preguntar; en un formulario que puede llevar veinte
        líneas capturadas, la única salida es «Cancelar», que sí confirma el
        descarte cuando hay algo escrito.
      -->
      <app-sticky-header
        title="Nueva factura"
        subtitle="Captura fiscal completa — DIAN"
        icon="receipt"
        variant="glass"
        [showBackButton]="false"
        [metadataContent]="submitHint()"
        [actions]="headerActions()"
        (actionClicked)="onHeaderAction($event)"
      />

      <!--
        SEPARACIÓN ENTRE SECCIONES. Estaban a «space-y-2» (0,5 rem) sobre
        tarjetas con borde propio, y el resultado se lee como un bloque
        continuo: no hay canal blanco que diga dónde termina una sección y
        empieza la siguiente. Se sube a la escala estándar del proyecto
        («space-y-4» = 1 rem, la misma que usan los formularios de producto y
        ajustes), sin valores sueltos.
      -->
      <div class="px-2 md:px-4 pb-6 space-y-4">
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
          <!--
            NO es un «<input type=number>» con el id. El id es la clave primaria
            y no aparece en ninguna pantalla del comerciante; lo que él conoce es
            «ORD-000142». El buscador acepta las dos cosas.
          -->
          <vendix-invoice-order-select
            [formControl]="orderIdControl"
            [error]="orderSelectError()"
          />
        }

        @if (mode() === 'manual') {
          <!--
            LA RESOLUCIÓN SE ELIGE ARRIBA Y SE EXPLICA DEBAJO.

            El selector va FUERA del «form» del documento, así que se enlaza con
            «[formControl]» y no con «formControlName»: sin un «formGroup»
            ancestro, el nombre no resolvería contra nada.
          -->
          <div class="space-y-2">
            <app-selector
              label="Resolución de numeración"
              [formControl]="resolutionControl"
              [options]="resolutionOptions()"
              [errorText]="fieldError('resolution_id') ?? ''"
              [disabled]="resolutionOptions().length === 0"
              placeholder="Elige el rango autorizado"
              size="sm"
            ></app-selector>

            @if (resolutionEmptyReason(); as reason) {
              <!--
                Una lista vacía y muda en la pantalla que gasta numeración
                autorizada es un callejón sin salida: hay que decir si están
                vencidas, agotadas o si no hay ninguna.
              -->
              <div
                role="alert"
                class="flex items-start gap-2 rounded-lg border border-error bg-error-light px-3 py-2.5"
              >
                <app-icon
                  name="alert-triangle"
                  [size]="14"
                  class="mt-0.5 shrink-0 text-error"
                />
                <p class="text-xs leading-relaxed text-error">{{ reason }}</p>
              </div>
            }

            @if (habilitationWarning(); as warning) {
              <!--
                Va ANTES del aviso de clave técnica: el aviso de clave es una
                sospecha sobre un dato ambiguo, y este es un hecho. Una factura
                emitida contra el rango de habilitación no es una factura.
              -->
              <div
                role="alert"
                class="flex items-start gap-2 rounded-lg border border-error bg-error-light px-3 py-2.5"
              >
                <app-icon
                  name="alert-triangle"
                  [size]="14"
                  class="mt-0.5 shrink-0 text-error"
                />
                <p class="text-xs leading-relaxed text-error">{{ warning }}</p>
              </div>
            }

            @if (technicalKeyWarning(); as warning) {
              <div
                class="flex items-start gap-2 rounded-lg border border-warning bg-warning-light px-3 py-2.5"
              >
                <app-icon
                  name="alert-triangle"
                  [size]="14"
                  class="mt-0.5 shrink-0 text-warning"
                />
                <p class="text-xs leading-relaxed text-warning">
                  {{ warning }}
                </p>
              </div>
            }

            <!-- El selector elige; el banner sigue informando qué se eligió. -->
            <vendix-invoice-resolution-banner
              [resolution]="activeResolution()"
              [documentLabel]="documentLabel()"
            />
          </div>

          <form [formGroup]="invoiceForm" class="space-y-4">
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

              <!--
                PERFIL DE FACTURACIÓN.

                No se pinta si no hay NINGUNO activo del tipo de operación
                elegido: sin perfiles, el wizard tiene que verse y comportarse
                exactamente como antes de esta fase, porque un selector vacío o
                deshabilitado dejaría al tenant sin poder facturar.
              -->
              @if (hasProfiles()) {
                <div class="mt-3">
                  <app-selector
                    label="Perfil de facturación"
                    formControlName="profile_id"
                    [options]="profileOptions()"
                    size="sm"
                    (valueChange)="onProfileChange()"
                  ></app-selector>

                  @if (profileAutoSelected()) {
                    <div
                      class="mt-2 flex items-start gap-2.5 rounded-lg border border-[var(--color-primary)]/25 bg-[color-mix(in_srgb,var(--color-primary)_6%,transparent)] px-3 py-2.5"
                    >
                      <app-icon
                        name="check-circle"
                        [size]="15"
                        class="mt-0.5 flex-shrink-0 text-[var(--color-primary)]"
                      />
                      <p class="text-xs leading-relaxed text-text-primary">
                        Usando perfil predeterminado
                        <strong>{{ selectedProfile()?.name }}</strong
                        >. Es el único activo para este tipo de operación, y sus
                        reglas quedan congeladas en la factura al emitirla.
                        Cámbialo en el selector si este documento va con la
                        configuración de la tienda.
                      </p>
                    </div>
                  }

                  @if (profileConfigFailed()) {
                    <div
                      class="mt-2 flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning-light px-3 py-2.5"
                    >
                      <app-icon
                        name="alert-triangle"
                        [size]="15"
                        class="mt-0.5 flex-shrink-0 text-warning"
                      />
                      <div class="min-w-0">
                        <p class="text-xs font-semibold text-warning">
                          No se pudieron leer las reglas del perfil
                        </p>
                        <p class="mt-0.5 text-xs leading-relaxed text-warning">
                          La factura se puede emitir igual: el servidor la timbra
                          con la versión vigente del perfil, no con lo que muestre
                          esta pantalla. Lo que falta es el instructivo del AIU —y
                          no se sustituye por el de la tienda, porque instruiría
                          sobre otra base gravable—.
                        </p>
                        <button
                          type="button"
                          class="mt-1.5 text-xs font-semibold text-warning underline underline-offset-2"
                          (click)="retryProfileConfig()"
                        >
                          Reintentar
                        </button>
                      </div>
                    </div>
                  }
                </div>
              }

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
                  [error]="verificationDigitError()"
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
                      <div class="col-span-12 md:col-span-5">
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

                      @if (isAiu()) {
                        <div class="col-span-8 md:col-span-5">
                          <app-selector
                            formControlName="aiu_component"
                            [options]="aiuComponentOptions"
                            [errorText]="itemError(i, 'aiu_component') ?? ''"
                            placeholder="Componente AIU"
                            size="sm"
                          ></app-selector>
                        </div>
                      } @else {
                        <div class="col-span-8 md:col-span-5">
                          <span
                            class="text-xs text-[var(--color-text-secondary)]"
                          >
                            {{ lineSummary(i) }}
                          </span>
                        </div>
                      }

                      <div class="col-span-4 md:col-span-2 flex justify-end gap-1">
                        <!--
                          Configuración avanzada de ESTA línea. La tira de la
                          tabla no da para todo lo que una línea puede declarar
                          (unidad, varios impuestos, cuenta PUC, componente AIU)
                          y, sobre todo, no cabe la previsión de la aritmética.
                        -->
                        <button
                          type="button"
                          (click)="openAdvancedItem(item)"
                          class="text-[var(--color-text-secondary)] hover:text-primary transition-colors p-1"
                          title="Configuración avanzada de la línea"
                          aria-label="Configuración avanzada de la línea"
                        >
                          <app-icon name="sliders-horizontal" [size]="16" />
                        </button>
                        <button
                          type="button"
                          (click)="removeItem(i)"
                          class="text-[var(--color-text-secondary)] hover:text-error transition-colors p-1"
                          title="Eliminar línea"
                          aria-label="Eliminar línea"
                        >
                          <app-icon name="x" [size]="16" />
                        </button>
                      </div>
                    </div>

                    <!--
                      LOS IMPUESTOS OCUPAN SU PROPIA FILA, a ancho completo.
                      Compartían celda con el selector de producto en cuatro de
                      doce columnas, y con dos o tres impuestos declarados las
                      píldoras empujaban el disparador a otro renglón. No es un
                      adorno al lado del producto: es la afirmación fiscal de la
                      línea, y necesita el sitio de un campo.
                    -->
                    <vendix-invoice-line-taxes
                      formControlName="taxes"
                      [taxes]="availableTaxes()"
                    />
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

              <!--
                TRES caminos a una línea, no uno. El comerciante pidió
                explícitamente poder «tanto buscar los productos de mi
                inventario (productos y servicios) como crear un producto
                personalizado»; la línea en blanco se conserva para quien sólo
                quiere teclear.
              -->
              <div class="flex flex-wrap justify-end gap-2 mt-4">
                <app-button
                  variant="outline"
                  size="sm"
                  type="button"
                  (clicked)="openProductPickerForNewLine()"
                  [disabled]="itemCount() >= 100"
                >
                  <app-icon slot="icon" name="search" [size]="14" />
                  Buscar en inventario
                </app-button>
                <app-button
                  variant="outline"
                  size="sm"
                  type="button"
                  (clicked)="openCustomItemForNewLine()"
                  [disabled]="itemCount() >= 100"
                >
                  <app-icon slot="icon" name="sparkles" [size]="14" />
                  Ítem personalizado
                </app-button>
                <app-button
                  variant="ghost"
                  size="sm"
                  type="button"
                  (clicked)="addItem()"
                  [disabled]="itemCount() >= 100"
                >
                  <app-icon slot="icon" name="plus" [size]="14" />
                  Línea en blanco
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
                <div
                  class="flex items-start gap-3 rounded-xl border border-dashed border-border bg-[var(--color-surface)] px-4 py-3.5"
                >
                  <div
                    class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--color-background)] text-[var(--color-text-secondary)]"
                  >
                    <app-icon name="calculator" [size]="18" />
                  </div>
                  <div class="min-w-0">
                    <p class="text-sm font-medium text-text-primary">
                      El documento no está declarado como AIU
                    </p>
                    <p class="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                      Cambia el tipo de operación a
                      <strong class="text-text-primary">AIU (09)</strong> en la
                      sección Documento para marcar cada línea como
                      administración, imprevistos o utilidad.
                    </p>
                  </div>
                </div>
              } @else {
                @if (aiuGuidance(); as guide) {
                  <!-- Régimen efectivo de la tienda: qué se grava y por qué -->
                  <div
                    class="rounded-xl border border-[var(--color-primary)]/25 bg-[color-mix(in_srgb,var(--color-primary)_6%,transparent)] px-4 py-3.5"
                  >
                    <div class="flex flex-wrap items-center gap-2">
                      <span
                        class="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-primary)]/12 px-2.5 py-1 text-[11px] font-semibold text-[var(--color-primary)]"
                      >
                        <app-icon name="scale" [size]="12" />
                        {{ guide.regimeLabel }}
                      </span>
                      <span
                        class="inline-flex items-center rounded-full bg-[var(--color-background)] px-2.5 py-1 text-[11px] font-medium text-text-primary ring-1 ring-border"
                      >
                        Base gravable: {{ guide.taxableLabel }}
                      </span>
                      @if (guide.isDefault) {
                        <span
                          class="inline-flex items-center rounded-full bg-[var(--color-background)] px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)] ring-1 ring-border"
                          title="La tienda nunca eligió régimen. Se aplica el default conservador, que declara MÁS IVA."
                        >
                          Valor por defecto
                        </span>
                      }
                    </div>
                    <p class="mt-2 text-xs text-[var(--color-text-secondary)]">
                      {{ guide.regimeCitation }}
                    </p>
                    <p class="mt-2 text-xs leading-relaxed text-text-primary">
                      {{ guide.instruction }}
                    </p>
                    @if (guide.minimumBase) {
                      <p
                        class="mt-2 text-xs leading-relaxed text-[var(--color-text-secondary)]"
                      >
                        {{ guide.minimumBase }}
                      </p>
                    }
                    <p
                      class="mt-2 text-[11px] text-[var(--color-text-secondary)]"
                    >
                      {{ aiuRegimeOriginHint() }} Cuál aplica lo decide el objeto
                      del contrato, no una preferencia del negocio.
                    </p>
                  </div>
                } @else {
                  <div
                    class="h-20 animate-pulse rounded-xl bg-[var(--color-surface)]"
                  ></div>
                }

                <!-- Objeto del contrato de ESTE documento (regla CAV03) -->
                @if (aiuEffectiveNote(); as note) {
                  <div
                    class="mt-3 rounded-xl border border-border bg-[var(--color-surface)] px-4 py-3.5"
                  >
                    <div
                      class="flex flex-wrap items-center justify-between gap-2"
                    >
                      <div class="flex items-center gap-2">
                        <app-icon
                          name="file-text"
                          [size]="15"
                          class="text-[var(--color-text-secondary)]"
                        />
                        <span class="text-sm font-medium text-text-primary">
                          Objeto del contrato
                        </span>
                      </div>
                      <span
                        class="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ring-1"
                        [ngClass]="
                          note.source === 'invoice'
                            ? 'bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)] text-[var(--color-primary)] ring-[var(--color-primary)]/25'
                            : note.source === 'none'
                              ? 'bg-error/5 text-error ring-error/30'
                              : 'bg-[var(--color-background)] text-[var(--color-text-secondary)] ring-border'
                        "
                      >
                        {{ aiuNoteSourceLabel() }}
                      </span>
                    </div>

                    <app-textarea
                      class="mt-2.5 block"
                      formControlName="aiu_contract_object"
                      [control]="control('aiu_contract_object')"
                      [error]="fieldError('aiu_contract_object')"
                      [rows]="2"
                      [placeholder]="
                        note.source === 'store' || note.source === 'profile'
                          ? 'Heredado: ' + note.object
                          : 'Ej.: aseo y cafetería para la sede norte, contrato 2026-014'
                      "
                    ></app-textarea>

                    <p
                      class="mt-1.5 text-[11px] leading-relaxed text-[var(--color-text-secondary)]"
                    >
                      Se guarda con la factura, así que el documento conserva el
                      contrato que describía aunque la tienda o el perfil cambien
                      el suyo después. {{ aiuInheritanceHint() }}
                    </p>

                    <!-- Vista previa de la cadena que viaja en cbc:Note -->
                    @if (note.note) {
                      <div
                        class="mt-2.5 rounded-lg border border-border bg-[var(--color-background)] px-3 py-2"
                      >
                        <div
                          class="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]"
                        >
                          <span>Nota que viaja al XML</span>
                          <span
                            class="tabular-nums font-semibold"
                            [ngClass]="note.valid ? 'text-success' : 'text-error'"
                          >
                            {{ note.length }} / {{ note.max }}
                          </span>
                        </div>
                        <p
                          class="mt-1 break-words text-[11px] leading-relaxed text-text-primary"
                        >
                          {{ note.note }}
                        </p>
                      </div>
                    }
                  </div>
                }

                <!-- Desglose por componente -->
                <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  @for (row of aiuBreakdown(); track row.key) {
                    <div
                      class="rounded-xl border border-border bg-[var(--color-surface)] px-3 py-2.5"
                    >
                      <p
                        class="text-[11px] uppercase tracking-wide text-[var(--color-text-secondary)]"
                      >
                        {{ row.label }}
                      </p>
                      <p
                        class="mt-0.5 text-sm font-semibold text-text-primary tabular-nums"
                      >
                        {{ formatCurrency(row.amount) }}
                      </p>
                    </div>
                  }
                </div>

                @if (aiuUnassigned() > 0) {
                  <div
                    class="mt-3 flex items-start gap-2.5 rounded-lg border border-error/30 bg-error/5 px-3 py-2.5"
                  >
                    <app-icon
                      name="alert-triangle"
                      [size]="15"
                      class="mt-0.5 flex-shrink-0 text-error"
                    />
                    <p class="text-xs leading-relaxed text-error">
                      Hay {{ aiuUnassigned() }} línea(s) sin componente AIU. La
                      DIAN valida la coherencia entre el
                      <code>CustomizationID</code> 09 y el desglose de las
                      líneas: una línea sin marcar hace que rechace el documento
                      entero.
                    </p>
                  </div>
                }

                @if (aiuTaxableWithoutTax().length > 0) {
                  <div
                    class="mt-3 flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning-light px-3 py-2.5"
                  >
                    <app-icon
                      name="alert-triangle"
                      [size]="15"
                      class="mt-0.5 flex-shrink-0 text-warning"
                    />
                    <div class="min-w-0">
                      <p class="text-xs font-semibold text-warning">
                        {{ aiuTaxableWithoutTax().length }} línea(s) de la base
                        gravable no declaran impuesto
                      </p>
                      <p class="mt-0.5 text-xs leading-relaxed text-warning">
                        Bajo {{ aiuGuidance()?.regimeLabel }} la base gravable es
                        {{ aiuGuidance()?.taxableLabel }}, así que
                        @for (
                          row of aiuTaxableWithoutTax();
                          track row.index;
                          let last = $last
                        ) {
                          <strong>{{ row.label }}</strong
                          >{{ last ? '' : ', ' }}
                        }
                        también debería(n) llevarlo. La DIAN acepta el documento
                        igual —el XML cuadra consigo mismo—, y el faltante sólo
                        aparece en una fiscalización, cuando ya sólo se corrige
                        con nota crédito. Déjalas sin impuesto únicamente si el
                        concepto está exento o excluido.
                      </p>
                    </div>
                  </div>
                }

                @if (aiuEffectiveNote(); as note) {
                  @if (!note.valid) {
                    <div
                      class="mt-3 flex items-start gap-2.5 rounded-lg border border-error/30 bg-error/5 px-3 py-2.5"
                    >
                      <app-icon
                        name="alert-triangle"
                        [size]="15"
                        class="mt-0.5 flex-shrink-0 text-error"
                      />
                      <div class="min-w-0">
                        <p class="text-xs font-semibold text-error">
                          @if (note.length > note.max) {
                            El objeto del contrato AIU es demasiado largo
                          } @else {
                            Falta el objeto del contrato AIU
                          }
                        </p>
                        <p class="mt-0.5 text-xs leading-relaxed text-error">
                          La regla CAV03 exige que la línea de Administración
                          lleve una nota que empiece por «{{
                            effectiveAiu()?.note_prefix
                          }}» y mida entre {{ note.min }} y
                          {{ note.max }} caracteres; la actual mide
                          {{ note.length }}. Descríbelo arriba, en
                          <strong>Objeto del contrato</strong>, o —si es siempre
                          el mismo— en Ajustes → Facturación → AIU. Sin eso la
                          emisión se rechaza y el documento no llega a tomar
                          consecutivo.
                        </p>
                      </div>
                    </div>
                  }
                }
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
                <app-toggle
                  formControlName="manual_withholding"
                  (toggled)="onManualWithholdingChange()"
                />
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
                @if (withholdingConcepts().length === 0) {
                  <div
                    class="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-light px-3 py-2.5 mb-3"
                  >
                    <app-icon
                      name="alert-triangle"
                      [size]="14"
                      class="text-warning mt-0.5 shrink-0"
                    />
                    <p class="text-xs text-text-primary leading-relaxed">
                      No hay conceptos de retención configurados. Créalos en
                      <span class="font-medium">Contabilidad › Retenciones</span>
                      o activa el importe manual de arriba: sin concepto, el
                      desglose no se puede guardar.
                    </p>
                  </div>
                }

                <div formArrayName="withholdings" class="space-y-2">
                  @for (
                    row of withholdingControls();
                    track withholdingUid(row);
                    let i = $index
                  ) {
                    <div
                      [formGroupName]="i"
                      class="rounded-lg border border-border bg-[var(--color-surface)] p-3"
                    >
                      <div class="grid grid-cols-12 gap-2.5">
                        <div class="col-span-12 md:col-span-7">
                          <app-selector
                            label="Concepto"
                            formControlName="concept_id"
                            [options]="withholdingConceptOptions()"
                            [searchable]="true"
                            placeholder="Busca el concepto de retención…"
                            size="sm"
                            (valueChange)="onWithholdingConceptChange(i)"
                          ></app-selector>
                        </div>
                        <div class="col-span-12 md:col-span-5">
                          <app-selector
                            label="Lado de la operación"
                            formControlName="role"
                            [options]="withholdingRoleOptions"
                            size="sm"
                          ></app-selector>
                        </div>
                        <div class="col-span-5 md:col-span-3">
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
                        <div class="col-span-7 md:col-span-5">
                          <app-input
                            label="Base gravable"
                            [currency]="true"
                            formControlName="base"
                            [control]="row.get('base')"
                            size="sm"
                          ></app-input>
                        </div>
                        <div
                          class="col-span-12 md:col-span-4 flex items-end justify-between gap-2 pb-0.5"
                        >
                          <div class="min-w-0">
                            <span
                              class="block text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]"
                            >
                              Retenido
                            </span>
                            <span
                              class="block text-sm font-semibold text-text-primary truncate"
                            >
                              {{ formatCurrency(withholdingRowAmount(i)) }}
                            </span>
                          </div>
                          <button
                            type="button"
                            class="shrink-0 rounded-md p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-error-light hover:text-error"
                            title="Quitar retención"
                            (click)="removeWithholding(i)"
                          >
                            <app-icon name="x" [size]="14" />
                          </button>
                        </div>
                      </div>

                      @if (incompleteWithholdingRow() === i + 1) {
                        <p
                          class="mt-2 flex items-center gap-1.5 text-[11px] text-warning"
                        >
                          <app-icon name="alert-circle" [size]="12" />
                          Falta concepto, tarifa o base. La factura no se envía
                          con una retención a medias.
                        </p>
                      }
                    </div>
                  } @empty {
                    <p
                      class="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-[var(--color-text-secondary)]"
                    >
                      Sin retenciones. Agrega una si el documento las lleva.
                    </p>
                  }
                </div>

                <div
                  class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <app-button
                    variant="outline"
                    size="sm"
                    type="button"
                    (clicked)="addWithholding()"
                  >
                    <app-icon slot="icon" name="plus" [size]="14" />
                    Agregar retención
                  </app-button>
                  <div
                    class="flex items-baseline justify-between gap-2 rounded-lg bg-[var(--color-surface-hover)] px-3 py-2 sm:justify-end"
                  >
                    <span
                      class="text-xs text-[var(--color-text-secondary)]"
                      >Total retenido</span
                    >
                    <span class="text-sm font-semibold text-text-primary">
                      {{ formatCurrency(effectiveWithholding()) }}
                    </span>
                  </div>
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
                    (valueChange)="onExchangeRateInputsChanged()"
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
                    (inputChange)="onExchangeRateInputsChanged()"
                  ></app-input>
                </div>

                <!--
                  Estado de la consulta a la TRM oficial. Se pinta SIEMPRE que
                  haya divisa: el silencio sobre de donde salio la tasa es lo
                  que hacia que un valor tecleado a ojo pareciera verificado.
                -->
                <div class="mt-2 min-h-[20px]">
                  @if (loadingExchangeRate()) {
                    <p
                      class="flex items-center gap-1.5 text-[11px] text-[var(--color-text-secondary)]"
                    >
                      <app-icon name="loader" [size]="12" class="animate-spin" />
                      Consultando la TRM oficial…
                    </p>
                  } @else if (exchangeRateQuote(); as quote) {
                    @if (quote.rate) {
                      <p
                        class="flex flex-wrap items-center gap-1.5 text-[11px] text-success"
                      >
                        <app-icon name="check-circle" [size]="12" />
                        TRM oficial del {{ quote.date }}:
                        <span class="font-semibold">{{
                          formatCurrency(+quote.rate)
                        }}</span>
                        @if (quote.trm) {
                          <span class="text-[var(--color-text-secondary)]">
                            (rige del {{ quote.trm.valid_from }} al
                            {{ quote.trm.valid_to }})
                          </span>
                        }
                        @if (exchangeRateOverridden()) {
                          <button
                            type="button"
                            class="underline underline-offset-2 hover:no-underline"
                            (click)="applyOfficialExchangeRate()"
                          >
                            Usar la oficial
                          </button>
                        }
                      </p>
                    } @else {
                      <p
                        class="flex items-start gap-1.5 text-[11px] text-warning"
                      >
                        <app-icon
                          name="alert-circle"
                          [size]="12"
                          class="mt-0.5 shrink-0"
                        />
                        {{ exchangeRateUnavailableReason() }}
                      </p>
                    }
                  }
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

        <!--
          El pie se conserva aunque la cabecera ya lleve las mismas acciones: la
          página mide ocho secciones y quien acaba de escribir la última línea
          está al final, no arriba. La frase de la izquierda es la misma que la
          cabecera enseña como metadato — un botón apagado sin motivo a la vista
          es un callejón sin salida.
        -->
        <div
          class="flex flex-col gap-3 rounded-lg border border-border bg-[var(--color-surface-secondary)] p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <span class="min-w-0 truncate text-xs text-[var(--color-text-secondary)]">
            {{ submitHint() }}
          </span>
          <div class="flex shrink-0 items-center gap-3">
            <!-- Nunca se apaga por «submitting»: salir siempre tiene que poder. -->
            <app-button variant="outline" (clicked)="cancel()">
              Cancelar
            </app-button>
            <!--
              Se apaga también con el borrador ya creado: en ese estado la vista
              sigue en pie sólo para enseñar lo que la puerta de emisión
              encontró, y pulsar de nuevo crearía una factura gemela.
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
    </div>

    <app-customer-modal
      [isOpen]="customerModalOpen()"
      [customer]="null"
      (isOpenChange)="customerModalOpen.set($event)"
      (save)="onCustomerCreated($event)"
    />

    <!--
      BUSCADOR DEL INVENTARIO. Pega al servidor en cada término (debounced), así
      que el universo es el inventario completo y no la primera página.
    -->
    <vendix-invoice-item-picker-modal
      [open]="productPickerOpen()"
      [usedProductIds]="pickedProductIds()"
      (productPicked)="onProductPicked($event)"
      (customRequested)="onCustomItemRequested()"
      (closed)="closeProductPicker()"
    />

    <!--
      CONFIGURACIÓN AVANZADA / ÍTEM PERSONALIZADO. El mismo modal sirve para las
      dos cosas: crear una línea que no existe en el inventario y editar a fondo
      una que ya está en la factura. Son el mismo conjunto de campos, y tener dos
      pantallas para el mismo dato garantizaría que una se quede atrás.
    -->
    <vendix-invoice-custom-item-modal
      [open]="customItemOpen()"
      [draft]="customItemDraft()"
      [taxes]="availableTaxes()"
      [isAiu]="isAiu()"
      [isEditing]="customItemEditing()"
      (saved)="onCustomItemSaved($event)"
      (closed)="customItemOpen.set(false)"
    />

    <!--
      LA PUERTA DE EMISIÓN, ANTES DE «VALIDAR».

      Va DESPUÉS de los sub-modales en el orden del DOM a propósito: todos son
      app-modal y comparten z-index, así que el último declarado es el que queda
      encima. Se pinta sobre el formulario todavía en pantalla para que los CTA
      de «Ir al campo» enfoquen el dato REAL que la DIAN va a rechazar, y no un
      formulario ya limpiado.
    -->
    <app-save-requirements-modal
      [(isOpen)]="emitRequirementsOpen"
      [requirements]="emitRequirements()"
      (action)="onEmitRequirementAction($event)"
    />
  `,
})
export class InvoiceCreatePageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly actions$ = inject(Actions);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly customersService = inject(CustomersService);
  private readonly taxCatalog = inject(InvoiceTaxCatalogService);
  private readonly aiuSettingsService = inject(InvoiceAiuSettingsService);
  private readonly withholdingCatalog = inject(InvoiceWithholdingCatalogService);
  private readonly exchangeRateService = inject(ExchangeRateService);
  private readonly emitReadinessService = inject(InvoiceEmitReadinessService);
  private readonly profileService = inject(InvoiceProfileService);

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

  /**
   * Fila (por `row_uid`) a la que apunta el picker abierto, o `null` cuando se
   * abrió desde el pie de la sección para AÑADIR una línea nueva. Es la misma
   * distinción para el modal de configuración avanzada.
   */
  private readonly pickerTargetUid = signal<string | null>(null);

  // ── Ítem personalizado / configuración avanzada ─────────────
  readonly customItemOpen = signal(false);
  readonly customItemDraft = signal<InvoiceCustomItemDraft | null>(null);
  readonly customItemEditing = signal(false);
  private readonly customItemTargetUid = signal<string | null>(null);

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
    /**
     * Rango de numeración elegido. SIN `Validators.required`: cuando no hay ni
     * una resolución elegible, exigirlo dejaría el formulario inválido con un
     * mensaje genérico, y el motivo real —vencidas, agotadas o inexistentes— ya
     * lo dice `resolutionEmptyReason()` junto al selector. El bloqueo de verdad
     * lo pone `collectBlockers()`, que nombra el problema.
     */
    resolution_id: [null as number | null],
    issue_date: [toLocalDateString(), [Validators.required]],
    due_date: [{ value: toLocalDateString(), disabled: true }],
    payment_form: [PAYMENT_FORM_CASH],
    payment_means_code: ['10'],
    operation_type: [OPERATION_TYPE_STANDARD],

    /**
     * Perfil de facturación elegido. `PROFILE_NONE` ⇒ flujo manual.
     *
     * SIN `Validators.required` y con el flujo manual como valor inicial: el
     * wizard tiene que poder emitir sin perfiles, que es el estado de todo tenant
     * que no los use. Exigirlo dejaría el formulario inválido en cada tienda que
     * nunca creó uno.
     */
    profile_id: [PROFILE_NONE],
    notes: [''],

    // AIU. Vacío ⇒ hereda el objeto del contrato de la tienda. Es un campo por
    // documento y no sólo de configuración porque una constructora factura
    // varias obras a la vez y la nota CAV03 describe UNA de ellas.
    aiu_contract_object: [''],

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

  // ── Resolución: selección, elegibilidad y banner ────────────

  private readonly activeResolutions = toSignal(
    this.store.select(selectActiveResolutions),
    { initialValue: [] as InvoiceResolution[] },
  );

  /**
   * El control vive en `invoiceForm` pero se pinta FUERA de él, así que se
   * expone tipado para enlazarlo con `[formControl]`. `form.get(...)` en la
   * plantilla queda prohibido por `vendix-angular-forms`.
   */
  get resolutionControl(): FormControl<number | null> {
    return this.invoiceForm.get('resolution_id') as FormControl<number | null>;
  }

  /**
   * Las resoluciones entre las que se PUEDE elegir sin equivocarse.
   *
   * Aquí está la mitigación del riesgo por el que esta pantalla llegó a esconder
   * el selector: elegir mal no da error, da una factura con el rango equivocado.
   * Filtrando por los cuatro criterios que deciden si el rango sirve —tipo de
   * documento, activa, vigente HOY y con numeración disponible—, una resolución
   * vencida o agotada sencillamente no aparece, y la equivocación deja de ser
   * alcanzable desde la lista.
   *
   * Las filas antiguas sin `document_type` cuentan como factura de venta, igual
   * que hace el backend.
   *
   * La clave técnica NO entra en este filtro. Ver `technicalKeyWarning()`.
   *
   * La numeración de HABILITACIÓN tampoco lo hace: no se esconde, se manda al
   * final. Ver `autoSelectableResolutions()`.
   */
  readonly eligibleResolutions = computed<InvoiceResolution[]>(() => {
    const target = toFiscalDocumentType(this.invoiceType());
    const today = toLocalDateString();
    return this.activeResolutions()
      .filter(
        (res) =>
          (res.document_type ?? 'sales_invoice') === target &&
          res.is_active === true &&
          isWithinValidity(res, today) &&
          Number(res.current_number) < Number(res.range_to),
      )
      .sort(compareResolutionsForSelection);
  });

  /**
   * Las que la pantalla puede elegir SOLA: las de producción.
   *
   * La numeración de habilitación sigue en la lista y se puede marcar a mano
   * —durante la habilitación es justo lo que hace falta—, pero nunca la escoge
   * la pantalla. La diferencia importa porque elegir mal aquí no da error: da
   * una factura real numerada con un rango de pruebas y firmada con la clave
   * técnica que la DIAN le entrega idéntica a todo contribuyente.
   */
  private readonly autoSelectableResolutions = computed<InvoiceResolution[]>(
    () => this.eligibleResolutions().filter((res) => !isHabilitationNumbering(res)),
  );

  readonly resolutionOptions = computed<SelectorOption[]>(() =>
    this.eligibleResolutions().map((res) => ({
      value: res.id,
      label:
        (isHabilitationNumbering(res) ? 'PRUEBAS · ' : '') +
        (res.prefix || 'sin prefijo') +
        ' · ' +
        res.resolution_number,
      description:
        // El aviso va DELANTE del consecutivo, no en vez de él: en el set de
        // pruebas hace falta saber por qué número va, y una descripción que
        // solo regaña obliga a salir de la pantalla a buscarlo.
        (isHabilitationNumbering(res)
          ? 'Numeración de habilitación, idéntica para todos los contribuyentes · '
          : '') +
        'Consecutivo ' +
        (Math.max(Number(res.current_number) || 0, (Number(res.range_from) || 0) - 1) + 1) +
        ' de ' +
        res.range_to +
        ' · vence ' +
        (res.valid_to ? formatDateOnlyUTC(res.valid_to) : 'sin vigencia declarada'),
    })),
  );

  /**
   * Por qué la lista está vacía, con el motivo REAL.
   *
   * Un selector vacío y mudo en la pantalla que gasta numeración autorizada no
   * dice si hay que renovar la resolución, activar una que existe o registrar la
   * primera. Son tres acciones distintas y el usuario no puede adivinar cuál.
   */
  readonly resolutionEmptyReason = computed<string | null>(() => {
    if (this.eligibleResolutions().length > 0) return null;

    const target = toFiscalDocumentType(this.invoiceType());
    const label = this.documentLabel().toLowerCase();
    const sameType = this.activeResolutions().filter(
      (res) => (res.document_type ?? 'sales_invoice') === target,
    );

    if (sameType.length === 0) {
      return (
        'No hay ninguna resolución activa para ' +
        label +
        '. Regístrala o actívala en Facturación → Resoluciones: sin rango autorizado el servidor no tiene de dónde tomar el consecutivo.'
      );
    }

    const today = toLocalDateString();
    const expired = sameType.filter((res) => !isWithinValidity(res, today));
    const exhausted = sameType.filter(
      (res) => Number(res.current_number) >= Number(res.range_to),
    );

    const reasons: string[] = [];
    if (expired.length > 0) {
      reasons.push(
        expired.length === 1
          ? '1 está fuera de vigencia'
          : expired.length + ' están fuera de vigencia',
      );
    }
    if (exhausted.length > 0) {
      reasons.push(
        exhausted.length === 1
          ? '1 agotó su rango'
          : exhausted.length + ' agotaron su rango',
      );
    }

    return (
      'Ninguna resolución de ' +
      label +
      ' puede numerar hoy: ' +
      (reasons.length > 0 ? reasons.join(' y ') : 'ninguna cumple los requisitos') +
      '. Solicita el rango nuevo a la DIAN y regístralo en Facturación → Resoluciones antes de emitir.'
    );
  });

  /**
   * PRESELECCIÓN: la resolución elegible MÁS ANTIGUA.
   *
   * Se agota primero el rango más viejo, que es lo que evita dejar vencer
   * numeración sin usar.
   *
   * ⚠️ ESTO REVIERTE EL CRITERIO EFECTIVO ANTERIOR. Mientras la pantalla no
   * mandaba `resolution_id`, quien elegía era `InvoiceNumberGenerator`, y ése
   * ordena por `created_at: 'desc'` — o sea, tomaba la MÁS RECIENTE. Desde que
   * la vista manda siempre un id explícito, el criterio que manda es el de esta
   * pantalla. Es intencional: la de la DIAN que primero vence es la que primero
   * hay que gastar.
   *
   * El desempate (`valid_from`, luego `created_at`, luego `id`) no es cosmético:
   * en datos reales conviven dos resoluciones con la MISMA `resolution_date`, y
   * sin un criterio total la preselección dependería del orden en que el store
   * devuelva el arreglo — es decir, cambiaría sola entre recargas.
   */
  private readonly preselectEligibleResolution = effect(() => {
    const eligible = this.eligibleResolutions();
    const control = this.invoiceForm.get('resolution_id');
    if (!control) return;

    const current = Number(control.value) || null;
    // Lo ya elegido manda mientras siga siendo elegible. Si dejó de serlo
    // (cambió el tipo de documento, se agotó el rango), se rehace: dejarlo
    // puesto mandaría al backend un id que la pantalla ya no ofrece.
    //
    // Se contrasta contra `eligible`, no contra las auto-elegibles: una fila de
    // habilitación marcada A MANO es una elección legítima y no se le puede
    // deshacer bajo los dedos al usuario.
    if (current && eligible.some((res) => res.id === current)) return;

    // Pero elegir SOLA solo elige producción. Si no hay ninguna, se queda vacío
    // y lo dice `habilitationWarning()`: preseleccionar el rango de pruebas
    // porque es lo único que quedaba convierte un descuido en una factura real
    // con numeración que no es de nadie.
    const next = this.autoSelectableResolutions()[0]?.id ?? null;
    if ((control.value ?? null) === next) return;
    control.setValue(next);
  });

  /**
   * En modo manual `resolution_id` es OBLIGATORIO. Y no es cosmética.
   *
   * Sin él, `buildPayload()` no manda el campo y quien elige es
   * `InvoiceNumberGenerator`, que toma la resolución más reciente por
   * `created_at`. Ahí se cuela justo lo que la preselección acaba de evitar: si
   * la única resolución activa es la de habilitación, la pantalla se niega a
   * preseleccionarla pero el servidor la escoge igual, y la factura sale con
   * numeración de pruebas sin que nadie lo haya decidido. Exigir la elección
   * cierra esa puerta trasera.
   *
   * Desde pedido no aplica: ese modo no pinta el selector, y un control
   * obligatorio invisible dejaría el botón de guardar apagado sin explicación.
   *
   * `updateValueAndValidity()` va CON evento a propósito: el botón de guardar
   * cuelga de `formStatus`, que es un puente sobre `statusChanges`. Silenciarlo
   * dejaría el formulario válido y el botón apagado, o al revés.
   */
  private readonly syncResolutionRequirement = effect(() => {
    const isManual = this.mode() === 'manual';
    const control = this.invoiceForm.get('resolution_id');
    if (!control) return;

    if (isManual) {
      control.setValidators([Validators.required]);
    } else {
      control.clearValidators();
    }
    control.updateValueAndValidity();
  });

  /**
   * La fila que el banner describe y que el backend va a consumir.
   *
   * Deriva del control, no de una inferencia paralela: dos criterios distintos
   * para el mismo dato acabarían enseñando una resolución y numerando con otra.
   * El respaldo a la primera elegible sólo cubre el instante entre que llegan
   * las resoluciones y corre la preselección.
   */
  readonly activeResolution = computed<InvoiceResolution | null>(() => {
    const chosen = Number(this.rawValue()['resolution_id']) || null;
    if (chosen) {
      const match = this.activeResolutions().find((res) => res.id === chosen);
      if (match) return match;
    }
    // El respaldo usa las mismas que la preselección, no las elegibles a secas:
    // si difirieran, el banner enseñaría durante un instante una resolución que
    // la pantalla nunca va a elegir.
    return this.autoSelectableResolutions()[0] ?? null;
  });

  /**
   * Aviso BLOQUEANTE de intención cuando lo elegido es numeración de pruebas.
   *
   * A diferencia de `technicalKeyWarning()` —que es una sospecha sobre un dato
   * ambiguo— aquí no hay ambigüedad: el rango de habilitación es el mismo para
   * todo contribuyente y la clave técnica también. Una factura emitida contra él
   * no es una factura. No se apaga el botón porque durante la habilitación este
   * es el camino correcto, pero el usuario tiene que estar eligiéndolo, no
   * encontrárselo puesto.
   */
  readonly habilitationWarning = computed<string | null>(() => {
    const chosen = Number(this.rawValue()['resolution_id']) || null;
    if (chosen) {
      const match = this.activeResolutions().find((res) => res.id === chosen);
      if (match && isHabilitationNumbering(match)) {
        return (
          'Esta es numeración de HABILITACIÓN (pruebas). La DIAN la asigna idéntica a todos los contribuyentes, con la misma clave técnica, y no sirve para facturar de verdad. Úsala solo para el set de pruebas.'
        );
      }
      return null;
    }

    // Sin elegir: si lo único disponible es de pruebas, hay que decirlo, porque
    // el selector NO está vacío y `resolutionEmptyReason()` guarda silencio.
    if (
      this.autoSelectableResolutions().length === 0 &&
      this.eligibleResolutions().length > 0
    ) {
      return (
        'Las únicas resoluciones disponibles son de habilitación (pruebas), así que no se preseleccionó ninguna. Registra la resolución de producción en Facturación → Resoluciones, o sincronízala desde la DIAN en la configuración del eje.'
      );
    }
    return null;
  });

  /**
   * Aviso NO bloqueante sobre la clave técnica de la resolución elegida.
   *
   * ─── POR QUÉ EL AVISO ES ASIMÉTRICO ─────────────────────────────────────
   *
   * `technical_key_length` se deriva SÓLO de la columna plana `technical_key`,
   * mientras que el emisor lee por bóveda y PREFIERE la columna cifrada. Por eso
   * los dos casos no significan lo mismo:
   *
   *  - `0` ⇒ **no se pinta nada**. No distingue «no hay clave» de «la clave está
   *    sellada en `technical_key_encrypted` y es perfectamente válida». Un falso
   *    alarmismo en la pantalla que gasta numeración autorizada es peor que el
   *    silencio.
   *  - `> 0` y fuera de {@link DIAN_TECHNICAL_KEY_LENGTHS} ⇒ **sí se avisa**. Hay
   *    una clave plana legible y no mide ninguna de las anchuras que la DIAN
   *    emite; puede estar rancia, pero merece una mirada.
   *
   * NO filtra ni reordena la lista, y NO apaga el botón de guardar: es una
   * sospecha sobre un dato ambiguo, no un veredicto.
   */
  readonly technicalKeyWarning = computed<string | null>(() => {
    const resolution = this.activeResolution();
    if (!resolution) return null;
    // Sólo la factura de venta lleva clave técnica en el CUFE.
    if ((resolution.document_type ?? 'sales_invoice') !== 'sales_invoice') {
      return null;
    }
    const length = Number(resolution.technical_key_length) || 0;
    if (length === 0) return null;
    if ((DIAN_TECHNICAL_KEY_LENGTHS as readonly number[]).includes(length)) {
      return null;
    }
    return (
      'La clave técnica guardada mide ' +
      length +
      ' caracteres y la DIAN la emite de ' +
      DIAN_TECHNICAL_KEY_LENGTHS.join(' o ') +
      '. Verifícala en Facturación → Resoluciones antes de emitir: con una clave equivocada la DIAN rechaza la factura por CUFE mal calculado y el consecutivo autorizado que gasta no se recupera.'
    );
  });

  // ── Catálogos cargados ──────────────────────────────────────

  readonly availableTaxes = signal<TaxOption[]>([]);

  /** Conceptos de `withholding_concepts` del tenant, con tarifa en PORCENTAJE. */
  readonly withholdingConcepts = signal<WithholdingConceptOption[]>([]);

  /**
   * Régimen AIU EFECTIVO de la tienda, o `null` mientras se resuelve.
   *
   * Nunca se asume un valor por defecto acá: el instructivo del régimen
   * equivocado hace que el comerciante grave mal, y con la DIAN aceptando el
   * documento el error no da síntoma. Mientras es `null` la sección muestra
   * «resolviendo» en vez de arriesgar una instrucción.
   */
  readonly aiuSettings = signal<InvoiceAiuSettings | null>(null);

  // ── Perfiles de facturación ─────────────────────────────────

  /** Catálogo de perfiles ACTIVOS del tenant, de todos los tipos de operación. */
  readonly profileCatalog = signal<InvoiceProfileCatalogEntry[]>([]);

  /** `true` mientras se leen las reglas de la versión vigente del perfil. */
  readonly profileConfigLoading = signal(false);

  /**
   * `true` si esa lectura FALLÓ. Estado propio, no «configuración vacía».
   *
   * Sin él, un fallo de red degradaría al setting de la TIENDA y la sección AIU
   * instruiría sobre una base gravable distinta de la que el backend va a
   * aplicar. El documento se sigue pudiendo emitir —el cálculo es del servidor,
   * contra la versión que congela al timbrar—, así que el fallo no bloquea: sólo
   * deja sin instructivo, y eso hay que DECIRLO en vez de sustituirlo por otro.
   */
  readonly profileConfigFailed = signal(false);

  /** Sección AIU de la versión vigente del perfil elegido. */
  readonly profileAiu = signal<ProfileAiuConfig | null>(null);

  /**
   * Descarta respuestas fuera de orden.
   *
   * Cambiar de perfil dos veces seguidas puede resolver la primera petición
   * DESPUÉS de la segunda, y sin este contador la pantalla acabaría instruyendo
   * bajo el régimen del perfil que el usuario ya descartó.
   */
  private profileConfigRequest = 0;
  private profileCatalogLoaded = false;

  /**
   * Perfiles activos del tipo de operación vigente.
   *
   * El filtro por tipo NO es cosmético: el backend rechaza con
   * `INVOICING_PROFILE_008` un perfil cuyo `operation_type` no coincide con el
   * del documento, así que ofrecer los de otro tipo sería ofrecer un 409.
   */
  readonly profilesForType = computed<InvoiceProfileCatalogEntry[]>(() => {
    const type = String(this.rawValue()['operation_type'] ?? '');
    return this.profileCatalog().filter(
      (entry) => entry.operation_type === type,
    );
  });

  /**
   * `false` ⇒ el selector NO se pinta y el wizard se comporta como siempre.
   *
   * Es la condición que protege el radio de impacto de este paso: en un tenant
   * sin perfiles, un selector vacío o deshabilitado dejaría el flujo manual
   * inalcanzable y nadie podría facturar.
   */
  readonly hasProfiles = computed<boolean>(
    () => this.profilesForType().length > 0,
  );

  /** Opciones del selector, con el flujo manual PRIMERO y siempre presente. */
  readonly profileOptions = computed<SelectorOption[]>(() => [
    {
      value: PROFILE_NONE,
      label: 'Sin perfil · configuración de la tienda',
      description: 'El AIU se resuelve desde Ajustes → Facturación → AIU.',
    },
    ...this.profilesForType().map((entry) => ({
      value: entry.id,
      label: entry.name,
      description:
        (entry.is_default ? 'Predeterminado · ' : '') +
        'versión ' +
        entry.current_version,
    })),
  ]);

  /** Id elegido, normalizado: cualquier cosa que no sea un entero positivo es el flujo manual. */
  readonly selectedProfileId = computed<number>(() => {
    const value = Number(this.rawValue()['profile_id']);
    return Number.isFinite(value) && value > 0 ? value : PROFILE_NONE;
  });

  /**
   * El perfil elegido, SÓLO si sigue estando en el catálogo activo del tipo.
   *
   * Es la fuente de la que `buildPayload` toma el `profile_id`, y por eso se
   * resuelve contra `profilesForType()` y no contra el valor crudo: así un id que
   * quedó puesto tras cambiar el tipo de operación, o cuando el catálogo no se
   * pudo leer, no llega nunca al backend.
   */
  readonly selectedProfile = computed<InvoiceProfileCatalogEntry | null>(() => {
    const id = this.selectedProfileId();
    if (id === PROFILE_NONE) return null;
    return this.profilesForType().find((entry) => entry.id === id) ?? null;
  });

  /**
   * Banner de «Usando perfil predeterminado».
   *
   * Sólo con EXACTAMENTE un perfil activo del tipo (ADR-9). Con dos o más el
   * selector ya muestra la elección a la vista y un banner sobraría; con uno
   * solo no hay nada visible que delate qué configuración se está aplicando.
   */
  readonly profileAutoSelected = computed<boolean>(
    () => this.profilesForType().length === 1 && this.selectedProfile() !== null,
  );

  /**
   * Configuración AIU que REALMENTE va a aplicar este documento.
   *
   * Con perfil elegido manda el perfil, y `store_settings` no se mira NI COMO
   * RESPALDO. Es la misma precedencia del backend —`profile_aiu ?? (await
   * loadAiuSettings(...))`, donde el `??` corta el `await`—, y tiene que ser la
   * misma: si acá se cayera al setting mientras el servidor calcula por el
   * perfil, la pantalla instruiría sobre otra base gravable y el error no daría
   * síntoma, porque la DIAN acepta el documento —el XML cuadra consigo mismo— y
   * el faltante sólo aparece en una fiscalización.
   *
   * `null` mientras la lectura está en vuelo o falló: media instrucción es peor
   * que ninguna, y la instrucción EQUIVOCADA es peor que las dos.
   */
  readonly effectiveAiu = computed<InvoiceAiuSettings | null>(() => {
    const store = this.aiuSettings();
    if (this.selectedProfileId() === PROFILE_NONE) return store;
    if (this.profileConfigLoading() || this.profileConfigFailed()) return null;

    const aiu = this.profileAiu();
    // Un perfil SIN sección AIU no configura nada del AIU: el backend deja el
    // snapshot vacío y `resolveAiuContext` rechaza con `INVOICING_AIU_002` si el
    // documento es AIU. Caer al setting de la tienda acá pintaría un instructivo
    // que el servidor no va a honrar.
    if (!aiu || !store) return null;

    // `note_prefix`, `note_min_length` y `note_max_length` son constantes DIAN,
    // iguales para tienda y perfil: se heredan del setting en vez de duplicarse.
    const object = (aiu.contract_object ?? '').trim();
    const note = object ? `${store.note_prefix} ${object}` : '';
    return {
      ...store,
      regime: aiu.regime,
      contract_object: aiu.contract_object ?? '',
      enforce_minimum_base: aiu.enforce_minimum_base,
      // Conversión SÓLO para el texto del instructivo. El importe del piso lo
      // calcula el backend con el decimal exacto de la versión congelada.
      minimum_base_percent: Number(aiu.minimum_base_percent),
      note,
      note_length: note.length,
      note_valid:
        note.length >= store.note_min_length &&
        note.length <= store.note_max_length,
      // El perfil ELIGIÓ el régimen: no hay «valor por defecto» que advertir.
      is_default: false,
    };
  });

  /** Última consulta a la TRM oficial, o `null` si aún no se ha pedido. */
  readonly exchangeRateQuote = signal<ExchangeRateQuote | null>(null);
  readonly loadingExchangeRate = signal(false);

  /** `true` si la tasa del formulario difiere de la oficial resuelta. */
  readonly exchangeRateOverridden = computed<boolean>(() => {
    const quote = this.exchangeRateQuote();
    if (!quote?.rate) return false;
    const current = Number(this.rawValue()['exchange_rate']);
    if (!(current > 0)) return false;
    // Un centavo de tolerancia: el `Decimal` del backend llega como string con
    // más escala de la que el `number` del input puede sostener, y marcar como
    // «override» una diferencia de redondeo confundiría en vez de avisar.
    return Math.abs(current - Number(quote.rate)) > 0.01;
  });

  /** Por qué no hay tasa oficial, en la frase que corresponda al caso. */
  readonly exchangeRateUnavailableReason = computed<string>(() => {
    const code = String(this.rawValue()['foreign_currency'] ?? '')
      .trim()
      .toUpperCase();
    if (code === 'COP') {
      return 'El peso colombiano no lleva conversión: la DIAN rechaza declarar una tasa de 1,00 (FAR03).';
    }
    if (code && code !== 'USD') {
      return `No hay TRM directa para ${code}. La TRM es la única tasa con fuente oficial colombiana y sólo cotiza el dólar: escribe la tasa pactada y la fecha en que se fijó.`;
    }
    return 'No se pudo consultar la TRM oficial en este momento. Escribe la tasa a mano; la factura se puede emitir igual.';
  });

  /** Opciones del selector de concepto: código + nombre + tarifa a la vista. */
  readonly withholdingConceptOptions = computed<SelectorOption[]>(() =>
    this.withholdingConcepts().map((concept) => ({
      value: concept.id,
      label: concept.code + ' · ' + concept.name,
      description:
        formatRatePercent(concept.ratePercent) +
        (concept.withholdingType
          ? ' · ' + withholdingTypeLabel(concept.withholdingType)
          : ''),
    })),
  );

  /** Los dos lados de la operación, tal como los nombra el DTO del backend. */
  readonly withholdingRoleOptions: SelectorOption[] = [
    { value: 'practiced', label: 'La tienda retiene' },
    { value: 'suffered', label: 'A la tienda le retienen' },
  ];

  private taxesLoaded = false;
  private aiuSettingsLoaded = false;
  private withholdingConceptsLoaded = false;

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
   * La fórmula vive en `utils/invoice-line-math.ts` y NO aquí: el modal de
   * configuración avanzada enseña la previsión de la misma línea, y dos copias
   * de esta aritmética divergirían sin dar un solo error — sólo dos cifras
   * distintas para el mismo renglón.
   */
  readonly lineMath = computed<InvoiceLineMath[]>(() =>
    this.itemsValue().map((item) => computeLineMath(item)),
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

  /**
   * Instructivo del régimen AIU, derivado de la configuración REAL de la
   * tienda.
   *
   * Antes esta guía era un texto fijo que afirmaba «la base gravable es
   * únicamente la utilidad». Eso es la regla del Decreto 1372/1992, que aplica
   * a contratos de construcción de inmueble; bajo E.T. art. 462-1 —el default
   * del sistema, y el régimen de aseo, vigilancia y servicios temporales— la
   * base es el AIU COMPLETO. El texto fijo instruía activamente a sub-declarar
   * IVA a toda tienda del 462-1, y como la DIAN acepta el documento el error
   * no producía ningún síntoma hasta la fiscalización.
   *
   * `null` mientras la configuración se resuelve: media instrucción es peor
   * que ninguna.
   */
  readonly aiuGuidance = computed<{
    regimeLabel: string;
    regimeCitation: string;
    taxableLabel: string;
    instruction: string;
    minimumBase: string | null;
    isDefault: boolean;
  } | null>(() => {
    const settings = this.effectiveAiu();
    if (!settings) return null;

    if (settings.regime === 'decreto_1372_1992') {
      return {
        regimeLabel: 'Decreto 1372/1992',
        regimeCitation: 'art. 3 — contratos de construcción de inmueble',
        taxableLabel: 'Sólo Utilidad',
        instruction:
          'Declara el impuesto ÚNICAMENTE sobre las líneas de utilidad y deja sin impuesto las de administración e imprevistos: la DIAN rechaza el bloque cac:TaxTotal en las líneas que no hacen parte de la base gravable.',
        // El piso del 10 % es del 462-1; bajo el decreto no existe, y
        // mencionarlo acá haría que el comerciante infle una base que la ley
        // no le exige.
        minimumBase: null,
        isDefault: settings.is_default,
      };
    }

    return {
      regimeLabel: 'E.T. art. 462-1',
      regimeCitation: 'aseo y cafetería, vigilancia, servicios temporales',
      taxableLabel: 'AIU completo',
      instruction:
        'Declara el impuesto sobre las TRES líneas: bajo este régimen la base gravable es el AIU completo (administración + imprevistos + utilidad), no sólo la utilidad.',
      minimumBase: settings.enforce_minimum_base
        ? `La base no puede quedar por debajo del ${settings.minimum_base_percent}% del valor del contrato. Si queda por debajo, la emisión se rechaza indicando cuánto falta — el sistema no infla la base en silencio porque eso cambiaría el importe que el cliente firmó.`
        : null,
      isDefault: settings.is_default,
    };
  });

  /**
   * Líneas AIU que SÍ entran a la base gravable del régimen y salieron sin un
   * solo impuesto.
   *
   * Es la simétrica del aviso de arriba, y hasta ahora el hueco sólo se cerraba
   * en un sentido: poner impuesto donde no va se corregía server-side y se
   * reportaba, mientras que dejar de ponerlo donde sí va pasaba en silencio.
   * Bajo `et_462_1` la base es el AIU COMPLETO, así que una factura con IVA
   * sólo en Administración sub-declara el de Imprevistos y Utilidad — y la DIAN
   * la acepta, porque el XML cuadra consigo mismo.
   *
   * AVISO, no bloqueo: un componente exento o excluido es un caso legítimo y
   * bloquear impediría capturarlo. Mismo criterio que aplica el calculador del
   * backend con la divergencia `aiu_taxable_line_without_tax`.
   *
   * Se cuenta `taxes.length` de la línea: las retenciones se capturan en su
   * propia sección de este modal, no dentro de la línea, así que lo que hay en
   * `taxes` son impuestos del documento.
   */
  readonly aiuTaxableWithoutTax = computed<
    Array<{ index: number; label: string }>
  >(() => {
    const settings = this.effectiveAiu();
    if (!settings) return [];

    // Bajo el Decreto 1372/1992 sólo la utilidad grava; bajo el 462-1, los tres
    // componentes. Es la misma pregunta que responde `isAiuTaxable` en el
    // backend, y se escribe igual para que no puedan divergir.
    const isTaxable = (component: string): boolean =>
      settings.regime === 'et_462_1' ? true : component === 'utilidad';

    const labels = new Map(
      AIU_COMPONENT_OPTIONS.map((option) => [
        String(option.value),
        option.label,
      ]),
    );

    return this.itemsValue()
      .map((item, index) => ({ item, index }))
      .filter(
        ({ item }) =>
          !!item.aiu_component &&
          isTaxable(item.aiu_component) &&
          (item.taxes ?? []).length === 0,
      )
      .map(({ item, index }) => ({
        index,
        label: labels.get(item.aiu_component) ?? item.aiu_component,
      }));
  });

  /** Lo tecleado en este documento, ya recortado como lo recorta el backend. */
  readonly aiuContractObject = computed<string>(() =>
    String(this.rawValue()['aiu_contract_object'] ?? '').trim(),
  );

  /**
   * La nota `cbc:Note` que REALMENTE saldría al XML, con la precedencia del
   * backend: objeto del documento primero, objeto de la tienda como respaldo.
   *
   * Se recompone acá con la misma fórmula de `buildAiuNote` —prefijo + UN
   * espacio + objeto— porque el contador y el veredicto tienen que medir la
   * cadena que viaja, no el texto suelto. La cota de CAV03 es sobre la nota
   * completa; contar sólo lo tecleado diría «cumple» 42 caracteres antes de que
   * sea cierto.
   *
   * `null` mientras la configuración se resuelve: media instrucción es peor que
   * ninguna.
   */
  readonly aiuEffectiveNote = computed<{
    source: 'invoice' | 'profile' | 'store' | 'none';
    object: string;
    note: string;
    length: number;
    valid: boolean;
    min: number;
    max: number;
    remaining: number;
  } | null>(() => {
    const settings = this.effectiveAiu();
    if (!settings) return null;

    const own = this.aiuContractObject();
    const inherited = (settings.contract_object ?? '').trim();
    const object = own || inherited;
    const note = object ? `${settings.note_prefix} ${object}` : '';

    return {
      // `profile` y `store` se separan porque el usuario tiene que saber DÓNDE
      // ir a cambiar lo que está heredando: con perfil, el objeto sale de la
      // versión del perfil y Ajustes → Facturación → AIU no lo toca.
      source: own
        ? 'invoice'
        : inherited
          ? this.selectedProfileId() === PROFILE_NONE
            ? 'store'
            : 'profile'
          : 'none',
      object,
      note,
      length: note.length,
      valid:
        note.length >= settings.note_min_length &&
        note.length <= settings.note_max_length,
      min: settings.note_min_length,
      max: settings.note_max_length,
      remaining: settings.note_max_length - note.length,
    };
  });

  /**
   * Objeto del contrato faltante o demasiado corto.
   *
   * La regla CAV03 exige que la nota de la línea de Administración —incluido el
   * prefijo obligatorio— mida entre 20 y 5.000 caracteres. Es el bloqueante de
   * la emisión AIU que más caro sale descubrir tarde: sin él la factura se
   * captura entera y revienta al validar.
   *
   * Se mide contra la nota EFECTIVA, no contra `settings.note_valid`: desde que
   * el documento puede traer su propio objeto de contrato, una tienda sin objeto
   * configurado ya no implica una emisión rota — implica que este documento
   * tiene que traerlo.
   */
  readonly aiuNoteBlocked = computed<boolean>(() => {
    const note = this.aiuEffectiveNote();
    return !!note && !note.valid;
  });

  /**
   * Dónde se cambia el RÉGIMEN que se está aplicando.
   *
   * Con perfil, Ajustes → Facturación → AIU no gobierna este documento: el
   * régimen sale de la versión del perfil. Mandar ahí al usuario le haría cambiar
   * un valor que no afecta a la factura que tiene en pantalla, y creer que sí.
   */
  readonly aiuRegimeOriginHint = computed<string>(() => {
    const profile = this.selectedProfile();
    return profile
      ? `El régimen viene del perfil «${profile.name}» (versión ${profile.current_version}) y se edita en Facturación → Perfiles.`
      : 'El régimen se elige en Ajustes → Facturación → AIU.';
  });

  /** Insignia del origen del objeto del contrato que va a viajar en la nota. */
  readonly aiuNoteSourceLabel = computed<string>(() => {
    switch (this.aiuEffectiveNote()?.source) {
      case 'invoice':
        return 'Propio de esta factura';
      case 'profile':
        return 'Heredado del perfil';
      case 'store':
        return 'Heredado de la tienda';
      default:
        return 'Sin definir';
    }
  });

  /**
   * Dónde se cambia lo que este documento hereda.
   *
   * Con perfil elegido, mandar al usuario a Ajustes → Facturación → AIU sería
   * mandarlo a una pantalla que NO afecta a este documento: el backend deriva el
   * AIU de la versión del perfil y no lee el setting ni como respaldo.
   */
  readonly aiuInheritanceHint = computed<string>(() => {
    const profile = this.selectedProfile();
    return profile
      ? `Déjalo vacío para heredar el del perfil «${profile.name}».`
      : 'Déjalo vacío para heredar el de Ajustes → Facturación → AIU.';
  });

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
    // Las retenciones, igual: `withholdings.<i>.<campo>`.
    for (const path of Object.keys(backend)) {
      if (path.startsWith('items.')) {
        counts[path.endsWith('.account_code') ? 'contabilidad' : 'lineas'] += 1;
      } else if (path.startsWith('withholdings.')) {
        counts.retenciones += 1;
      }
    }
    // Sin esto, una fila de retención incompleta deja el formulario inválido y
    // la pestaña de Retenciones no muestra ni un solo error: el usuario ve el
    // botón deshabilitado sin saber dónde mirar.
    for (const group of this.withholdingControls()) {
      for (const name of ['concept_id', 'rate', 'base']) {
        const control = group.get(name);
        if (control && control.invalid && control.touched) {
          counts.retenciones += 1;
        }
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
    // La nota CAV03 es bloqueante de emisión, así que la cabecera plegada de la
    // sección tiene que delatarla: si no, el usuario cierra AIU convencido de
    // que quedó completa y descubre el faltante recién al enviar.
    if (this.isAiu() && this.aiuNoteBlocked()) {
      counts.aiu += 1;
    }
    return counts;
  });

  /**
   * Número (1-based) de la primera fila de retención incompleta, o 0 si no hay.
   *
   * 1-based porque el número se le muestra al usuario, y la sección enumera las
   * retenciones tal como las ve, no como las indexa el `FormArray`.
   */
  readonly incompleteWithholdingRow = computed<number>(() => {
    if (this.isManualWithholding()) return 0;
    const rows = this.withholdingsValue();
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (
        row.concept_id == null ||
        !(Number(row.rate) > 0) ||
        !(Number(row.base) > 0)
      ) {
        return i + 1;
      }
    }
    return 0;
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
        ? 'Se facturará el pedido elegido, con sus líneas e impuestos.'
        : 'Busca el pedido por su número, por el cliente o por su id.';
    }
    if (this.itemCount() === 0) return 'Agrega al menos una línea.';
    if (!this.activeResolution()) {
      return 'No hay resolución activa: el servidor rechazará la factura.';
    }
    if (this.isCredit() && !this.rawValue()['due_date']) {
      return 'Venta a crédito: declara la fecha de vencimiento.';
    }
    // Se nombra antes del genérico porque la sección de retenciones va plegada:
    // «revisa los campos marcados» manda a buscar una marca que no está a la
    // vista, y era la queja más fácil de evitar.
    if (this.incompleteWithholdingRow() > 0) {
      return `La retención #${this.incompleteWithholdingRow()} está incompleta: elige concepto, tarifa y base.`;
    }
    if (this.formStatus() !== 'VALID') return 'Revisa los campos marcados.';
    return 'Todo listo para emitir.';
  });

  /**
   * Acciones de la cabecera.
   *
   * `computed` y no un arreglo fijo: dependen de `submitting()`,
   * `checkingEmitReadiness()` y `draftCreated()`, y un arreglo plano en zoneless
   * dejaría el botón congelado en su estado inicial.
   *
   * Guardar NO se apaga por `formStatus()`. Es una decisión de esta pantalla:
   * un botón mudo con ocho secciones plegadas no dice dónde está el problema,
   * así que el envío arranca siempre y `collectBlockers()` enumera qué falta.
   * Cancelar NUNCA se deshabilita: salir siempre tiene que poder.
   */
  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    {
      id: 'cancel',
      label: 'Cancelar',
      variant: 'outline',
      icon: 'x',
    },
    {
      id: 'save',
      label:
        this.mode() === 'from_order' ? 'Crear desde pedido' : 'Crear factura',
      variant: 'primary',
      icon: 'save',
      loading: this.submitting() || this.checkingEmitReadiness(),
      disabled:
        this.submitting() || this.checkingEmitReadiness() || this.draftCreated(),
      title: this.submitHint(),
    },
  ]);

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

  // ── Ciclo de vida de la página ──────────────────────────────

  ngOnInit(): void {
    // LAS RESOLUCIONES SE PIDEN AQUÍ. En el modal las traía el contenedor del
    // listado, que vive bajo el shell del módulo; esta vista cuelga FUERA de ese
    // shell, así que nadie más las despacha y el selector llegaría vacío — con
    // el efecto de que la factura se numeraría a ciegas.
    this.store.dispatch(loadResolutions());
    this.initializeCapture();
  }

  /**
   * Arranque de una captura nueva.
   *
   * Antes era `onOpened()`, el gancho del modal. Se conserva como método propio
   * porque hace dos cosas distintas —limpiar el veredicto de la sesión anterior
   * y cargar los catálogos— y ambas son también lo que hay que hacer al reusar
   * la vista sin destruirla.
   */
  private initializeCapture(): void {
    // Red de seguridad: un id de borrador colgado cerraría el envío para
    // siempre. Entrar a la vista es siempre el comienzo de una factura nueva.
    this.createdInvoiceId.set(null);
    this.emitRequirements.set([]);
    this.emitRequirementsOpen.set(false);
    this.checkingEmitReadiness.set(false);

    this.loadTaxCatalog();
    this.loadAiuSettings();
    this.loadProfileCatalog();
    this.loadWithholdingConcepts();
    // Los productos YA NO se precargan: el selector busca contra el servidor
    // cada vez que se abre. Precargar una página era lo que hacía infacturable
    // el producto 201 de una tienda.
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

  /**
   * Configuración AIU de la tienda.
   *
   * Se pide SIEMPRE al abrir, no sólo cuando el documento ya está marcado como
   * AIU: el usuario puede cambiar el tipo de operación en cualquier momento y
   * el instructivo tiene que estar listo cuando lo haga, no una petición
   * después.
   */
  private loadAiuSettings(): void {
    if (this.aiuSettingsLoaded) return;
    this.aiuSettingsLoaded = true;
    this.aiuSettingsService
      .load()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((settings) => this.aiuSettings.set(settings));
  }

  /**
   * Catálogo de perfiles activos del tenant.
   *
   * FALLA EN SILENCIO A PROPÓSITO. Si la petición no responde, el catálogo queda
   * vacío, el selector no se pinta y el wizard se comporta exactamente como el
   * flujo manual —que es lo que hacía antes de esta fase—. Cualquier otra
   * degradación (bloquear el envío, reintentar en bucle, pintar el selector
   * deshabilitado) dejaría al tenant sin poder facturar por un fallo en una
   * lectura secundaria.
   */
  private loadProfileCatalog(): void {
    if (this.profileCatalogLoaded) return;
    this.profileCatalogLoaded = true;
    this.profileService
      .catalog()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.profileCatalog.set(response?.data ?? []);
          this.syncProfileSelection();
        },
        error: () => this.profileCatalog.set([]),
      });
  }

  /**
   * Ajusta el perfil elegido al tipo de operación vigente.
   *
   * Se llama al llegar el catálogo, al cambiar el tipo de operación y al
   * reiniciar el formulario. En el segundo caso es OBLIGATORIO: el backend
   * rechaza con `INVOICING_PROFILE_008` un perfil cuyo `operation_type` no
   * coincide con el del documento, así que dejar puesto el perfil AIU al volver a
   * «Estándar» convertiría el envío en un 409 sobre un campo que ya no se ve.
   *
   * Precedencia (ADR-9): un perfil ya elegido que sigue siendo válido se respeta
   * —nunca se pisa una elección del usuario—; si no, se preselecciona el
   * predeterminado del tipo. Con exactamente un activo se elige ése aunque no
   * esté marcado como predeterminado: es el caso de F.2, el que lleva banner.
   * Sin candidatos, se vuelve al flujo manual.
   */
  private syncProfileSelection(): void {
    const options = this.profilesForType();
    const current = this.selectedProfileId();

    if (current !== PROFILE_NONE && options.some((e) => e.id === current)) {
      // Sigue siendo válido. Sólo hay que garantizar que sus reglas estén
      // leídas: el catálogo pudo llegar después de que el usuario tocara el
      // selector, y en ese orden nadie habría disparado la lectura.
      if (
        !this.profileAiu() &&
        !this.profileConfigLoading() &&
        !this.profileConfigFailed()
      ) {
        this.loadProfileConfig(current);
      }
      return;
    }

    const next =
      options.length === 1
        ? options[0]
        : (options.find((entry) => entry.is_default) ?? null);

    this.applyProfile(next ? next.id : PROFILE_NONE);
  }

  /** Escribe el perfil en el formulario y dispara la lectura de sus reglas. */
  private applyProfile(id: number): void {
    const control = this.invoiceForm.get('profile_id');
    if (!control) return;
    if (Number(control.value) === id) {
      // Ya estaba puesto: sólo asegurar las reglas. Reescribir emitiría un
      // `valueChanges` que no cambia nada y recomputaría media pantalla.
      this.loadProfileConfig(id);
      return;
    }
    // Con `emitEvent` por defecto: el `computed` que lee el valor crudo depende
    // de `formValue()`, y silenciar el evento dejaría el selector pintando el
    // valor anterior.
    control.setValue(id);
    this.loadProfileConfig(id);
  }

  /**
   * Reglas de la versión vigente del perfil.
   *
   * Se leen de `GET /profiles/:id` y NO del catálogo: el catálogo vive en Redis y
   * su propio contrato lo prohíbe —una `config` en caché es una tarifa fiscal con
   * fecha de caducidad—. Lo que se pinta con esto es INSTRUCTIVO; el cálculo del
   * documento lo hace el backend contra la versión que congela al timbrar, así
   * que una lectura rancia acá no puede alterar el XML.
   */
  private loadProfileConfig(id: number): void {
    const request = ++this.profileConfigRequest;

    if (id === PROFILE_NONE) {
      this.profileAiu.set(null);
      this.profileConfigLoading.set(false);
      this.profileConfigFailed.set(false);
      return;
    }

    this.profileConfigLoading.set(true);
    this.profileConfigFailed.set(false);
    this.profileService
      .getById(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (request !== this.profileConfigRequest) return;
          this.profileAiu.set(response?.data?.current_config?.aiu ?? null);
          this.profileConfigLoading.set(false);
        },
        error: () => {
          if (request !== this.profileConfigRequest) return;
          this.profileAiu.set(null);
          this.profileConfigLoading.set(false);
          this.profileConfigFailed.set(true);
        },
      });
  }

  /** El usuario cambió de perfil en el selector. */
  onProfileChange(): void {
    this.clearSubmitError();
    this.loadProfileConfig(this.selectedProfileId());
  }

  /** Reintento explícito cuando la lectura de las reglas del perfil falló. */
  retryProfileConfig(): void {
    this.loadProfileConfig(this.selectedProfileId());
  }

  // ── Tasa de cambio oficial ──────────────────────────────────

  /**
   * Pide la TRM y la propone como valor del campo.
   *
   * Se dispara al cambiar la divisa o la fecha, no en cada tecla del importe:
   * la tasa depende de esos dos y de nada más.
   *
   * NO pisa un valor que el usuario ya escribió. La tasa pactada en un contrato
   * puede diferir legítimamente de la TRM del día y quien responde por ella ante
   * la DIAN es el emisor: el endpoint propone, el formulario no impone. Cuando
   * difieren, el aviso ofrece «Usar la oficial» en vez de decidir por él.
   */
  onExchangeRateInputsChanged(): void {
    const raw = this.invoiceForm.getRawValue() as Record<string, unknown>;
    const currency = String(raw['foreign_currency'] ?? '').trim().toUpperCase();
    if (!currency) {
      this.exchangeRateQuote.set(null);
      return;
    }

    const date = String(raw['exchange_rate_date'] ?? '').trim();
    this.loadingExchangeRate.set(true);
    this.exchangeRateService
      .quote({ currency, ...(date ? { date } : {}) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((quote) => {
        this.loadingExchangeRate.set(false);
        this.exchangeRateQuote.set(quote);
        if (!quote?.rate) return;

        // La fecha efectiva la fija el backend cuando el formulario no la
        // declara. Reflejarla evita que el documento diga «TRM» sin decir de
        // qué día, que es justo lo que exige `cbc:Date` (FAR07).
        if (!date) {
          this.invoiceForm
            .get('exchange_rate_date')
            ?.setValue(quote.date, { emitEvent: true });
        }

        const current = Number(this.invoiceForm.get('exchange_rate')?.value);
        if (!(current > 0)) {
          this.invoiceForm.get('exchange_rate')?.setValue(Number(quote.rate));
        }
      });
  }

  /** Sustituye la tasa tecleada por la oficial, a petición del usuario. */
  applyOfficialExchangeRate(): void {
    const quote = this.exchangeRateQuote();
    if (!quote?.rate) return;
    this.invoiceForm.get('exchange_rate')?.setValue(Number(quote.rate));
    this.invoiceForm.get('exchange_rate_date')?.setValue(quote.date);
  }

  private loadWithholdingConcepts(): void {
    if (this.withholdingConceptsLoaded) return;
    this.withholdingConceptsLoaded = true;
    this.withholdingCatalog
      .load()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((concepts) => this.withholdingConcepts.set(concepts));
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

  /**
   * Error del buscador de pedidos.
   *
   * `order_id` es como lo nombra el backend en un rechazo del `ParseIntPipe`;
   * el mensaje local cubre el caso normal —pulsar «Crear desde pedido» sin
   * haber elegido ninguno—, que antes no decía absolutamente nada.
   */
  orderSelectError(): string | undefined {
    const backend = this.fieldError('order_id');
    if (backend) return backend;
    if (this.orderIdControl.touched && !this.orderIdValue()) {
      return 'Elige el pedido que se va a facturar.';
    }
    return undefined;
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

  /**
   * Igual que `dueDateError()`: el backend también lo rechaza, pero decirlo
   * junto al campo evita el viaje y, sobre todo, evita que el usuario lo
   * descubra cuando la DIAN ya se comió el consecutivo.
   */
  verificationDigitError(): string | undefined {
    const backend = this.fieldError('customer_verification_digit');
    if (backend) return backend;
    if (!this.isNitCustomer()) return undefined;
    const raw = this.rawValue();
    const taxId = String(raw['customer_tax_id'] ?? '')
      .trim()
      .split('-')[0];
    const dv = String(raw['customer_verification_digit'] ?? '').trim();
    if (!taxId || !dv || isValidNitDv(taxId, dv)) return undefined;
    return `No corresponde al NIT ${taxId} (debería ser ${computeNitDv(taxId)})`;
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
    // El perfil está ligado al tipo: cambiar el tipo puede invalidar el elegido
    // y, con él, la base gravable que la pantalla está instruyendo.
    this.syncProfileSelection();

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
    this.appendItem();
  }

  /**
   * Igual que `addItem`, pero DEVUELVE el grupo recién creado.
   *
   * Se lee del `FormArray` y no de `itemControls()`: ese `computed` se refresca
   * a través de `toSignal(valueChanges)`, y quien acaba de empujar la fila
   * necesita el control AHORA para escribirle encima, no en el siguiente ciclo.
   */
  private appendItem(): FormGroup | null {
    if (this.itemsArray.length >= 100) return null;
    this.nextRowUid += 1;
    const group = this.fb.group({
      row_uid: ['row-' + this.nextRowUid],
      product_id: [null as number | null],
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
    });
    this.itemsArray.push(group);
    return group;
  }

  removeItem(index: number): void {
    this.itemsArray.removeAt(index);
  }

  addWithholding(): void {
    this.nextWithholdingUid += 1;
    this.withholdingsArray.push(
      this.fb.group({
        row_uid: ['wh-' + this.nextWithholdingUid],
        // `concept_id` es lo que el backend exige (`InvoiceWithholdingInputDto`);
        // `concept` es sólo la etiqueta que se muestra y que viaja a ningún lado.
        // Sin el id la fila no se puede resolver, así que es OBLIGATORIO y no
        // un filtro silencioso: una fila descartada al enviar desalinearía los
        // índices con los que el backend reporta sus errores
        // (`withholdings.0.rate`) y el mensaje se pintaría sobre otra fila.
        concept_id: [
          null as number | null,
          { validators: [Validators.required] },
        ],
        concept: [''],
        // 'practiced' = la tienda retiene al cliente (lo normal al facturar).
        // 'suffered'  = al cliente le corresponde retener a la tienda.
        role: [
          'practiced' as 'practiced' | 'suffered',
          { validators: [Validators.required] },
        ],
        /**
         * PORCENTAJE. La conversión a fracción se hace en el payload.
         * `max: 100` acompaña al `@Max(1)` del backend sobre la fracción: son
         * la misma cota expresada en cada escala.
         */
        rate: [
          0,
          {
            validators: [
              Validators.required,
              Validators.min(0.0001),
              Validators.max(100),
            ],
          },
        ],
        // La base por defecto es la base gravable del documento, que es sobre
        // lo que se retiene en la práctica. Editable porque hay conceptos que
        // retienen sobre otra base.
        base: [
          Math.round(this.totals().base),
          { validators: [Validators.required, Validators.min(0.01)] },
        ],
      }),
    );
  }

  /**
   * El toggle de importe manual VACÍA la rama contraria.
   *
   * Las dos ramas son excluyentes en el payload (ver `buildPayload`), y dejarlas
   * pobladas a la vez tiene dos consecuencias concretas: el formulario queda
   * inválido para siempre por filas que ya no se ven —los validadores de la fila
   * siguen corriendo aunque la sección pinte el input manual—, y el usuario
   * puede terminar declarando dos verdades distintas sobre la misma retención.
   */
  onManualWithholdingChange(): void {
    if (this.isManualWithholding()) {
      this.withholdingsArray.clear();
      return;
    }
    this.invoiceForm.get('withholding_amount')?.setValue(null);
  }

  /**
   * Elegir un concepto rellena tarifa y etiqueta desde el catálogo.
   *
   * La tarifa queda EDITABLE a propósito: hay conceptos con tarifa diferencial
   * por cuantía o por tipo de proveedor, y forzar la del catálogo obligaría al
   * contador a crear un concepto nuevo para una excepción de una factura.
   */
  onWithholdingConceptChange(index: number): void {
    const group = this.withholdingsArray.at(index) as FormGroup | null;
    if (!group) return;
    const conceptId = Number(group.get('concept_id')?.value);
    const concept = this.withholdingConcepts().find((c) => c.id === conceptId);
    if (!concept) return;
    group.get('concept')?.setValue(concept.name);
    group.get('rate')?.setValue(concept.ratePercent);
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

  // ── Ítems: inventario e ítem personalizado ──────────────────

  /** Picker apuntado a una fila existente: vincula el producto a ESA línea. */
  openProductPicker(item: AbstractControl): void {
    this.pickerTargetUid.set(this.rowUid(item));
    this.productPickerOpen.set(true);
  }

  /** Picker sin destino: lo que se elija AÑADE una línea. */
  openProductPickerForNewLine(): void {
    if (this.itemsArray.length >= 100) return;
    this.pickerTargetUid.set(null);
    this.productPickerOpen.set(true);
  }

  closeProductPicker(): void {
    this.productPickerOpen.set(false);
    this.pickerTargetUid.set(null);
  }

  /**
   * El producto elegido hidrata la línea.
   *
   * La opción trae ya el nombre y el precio base, así que no hace falta el
   * `Map` paralelo que había antes: un espejo del catálogo indexado en memoria
   * es una copia que se desactualiza en cuanto la búsqueda deja de ser local.
   */
  onProductPicked(product: InvoiceProductOption): void {
    const uid = this.pickerTargetUid();
    this.productPickerOpen.set(false);
    this.pickerTargetUid.set(null);

    const group = uid
      ? this.itemControls().find((item) => this.rowUid(item) === uid)
      : this.appendItem();
    if (!group) return;

    const patch: Record<string, unknown> = {
      product_id: product.id,
      product_name: product.name,
    };
    // La descripción sólo se pisa si el usuario no escribió una: la suya manda,
    // porque es la que la DIAN publica en `cbc:Description`.
    if (!String(group.get('description')?.value ?? '').trim()) {
      patch['description'] = product.name;
    }
    // `basePrice` y NO el precio final: éste último ya lleva impuesto dentro y
    // el precio unitario que se captura es la base. Mandar el precio con
    // impuesto y además declarar el impuesto como adicional lo cobraría dos
    // veces.
    if (!Number(group.get('unit_price')?.value)) {
      patch['unit_price'] = product.basePrice;
    }
    group.patchValue(patch);
  }

  /** Desde el picker: «no está en mi inventario, lo facturo igual». */
  onCustomItemRequested(): void {
    this.productPickerOpen.set(false);
    const uid = this.pickerTargetUid();
    this.pickerTargetUid.set(null);
    if (uid) {
      const group = this.itemControls().find((item) => this.rowUid(item) === uid);
      if (group) {
        this.openAdvancedItem(group);
        return;
      }
    }
    this.openCustomItemForNewLine();
  }

  /** Ítem personalizado en blanco: añade una línea al guardar. */
  openCustomItemForNewLine(): void {
    if (this.itemsArray.length >= 100) return;
    this.customItemTargetUid.set(null);
    this.customItemEditing.set(false);
    this.customItemDraft.set(null);
    this.customItemOpen.set(true);
  }

  /** Configuración avanzada de una línea que ya existe. */
  openAdvancedItem(item: AbstractControl): void {
    const value = item.value as InvoiceItemFormValue;
    this.customItemTargetUid.set(this.rowUid(item));
    this.customItemEditing.set(true);
    this.customItemDraft.set({
      product_id: value.product_id ?? null,
      product_name: value.product_name ?? '',
      description: value.description ?? '',
      quantity: Number(value.quantity) || 0,
      unit_code: value.unit_code || UNIT_CODE_DEFAULT,
      unit_price: Number(value.unit_price) || 0,
      discount_amount: Number(value.discount_amount) || 0,
      taxes: Array.isArray(value.taxes) ? [...value.taxes] : [],
      account_code: value.account_code ?? '',
      aiu_component: value.aiu_component ?? '',
    });
    this.customItemOpen.set(true);
  }

  /**
   * El modal avanzado devolvió la línea. Se escribe sobre la fila apuntada, o
   * se crea una nueva cuando el modal se abrió sin destino.
   */
  onCustomItemSaved(draft: InvoiceCustomItemDraft): void {
    this.customItemOpen.set(false);
    const uid = this.customItemTargetUid();
    this.customItemTargetUid.set(null);

    const group = uid
      ? this.itemControls().find((item) => this.rowUid(item) === uid)
      : this.appendItem();
    if (!group) return;

    group.patchValue({
      product_id: draft.product_id,
      product_name: draft.product_name,
      description: draft.description,
      quantity: draft.quantity,
      unit_code: draft.unit_code,
      unit_price: draft.unit_price,
      discount_amount: draft.discount_amount,
      taxes: draft.taxes,
      account_code: draft.account_code,
      aiu_component: draft.aiu_component,
    });
    this.setSection('lineas', true);
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
        // Antes esto era un `return` mudo: se pulsaba «Crear desde pedido» y no
        // pasaba absolutamente nada. Un botón que no responde y no explica es
        // indistinguible de una pantalla rota.
        this.orderIdControl.markAsTouched();
        this.submitError.set(
          'La factura no se envió: falta decir QUÉ pedido se va a facturar.',
        );
        this.submitErrorDetails.set([
          'Busca el pedido por su número (p. ej. ORD-000142), por el nombre o el correo del cliente, o pega su id si lo conoces.',
        ]);
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
        blockers.length === 1
          ? 'La factura no se envió: falta 1 dato que la DIAN rechazaría, y el consecutivo autorizado no se recupera.'
          : `La factura no se envió: faltan ${blockers.length} datos que la DIAN rechazaría, y el consecutivo autorizado no se recupera.`,
      );
      // Los avisos viajan JUNTO a los bloqueantes, no en una segunda pasada: el
      // usuario corrige una vez y vuelve a enviar una vez.
      this.submitErrorDetails.set([
        ...blockers,
        ...this.collectAdvisories().map((advisory) => 'Aviso: ' + advisory),
      ]);
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
    // El DV es un checksum, no un dato: si no cuadra con el NIT, la DIAN
    // rechaza la identificación del adquiriente DESPUÉS de haber consumido el
    // consecutivo autorizado, que no se recupera. Se verifica acá con el mismo
    // módulo-11 que aplica `@NitDvMatches()` en el backend.
    if (this.isNitCustomer()) {
      // `900123456-7` ya trae el DV pegado: recortarlo evita un error falso.
      const taxId = String(raw['customer_tax_id'] ?? '')
        .trim()
        .split('-')[0];
      const dv = String(raw['customer_verification_digit'] ?? '').trim();
      if (taxId && dv && !isValidNitDv(taxId, dv)) {
        blockers.push(
          `El dígito de verificación ${dv} no corresponde al NIT ${taxId}: el módulo-11 da ${computeNitDv(taxId)}. Corrígelo antes de emitir.`,
        );
      }
    }
    if (this.itemsArray.length === 0) {
      blockers.push('La factura necesita al menos una línea.');
    }
    // Se prefiere el motivo REAL de la lista vacía (vencidas / agotadas /
    // ninguna) al genérico: son tres arreglos distintos y el usuario no puede
    // adivinar cuál le toca.
    if (!this.activeResolution()) {
      blockers.push(
        this.resolutionEmptyReason() ??
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
    // Espejo exacto de lo que el backend valida en `resolveAiuContext` antes de
    // tomar consecutivo. Se repite acá para que el usuario lo lea con la factura
    // todavía en pantalla, no en un error de servidor.
    if (this.isAiu()) {
      const note = this.aiuEffectiveNote();
      if (note && !note.valid) {
        blockers.push(
          note.length > note.max
            ? `El objeto del contrato AIU deja la nota CAV03 en ${note.length} caracteres y el máximo es ${note.max}. Recórtalo.`
            : 'La operación es AIU (09) y no hay objeto del contrato. La regla CAV03 exige la nota en la línea de Administración: descríbelo en la sección AIU o en Ajustes → Facturación.',
        );
      }
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
      const value = group.value as InvoiceItemFormValue;
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
      // El descuento que se come la línea NO produce un error ni un negativo:
      // `lineGross` la recorta a cero y la factura sale con un renglón de cero
      // que la DIAN acepta y que nadie cobra. Es el fallo más silencioso de
      // esta pantalla desde que el descuento por línea existe.
      if (lineDiscountExceedsSubtotal(value)) {
        blockers.push(
          label +
            `: el descuento (${this.formatCurrency(Number(value.discount_amount) || 0)}) iguala o supera el subtotal de la línea (${this.formatCurrency(
              (Number(value.quantity) || 0) * (Number(value.unit_price) || 0),
            )}). La línea quedaría en cero.`,
        );
      }
      // Una unidad de medida vacía saldría al XML como `@unitCode` en blanco y
      // la DIAN rechaza el documento entero por una línea (regla FAJ).
      if (!String(value.unit_code ?? '').trim()) {
        blockers.push(
          label +
            ': falta la unidad de medida. Sale al XML como @unitCode y la DIAN no acepta el atributo vacío.',
        );
      }
    });

    const email = String(raw['customer_email'] ?? '').trim();
    if (email && this.invoiceForm.get('customer_email')?.hasError('email')) {
      blockers.push(
        'El correo del adquiriente no es válido. Es la dirección a la que se entrega la factura electrónica.',
      );
    }
    // OJO: la FALTA de correo NO entra aquí. Una venta a consumidor final se
    // factura sin él y bloquearla dejaría sin emitir el caso más común del
    // comercio. Ese hallazgo lo reporta la puerta de emisión con su severidad
    // real, sobre el documento ya persistido.

    return blockers;
  }

  /**
   * AVISOS: cosas que conviene saber y que NO impiden emitir.
   *
   * Van separadas de `collectBlockers()` a propósito. Mezclarlas convertiría
   * una recomendación en un muro: un aviso que bloquea es un bloqueo, y esta
   * pantalla ya tiene la fama de decir «revisa el formulario» sin decir qué.
   */
  private collectAdvisories(): string[] {
    const advisories: string[] = [];
    const raw = this.rawValue();

    if (!String(raw['customer_email'] ?? '').trim()) {
      advisories.push(
        'El adquiriente no tiene correo: la factura se emite igual, pero no hay a dónde entregarla electrónicamente.',
      );
    }
    if (!String(raw['customer_tax_id'] ?? '').trim()) {
      advisories.push(
        'El adquiriente no declara número de documento. Sólo es correcto si la venta es a consumidor final.',
      );
    }
    if (
      this.availableTaxes().length > 0 &&
      this.itemsValue().every((item) => (item.taxes ?? []).length === 0)
    ) {
      advisories.push(
        'Ninguna línea declara impuesto y tu tienda sí tiene catálogo. Sólo es correcto si toda la operación es excluida o exenta.',
      );
    }
    return advisories;
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
   * `resolution_id` SÍ viaja desde que el selector volvió. No es un cambio de
   * contrato: `CreateInvoiceDto` ya lo declaraba opcional y el servicio ya lo
   * pasaba a `generateNextNumber`. Lo que cambia es quién decide — antes el
   * backend caía a su búsqueda por tipo de documento (que ordena por
   * `created_at desc`, o sea la MÁS RECIENTE); ahora manda lo que el usuario
   * leyó en el banner. Sólo se omite si no hay ninguna elegible, y en ese caso
   * `collectBlockers()` ya frenó el envío.
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
          // Sólo un identificador REAL de `tax_rates` viaja: el catálogo marca
          // con negativo la categoría legada que no tiene fila de tarifa, y esa
          // columna es una clave foránea. Ver `InvoiceTaxCatalogService`.
          ...(tax.tax_rate_id > 0 ? { tax_rate_id: tax.tax_rate_id } : {}),
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
    // El id sólo viaja si es un entero positivo real: un `null` colado se
    // convertiría en `NaN` y `forbidNonWhitelisted` devolvería un 400 nombrando
    // un campo que el usuario sí vio, pero por un motivo que no entendería.
    const resolutionId = Number(raw['resolution_id']);
    if (Number.isFinite(resolutionId) && resolutionId > 0) {
      payload.resolution_id = resolutionId;
    }
    if (raw['due_date']) payload.due_date = String(raw['due_date']);
    if (raw['payment_form']) payload.payment_form = String(raw['payment_form']);
    if (raw['payment_means_code']) {
      payload.payment_means_code = String(raw['payment_means_code']);
    }
    if (raw['operation_type']) {
      payload.operation_type = String(raw['operation_type']);
    }
    // Se toma del CATÁLOGO, no del valor crudo del control: así un id que quedó
    // puesto tras cambiar el tipo de operación —o cuando el catálogo no se pudo
    // leer— no llega nunca al backend, y el 409 `INVOICING_PROFILE_008` queda
    // inalcanzable desde esta pantalla. Ausente ⇒ flujo manual, idéntico a hoy.
    const selectedProfile = this.selectedProfile();
    if (selectedProfile) {
      payload.profile_id = selectedProfile.id;
    }
    // Sólo si la operación es AIU y el usuario efectivamente escribió algo: en
    // cualquier otro caso se omite para que el backend herede el de la tienda,
    // que es la precedencia que aplica `resolveAiuContext`. Mandar cadena vacía
    // persistiría un override vacío y rompería la herencia.
    const aiuContractObject = this.aiuContractObject();
    if (this.isAiu() && aiuContractObject) {
      payload.aiu_contract_object = aiuContractObject;
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
    //
    // El importe manual y el desglose son las dos ramas EXCLUYENTES del toggle
    // de la sección: mandar filas mientras el usuario escribió un agregado a
    // mano declararía dos verdades distintas sobre la misma retención.
    //
    // SIN `filter`, a propósito. Los tres campos que harían descartar una fila
    // (`concept_id`, `rate`, `base`) son `Validators.required` del grupo, así
    // que una fila incompleta bloquea el envío en vez de desaparecer de él. Y
    // el mapeo 1:1 es lo que mantiene alineados los índices con los que el
    // backend reporta sus errores (`withholdings.0.rate`): filtrar aquí haría
    // que `applyBackendValidationErrors` pintara el mensaje sobre otra fila.
    if (!this.isManualWithholding()) {
      const withheldRows = this.withholdingsValue()
        .map((row) => ({
          role: (row.role ?? 'practiced') as 'practiced' | 'suffered',
          concept_id: Number(row.concept_id),
          base_amount: round2(Number(row.base)),
          // ⚠️ PORCENTAJE → FRACCIÓN. El formulario captura «Tarifa %» (2.5) y
          // `InvoiceWithholdingInputDto.rate` es una FRACCIÓN (0.025), porque
          // el backend calcula `base.times(rate)` sin dividir entre 100 —igual
          // que `WithholdingCalculatorService` sobre `withholding_concepts.rate`,
          // que es `Decimal(7,4)` en fracción.
          //
          // Mandar el porcentaje crudo persistiría una retención CIEN VECES
          // mayor sin un solo error visible: la aritmética interna cuadra
          // consigo misma, sólo que sobre la escala equivocada. Ésta es la
          // única división de escala del formulario; el `@Max(1)` del DTO es la
          // red de seguridad del backend.
          rate: Number((Number(row.rate) / 100).toFixed(6)),
          // El importe viaja SIEMPRE calculado con la misma fórmula que pinta
          // la UI. Si se omitiera, el backend lo recalcularía y el usuario
          // podría terminar con un total distinto al que aprobó en pantalla.
          amount: round2(rowWithholding(row)),
        }));
      if (withheldRows.length > 0) {
        payload.withholdings = withheldRows;
      }
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

  /**
   * Salida limpia: el borrador ya no se puede tocar desde este formulario, así
   * que se vuelve al listado, que es donde sí se corrige.
   *
   * `resetForm()` antes de navegar no es decorativo: deja el formulario limpio
   * —`dirty` en falso incluido—, de modo que ninguna guarda de descarte se
   * dispare sobre una factura que YA se creó.
   */
  private finishAndClose(): void {
    this.resetForm();
    this.createdInvoiceId.set(null);
    void this.router.navigate([INVOICES_LIST_ROUTE]);
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

    // EL MOTIVO REAL NO SE PIERDE NUNCA.
    //
    // Antes esta lista se vaciaba salvo en el camino exacto «SYS_VALIDATION_001
    // + formulario disponible». Las otras dos combinaciones —«desde pedido»
    // (que pasa `form = null`) y cualquier código distinto que igual traiga
    // `details.validationErrors`— dejaban al comerciante con una frase de
    // catálogo y ni una pista de QUÉ campo rechazó el servidor. Extraer primero
    // y mapear después separa las dos preguntas: qué dijo el backend, y a qué
    // control corresponde.
    const messages = extractValidationMessages(failure.details);

    if (!form) {
      this.submitErrorDetails.set(messages);
      return;
    }

    const applied = applyBackendValidationErrors(form, failure.details);
    this.backendFieldErrors.set(applied.fieldErrors);
    // Lo que SÍ se pudo amarrar a un campo se pinta EN el campo; lo demás se
    // enumera, para que ningún motivo desaparezca por no saber dónde ponerlo.
    this.submitErrorDetails.set(
      applied.unmatched.length > 0 ? applied.unmatched : [],
    );
    this.erroredControls = applied.touchedControls;
    this.watchForCorrection(applied.touchedControls);
    this.expandSectionsWithErrors();

    // Un 400 sin un solo `validationErrors` mapeable deja el banner con el copy
    // del código y nada más. Al menos se enumera lo crudo antes que callar.
    if (
      applied.unmatched.length === 0 &&
      Object.keys(applied.fieldErrors).length === 0 &&
      messages.length > 0
    ) {
      this.submitErrorDetails.set(messages);
    }
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
      // A `null` a propósito: el efecto de preselección vuelve a elegir la
      // resolución elegible más antigua en cuanto el formulario se estabiliza.
      // Conservar la anterior podría dejar puesta una que ya se agotó.
      resolution_id: null,
      issue_date: toLocalDateString(),
      due_date: toLocalDateString(),
      payment_form: PAYMENT_FORM_CASH,
      payment_means_code: '10',
      operation_type: OPERATION_TYPE_STANDARD,
      // A `PROFILE_NONE` a propósito: `syncProfileSelection()` vuelve a
      // preseleccionar el predeterminado del tipo en cuanto el formulario queda
      // limpio. Conservar el anterior podría dejar puesto uno que se desactivó
      // mientras se capturaba la factura anterior.
      profile_id: PROFILE_NONE,
      notes: '',
      aiu_contract_object: '',
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
    this.syncProfileSelection();
    this.orderIdControl.reset();
    this.mode.set('manual');
    this.pickerTargetUid.set(null);
    this.productPickerOpen.set(false);
    this.customItemOpen.set(false);
    this.customItemDraft.set(null);
    this.customItemEditing.set(false);
    this.customItemTargetUid.set(null);
    this.inlineCustomer.set(null);
    this.linkedCustomerLabel.set(null);
    this.customerQuery.set('');
    this.customerResults.set([]);
    this.openSections.set(
      new Set<SectionId>(['documento', 'adquiriente', 'lineas']),
    );
  }

  /** Reparto de las acciones de la cabecera. */
  onHeaderAction(actionId: string): void {
    if (actionId === 'cancel') {
      this.cancel();
      return;
    }
    if (actionId === 'save') {
      this.onSubmit();
    }
  }

  /**
   * Salir sin emitir.
   *
   * Con captura escrita PIDE CONFIRMACIÓN: en un modal, cerrar sin querer era
   * recuperable porque el componente quedaba montado con los datos dentro; en
   * una vista, navegar lo destruye y las veinte líneas se pierden de verdad.
   *
   * `submitting()` sí frena la salida —hay una petición en vuelo cuyo desenlace
   * decide si existe una factura—, pero el botón NUNCA se pinta deshabilitado
   * por ello: un botón de salida apagado es la definición de callejón sin salida.
   */
  cancel(): void {
    if (this.submitting()) return;
    this.clearSubmitError();

    // Si el borrador ya existe, salir TIENE que limpiar: el formulario dejó de
    // describir algo editable, y conservarlo invitaría a crear la misma factura
    // dos veces. No se pregunta nada: no hay cambios que descartar.
    if (this.createdInvoiceId() !== null) {
      this.finishAndClose();
      return;
    }

    if (!this.invoiceForm.dirty && !this.itemsArray.dirty) {
      void this.router.navigate([INVOICES_LIST_ROUTE]);
      return;
    }

    void this.dialogService
      .confirm({
        title: 'Descartar la factura',
        message:
          'Tienes captura sin emitir. Si sales ahora se pierde: la factura todavía no existe y no queda borrador al que volver.',
        confirmText: 'Salir sin guardar',
        cancelText: 'Continuar editando',
        confirmVariant: 'danger',
      })
      .then((confirmed: boolean) => {
        if (!confirmed) return;
        this.resetForm();
        void this.router.navigate([INVOICES_LIST_ROUTE]);
      });
  }
}

/**
 * Importe retenido de una fila: `base × tarifa`, nunca negativo.
 *
 * `row.rate` está en PORCENTAJE en todo el formulario —el input se llama
 * «Tarifa %» y el contador escribe `2.5`—, de ahí el `/100`. El backend usa la
 * escala contraria (fracción); la conversión ocurre una sola vez, en
 * `buildWithholdingPayload`.
 */
function rowWithholding(row: WithholdingRowValue): number {
  const rate = Number(row?.rate) || 0;
  const base = Number(row?.base) || 0;
  if (rate <= 0 || base <= 0) return 0;
  return (base * rate) / 100;
}

/** «2.5 %» sin decimales sobrantes. */
function formatRatePercent(percent: number): string {
  const value = Number(percent) || 0;
  const text = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return text + ' %';
}

/**
 * `withholding_type_enum` → etiqueta del contador.
 *
 * Con `default` explícito: el enum del backend puede crecer, y un valor nuevo
 * debe verse tal cual antes que desaparecer de la descripción del selector.
 */
function withholdingTypeLabel(type: string): string {
  switch (type) {
    case 'retefuente':
      return 'Retefuente';
    case 'reteiva':
      return 'ReteIVA';
    case 'reteica':
      return 'ReteICA';
    case 'retecree':
      return 'ReteCREE';
    default:
      return type;
  }
}

/** Dos decimales. Evita que el artefacto de coma flotante viaje al backend. */
function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Recorta un valor de fecha a su parte `YYYY-MM-DD`.
 *
 * `valid_from` / `valid_to` / `resolution_date` son fechas-sola guardadas en
 * columnas de marca de tiempo: llegan como `2026-01-01T00:00:00.000Z` y hay que
 * leerlas por su componente UTC. Convertirlas a `Date` local haría que una
 * vigencia que termina el día 31 se declarara vencida la tarde del 30 en
 * cualquier huso al oeste de Greenwich.
 */
function toDateOnly(value: string | null | undefined): string {
  return value ? String(value).slice(0, 10) : '';
}

/** `true` cuando `today` (YYYY-MM-DD local) cae dentro de la vigencia declarada. */
function isWithinValidity(res: InvoiceResolution, today: string): boolean {
  const from = toDateOnly(res.valid_from);
  const to = toDateOnly(res.valid_to);
  // Una vigencia sin declarar no descalifica: la resolución existe y el backend
  // la acepta. Lo que descalifica es una vigencia declarada que ya no cubre hoy.
  if (from && today < from) return false;
  if (to && today > to) return false;
  return true;
}

/**
 * Orden TOTAL de las resoluciones, de la más antigua a la más nueva.
 *
 * El desempate encadenado existe porque el empate es un caso real, no teórico:
 * dos resoluciones de factura de venta pueden compartir `resolution_date`. Sin
 * un criterio que llegue hasta el `id`, `Array.sort` conservaría el orden en que
 * llegó el arreglo y la preselección cambiaría sola entre recargas.
 */
function compareResolutionsByAge(
  a: InvoiceResolution,
  b: InvoiceResolution,
): number {
  const aDate = toDateOnly(a.resolution_date) || toDateOnly(a.valid_from);
  const bDate = toDateOnly(b.resolution_date) || toDateOnly(b.valid_from);
  if (aDate !== bDate) return aDate < bDate ? -1 : 1;

  const aFrom = toDateOnly(a.valid_from);
  const bFrom = toDateOnly(b.valid_from);
  if (aFrom !== bFrom) return aFrom < bFrom ? -1 : 1;

  const aCreated = String(a.created_at ?? '');
  const bCreated = String(b.created_at ?? '');
  if (aCreated !== bCreated) return aCreated < bCreated ? -1 : 1;

  return (Number(a.id) || 0) - (Number(b.id) || 0);
}

/**
 * El orden con el que se PINTA el selector: producción primero, pruebas al
 * final, y dentro de cada grupo de la más antigua a la más nueva.
 *
 * El grupo va ANTES que la antigüedad a propósito. La numeración de habilitación
 * es de 2019 en la mayoría de los tenants, así que ordenar solo por antigüedad
 * la dejaría siempre primera — encabezando la lista y quedando preseleccionada
 * justo el rango que jamás debe emitir una factura real.
 */
function compareResolutionsForSelection(
  a: InvoiceResolution,
  b: InvoiceResolution,
): number {
  const aTest = isHabilitationNumbering(a) ? 1 : 0;
  const bTest = isHabilitationNumbering(b) ? 1 : 0;
  if (aTest !== bTest) return aTest - bTest;
  return compareResolutionsByAge(a, b);
}
