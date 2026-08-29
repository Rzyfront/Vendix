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
import {
  selectActiveResolutions,
  selectResolutions,
} from '../../state/selectors/invoicing.selectors';
import { invoiceHelp } from '../../utils/invoice-section-help';
import type { InvoiceScreenSectionId } from '../../utils/invoice-section-order';
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
import {
  compareResolutionsForSelection,
  hasRemainingRange,
  isWithinValidity,
  nextConsecutive,
} from '../../utils/resolution-selection.util';

import { AlertBannerComponent } from '../../../../../../shared/components/alert-banner/alert-banner.component';
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
  ConfirmationModalComponent,
  DialogService,
  DianMunicipalitySelectComponent,
  ModalComponent,
  SaveRequirement,
  SaveRequirementsModalComponent,
  StickyHeaderActionButton,
  StickyHeaderComponent,
} from '../../../../../../shared/components/index';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
/**
 * CLIENTE DEL GATEWAY DE IMPRESIÓN (E.2/E.1). El mismo servicio que usa el
 * Hub de formatos y el editor de perfiles: la previsualización FB-29
 * (`POST /store/print-formats/:formatType/preview`) devuelve HTML —no un
 * binario— y no pasa por la compuerta fiscal, así que funciona sin
 * habilitación DIAN y NO toma consecutivo (medido: `current_number` 107 →
 * 107 tras tres previews).
 */
import { PrintGatewayClientService } from '../../../../../../shared/services/print/print-gateway-client.service';
import type { StorePrintFormatDetail } from '../../../../../../core/models/print-formats.model';
/**
 * SELECTOR DE CUENTA PUC CON BÚSQUEDA (5 resultados por página, el resto se
 * alcanza escribiendo). Vive bajo `products` porque nació allí y se importa en
 * vez de duplicarse: es el único sitio que traduce código↔id contra el plan de
 * cuentas, y guardar un id donde el motor contable espera un código manda el
 * ingreso a la cuenta por defecto sin error visible. Merece subir a `shared`.
 */
import { AccountCodeSelectComponent } from '../../../products/components/account-code-select.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import {
  formatDateOnlyUTC,
  toLocalDateString,
} from '../../../../../../shared/utils/date.util';
import { computeNitDv } from '../../../../../../shared/utils/nit.util';
import type { DianMunicipalityOption } from '../../../../../../shared/services/dian-municipality-lookup.service';
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
import { InvoiceLineTaxesComponent } from '../../components/invoice-create/invoice-line-taxes.component';
import { InvoiceItemPickerModalComponent } from '../../components/invoice-create/invoice-item-picker-modal.component';
import {
  InvoiceCustomItemDraft,
  InvoiceCustomItemModalComponent,
} from '../../components/invoice-create/invoice-custom-item-modal.component';
import { InvoiceOrderSelectComponent } from '../../components/invoice-create/invoice-order-select.component';
/**
 * SECCIÓN AIU COMPARTIDA con el editor de perfiles. Es el mismo componente y
 * los mismos controles en las dos pantallas: lo que cambia es qué significa
 * dejar uno vacío, no qué campos hay. Ver su docblock.
 */
import { InvoiceSectionAiuComponent } from '../../../../../../shared/components/invoice-sections/index';
import {
  asAiuComponentsBasis,
  asAiuTaxableBasis,
  reprojectAiuTaxRules,
} from '../../../../../../shared/components/invoice-sections/index';
import type {
  AiuDepartureField,
  AiuSectionPaths,
  AiuTaxRuleValue,
} from '../../../../../../shared/components/invoice-sections/index';
/**
 * SECCIÓN DOCUMENTO COMPARTIDA con el editor de perfiles (B.2). Mismo
 * componente y mismos controles —resolución, tipo de documento, forma y
 * medio de pago, fechas y notas de cabecera— en las dos pantallas.
 */
import { InvoiceSectionDocumentoComponent } from '../../../../../../shared/components/invoice-sections/index';
import type {
  DocumentoSectionErrors,
  DocumentoSectionNotice,
  DocumentoSectionPaths,
} from '../../../../../../shared/components/invoice-sections/index';
/**
 * SECCIÓN LÍNEAS COMPARTIDA con «Líneas modelo» del editor de perfiles (B.3).
 * Es la sección con más asimetría de las dos pantallas —picker de producto,
 * impuestos por línea y descuento sólo existen acá—, así que el componente
 * tiene dos plantillas internas por contexto en vez de una sola con banderas
 * de campo. Ver su docblock.
 */
import { InvoiceSectionLineasComponent } from '../../../../../../shared/components/invoice-sections/index';
import type {
  LineasRowErrors,
  LineasRowPaths,
} from '../../../../../../shared/components/invoice-sections/index';
/**
 * SECCIÓN IMPUESTOS COMPARTIDA con la matriz por porción del editor de
 * perfiles (B.4). En contexto `invoice` sólo pinta el agregado de línea
 * (`taxBreakdown()`) de solo lectura — la matriz por porción no tiene hoy
 * fuente de datos propia en la factura, así que no se inventa acá. Ver el
 * docblock del componente para la razón completa.
 */
import { InvoiceSectionImpuestosComponent } from '../../../../../../shared/components/invoice-sections/index';
/**
 * SECCIÓN RETENCIONES COMPARTIDA con el editor de perfiles (B.5). El
 * interruptor de importe manual y su input de monto total NO tienen
 * equivalente en el perfil —un perfil no emite, sólo precarga conceptos—,
 * así que se quedan en la página y el componente sólo se monta en la rama
 * `@else` (sin importe manual). Ver el docblock del componente.
 */
import { InvoiceSectionRetencionesComponent } from '../../../../../../shared/components/invoice-sections/index';
import type { RetencionesRowPaths } from '../../../../../../shared/components/invoice-sections/index';
/**
 * SECCIÓN DIVISA COMPARTIDA con el editor de perfiles (B.6). Toda la
 * consulta a la TRM oficial (`ExchangeRateQuote`, carga, sobre-escritura,
 * equivalente declarado) es sólo de `invoice`: un perfil no emite, así que
 * no dispara ninguna consulta. Ver el docblock del componente.
 */
import { InvoiceSectionDivisaComponent } from '../../../../../../shared/components/invoice-sections/index';
import type { DivisaSectionPaths } from '../../../../../../shared/components/invoice-sections/index';
/**
 * SECCIÓN FORMATO COMPARTIDA con el editor de perfiles (B.7/E.1). En la
 * factura no hay controles de plantilla que el DTO declare: lo que se pinta
 * es CON QUÉ se imprime este documento y el mantenimiento de la plantilla
 * ACTIVA DE TIENDA contra la biblioteca de la organización. Ver el docblock
 * del componente.
 */
import {
  FISCAL_INVOICE_FORMAT_TYPE,
  InvoiceSectionFormatoComponent,
  InvoiceSectionNotasComponent,
} from '../../../../../../shared/components/invoice-sections/index';
import type { FormatoSectionPaths, NotasSectionPaths } from '../../../../../../shared/components/invoice-sections/index';
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
import type {
  PreviewProfileLinePayload,
  PreviewProfilePayload,
  ProfilePreviewResult,
} from '../../interfaces/invoice-profile.interface';
import type {
  AccountingModel,
  AiuBucket,
  AiuComponentLiteral,
  AiuComponentsBasis,
  AiuTaxableBasis,
  AiuVatRegimeLiteral,
  InvoiceProfileConfig,
  ProfileAiuConfig,
  ProfileConfigIssue,
} from '../../../../../../core/utils/invoice-profile-config.contract';
import {
  AIU_COMPONENTS,
  AIU_LEGAL_FLOOR_PERCENT_SCALED,
  AIU_TAXABLE_BUCKETS_BY_BASIS,
  CONFIG_LIMITS,
  formatPercentScaled,
  parsePercentScaled,
  regimeFromTaxableBasis,
  resolveAccountingModel,
  resolveAiuComponentsBasis,
  resolveAiuTaxableBasis,
} from '../../../../../../core/utils/invoice-profile-config.contract';

/**
 * La configuración AIU efectiva del documento, con la BASE GRAVABLE al frente.
 *
 * ─── POR QUÉ NO ES `InvoiceAiuSettings` A SECAS ──────────────────────────────
 *
 * `InvoiceAiuSettings` es el espejo de `GET /store/invoicing/aiu-settings`, y
 * ese endpoint responde SÓLO `regime`, con los dos regímenes legales. No es un
 * rezago de la transición: `AiuSettings.regime` —el ajuste de tienda, en
 * `settings/interfaces/store-settings.interface.ts`— nunca tuvo `taxable_basis`
 * y no va a tenerlo, porque `'subtotal'` no es un default de tienda. Lo dice el
 * backend en su propio comentario sobre `AiuRegimeSnapshot`
 * (`invoice-flow.service.ts`): «el tercer valor sólo llega vía snapshot de
 * perfil o de factura, nunca vía ajuste vivo». Verificado en
 * `InvoicingService.getAiuSettingsView`.
 *
 * Así que en la rama SIN perfil el `regime` de la tienda es la fuente legítima
 * y completa —pero se lee DERIVANDO con `resolveAiuTaxableBasis`, nunca
 * comparándolo contra un literal—, y en la rama CON perfil la fuente es
 * `taxable_basis` del snapshot, que sí puede decir `'subtotal'`. Meter ese
 * tercer valor en un campo tipado `'et_462_1' | 'decreto_1372_1992'` obligaría
 * al compilador a elegir uno de los dos: es la mentira que este tipo existe
 * para hacer imposible.
 *
 * Por eso la base viaja aparte y `regime` pasa a ser NULLABLE —el régimen legal
 * equivalente cuando existe, `null` bajo `'subtotal'`—. Quien decide
 * gravabilidad lee `taxable_basis`; `regime` queda sólo para citar la norma. Es
 * la misma decisión —separar en vez de ampliar— que el backend tomó con
 * `AiuRegimeSnapshot` y esta rama con `PersistedAiuRegime`.
 */
type EffectiveAiuSettings = Omit<InvoiceAiuSettings, 'regime'> & {
  /** Qué porción del contrato grava. Es la única fuente de la decisión. */
  taxable_basis: AiuTaxableBasis;
  /** Régimen legal equivalente, o `null` cuando no hay ninguno que citar. */
  regime: AiuVatRegimeLiteral | null;
};

/**
 * Códigos de la tabla 13.2.2 del anexo que son tributos de DOCUMENTO, o sea los
 * que viajan dentro de la línea (`cac:TaxTotal`) y suman al total.
 *
 * Los de retención (`05` ReteIVA, `06` ReteFuente, `07` ReteICA) quedan fuera a
 * propósito: no suman al total y se capturan en la sección de retenciones, que
 * exige un `concept_id` del catálogo de la tienda. Mapearlos acá los convertiría
 * en impuestos de línea, que es exactamente el descuadre que la DIAN rechaza.
 */
const AIU_DOCUMENT_TAX_TYPE_BY_CODE: Readonly<Record<string, string>> = {
  '01': 'iva',
  '03': 'ica',
  '04': 'inc',
};
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

/**
 * LOS CONTROLES QUE EL PERFIL PRECARGA, con su nombre en español.
 *
 * Una sola lista para tres usos que TIENEN que coincidir:
 *
 *  1. `profileOverwriteFields()` — qué se le advierte al usuario que perderá.
 *  2. `applyProfileFully()` — a qué controles se les devuelve el `pristine` que
 *     autoriza a `applyProfilePrefill` a escribirlos.
 *  3. Documentación de qué toca un perfil y qué no.
 *
 * Si estuvieran en tres sitios, la divergencia sería silenciosa y del peor tipo:
 * una ruta añadida a `put()` pero no a la lista del `pristine` dejaría de
 * aplicarse sin error alguno, y el usuario vería un perfil que «no hace nada» en
 * un campo concreto. Peor todavía al contrario: una ruta advertida pero no
 * aplicada avisa de una pérdida que no ocurre.
 *
 * `resolution_id` y `exchange_rate` entran aunque `put()` no los escriba:
 * la resolución la gobierna `preselectEligibleResolution` —que también respeta
 * `dirty`— y la tasa se limpia cuando el perfil no declara conversión. Las dos
 * cambian al aplicar un perfil, así que las dos se advierten.
 *
 * Las LÍNEAS y las RETENCIONES no están acá: son `FormArray`, no se gobiernan
 * por `pristine` sino por las banderas `forced` de sus dos siembras, y se
 * advierten aparte porque su aviso lleva el conteo.
 *
 * LA MATRIZ DE TRIBUTOS (`aiu_taxes`) tampoco, y no por olvido: su `dirty` no
 * significa «escrito a mano». La reproyección que mantiene la matriz coherente
 * con la base gravable —`reprojectAiuTaxRules`, disparada al sembrar la base
 * heredada— añade la fila derivada del costo reembolsable y con eso marca el
 * arreglo `dirty` sin que nadie haya tocado nada. Advertir sobre esa señal
 * pondría en el modal una pérdida que el operador no causó, y un aviso que
 * aparece solo es lo que entrena a ignorar los avisos. Mientras la matriz no
 * tenga una marca propia de captura manual, se queda fuera.
 */
const PROFILE_PREFILL_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['resolution_id', 'la resolución elegida'],
  ['invoice_type', 'el tipo de documento'],
  ['payment_form', 'la forma de pago'],
  ['payment_means_code', 'el medio de pago'],
  ['notes', 'las notas del documento'],
  ['use_foreign_currency', 'la divisa'],
  ['foreign_currency', 'la divisa'],
  ['exchange_rate', 'la tasa de cambio'],
  ['aiu_contract_object', 'el objeto del contrato'],
  ['default_account_code', 'la cuenta contable por omisión'],
  // ── LO QUE LA SECCIÓN AIU AÑADIÓ AL DOCUMENTO ────────────────────────────
  //
  // Estas ocho rutas viven en el grupo `aiu` y las escribe
  // `seedAiuFromProfile`, no el `put()` de `applyProfilePrefill`. Aun así
  // pertenecen a esta lista, que no es «lo que escribe put()» sino «lo que un
  // perfil precarga»: sin ellos, elegir un perfil sobre un reparto escrito a
  // mano lo reemplazaba SIN avisar de que se perdía, y era la mitad de la
  // sección AIU la que desaparecía en silencio.
  //
  // Varias rutas comparten etiqueta —igual que las dos de la divisa— porque el
  // aviso se lee por concepto y no por control: «el reparto de la base AIU» es
  // una sola cosa para quien la escribió, aunque sean tres campos.
  //
  // Las TRES congeladas —`taxable_basis`, `enforce_minimum_base`,
  // `minimum_base_percent`— NO entran: no las precarga el perfil sino los
  // ajustes efectivos, y no se pueden escribir a mano (ver `aiuFrozenFields`),
  // así que nunca pueden estar `dirty`. Advertir de perderlas sería avisar de
  // una pérdida que no ocurre.
  ['aiu.components_basis', 'la unidad de los porcentajes del AIU'],
  ['aiu.accounting_model', 'el modelo de contabilización del AIU'],
  ['aiu.administracion', 'el reparto de la base AIU'],
  ['aiu.imprevistos', 'el reparto de la base AIU'],
  ['aiu.utilidad', 'el reparto de la base AIU'],
  ['aiu.revenue_administracion', 'las cuentas contables del AIU'],
  ['aiu.revenue_imprevistos', 'las cuentas contables del AIU'],
  ['aiu.revenue_utilidad', 'las cuentas contables del AIU'],
  ['aiu.vat_payable_account', 'las cuentas contables del AIU'],
];

/**
 * Escapa el texto que entra al mensaje del modal de confirmación.
 *
 * El mensaje se pinta con `[innerHTML]` —lo necesita para la lista de viñetas—
 * y lleva el NOMBRE DEL PERFIL, que lo escribe el tenant. Angular sanea el
 * `innerHTML`, así que esto no es la barrera de seguridad; es lo que evita que
 * un perfil llamado «Aseo <A&B>» se lea partido o con el nombre a medias.
 */
function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─────────────────────────────────────────────────────────────
// Contrato de salida
// ─────────────────────────────────────────────────────────────

/**
 * Dirección fiscal ESTRUCTURADA del adquiriente (A.8).
 *
 * Espejo fiel de `InvoiceAddressDto` (backend,
 * `invoicing/dto/invoice-address.dto.ts`): el DTO declara `customer_address`
 * con `@Transform(liftInvoiceAddress)`, así que acepta el string plano que
 * siempre envió esta pantalla O este objeto desglosado. Los nombres de campo
 * NO son inventados: son exactamente los que `normalizeAddress()` del provider
 * DIAN lee para `cac:PhysicalLocation`, y lo que hace que el código DANE de
 * ciudad —rechazo clásico de la DIAN— por fin viaje en cada factura con
 * dirección.
 */
interface CustomerInvoiceAddressPayload {
  /** Único obligatorio cuando se envía el objeto (`@IsNotEmpty`). */
  address_line: string;
  /** Código DANE de municipio, 5 dígitos (ej. "05001" = Medellín). */
  city_code?: string;
  city_name?: string;
  /** Código DANE de departamento, 2 dígitos: los dos primeros del city_code. */
  department_code?: string;
  department_name?: string;
}

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
  /**
   * String plano (sólo la línea de dirección) u objeto desglosado con los
   * códigos DANE. El backend eleva ambas formas a `InvoiceAddressDto`; ver
   * {@link CustomerInvoiceAddressPayload}.
   */
  customer_address?: string | CustomerInvoiceAddressPayload;
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
   * MODELO DE CONTABILIZACIÓN de este documento (D.7).
   *
   * `CreateInvoiceDto.aiu_accounting_model` lo valida contra
   * `ENABLED_ACCOUNTING_MODELS`, así que mandarlo explícito es seguro en los
   * dos estados de la compuerta: hoy sólo `'sumada'` pasa el `@IsIn`, y el día
   * que se habilite `'no_sumada'` el valor que eligió el operador en el radio
   * viaja sin tocar esta pantalla. Omitirlo dejaría la elección en manos del
   * default del servidor justo cuando el documento tiene una elegida.
   *
   * Sólo viaja en operación AIU: fuera de ella el campo no significa nada y un
   * valor huérfano sería ruido en el payload fiscal.
   */
  aiu_accounting_model?: AccountingModel;
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
  /**
   * D.10 — escala del precio publicado del producto resuelto. Dato del
   * CATÁLOGO adjunto a la fila (nunca editable, nunca en el payload:
   * `buildPayload` mapea los items campo a campo y este control no viaja).
   */
  price_unit_quantity?: number | string | null;
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

/**
 * Las secciones de esta pantalla NO se enumeran aquí: se derivan del orden
 * canónico compartido con el editor de perfiles
 * (`utils/invoice-section-order.ts`). Enumerarlas dos veces es lo que hizo que
 * AIU acabara en distinta posición en cada pantalla.
 */
type SectionId = InvoiceScreenSectionId;

/** Qué controles de cabecera pertenecen a cada sección, para contar errores. */
const SECTION_FIELDS: Record<SectionId, string[]> = {
  /**
   * El perfil no valida NADA del documento: elegirlo no puede dejar la factura
   * en error, y no elegirlo tampoco. Por eso la lista va vacía —el contador de
   * errores de esta sección tiene que quedarse en cero siempre— mientras que la
   * sección sí existe, para que se plegue y se cuente como una más.
   */
  perfil: [],
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
  notas_internas: [],
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
    AlertBannerComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    ToggleComponent,
    IconComponent,
    AccountCodeSelectComponent,
    CustomerModalComponent,
    DianMunicipalitySelectComponent,
    ConfirmationModalComponent,
    SaveRequirementsModalComponent,
    InvoiceFormSectionComponent,
    InvoiceLineTaxesComponent,
    InvoiceItemPickerModalComponent,
    InvoiceCustomItemModalComponent,
    InvoiceOrderSelectComponent,
    InvoiceSectionAiuComponent,
    InvoiceSectionDocumentoComponent,
    InvoiceSectionLineasComponent,
    InvoiceSectionImpuestosComponent,
    InvoiceSectionRetencionesComponent,
    InvoiceSectionDivisaComponent,
    InvoiceSectionFormatoComponent,
    InvoiceSectionNotasComponent,
    ModalComponent,
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
          <app-alert-banner
            variant="danger"
            icon="alert-triangle"
            tone="token"
            heading="No se pudo crear la factura"
          >
            {{ submitError() }}
            @if (submitErrorDetails().length) {
              <ul class="mt-1 list-disc space-y-0.5 pl-4 text-xs">
                @for (detail of submitErrorDetails(); track detail) {
                  <li>{{ detail }}</li>
                }
              </ul>
            }
          </app-alert-banner>
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
            EL PERFIL VA PRIMERO, ANTES QUE CUALQUIER DATO DEL DOCUMENTO.

            Estaba dentro de «Documento», debajo de la resolución. Es el orden
            equivocado: elegir un perfil REESCRIBE la resolución, los códigos de
            pago, las notas de cabecera, las líneas y el bloque AIU, así que
            ponerlo después de esos campos invita a llenarlos para verlos cambiar
            solos. Arriba del todo se lee como lo que es: el punto de partida del
            documento, no un ajuste más de la cabecera.

            El selector va FUERA del «form», así que se enlaza con
            «[formControl]» y no con «formControlName» —sin un «formGroup»
            ancestro el nombre no resolvería contra nada—. El control sigue
            siendo el mismo del formulario, así que el payload, el reset y los
            computed que leen el valor crudo no cambian.

            SE PINTA SIEMPRE, TAMBIÉN SIN PERFILES DEL TIPO ELEGIDO.

            Antes se escondía cuando la lista quedaba vacía, y eso hacía
            indistinguibles dos cosas muy distintas: «esta tienda no tiene
            perfiles de operación Estándar» y «esta pantalla no trabaja con
            perfiles». Quien nunca ve el control no descubre que existe.

            Lo que NO se hace es ofrecer perfiles de otro tipo de operación: el
            backend responde «INVOICING_PROFILE_008» a un perfil cuyo
            «operation_type» no coincide con el del documento, así que cruzarlos
            sería ofrecer un 409 tras llenar la factura entera. Sin perfiles del
            tipo elegido se dice eso mismo, con el tipo por su nombre, y se
            ofrece crear uno.

            El tipo de operación se queda en «Documento»: es el filtro de esta
            lista, no parte de ella, y moverlo dejaría su contador de errores
            señalando una sección que ya no lo contiene.

            Es una «vendix-invoice-form-section» y no un «<section>» propio para
            que se pliegue como todas las demás y para que la cabecera se lea
            igual. El cuerpo de esa sección se OCULTA al plegarse, no se
            desmonta, así que «profileControl» sigue registrado con la sección
            cerrada.
          -->
          <vendix-invoice-form-section
            title="Perfil de facturación"
            icon="wand-2"
            [summary]="profileSummary()"
            [help]="profileSectionHelp"
            [expanded]="isSectionOpen('perfil')"
            (expandedChange)="setSection('perfil', $event)"
          >
            @if (hasProfiles()) {
              <p
                class="mb-3 text-xs leading-relaxed text-[var(--color-text-secondary)]"
              >
                Elegirlo preconfigura el documento completo —empezando por la
                resolución— y reemplaza lo que ya hubiera escrito. Si la factura
                ya está modificada, se pregunta antes.
              </p>
              <app-selector
                label="Perfil de facturación"
                [formControl]="profileControl"
                [options]="profileOptions()"
                size="sm"
                (valueChange)="onProfileChange()"
              ></app-selector>

              @if (profileAutoSelected()) {
                <div
                  class="mt-3 flex items-start gap-2.5 rounded-lg border border-[var(--color-primary)]/25 bg-[color-mix(in_srgb,var(--color-primary)_6%,transparent)] px-3 py-2.5"
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

              <!--
                LO QUE EL PERFIL RELLENÓ. Va aquí, pegado al selector, y no
                al pie: quien acaba de elegir un perfil está mirando este
                punto de la pantalla, y es donde tiene que enterarse de qué
                campos cambiaron sin que él los tocara.

                Todo lo listado queda EDITABLE en su propia sección. Esto
                informa, no bloquea.
              -->
              @if (prefillSummary().length > 0) {
                <app-alert-banner
                  class="mt-3"
                  variant="info"
                  icon="wand-2"
                  tone="token"
                >
                  El perfil precargó
                  <strong>{{ prefillSummary().join(', ') }}</strong
                  >. Todo queda editable: si cambias un campo a mano, el perfil
                  no lo vuelve a pisar.
                </app-alert-banner>
              }

              <!--
                LÍNEAS DEL PERFIL NO SEMBRADAS. El usuario ya había
                capturado líneas, así que reemplazarlas sin preguntar
                borraría trabajo que no se recupera. Se ofrece.
              -->
              @if (pendingModelLines() > 0) {
                <div
                  class="mt-3 flex flex-col gap-2 rounded-lg border border-[var(--color-primary)]/25 bg-[color-mix(in_srgb,var(--color-primary)_6%,transparent)] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <p class="text-xs leading-relaxed text-text-primary">
                    Este perfil trae
                    <strong>{{ pendingModelLines() }}</strong> línea(s)
                    modelo. No se cargaron porque ya capturaste líneas
                    propias: cargarlas las reemplaza.
                  </p>
                  <button
                    type="button"
                    class="shrink-0 rounded-lg border border-[var(--color-primary)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-primary)]"
                    (click)="applyModelLines()"
                  >
                    Reemplazar por las del perfil
                  </button>
                </div>
              }

              @if (profileConfigFailed()) {
                <!--
                  Migrado a «app-alert-banner» (encargo del orquestador,
                  2026-08-24): el div a mano nunca llevó role=alert, así que un
                  lector de pantalla no lo anunciaba. El componente compartido
                  lo trae fijo en su plantilla.
                -->
                <app-alert-banner
                  class="mt-3"
                  variant="warning"
                  icon="alert-triangle"
                  tone="token"
                  heading="No se pudieron leer las reglas del perfil"
                >
                  La factura se puede emitir igual: el servidor la timbra con
                  la versión vigente del perfil, no con lo que muestre esta
                  pantalla. Lo que falta es el instructivo del AIU —y no se
                  sustituye por el de la tienda, porque instruiría sobre otra
                  base gravable—.
                  <button
                    bannerActions
                    type="button"
                    class="mt-1.5 text-xs font-semibold text-warning underline underline-offset-2"
                    (click)="retryProfileConfig()"
                  >
                    Reintentar
                  </button>
                </app-alert-banner>
              }
            } @else {
              <!--
                ESTADO VACÍO, NO SECCIÓN AUSENTE.

                Nombra el tipo de operación —«Estándar (10)», no «este tipo»—
                porque la razón de que la lista esté vacía ES el tipo, y sin
                decirlo la frase se lee como una avería. Y no ofrece los perfiles
                de otro tipo: ver «INVOICING_PROFILE_008».
              -->
              <div class="flex items-start gap-2.5">
                <app-icon
                  name="wand-2"
                  [size]="16"
                  class="mt-0.5 shrink-0 text-[var(--color-text-secondary)]"
                />
                <div class="min-w-0">
                  <p class="text-xs leading-relaxed text-text-primary">
                    No hay perfiles activos para la operación
                    <strong>{{ operationTypeLabel() }}</strong>. Esta factura se
                    llena a mano y se emite igual: el perfil sólo ahorra
                    escribir lo que se repite.
                  </p>
                  <button
                    type="button"
                    class="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-primary)] underline underline-offset-2"
                    (click)="goToProfileCreate()"
                  >
                    <app-icon name="plus" [size]="13" />
                    Crear un perfil para esta operación
                  </button>
                </div>
              </div>
            }
          </vendix-invoice-form-section>


          <!--
            Mismo aire que el editor de perfiles: las dos pantallas son la misma
            captura, una por documento y otra preconfigurada, y separarlas
            distinto haría que la segunda no se leyera como espejo de la primera.
          -->
          <form [formGroup]="invoiceForm" class="space-y-6">
            <!-- ── DOCUMENTO ─────────────────────────────────────── -->
            <vendix-invoice-form-section
              title="Documento"
              [help]="help('documento')"
              icon="file-text"
              [summary]="documentSummary()"
              [errorCount]="sectionErrors().documento"
              [expanded]="isSectionOpen('documento')"
              (expandedChange)="setSection('documento', $event)"
            >
              <!--
                TIPO DE OPERACIÓN. No vive en «vendix-invoice-section-documento»
                (B.2): el editor de perfiles lo tiene FUERA de su sección
                «Documento» porque decide qué secciones aplican, no es un dato
                del documento en sí. Ver el docblock del componente compartido.
              -->
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
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
                SECCIÓN DOCUMENTO COMPARTIDA CON EL EDITOR DE PERFILES (B.2). Es
                el mismo componente y los mismos controles en las dos pantallas
                —resolución, tipo de documento, forma y medio de pago, fechas y
                notas de cabecera—; lo que cambia es qué significa dejar uno
                vacío y qué campos no tienen sentido siquiera (las fechas, aquí;
                ver «invoice-section-documento.component.ts»).
              -->
              <vendix-invoice-section-documento
                context="invoice"
                [form]="invoiceForm"
                [paths]="documentoSectionPaths"
                [invoiceTypeOptions]="invoiceTypeOptions"
                [paymentFormOptions]="paymentFormOptions"
                [paymentMeansOptions]="paymentMeansOptions"
                [resolutionControl]="resolutionControl"
                [resolutionOptions]="resolutionOptions()"
                resolutionPlaceholder="Elige el rango autorizado"
                resolutionSize="md"
                [activeResolution]="activeResolution()"
                [documentLabel]="documentLabel()"
                [notices]="documentoNotices()"
                [errors]="documentoErrors()"
                [dueDateRequired]="isCredit()"
                [dueDateHelp]="dueDateHelp()"
                (invoiceTypeChanged)="onInvoiceTypeChange()"
                (paymentFormChanged)="onPaymentFormChange()"
                (issueDateChanged)="syncDueDate()"
              ></vendix-invoice-section-documento>
            </vendix-invoice-form-section>

            <!-- ── ADQUIRIENTE ───────────────────────────────────── -->
            <vendix-invoice-form-section
              title="Adquiriente"
              [help]="help('adquiriente')"
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
                  [label]="customerNameLabel()"
                  [placeholder]="customerNamePlaceholder()"
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
                  [placeholder]="customerTaxIdPlaceholder()"
                  size="sm"
                ></app-input>
                <!--
                  A.8 — el DV NUNCA se digita. Se deriva del número con el
                  mismo módulo 11 que aplica el backend, en vivo mientras se
                  teclea, y sólo existe cuando el documento es NIT: una
                  cédula o un pasaporte no llevan checksum, así que el campo
                  desaparece por completo (antes estorbaba deshabilitado).
                  Misma conducta que el checkout de suscripciones.
                -->
                @if (isNitCustomer()) {
                  <label class="flex flex-col gap-1">
                    <span class="text-xs font-medium text-[var(--color-text-secondary)]">
                      DV
                    </span>
                    <input
                      type="text"
                      [value]="computedCustomerDv()"
                      disabled
                      aria-readonly="true"
                      aria-label="Dígito de verificación calculado automáticamente"
                      title="Calculado con el módulo 11 de la DIAN; no se digita."
                      class="w-full px-3 py-2 text-sm rounded-lg border border-border bg-[var(--color-surface-secondary)] text-text-secondary cursor-not-allowed"
                    />
                  </label>
                }
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
                <!--
                  A.8 - tipo de persona. Solo se pregunta con NIT: una cedula
                  ES una persona natural y fijarla a mano seria un paso que el
                  formulario puede dar solo (buildPayload manda NATURAL en
                  cuanto el documento deja de ser NIT).
                -->
                @if (isNitCustomer()) {
                  <app-selector
                    label="Tipo de persona"
                    formControlName="customer_person_type"
                    [options]="customerPersonTypeOptions"
                    helpText="Natural con NIT (independiente) o Jurídica (empresa)."
                    size="sm"
                  ></app-selector>
                }
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <app-input
                  label="Dirección fiscal"
                  formControlName="customer_address"
                  [control]="control('customer_address')"
                  [error]="fieldError('customer_address')"
                  size="sm"
                ></app-input>
                <!--
                  A.8 — municipio DANE por NOMBRE. El código de ciudad era el
                  otro rechazo clásico de la DIAN: aquí ya no se teclea ni se
                  adivina, se busca contra el catálogo Divipola y el valor del
                  control es el código de 5 dígitos exacto que exige el XML.
                -->
                <div>
                  <label
                    class="block text-xs font-medium text-[var(--color-text-secondary)] mb-1"
                  >
                    Municipio (DANE)
                  </label>
                  <app-dian-municipality-select
                    formControlName="customer_municipality_code"
                    placeholder="Busca por nombre o código DANE..."
                    (municipalitySelected)="onCustomerMunicipality($event)"
                  />
                  @if (customerMunicipalityError(); as municipalityErr) {
                    <p class="mt-1 text-xs text-error">{{ municipalityErr }}</p>
                  }
                </div>
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
                  <!--
                    Trece casillas y no trece interruptores: esto es una lista
                    de selección múltiple de códigos del RUT, no trece ajustes
                    independientes. Un interruptor promete «activar algo» y
                    ocuparía tres veces el alto.

                    Lo que sí cambia es el contraste. Antes eran casillas
                    desnudas sobre el fondo de la tarjeta: lo marcado y lo no
                    marcado se distinguían por un cuadro de 13 px con el color
                    por omisión del navegador. Ahora cada opción es una ficha
                    con borde propio, y la marcada tiñe borde y fondo con el
                    color primario del tema. El cuadro sigue ahí —el estado no
                    puede comunicarse SÓLO por color— y el área pulsable pasa a
                    ser toda la ficha.
                  -->
                  @for (code of fiscalResponsibilities; track code) {
                    <label
                      class="flex items-center gap-2 cursor-pointer rounded-lg border px-2 py-2 transition-colors"
                      [style.border-color]="
                        hasResponsibility(code)
                          ? 'var(--color-primary)'
                          : 'var(--color-border)'
                      "
                      [style.background]="
                        hasResponsibility(code)
                          ? 'color-mix(in srgb, var(--color-primary) 8%, transparent)'
                          : 'var(--color-surface)'
                      "
                    >
                      <input
                        type="checkbox"
                        class="h-4 w-4 shrink-0 rounded border-border accent-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
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

            <!-- ── AIU ───────────────────────────────────────────── -->
            <!--
              SE OCULTA COMPLETA cuando el tipo de operación no es AIU (09).

              Antes se seguía pintando si había algo capturado dentro —objeto de
              contrato, o una línea con componente— con el argumento de que «ese
              dato viaja al XML y tiene que poder revisarse». No viaja:
              «buildPayload» condiciona AMBOS campos a «isAiu()»
              («aiu_contract_object» y el «aiu_component» de cada línea), así que
              en un documento que no es AIU nada de esto llega al backend. La
              sección sólo podía decir «esto no aplica» y, peor, sugería
              configurar algo que se iba a descartar.

              Lo capturado NO se borra al ocultar: volver a poner el tipo en AIU
              lo muestra intacto. Borrarlo por cambiar un selector destruiría el
              trabajo de quien se equivocó de tipo un segundo.
            -->
            @if (isAiu()) {
            <vendix-invoice-form-section
              title="AIU"
              [help]="help('aiu')"
              icon="calculator"
              [optional]="true"
              [summary]="aiuSummary()"
              [errorCount]="sectionErrors().aiu"
              [expanded]="isSectionOpen('aiu')"
              (expandedChange)="setSection('aiu', $event)"
            >
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
                    Cuál aplica lo decide el objeto del contrato, no una
                    preferencia del negocio.
                  </p>
                </div>
              } @else {
                <div
                  class="h-20 animate-pulse rounded-xl bg-[var(--color-surface)]"
                ></div>
              }

              <!--
                LA SECCIÓN AIU ES UN SOLO COMPONENTE, COMPARTIDO CON EL EDITOR
                DE PERFILES.

                Antes acá había 359 líneas de sólo lectura con UN control
                editable —el objeto del contrato— y el resto remitiendo a
                «Facturación → Perfiles»: corregir un reparto obligaba a salir
                de la emisión, crear una versión N+1 del perfil —que rige para
                TODAS las facturas siguientes— y volver.

                Ahora los controles son los mismos que los del perfil y editarlos
                NO toca el perfil ni crea versión (ADR-3). Los tres que este
                documento no puede llevar —base gravable y piso— llegan
                congelados con el motivo a la vista: ver «aiuFrozenFields».

                «issues» sólo lleva el rechazo del backend traducido al nombre
                canónico: el validador del contrato corre al GUARDAR UN PERFIL, y
                una factura no se guarda como perfil.
              -->
              <vendix-invoice-section-aiu
                class="mt-3"
                context="invoice"
                [form]="invoiceForm"
                [paths]="aiuSectionPaths"
                [taxRules]="aiuTaxesArray"
                [issues]="aiuSectionIssues()"
                [departures]="aiuDepartures()"
                [frozenFields]="aiuFrozenFields"
                [frozenReason]="aiuFrozenReason()"
                [customerFiscalResponsibilities]="responsibilitiesValue()"
              ></vendix-invoice-section-aiu>

              <!-- Nota CAV03 que viaja al XML. El campo que la alimenta —el
                   objeto del contrato— lo pinta la sección de arriba; acá queda
                   el ORIGEN del valor heredado y la cadena exacta con su
                   longitud, que es lo que la DIAN mide. -->
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

                  <!--
                    EL CONTROL NO SE REPITE ACÁ. Lo pinta la sección AIU de
                    arriba, y atar un segundo «formControl» a la misma casilla
                    dejaría dos cajas idénticas en la misma pantalla: se
                    sincronizarían, pero el operador no sabría cuál manda y
                    buscaría la diferencia. Acá queda lo que la sección no puede
                    decir: de DÓNDE sale el valor cuando se hereda.
                  -->
                  <p
                    class="mt-2 text-[11px] leading-relaxed text-[var(--color-text-secondary)]"
                  >
                    @if (note.source === 'store' || note.source === 'profile') {
                      Heredado: «{{ note.object }}».
                    }
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

              @if (aiuApplyPlan(); as plan) {
                <!-- Las cuatro configuraciones del perfil, aplicadas a las
                     lineas. Es lo unico que convierte el bloque «Base AIU»
                     del editor en importes: sin esto los porcentajes se
                     configuran y no los lee nadie. -->
                <div
                  class="mt-3 rounded-xl border border-border bg-[var(--color-surface)] px-3.5 py-3"
                >
                  <div
                    class="flex flex-wrap items-start justify-between gap-2"
                  >
                    <div class="min-w-0">
                      <p class="text-sm font-medium text-text-primary">
                        Base AIU configurada en el perfil
                      </p>
                      <p
                        class="mt-0.5 text-xs leading-relaxed text-[var(--color-text-secondary)]"
                      >
                        @if (plan.ready) {
                          AIU del
                          <strong class="text-text-primary"
                            >{{ plan.aiuPercentLabel }} %</strong
                          >
                          del valor del contrato, deducido de
                          {{ formatCurrency(plan.costBase) }} en lineas de
                          costo: contrato
                          {{ formatCurrency(plan.contractAmount) }}, AIU
                          {{ formatCurrency(plan.aiuAmount) }}.
                        } @else {
                          {{ plan.blocked }}
                        }
                      </p>
                    </div>
                    @if (plan.ready) {
                      <app-button
                        variant="secondary"
                        size="sm"
                        (clicked)="applyAiuBase()"
                      >
                        <app-icon slot="icon" name="calculator" [size]="14" />
                        Aplicar a las lineas
                      </app-button>
                    }
                  </div>

                  @if (plan.ready) {
                    <div
                      class="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3"
                    >
                      @for (part of plan.parts; track part.bucket) {
                        <div
                          class="rounded-lg border border-border bg-[var(--color-background)] px-2.5 py-2"
                        >
                          <p
                            class="text-[11px] uppercase tracking-wide text-[var(--color-text-secondary)]"
                          >
                            {{ part.label }} · {{ part.percentLabel }} %
                          </p>
                          <p
                            class="mt-0.5 text-sm font-semibold tabular-nums text-text-primary"
                          >
                            {{ formatCurrency(part.amount) }}
                          </p>
                          <p
                            class="mt-0.5 text-[11px] text-[var(--color-text-secondary)]"
                          >
                            @if (part.taxes.length > 0) {
                              @for (
                                tax of part.taxes;
                                track tax.tax_rate_id;
                                let last = $last
                              ) {
                                {{ tax.name }}{{ last ? '' : ' · ' }}
                              }
                            } @else {
                              Sin impuesto
                            }
                            @if (part.account) {
                              · cuenta {{ part.account }}
                            }
                          </p>
                        </div>
                      }
                    </div>
                    @if (plan.replaces > 0) {
                      <p
                        class="mt-2 text-[11px] text-[var(--color-text-secondary)]"
                      >
                        Reemplaza {{ plan.replaces }} linea(s) que ya llevan
                        componente AIU. Las lineas de costo no se tocan.
                      </p>
                    }
                  }
                </div>
              }

              @if (aiuUnassigned() > 0) {
                <app-alert-banner
                  class="mt-3"
                  variant="info"
                  icon="info"
                  tone="token"
                >
                  {{ aiuUnassigned() }} linea(s) sin componente: se facturan como
                  <strong>costo reembolsable</strong> del contrato. Suman al valor
                  del contrato y quedan fuera de la base gravable. Márcalas si
                  alguna es administración, imprevistos o utilidad.
                </app-alert-banner>
              }

              @if (aiuTaxableWithoutTax().length > 0) {
                <app-alert-banner
                  class="mt-3"
                  variant="warning"
                  icon="alert-triangle"
                  tone="token"
                  [heading]="
                    aiuTaxableWithoutTax().length +
                    ' línea(s) de la base gravable no declaran impuesto'
                  "
                >
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
                  también debería(n) llevarlo. La DIAN acepta el documento igual
                  —el XML cuadra consigo mismo—, y el faltante sólo aparece en
                  una fiscalización, cuando ya sólo se corrige con nota crédito.
                  Déjalas sin impuesto únicamente si el concepto está exento o
                  excluido.
                </app-alert-banner>
              }

              @if (aiuEffectiveNote(); as note) {
                @if (!note.valid) {
                  <!--
                    Migrado a «app-alert-banner» (encargo del orquestador,
                    2026-08-24): el div a mano nunca llevó role=alert.
                    Variante «danger», tono «token» — mismo par que ya usan
                    «aiuUnassigned»/«aiuTaxableWithoutTax» un poco más arriba.
                  -->
                  <app-alert-banner
                    class="mt-3"
                    variant="danger"
                    icon="alert-triangle"
                    tone="token"
                    [heading]="
                      note.length > note.max
                        ? 'El objeto del contrato AIU es demasiado largo'
                        : 'Falta el objeto del contrato AIU'
                    "
                  >
                    La regla CAV03 exige que la línea de Administración lleve
                    una nota que empiece por «{{
                      effectiveAiu()?.note_prefix
                    }}» y mida entre {{ note.min }} y {{ note.max }}
                    caracteres; la actual mide {{ note.length }}. Descríbelo
                    arriba, en <strong>Objeto del contrato</strong>, o —si es
                    siempre el mismo— en Ajustes → Facturación → AIU. Sin eso
                    la emisión se rechaza y el documento no llega a tomar
                    consecutivo.
                  </app-alert-banner>
                }
              }
            </vendix-invoice-form-section>

            }

            <!-- ── LÍNEAS ────────────────────────────────────────── -->
            <vendix-invoice-form-section
              title="Líneas"
              [help]="help('lineas')"
              icon="list"
              [badge]="itemCount() + (itemCount() === 1 ? ' línea' : ' líneas')"
              [summary]="linesSummary()"
              [errorCount]="sectionErrors().lineas"
              [expanded]="isSectionOpen('lineas')"
              (expandedChange)="setSection('lineas', $event)"
            >
              <!--
                B.3: sección compartida con el editor de perfiles
                («InvoiceSectionLineasComponent»). El «FormArray» de «items»
                sigue siendo de esta página —el componente sólo LEE sus
                filas—, así que abrir el picker, el modal de línea avanzada y
                las tres formas de crear una línea siguen abriendo los mismos
                modales de siempre; el componente sólo emite la intención.
              -->
              <vendix-invoice-section-lineas
                context="invoice"
                [rows]="itemControls()"
                [rowPaths]="lineasRowPaths"
                [isAiu]="isAiu()"
                [aiuComponentOptions]="aiuComponentOptions"
                [unitCodeOptions]="unitCodeOptions"
                [descriptionLimit]="itemDescriptionLimit"
                [rowErrors]="lineasRowErrors()"
                [rowSummaries]="lineasRowSummaries()"
                [carriesAiu]="lineCarriesAiuBound"
                [toggleAiu]="toggleLineAiuBound"
                [availableTaxes]="availableTaxes()"
                emptyStateText="Una factura sin líneas no es una factura: quemaría un consecutivo autorizado para declarar un total de cero."
                (openProductPicker)="openProductPicker($event)"
                (openAdvancedItem)="openAdvancedItem($event)"
                (addFromPicker)="openProductPickerForNewLine()"
                (addCustomItem)="openCustomItemForNewLine()"
                (addBlankLine)="addItem()"
                (removeLine)="removeItem($event)"
              ></vendix-invoice-section-lineas>
            </vendix-invoice-form-section>

            <!-- ── IMPUESTOS ─────────────────────────────────────── -->
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
              [help]="help('impuestos')"
              icon="percent"
              [summary]="taxSummary()"
              [errorCount]="sectionErrors().impuestos"
              [expanded]="isSectionOpen('impuestos')"
              (expandedChange)="setSection('impuestos', $event)"
            >
              <vendix-invoice-section-impuestos
                context="invoice"
                [breakdown]="taxBreakdown()"
                [formatCurrency]="formatCurrencyBound"
                [availableTaxesCount]="availableTaxes().length"
              ></vendix-invoice-section-impuestos>
            </vendix-invoice-form-section>

            <!-- ── RETENCIONES ───────────────────────────────────── -->
            <!--
              SE OCULTA en una exportación sin nada capturado: el comprador está
              fuera del país y no puede ser agente retenedor de la DIAN, así que
              no hay retención que practicar ni sufrir. Con filas dentro se sigue
              viendo, con su aviso.
            -->
            @if (showWithholdingSection()) {
            <vendix-invoice-form-section
              title="Retenciones"
              [help]="help('retenciones')"
              icon="hand-coins"
              [optional]="true"
              [summary]="withholdingSummary()"
              [errorCount]="sectionErrors().retenciones"
              [expanded]="isSectionOpen('retenciones')"
              (expandedChange)="setSection('retenciones', $event)"
            >
              @if (isExportInvoice()) {
                <p
                  class="mb-2 flex items-start gap-1.5 text-xs text-warning"
                >
                  <app-icon
                    name="alert-triangle"
                    [size]="14"
                    class="mt-0.5 shrink-0"
                  />
                  <span
                    >El documento es una factura de exportación: el comprador
                    está fuera del país y no puede ser agente retenedor de la
                    DIAN. Estas retenciones se enviarán tal como están —no se
                    descartan en silencio—; quítalas si no corresponden.</span
                  >
                </p>
              }
              <p class="text-xs text-[var(--color-text-secondary)] mb-2">
                La retención NO reduce el total que se declara a la DIAN
                (<code>PayableAmount</code> se valida sin mirar la retención):
                reduce lo que efectivamente se cobra. Se envía como un único
                importe positivo en <code>withholding_amount</code>, nunca como
                un impuesto negativo.
              </p>

              <!--
                La etiqueta va DENTRO del interruptor y no en un «label» que lo
                envuelve. El componente pone su propio «aria-label» al control,
                y ese atributo gana sobre el texto del «label» de alrededor: el
                lector de pantalla anunciaba «Toggle» y el texto visible no se
                leía nunca. Además un «label» que envuelve un botón dispara el
                clic dos veces.
              -->
              <div class="mb-3">
                <app-toggle
                  formControlName="manual_withholding"
                  label="Escribir el importe a mano en vez de calcularlo por concepto"
                  ariaLabel="Escribir el importe de retención a mano en vez de calcularlo por concepto"
                  (toggled)="onManualWithholdingChange()"
                />
              </div>

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
                <vendix-invoice-section-retenciones
                  context="invoice"
                  [rows]="withholdingControls()"
                  [rowPaths]="retencionesRowPaths"
                  [conceptOptions]="withholdingConceptOptions()"
                  [roleOptions]="withholdingRoleOptions"
                  [incompleteRowNumber]="incompleteWithholdingRow()"
                  [rowAmounts]="retencionesRowAmounts()"
                  [totalWithheld]="effectiveWithholding()"
                  [formatCurrency]="formatCurrencyBound"
                  emptyStateText="Sin retenciones. Agrega una si el documento las lleva."
                  (addWithholding)="addWithholding()"
                  (removeWithholding)="removeWithholding($event)"
                  (conceptChange)="onWithholdingConceptChange($event)"
                ></vendix-invoice-section-retenciones>
              }
            </vendix-invoice-form-section>

            }

            <!-- ── DIVISA ────────────────────────────────────────── -->
            <!--
              NO se gatea por tipo de documento: una venta nacional pactada en
              dólares también declara la conversión, así que esconderla en un
              documento nacional ocultaría una captura legítima.
            -->
            <vendix-invoice-form-section
              title="Divisa"
              [help]="help('divisa')"
              icon="globe"
              [optional]="true"
              [summary]="currencySummary()"
              [errorCount]="sectionErrors().divisa"
              [expanded]="isSectionOpen('divisa')"
              (expandedChange)="setSection('divisa', $event)"
            >
              <vendix-invoice-section-divisa
                context="invoice"
                [form]="invoiceForm"
                [paths]="divisaSectionPaths"
                [currencyOptions]="foreignCurrencyOptions"
                [errors]="divisaErrors()"
                [usesForeignCurrency]="usesForeignCurrency()"
                [exchangeRateLoading]="loadingExchangeRate()"
                [exchangeRateQuote]="exchangeRateQuote()"
                [exchangeRateOverridden]="exchangeRateOverridden()"
                [exchangeRateUnavailableReason]="exchangeRateUnavailableReason()"
                [foreignCurrencyCode]="foreignCurrencyCode()"
                [foreignTotalLabel]="foreignTotalLabel()"
                [formatCurrency]="formatCurrencyBound"
                (exchangeRateInputsChanged)="onExchangeRateInputsChanged()"
                (applyOfficialExchangeRate)="applyOfficialExchangeRate()"
              ></vendix-invoice-section-divisa>
            </vendix-invoice-form-section>

            <!--
              ── CONTABILIDAD ────────────────────────────────────
              B.6 evaluó extraer esta sección a un componente compartido y
              concluyó que NO hay campo en común que extraer: esta pantalla
              fuerza una cuenta POR DEFECTO más un mapa de overrides POR
              LÍNEA (porque una factura tiene líneas reales que contabilizar
              hoy); el perfil (no-AIU) fuerza dos cuentas fijas por BUCKET
              (porque un perfil no tiene líneas, sólo precarga el mapeo que
              usará la próxima factura). Cero controles del mismo nombre o
              forma entre las dos. Lo único genuinamente compartido —las
              CINCO cuentas AIU— ya vive en «InvoiceSectionAiuComponent»
              desde una fase anterior al plan, no es trabajo nuevo de B.6.
              Envolver esto en un componente con dos plantillas habría sido
              reubicar código, no eliminar duplicación (no hay duplicación
              que eliminar). Ver el mismo razonamiento en el comentario
              espejo de «invoice-profile-editor.component.ts».
            -->
            <vendix-invoice-form-section
              title="Contabilidad"
              [help]="help('contabilidad')"
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
                  <!--
                    SELECTOR CON BÚSQUEDA, no un campo de texto. Teclear el
                    código a mano es la vía directa a un PUC que no existe en
                    esta tienda: el asiento no cuadra nada y la factura sale
                    igual, así que el descuadre aparece al cerrar el mes. El
                    selector sólo ofrece cuentas del plan que aceptan
                    movimientos, trae 5 por página y el resto se alcanza
                    escribiendo código o nombre.
                  -->
                  <app-account-code-select
                    label="Cuenta PUC por defecto"
                    formControlName="default_account_code"
                    placeholder="Mapeo automático de cuentas"
                  ></app-account-code-select>
                </div>
                <app-button
                  variant="outline"
                  size="sm"
                  type="button"
                  aria-label="Aplicar cuenta contable a todas las líneas"
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
                      <app-account-code-select
                        [formControl]="accountControl(item)"
                        [error]="itemError(i, 'account_code')"
                        placeholder="Cuenta PUC (opcional)"
                        [ariaLabel]="'Cuenta PUC de ' + lineLabel(i)"
                      ></app-account-code-select>
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

          <!-- ── FORMATO DE IMPRESIÓN (B.7/E.1) ─────────────────
               Fuera del «form» a propósito, igual que la sección
               Previsualización del editor de perfiles: el selector escribe en
               su FormGroup local y no enlaza ningún control del payload
               fiscal. La precedencia real (perfil congelado → tienda →
               sistema) viaja como etiqueta, no como suposición. -->
          <vendix-invoice-form-section
            title="Formato de impresión"
            [help]="help('formato')"
            icon="printer"
            [optional]="true"
            [summary]="formatoSummary()"
            [expanded]="formatoSectionOpen()"
            (expandedChange)="formatoSectionOpen.set($event)"
          >
            <vendix-invoice-section-formato
              context="invoice"
              [form]="printFormatForm"
              [paths]="formatoSectionPaths"
              [templateOptions]="printTemplateOptions()"
              [libraryFailed]="printLibraryFailed()"
              [effectivePrintLabel]="effectivePrintLabel()"
              [storeTemplateSaving]="storeTemplateSaving()"
              (templateSelectionChange)="onStoreTemplateSelected($event)"
            ></vendix-invoice-section-formato>
          </vendix-invoice-form-section>

          <!-- ── NOTAS INTERNAS ────────────────────────────────── -->
          <!-- B.7: misma sustitución — el par Descripción/Nota
               interna vive ahora en el componente compartido. -->
          <vendix-invoice-form-section
            title="Notas internas"
            [help]="help('notas_internas')"
            icon="sticky-note"
            [optional]="true"
            [expanded]="isSectionOpen('notas_internas')"
            (expandedChange)="setSection('notas_internas', $event)"
          >
            <vendix-invoice-section-notas
              context="invoice"
              [form]="invoiceForm"
              [paths]="notasSectionPaths"
            ></vendix-invoice-section-notas>
          </vendix-invoice-form-section>

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

    <!--
      «¿RECONFIGURO LA FACTURA CON ESTE PERFIL?»

      Sólo aparece si hay algo escrito a mano que el perfil pisaría. Con la
      factura virgen —el caso normal— el perfil se aplica sin preguntar nada.

      El estado de apertura se ATA a la señal en una sola dirección y el cierre
      se escucha aparte: app-modal cierra con Escape por su cuenta, y sin
      escuchar isOpenChange esa tecla dejaría el modal invisible con la
      pregunta sin responder y el selector mostrando un perfil que nunca se
      aplicó — que es exactamente el estado que este modal existe para impedir.
    -->
    <app-confirmation-modal
      [isOpen]="profilePendingConfirm() !== null"
      (isOpenChange)="onProfileConfirmOpenChange($event)"
      title="Reconfigurar la factura con el perfil"
      [message]="profileConfirmMessage()"
      confirmText="Aplicar el perfil"
      cancelText="Dejarla como está"
      confirmVariant="danger"
      size="md"
      (confirm)="confirmProfileApply()"
      (cancel)="cancelProfileApply()"
    />

    <!--
      «VER COMO SALDRÁ» ANTES DE EMITIR (E.2 — paso 6 del plan de cierre).

      La previsualización muestra el XML que la factura produciría y las reglas
      del Anexo Técnico evaluadas sobre él, no el formato de impresión. El
      acoplamiento entre datos y formato vive en el editor de plantillas (FB-29
      tiene su propio botón de previsualización con un documento de muestra);
      acá lo que se valida es el CONTENIDO —la base gravable segregada, la nota
      CAV03, las identidades de totales, los códigos de tributo— porque es lo
      que decide si la DIAN acepta o rechaza.

      No descarga nada, no persiste nada y NO toma consecutivo
      ('PreviewNumberingGuard' lo protege). El número visible es «PREVIEW». El
      cuerpo del POST es el de la factura tal como está en el formulario: líneas
      capturadas, adquiriente, base AIU, componentes, objeto del contrato. Si
      el perfil está fijado, el preview refleja el snapshot VIVO del perfil
      ('current_config'); si no, refleja el snapshot MANUAL del formulario.
    -->
    <app-modal
      [isOpen]="printPreviewOpen()"
      (isOpenChange)="closePrintPreview($event)"
      title="Ver como saldrá"
      [subtitle]="
        'Previsualización del XML — ' +
        (printPreviewProfileId() !== null
          ? 'perfil #' + printPreviewProfileId()
          : 'modo manual')
      "
      size="xl"
      [fullScreenOnMobile]="true"
    >
      <app-alert-banner
        variant="warning"
        icon="alert-triangle"
        tone="token"
        class="mb-3 block"
      >
        <strong>Número de muestra.</strong> Esta previsualización no emite la
        factura ni toma consecutivo: usa el marcador «PREVIEW». Lo que SÍ
        refleja es lo que acabas de capturar — líneas, adquiriente, base AIU.
      </app-alert-banner>

      @if (printPreviewLoading()) {
        <div class="flex items-center justify-center gap-2 py-10">
          <app-icon name="loader" [size]="18" class="animate-spin"></app-icon>
          <span class="text-sm text-[var(--color-text-secondary)]">
            Generando la previsualización…
          </span>
        </div>
      } @else if (printPreviewError(); as previewError) {
        <p class="py-6 text-center text-sm text-error">{{ previewError }}</p>
      } @else if (printPreviewResult(); as result) {
        <!--
          Reglas del anexo evaluadas sobre el XML. Salen ANTES del XML para
          que el operador lea el veredicto (FAU04, FAX01, AIU-piso) y no
          tenga que abrirlo para saber si puede emitir.
        -->
        <div
          class="mb-3 max-h-[180px] overflow-auto rounded-lg border border-border bg-surface-secondary p-2 text-xs"
          role="region"
          aria-label="Reglas del Anexo Técnico evaluadas"
        >
          <p class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
            Reglas del anexo ({{ result.validations.length }})
          </p>
          <ul class="space-y-1">
            @for (rule of result.validations; track rule.rule) {
              <li class="flex items-start gap-2">
                <app-icon
                  [name]="rule.passed ? 'check-circle' : (rule.severity === 'blocker' ? 'x-circle' : 'alert-circle')"
                  [size]="12"
                  class="shrink-0 mt-0.5"
                  [class.text-success]="rule.passed"
                  [class.text-error]="!rule.passed && rule.severity === 'blocker'"
                  [class.text-warning]="!rule.passed && rule.severity !== 'blocker'"
                ></app-icon>
                <span class="flex-1 min-w-0">
                  <strong class="font-mono">{{ rule.rule }}</strong>
                  <span class="text-text-secondary"> — {{ rule.message }}</span>
                </span>
              </li>
            }
          </ul>
        </div>

        <!--
          Totales del XML proyectado. Sirven de puente entre las reglas
          (veredicto) y el XML (evidencia): ver las cifras evita tener que
          parsear el documento a ojo.
        -->
        <div
          class="mb-3 grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface-secondary p-2 text-[11px] sm:grid-cols-5"
          role="region"
          aria-label="Totales del XML"
        >
          <div>
            <p class="text-text-secondary">Valor del contrato</p>
            <p class="font-mono font-semibold">{{ result.breakdown.totals.line_extension_amount }}</p>
          </div>
          <div>
            <p class="text-text-secondary">Base gravable</p>
            <p class="font-mono font-semibold">{{ result.breakdown.totals.tax_exclusive_amount }}</p>
          </div>
          <div>
            <p class="text-text-secondary">Tributos</p>
            <p class="font-mono font-semibold">{{ result.breakdown.totals.tax_amount }}</p>
          </div>
          <div>
            <p class="text-text-secondary">Total con tributos</p>
            <p class="font-mono font-semibold">{{ result.breakdown.totals.tax_inclusive_amount }}</p>
          </div>
          <div>
            <p class="text-text-secondary">A pagar</p>
            <p class="font-mono font-semibold">{{ result.breakdown.totals.payable_amount }}</p>
          </div>
        </div>

        <!--
          XML crudo. Se pinta en monoespaciado y con scroll horizontal porque
          el Anexo exige líneas largas; envolverlas deformaría la jerarquía.
        -->
        <pre
          class="max-h-[420px] overflow-auto rounded-lg border border-border bg-slate-950 p-3 text-[11px] leading-tight text-slate-100"
          role="region"
          aria-label="XML proyectado"
        ><code>{{ result.xml }}</code></pre>

        <p class="mt-2 text-right text-[11px] text-[var(--color-text-secondary)]">
          El XML viaja siempre igual a la DIAN; el formato de impresión se previsualiza en su editor.
        </p>
      }
    </app-modal>
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
  private readonly printGateway = inject(PrintGatewayClientService);

  // ── Catálogos estáticos ─────────────────────────────────────
  readonly invoiceTypeOptions = INVOICE_TYPE_OPTIONS;
  readonly operationTypeOptions = OPERATION_TYPE_OPTIONS;
  readonly paymentFormOptions = PAYMENT_FORM_OPTIONS;
  readonly paymentMeansOptions = PAYMENT_MEANS_OPTIONS;
  readonly documentTypeOptions = DOCUMENT_TYPE_OPTIONS;
  readonly taxRegimeOptions = TAX_REGIME_OPTIONS;
  readonly unitCodeOptions = UNIT_CODE_OPTIONS;
  readonly aiuComponentOptions = AIU_COMPONENT_OPTIONS;
  /**
   * La ayuda larga de cada sección, del catálogo compartido con el editor de
   * perfiles. Método y no mapa inline: la misma regla fiscal explicada de dos
   * maneras en dos pantallas acaba contradiciéndose.
   */
  readonly help = invoiceHelp;

  /**
   * F.3: tope de `description` por LÍNEA de factura — FAZ02 (`1-300`), el
   * mismo que ya aplica `CreateFacturaInvoiceItemDto` en el backend. No es
   * el mismo tope que el de una nota crédito/débito (500): esa cota vive en
   * `credit-note-create.component.ts`/`invoice-note-create.component.ts`,
   * que no comparten esta sección.
   */
  readonly itemDescriptionLimit = CONFIG_LIMITS.line_description;

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
    // AIU va abierta por lo mismo que va antes de Líneas: decide qué porción
    // lleva cada línea. Cuando la operación no es AIU la sección no se pinta,
    // así que tenerla en el conjunto no cuesta nada.
    new Set<SectionId>(['perfil', 'documento', 'adquiriente', 'aiu', 'lineas']),
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
    // F.3: 500 es FAD13 (`/Invoice/cbc:Note`, `E A 1-500`) — el mismo tope que
    // `CreateInvoiceDto.notes` en el backend (create-invoice.dto.ts:1101).
    notes: ['', Validators.maxLength(CONFIG_LIMITS.header_note)],

    // AIU. Vacío ⇒ hereda el objeto del contrato de la tienda. Es un campo por
    // documento y no sólo de configuración porque una constructora factura
    // varias obras a la vez y la nota CAV03 describe UNA de ellas.
    aiu_contract_object: [''],

    /**
     * EL AIU DE ESTE DOCUMENTO — no del perfil.
     *
     * Antes esta pantalla tenía UN control AIU editable —el objeto del
     * contrato— y todo lo demás en sólo lectura, remitiendo a «Facturación →
     * Perfiles». Corregir un reparto obligaba a salir de la emisión y crear una
     * versión N+1 del perfil, que afecta a TODAS las facturas futuras, para
     * arreglar una. Estos controles son la copia de trabajo del documento: se
     * precargan del perfil y editarlos no lo toca (ADR-3).
     *
     * QUÉ HACE CADA UNO CON LO QUE SE EMITE:
     * · los tres porcentajes y su unidad, las cinco cuentas y la matriz de
     *   tributos gobiernan `applyAiuBase()`, que ESCRIBE LAS LÍNEAS del
     *   documento —importe, cuenta e impuestos—, y las líneas sí viajan en el
     *   payload. Editarlos cambia lo que se emite.
     * · `taxable_basis`, `enforce_minimum_base` y `minimum_base_percent` NO
     *   viajan: `CreateInvoiceDto` no los declara y el backend los toma de la
     *   versión del perfil (`invoicing.service.ts`, `aiu_context`). Se pintan
     *   —la estructura es la misma en las dos pantallas— pero llegan
     *   CONGELADOS desde `aiuFrozenFields`, con el motivo a la vista. Dejarlos
     *   editables aceptaría un valor que el servidor ignora, y ese es el fallo
     *   mudo de este módulo: la pantalla instruye sobre una base y el documento
     *   se emite con otra.
     *
     * El objeto del contrato y la cuenta del costo reembolsable NO se duplican
     * acá: la sección los toma de `aiu_contract_object` y `default_account_code`
     * por el mapa de rutas (`aiuSectionPaths`).
     */
    aiu: this.fb.group({
      taxable_basis: ['aiu' as AiuTaxableBasis],
      enforce_minimum_base: [true],
      minimum_base_percent: [
        formatPercentScaled(AIU_LEGAL_FLOOR_PERCENT_SCALED),
      ],
      components_basis: ['contract' as AiuComponentsBasis],
      // VACÍOS a propósito, y no los 5/2/3 con que nace un perfil nuevo: un
      // documento sin perfil no tiene reparto configurado, y sembrar unos
      // porcentajes plausibles haría que «Aplicar a las líneas» escribiera
      // importes que nadie acordó. Vacío suma 0,00 % y el plan lo dice.
      administracion: [''],
      imprevistos: [''],
      utilidad: [''],
      revenue_administracion: [''],
      revenue_imprevistos: [''],
      revenue_utilidad: [''],
      vat_payable_account: [''],
      // Modelo de contabilización. `'sumada'` por omisión: es el ÚNICO
      // habilitado (`ENABLED_ACCOUNTING_MODELS`) y lo que el calculador hace
      // por construcción, así que un documento que abre con este valor no
      // cambia de comportamiento ni nace `dirty`. C.6.
      accounting_model: ['sumada' as AccountingModel],
    }),

    /**
     * Matriz de tributos DEL DOCUMENTO. Mismas filas que la del perfil, con la
     * del costo reembolsable incluida y nunca pintada: es la constancia de qué
     * hizo el documento con ese costo, y `derivedCostTaxRule` la mantiene
     * coherente con la base.
     */
    aiu_taxes: this.fb.array([] as FormGroup[]),

    // Adquiriente
    customer_id: [null],
    customer_name: ['', [Validators.required, Validators.minLength(2)]],
    customer_document_type: [DOCUMENT_TYPE_NIT_CODE],
    customer_tax_id: [''],
    customer_verification_digit: [''],
    /**
     * A.8 — tipo de persona del adquiriente NIT. Sólo se PINTA con NIT
     * (una cédula ES una persona natural, no hay nada que elegir) y el
     * payload lo fija a `'NATURAL'` por su cuenta cuando el documento no es
     * NIT. Los valores son los de `CreateCustomerDto.person_type`, porque su
     * único consumidor real hoy es el `inline_customer` que materializa la
     * fila del cliente al emitir.
     */
    customer_person_type: ['JURIDICA' as 'NATURAL' | 'JURIDICA'],
    customer_tax_regime: [''],
    customer_fiscal_responsibilities: [[] as string[]],
    customer_email: ['', [Validators.email]],
    customer_phone: [''],
    customer_address: [''],
    /**
     * A.8 — municipio DANE del adquiriente (Divipola). El control guarda el
     * CÓDIGO de 5 dígitos vía CVA (`app-dian-municipality-select`) y el
     * nombre legible viaja aparte para `city_name`; `buildPayload` los sube
     * dentro de `customer_address` estructurada. Sin este código la DIAN
     * rechaza el `cbc:ID` de `cac:CityName` DESPUÉS de consumir consecutivo.
     */
    customer_municipality_code: [''],
    customer_city_name: [''],

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

  /**
   * `true` si el documento es una factura de EXPORTACIÓN.
   *
   * Decide qué secciones aplican: una exportación no está sujeta a retención en
   * Colombia, porque el comprador está fuera del país y no puede ser agente
   * retenedor de la DIAN.
   */
  readonly isExportInvoice = computed(
    () => this.rawValue()['invoice_type'] === 'export_invoice',
  );

  /**
   * ¿Se pinta la sección AIU? SÓLO si el documento es de operación AIU (09).
   *
   * Hubo una versión anterior que además la pintaba cuando ya había algo
   * capturado dentro —objeto de contrato, o una línea con componente—, con el
   * argumento de que «ese dato viaja al XML aunque el tipo de operación haya
   * dejado de ser AIU». La premisa era falsa: `buildPayload` condiciona los dos
   * únicos campos AIU del documento a `isAiu()` —`aiu_contract_object` y el
   * `aiu_component` de cada línea—, así que en un documento que no es AIU ni uno
   * de los dos llega al backend, y menos al XML.
   *
   * Sin esa premisa sólo quedaba el coste: una sección que únicamente podía
   * decir «esto no aplica», con su propio contador de errores, en la pantalla
   * que gasta numeración autorizada. Y algo peor que ruido — invitaba a
   * configurar un régimen y unas bases que se iban a descartar en silencio.
   *
   * Ocultar NO borra: los valores siguen en el formulario y reaparecen intactos
   * si el tipo vuelve a AIU. Limpiarlos al cambiar un selector destruiría el
   * trabajo de quien se equivocó de tipo durante un segundo.
   */
  readonly showAiuSection = computed<boolean>(() => this.isAiu());

  /** Retenciones capturadas, por fila o por importe manual. */
  readonly hasWithholdingData = computed<boolean>(() => {
    if (this.withholdingsValue().length > 0) return true;
    return Number(this.rawValue()['withholding_amount'] ?? 0) > 0;
  });

  /**
   * La sección de retenciones se pinta salvo en una exportación SIN nada
   * capturado. Misma regla que el AIU: se oculta lo vacío e inaplicable, nunca
   * lo que tiene datos.
   */
  readonly showWithholdingSection = computed<boolean>(
    () => !this.isExportInvoice() || this.hasWithholdingData(),
  );

  readonly isNitCustomer = computed(
    () => this.rawValue()['customer_document_type'] === DOCUMENT_TYPE_NIT_CODE,
  );

  /**
   * Número del documento del adquiriente SIN el DV pegado.
   *
   * Igual criterio que el checkout: `900123456-8` ya trae el DV, y quitar
   * todo lo no numérico sin recortar el sufijo daría un «NIT» de diez dígitos
   * que no es de nadie. Es la base de la que se deriva todo lo demás abajo.
   */
  readonly customerTaxIdBase = computed(() => {
    const rawTaxId = String(this.rawValue()['customer_tax_id'] ?? '').trim();
    const head = rawTaxId.includes('-') ? rawTaxId.split('-')[0] : rawTaxId;
    return head.replace(/\D/g, '');
  });

  /**
   * A.8 — DV calculado en vivo con el MÓDULO 11 de la DIAN.
   *
   * Misma util compartida que consume el checkout (`shared/utils/nit.util`):
   * nunca se digita, porque un checksum tecleado sólo puede coincidir con el
   * NIT o estar mal — y estar mal es un rechazo DIAN con consecutivo ya
   * quemado. Vacío si el documento no es NIT (no hay nada que mostrar ni que
   * enviar).
   */
  readonly computedCustomerDv = computed(() => {
    if (!this.isNitCustomer()) return '';
    return computeNitDv(this.customerTaxIdBase()) ?? '';
  });

  /** Label dinámico: empresa ⇒ razón social; cédula/pasaporte ⇒ nombre. */
  readonly customerNameLabel = computed(() =>
    this.isNitCustomer() ? 'Razón social' : 'Nombre completo',
  );

  readonly customerNamePlaceholder = computed(() =>
    this.isNitCustomer()
      ? 'Nombre de la empresa registrado ante la DIAN'
      : 'Nombre y apellido (ej. Keilin Luz Sierra Toro)',
  );

  readonly customerTaxIdPlaceholder = computed(() =>
    this.isNitCustomer() ? '900123456' : '1118860902',
  );

  /**
   * A.8 — opciones del tipo de persona. Valores del contrato
   * `CreateCustomerDto.person_type`; etiquetas según la tabla del dueño.
   */
  readonly customerPersonTypeOptions: SelectorOption[] = [
    { value: 'JURIDICA', label: 'Persona Jurídica' },
    { value: 'NATURAL', label: 'Persona Natural' },
  ];

  /**
   * A.8 — el código DANE es obligatorio cuando hay dirección fiscal.
   *
   * No es `Validators.required` del control porque la regla NO es «siempre»:
   * una venta a consumidor final no declara dirección, y una exportación es
   * justo el caso donde un catálogo colombiano sobra. Con dirección escrita
   * y municipio ausente se avisa junto al campo Y en los bloqueadores, antes
   * de que el rechazo lo descubra con el consecutivo ya consumido.
   */
  readonly customerMunicipalityError = computed<string>(() => {
    if (this.isExportInvoice()) return '';
    const raw = this.rawValue();
    const addressLine = String(raw['customer_address'] ?? '').trim();
    const cityCode = String(raw['customer_municipality_code'] ?? '').trim();
    if (addressLine && !cityCode) {
      return 'Con dirección fiscal hace falta el municipio DANE: búscalo por nombre y selecciónalo.';
    }
    return '';
  });

  readonly isManualWithholding = computed(
    () => this.rawValue()['manual_withholding'] === true,
  );

  readonly usesForeignCurrency = computed(
    () => this.rawValue()['use_foreign_currency'] === true,
  );

  readonly foreignCurrencyCode = computed<string>(
    () => this.rawValue()['foreign_currency'] || 'divisa',
  );

  /**
   * Responsabilidades fiscales del adquiriente, reactivas.
   *
   * PÚBLICA porque la sección AIU deriva de ellas su SUGERENCIA de tributos y
   * la recibe como entrada. Se pasa el valor y no la ruta del control a
   * propósito: la sección no debe poder escribir el RUT del cliente, sólo
   * leerlo. Cuelga de `rawValue()`, así que cambia con el cliente elegido y con
   * cada casilla que se marque a mano.
   */
  readonly responsibilitiesValue = computed<string[]>(() => {
    const value = this.rawValue()['customer_fiscal_responsibilities'];
    return Array.isArray(value) ? value : [];
  });

  // ── Resolución: selección, elegibilidad y banner ────────────

  private readonly activeResolutions = toSignal(
    this.store.select(selectActiveResolutions),
    { initialValue: [] as InvoiceResolution[] },
  );

  /**
   * La lista COMPLETA, activas e inactivas, y sólo para EXPLICAR.
   *
   * No sustituye a `activeResolutions()` a propósito: de esa cuelgan la
   * elegibilidad y la preselección, o sea la ruta que gasta numeración
   * autorizada, y ampliarle la fuente sería relajar la compuerta que impide
   * numerar con una resolución desactivada.
   *
   * Existe porque `selectActiveResolutions` ya filtra `is_active`, y sin la
   * lista completa el aviso no puede distinguir «la resolución preferida se
   * borró» de «está desactivada» — dos causas con dos remedios distintos
   * (registrarla de nuevo, o reactivarla) que el operador no puede adivinar.
   */
  private readonly allResolutions = toSignal(
    this.store.select(selectResolutions),
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
   * Igual que `resolutionControl`, y por el mismo motivo: el selector de perfil
   * se pinta ARRIBA del `form` —elegir un perfil reescribe el documento entero,
   * así que va antes de los campos que reescribe— y sin un `formGroup` ancestro
   * `formControlName` no resolvería contra nada. El control sigue siendo el del
   * formulario, así que `buildPayload`, el reset y los computed que leen el
   * valor crudo no se enteran del cambio de sitio.
   */
  get profileControl(): FormControl<number | null> {
    return this.invoiceForm.get('profile_id') as FormControl<number | null>;
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
          hasRemainingRange(res),
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
        nextConsecutive(res) +
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
    const exhausted = sameType.filter((res) => !hasRemainingRange(res));

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

  /** El id que el perfil activo prefiere, o `null` si no opina. */
  private readonly profilePreferredResolutionId = computed<number | null>(() => {
    const raw = Number(this.profileConfig()?.dian?.resolution_id);
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  });

  /**
   * Qué pasó con la preferencia del perfil, cuando no se pudo honrar.
   *
   * Callar acá sería lo peor de los dos mundos: el operador configuró un rango
   * en el perfil, la factura salió con otro, y nada en la pantalla lo relaciona.
   * El aviso nombra la resolución guardada —de ahí que el perfil guarde también
   * `resolution_number`— y el motivo, que son las tres cosas que hacen falta
   * para decidir si se sigue o se va a renovar el rango.
   */
  readonly profileResolutionNotice = computed<string | null>(() => {
    const preferred = this.profilePreferredResolutionId();
    if (preferred === null) return null;
    if (this.autoSelectableResolutions().some((res) => res.id === preferred)) {
      return null;
    }

    const config = this.profileConfig();
    const label = config?.dian?.resolution_number
      ? 'la resolución ' + config.dian.resolution_number
      : 'una resolución que ya no está disponible';
    const chosen = this.activeResolution();
    const found = this.allResolutions().find((res) => res.id === preferred);

    // El ORDEN de las ramas es el de GRAVEDAD, no el de evaluación de
    // `eligibleResolutions`. La numeración de habilitación va primero porque es
    // lo único que no se arregla: un rango agotado se renueva y una vigencia se
    // prorroga, pero una resolución de pruebas nunca debe numerar una factura
    // real. Y las dos cosas coinciden a menudo —el rango de pruebas se gasta
    // rápido—, así que si ganara «agotó su rango» el aviso mandaría a pedirle a
    // la DIAN un rango nuevo para una numeración que jamás hay que usar.
    let reason: string;
    if (!found) {
      reason = 'ya no figura entre las resoluciones de la tienda';
    } else if (isHabilitationNumbering(found)) {
      reason =
        'es numeración de habilitación, que nunca se preselecciona para una factura real';
    } else if (found.is_active !== true) {
      reason = 'está inactiva';
    } else if (!hasRemainingRange(found)) {
      reason = 'agotó su rango';
    } else if (!isWithinValidity(found, toLocalDateString())) {
      reason = 'está fuera de vigencia';
    } else {
      reason = 'no puede numerar este documento';
    }

    return (
      'El perfil prefiere ' +
      label +
      ', pero ' +
      reason +
      '. Se preseleccionó ' +
      (chosen
        ? (chosen.prefix || 'sin prefijo') + ' · ' + chosen.resolution_number
        : 'ninguna') +
      '.'
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
    // Dependencia DELIBERADA y sin uso: aplicar un perfil a la fuerza tiene que
    // volver a correr este efecto aunque la resolución preferida sea la misma
    // que la del perfil anterior. Ver `profileApplyToken`.
    this.profileApplyToken();
    const control = this.invoiceForm.get('resolution_id');
    if (!control) return;

    const current = Number(control.value) || null;

    // La PREFERENCIA DEL PERFIL, honrada sólo si hoy puede numerar de verdad. Se
    // contrasta contra las auto-elegibles y no contra `eligible`: eso descarta
    // de un golpe la vencida, la agotada, la inactiva y la de habilitación, que
    // son justo los cuatro casos en que obedecer al perfil produciría una
    // factura mal numerada.
    const preferred = this.profilePreferredResolutionId();
    const honoured =
      preferred !== null &&
      this.autoSelectableResolutions().some((res) => res.id === preferred)
        ? preferred
        : null;

    // ─── QUIÉN LE GANA A QUIÉN ───────────────────────────────────────────────
    //
    // Lo que el USUARIO eligió a mano manda sobre todo, mientras siga siendo
    // elegible. Se contrasta contra `eligible` y no contra las auto-elegibles:
    // una fila de habilitación marcada A MANO es una elección legítima —durante
    // la habilitación es justo lo que hace falta— y no se le puede deshacer bajo
    // los dedos.
    //
    // `dirty` es lo que separa «lo eligió el usuario» de «lo puso este efecto»:
    // `setValue` programático NO marca dirty, así que sólo la interacción real
    // lo enciende. Distinguirlo importa porque el perfil llega DESPUÉS de la
    // primera pasada de este efecto —hay que elegir tipo de operación para que
    // haya perfil—, y sin la distinción la preselección automática de esa
    // primera pasada bloqueaba para siempre la preferencia del perfil: se
    // guardaba una resolución preferida que jamás se aplicaba, en silencio y sin
    // aviso, porque desde el punto de vista del aviso todo estaba en orden.
    if (control.dirty && current && eligible.some((res) => res.id === current)) {
      return;
    }

    // La preferencia del perfil desplaza a la preselección automática. No es
    // pisarle nada al usuario: es para lo que se configuró el perfil.
    if (honoured !== null) {
      if ((control.value ?? null) !== honoured) control.setValue(honoured);
      return;
    }

    // Sin preferencia honorable, lo automático ya puesto se queda. Si dejó de
    // ser elegible (cambió el tipo de documento, se agotó el rango) se rehace:
    // dejarlo puesto mandaría al backend un id que la pantalla ya no ofrece.
    if (current && eligible.some((res) => res.id === current)) return;

    // Y elegir SOLA sólo elige producción. Si no hay ninguna se queda vacío y lo
    // dice `habilitationWarning()`: preseleccionar el rango de pruebas porque es
    // lo único que quedaba convierte un descuido en una factura real con
    // numeración que no es de nadie.
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
   * Snapshot COMPLETO de la versión vigente del perfil elegido.
   *
   * Antes sólo se guardaba `aiu`, y con eso el perfil no podía hacer lo único
   * que un perfil existe para hacer: precargar el formulario. Elegir uno pintaba
   * un instructivo y no rellenaba ni un campo.
   *
   * SIGUE SIENDO INSTRUCTIVO, no fuente de cálculo. Lo que se emite lo calcula
   * el servidor contra la versión que congela al timbrar; esto sólo evita
   * rediligenciar.
   */
  readonly profileConfig = signal<InvoiceProfileConfig | null>(null);

  /**
   * Campos que el perfil rellenó, por nombre de control.
   *
   * EXISTE PARA QUE LO PRECARGADO SEA VISIBLE. Un preset que inyecta un valor
   * que el usuario nunca ve y termina emitido a la DIAN es el peor resultado
   * posible de esta función: la marca «del perfil» junto al campo es lo que
   * convierte una inyección silenciosa en una propuesta revisable.
   */
  readonly prefilledFields = signal<Set<string>>(new Set<string>());

  /**
   * Líneas modelo del perfil que NO se sembraron porque el usuario ya había
   * capturado líneas propias.
   *
   * Pisar lo que alguien ya escribió es inaceptable en una pantalla que gasta
   * numeración autorizada, así que en ese caso la siembra se OFRECE —con este
   * contador y un botón— en vez de ejecutarse.
   */
  readonly pendingModelLines = signal<number>(0);

  /**
   * Perfil que el usuario acaba de elegir y que ESPERA CONFIRMACIÓN, porque
   * aplicarlo pisaría datos que él ya había escrito. `null` = nada pendiente.
   *
   * Elegir un perfil no es un ajuste más de la cabecera: reescribe la
   * resolución, los códigos de pago, las notas, las líneas, las retenciones y
   * el bloque AIU. Sobre un formulario recién abierto eso es exactamente lo que
   * se quiere y no hay nada que preguntar; sobre un formulario a medio llenar es
   * destrucción de trabajo que ningún Ctrl+Z recupera. La pregunta sólo aparece
   * en el segundo caso — ver `profileOverwriteFields()`.
   */
  readonly profilePendingConfirm = signal<number | null>(null);

  /** Lo que se perdería al aplicar el perfil pendiente. Se pinta en el modal. */
  readonly profileOverwriteList = signal<string[]>([]);

  /**
   * Contador que sólo existe para RE-DISPARAR `preselectEligibleResolution`.
   *
   * El efecto honra la resolución preferida del perfil, pero sus dependencias
   * son valores: si dos perfiles distintos prefieren la MISMA resolución,
   * `profilePreferredResolutionId()` no cambia, el efecto no vuelve a correr, y
   * una resolución que el usuario había cambiado a mano se quedaría puesta pese
   * a que acaba de pedir «aplícame todo el perfil». Incrementar este contador es
   * lo que fuerza la reevaluación SIN añadir un segundo escritor sobre
   * `resolution_id` — que es lo que el propio efecto prohíbe.
   */
  private readonly profileApplyToken = signal(0);

  /**
   * El último perfil que de verdad se aplicó, para poder devolver el selector
   * a su sitio si el usuario cancela la confirmación. El selector muestra lo que
   * él eligió mientras la pregunta está en pantalla; si dice «no», tiene que
   * volver a mostrar el perfil bajo el que está trabajando y no el que descartó.
   */
  private appliedProfileId = PROFILE_NONE;

  /**
   * `true` durante UNA sola precarga: la que el usuario confirmó.
   *
   * Es lo que convierte la precarga conservadora —que respeta todo lo escrito—
   * en la aplicación completa que se acaba de autorizar. Se consume al leerlo,
   * así que ninguna precarga posterior (un reintento, el catálogo que llega
   * tarde) hereda el permiso de sobrescribir.
   */
  private forceProfileSeed = false;

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
  readonly effectiveAiu = computed<EffectiveAiuSettings | null>(() => {
    const store = this.aiuSettings();
    if (this.selectedProfileId() === PROFILE_NONE) {
      // Sin perfil manda `store_settings`, que no tiene `taxable_basis`: se
      // deriva de su `regime` con el MISMO resolvedor del backend en vez de
      // asumir `'aiu'`. Asumirla instruiría «AIU completo» a toda tienda del
      // Decreto 1372/1992, que grava sólo la utilidad.
      return store
        ? {
            ...store,
            taxable_basis: resolveAiuTaxableBasis({
              regime: store.regime,
              taxable_basis: null,
            }),
            regime: store.regime,
          }
        : null;
    }
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
    // LA BASE SE DERIVA, NO SE COPIA. `aiu.regime` seguía existiendo en el
    // snapshot del perfil incluso cuando su `taxable_basis` decía otra cosa, y
    // leerlo a secas producía el peor desalineamiento del módulo: un perfil
    // `{ taxable_basis: 'subtotal', regime: 'et_462_1' }` hacía que esta
    // pantalla instruyera «AIU completo, piso del 10 %» mientras el backend
    // —que resuelve por `resolveAiuTaxableBasis`— gravaba el contrato entero,
    // costo reembolsable incluido, sin piso alguno. El operador seguía la
    // instrucción, la DIAN aceptaba el documento porque el XML cuadra consigo
    // mismo, y el faltante sólo aparecía en una fiscalización.
    const taxable_basis = resolveAiuTaxableBasis(aiu);
    return {
      ...store,
      taxable_basis,
      // El régimen legal se deriva de la base, nunca al revés: bajo
      // `'subtotal'` no hay régimen que citar y el campo queda en `null`.
      regime: regimeFromTaxableBasis(taxable_basis),
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
      // El perfil ELIGIÓ la base gravable: no hay «valor por defecto» que
      // advertir.
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

  /**
   * Líneas sin componente. NO son un error: son el costo reembolsable del
   * contrato (ver `InvoiceCalculatorLineInput.aiu_component`, que lo documenta
   * como el caso legítimo, y la cubeta `costo` del contrato del perfil).
   */
  readonly aiuUnassigned = computed(
    () => this.itemsValue().filter((item) => !item.aiu_component).length,
  );

  /**
   * Documento AIU en el que NINGUNA línea es del AIU.
   *
   * Esto sí es un defecto: el `CustomizationID` 09 declara un contrato AIU y el
   * desglose no trae ni administración, ni imprevistos, ni utilidad. La base
   * gravable saldría en cero, y bajo el art. 462-1 el piso del 10 % la rechaza
   * al calcular —con el consecutivo ya tomado— mientras que bajo el Decreto
   * 1372 se emitiría un documento sin un peso de base.
   *
   * Con el arreglo vacío devuelve `false`: la falta de líneas la reporta su
   * propia sección, y dos mensajes para un solo hecho mandan a arreglar dos
   * cosas donde hay una.
   */
  readonly aiuWithoutAnyComponent = computed(() => {
    const items = this.itemsValue();
    return items.length > 0 && items.every((item) => !item.aiu_component);
  });

  // ── La sección AIU compartida ───────────────────────────────
  //
  // Las rutas: el objeto del contrato y la cuenta del costo reembolsable
  // apuntan a controles que YA EXISTÍAN en la raíz del formulario
  // (`aiu_contract_object` y `default_account_code`). No se duplican dentro del
  // grupo `aiu` porque duplicar un control fiscal es lo que produce el fallo de
  // «dos campos que se ven iguales y guardan distinto»: `buildPayload` lee
  // `aiu_contract_object` y `default_account_code` se derrama sobre las líneas,
  // así que el segundo par nunca viajaría y el operador no tendría forma de
  // saber cuál de los dos leyó el servidor.
  readonly aiuSectionPaths: AiuSectionPaths = {
    taxable_basis: 'aiu.taxable_basis',
    contract_object: 'aiu_contract_object',
    enforce_minimum_base: 'aiu.enforce_minimum_base',
    minimum_base_percent: 'aiu.minimum_base_percent',
    components_basis: 'aiu.components_basis',
    components: {
      administracion: 'aiu.administracion',
      imprevistos: 'aiu.imprevistos',
      utilidad: 'aiu.utilidad',
    },
    revenue_account: {
      administracion: 'aiu.revenue_administracion',
      imprevistos: 'aiu.revenue_imprevistos',
      utilidad: 'aiu.revenue_utilidad',
      costo: 'default_account_code',
    },
    vat_payable_account: 'aiu.vat_payable_account',
    // C.6: el control ya existe en el grupo `aiu` de arriba; esta ruta es lo
    // que le faltaba para que la sección compartida deje de pintar los dos
    // `div` estáticos y pinte un radio real.
    accounting_model: 'aiu.accounting_model',
  };

  // ── La sección Documento compartida (B.2) ───────────────────
  //
  // El formulario de la factura es PLANO: `invoice_type`, `payment_form`,
  // `payment_means_code`, `issue_date`, `due_date`, `notes` viven en la raíz.
  // El perfil los anida bajo `dian`. Ver el docblock de
  // `invoice-section-documento.component.ts` y el ADR-2 del plan.
  readonly documentoSectionPaths: DocumentoSectionPaths = {
    invoice_type: 'invoice_type',
    payment_form: 'payment_form',
    payment_means_code: 'payment_means_code',
    issue_date: 'issue_date',
    due_date: 'due_date',
    notes: 'notes',
    header_notes: null,
  };

  // ── La sección Notas internas compartida (B.7) ─────────────────
  //
  // En la factura los controles son `null`: el DTO de creación no declara
  // `internal_note` ni `description`, así que el componente compartido pinta
  // el párrafo informativo en lugar de los campos. Ver el docblock de
  // `invoice-section-notas.component.ts`.
  readonly notasSectionPaths: NotasSectionPaths = {
    description: null,
    internal_note: null,
  };

  /**
   * Los avisos de resolución, ya resueltos como lista para el componente
   * compartido. La LÓGICA de cuándo aparece cada uno sigue siendo de esta
   * página —depende del perfil activo, el catálogo de resoluciones y el
   * estado de habilitación DIAN—; el componente sólo pinta el `app-alert-banner`
   * por entrada, en vez de que cada aviso repita su propio marcado.
   */
  readonly documentoNotices = computed<readonly DocumentoSectionNotice[]>(() => {
    const notices: DocumentoSectionNotice[] = [];
    const profileNotice = this.profileResolutionNotice();
    if (profileNotice) notices.push({ variant: 'warning', text: profileNotice });
    const emptyReason = this.resolutionEmptyReason();
    if (emptyReason) notices.push({ variant: 'danger', text: emptyReason });
    const habilitation = this.habilitationWarning();
    if (habilitation) notices.push({ variant: 'danger', text: habilitation });
    const technicalKey = this.technicalKeyWarning();
    if (technicalKey) notices.push({ variant: 'warning', text: technicalKey });
    const notesOverflow = this.notesOverflowWarning();
    if (notesOverflow) notices.push({ variant: 'danger', text: notesOverflow });
    return notices;
  });

  /**
   * Defecto 3 (orquestador, 2026-08-25): `applyProfilePrefill` une las
   * `header_notes` del perfil con `\n` sin medir la unión. Cada nota mide
   * hasta 500 (`CONFIG_LIMITS.header_note`) y puede haber hasta 10
   * (`CONFIG_LIMITS.header_notes_count`) — un perfil perfectamente válido
   * puede producir una unión mucho más larga que el tope real de `notes` en
   * ESTE documento (500, FAD13). Sin este aviso, quien nunca escribió una
   * nota ve un 400 que no puede explicarse.
   *
   * Se avisa, no se recorta: recortar en silencio es exactamente el defecto
   * que este mismo encargo corrigió en `buildNoteText` — perder texto sin que
   * nadie lo note es peor que un formulario inválido que dice por qué.
   */
  readonly notesOverflowWarning = computed<string | null>(() => {
    const notes = String(this.rawValue()['notes'] ?? '');
    const max = CONFIG_LIMITS.header_note;
    if (notes.length <= max) return null;
    return `Las notas de cabecera precargadas de este perfil miden ${notes.length} caracteres; el máximo que admite la factura es ${max} (Anexo Técnico DIAN 1.9, regla FAD13). Recórtalas en el campo Notas antes de emitir, o la DIAN rechaza el documento después de tomar consecutivo.`;
  });

  /** Errores de campo ya resueltos, para el componente compartido. */
  readonly documentoErrors = computed<DocumentoSectionErrors>(() => ({
    resolution: this.fieldError('resolution_id'),
    invoice_type: this.fieldError('invoice_type'),
    issue_date: this.fieldError('issue_date'),
    payment_form: this.fieldError('payment_form'),
    payment_means_code: this.fieldError('payment_means_code'),
    due_date: this.dueDateError(),
    notes: this.fieldError('notes'),
  }));

  /**
   * SECCIÓN LÍNEAS COMPARTIDA (B.3). `aiu_field` apunta a `aiu_component`
   * —así se llama el control en esta pantalla (ADR-2: el nombre que
   * sobrevive es el del DTO de cada destino)—; el editor de perfiles apunta
   * el mismo campo canónico a `bucket`, su propio nombre.
   */
  readonly lineasRowPaths: LineasRowPaths = {
    description: 'description',
    quantity: 'quantity',
    unit_code: 'unit_code',
    unit_price: 'unit_price',
    discount_amount: 'discount_amount',
    aiu_field: 'aiu_component',
    taxes: 'taxes',
  };

  /** Un objeto de errores por línea, en el vocabulario del componente. */
  readonly lineasRowErrors = computed<readonly LineasRowErrors[]>(() =>
    this.itemControls().map((_, i) => ({
      description: this.itemError(i, 'description'),
      quantity: this.itemError(i, 'quantity'),
      unit_code: this.itemError(i, 'unit_code'),
      unit_price: this.itemError(i, 'unit_price'),
      discount_amount: this.itemError(i, 'discount_amount'),
      aiu_field: this.itemError(i, 'aiu_component'),
    })),
  );

  /** El total de línea que se pinta cuando la línea NO lleva AIU. */
  readonly lineasRowSummaries = computed<readonly string[]>(() =>
    this.itemControls().map((_, i) => this.lineSummary(i)),
  );

  /**
   * Envoltorios de `lineCarriesAiu`/`toggleLineAiu` con la firma que espera
   * el componente compartido —`(row, index[, on])`—: esta pantalla identifica
   * la línea por su CONTROL, no por su índice, así que el índice se ignora.
   * Son campos de flecha, no métodos, para que `this` quede fijo sin
   * `.bind()` en la plantilla.
   */
  readonly lineCarriesAiuBound = (row: AbstractControl, _index: number): boolean =>
    this.lineCarriesAiu(row);
  readonly toggleLineAiuBound = (
    row: AbstractControl,
    _index: number,
    on: boolean,
  ): void => this.toggleLineAiu(row, on);

  /**
   * Envoltorio de `formatCurrency` para `vendix-invoice-section-impuestos`
   * (B.4): el método usa `this.currencyService`, así que pasarlo desnudo
   * como referencia perdería el `this` al invocarse dentro del componente
   * compartido. Mismo criterio que los envoltorios de arriba.
   */
  readonly formatCurrencyBound = (value: number): string =>
    this.formatCurrency(value);

  /** Mapa de rutas de «Retenciones» (B.5): la factura sí guarda `base`. */
  readonly retencionesRowPaths: RetencionesRowPaths = {
    concept_id: 'concept_id',
    role: 'role',
    rate: 'rate',
    base: 'base',
  };

  /** «Retenido» por fila, ya calculado — la sección compartida sólo lo pinta. */
  readonly retencionesRowAmounts = computed<readonly number[]>(() =>
    this.withholdingControls().map((_, i) => this.withholdingRowAmount(i)),
  );

  /** Mapa de rutas de «Divisa» (B.6): la factura sí guarda tasa y fecha. */
  readonly divisaSectionPaths: DivisaSectionPaths = {
    declare_foreign: 'use_foreign_currency',
    currency_code: 'foreign_currency',
    exchange_rate: 'exchange_rate',
    exchange_rate_date: 'exchange_rate_date',
  };

  readonly divisaErrors = computed(() => ({
    currency_code: this.fieldError('foreign_currency'),
    exchange_rate: this.fieldError('exchange_rate'),
    exchange_rate_date: this.fieldError('exchange_rate_date'),
    foreign_total_amount: this.fieldError('foreign_total_amount'),
  }));

  // ── Formato de impresión y «Ver como saldrá» (B.7 / E.1 / E.2) ──

  /**
   * Formulario LOCAL del selector de plantilla. NO vive en `invoiceForm` a
   * propósito: `CreateInvoiceDto` no declara `template_id`, y con
   * «forbidNonWhitelisted» activo un campo extra del formulario raíz sería un
   * campo esperando equivocarse y colarse al payload. Un FormGroup propio lo
   * vuelve estructuralmente imposible.
   */
  readonly printFormatForm = this.fb.group({ template_id: [''] });

  /** Rutas del componente compartido: sólo el selector existe en la factura. */
  readonly formatoSectionPaths: FormatoSectionPaths = {
    template_id: 'template_id',
    template_key: null,
    show_aiu_breakdown: null,
    display_decimals: null,
  };

  /**
   * Estado plegable PROPIO de la sección. No entra en `openSections` porque
   * ese registro se deriva del orden canónico (`invoice-section-order.ts`),
   * donde «formato» sigue clasificado como sección de perfil hasta que el
   * espejo la suba formalmente a las dos pantallas.
   */
  readonly formatoSectionOpen = signal(false);

  /** Biblioteca de plantillas de la ORGANIZACIÓN (FB-31). */
  readonly printTemplates = signal<
    { id: number; name: string; is_system: boolean }[]
  >([]);
  readonly printLibraryFailed = signal(false);

  /** Config activa de la TIENDA para el formato fiscal (GET /:formatType). */
  private readonly storeFormatDetail = signal<StorePrintFormatDetail | null>(
    null,
  );
  readonly storeTemplateSaving = signal(false);

  readonly printTemplateOptions = computed(() => [
    { value: '', label: 'Plantilla activa de la tienda' },
    ...this.printTemplates().map((t) => ({
      value: String(t.id),
      label: t.is_system ? `${t.name} (del sistema)` : t.name,
    })),
  ]);

  /** Plantilla que congeló el perfil elegido, si opina sobre el diseño. */
  private readonly profileTemplateId = computed<number | null>(() => {
    const id = this.profileConfig()?.format?.template_id;
    return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
  });

  /**
   * La PRECEDENCIA REAL del gateway al imprimir (`resolveProfileTemplateId`):
   * plantilla congelada por el perfil → plantilla activa de la tienda →
   * defecto del sistema. El selector y su etiqueta se precargan de aquí.
   */
  private readonly effectiveTemplateId = computed<number | null>(
    () =>
      this.profileTemplateId() ??
      this.storeFormatDetail()?.template_id ??
      null,
  );

  readonly effectivePrintLabel = computed<string>(() => {
    const nameFor = (id: number): string => {
      const found = this.printTemplates().find((template) => template.id === id);
      return found ? `«${found.name}»` : `#${id}`;
    };
    const fromProfile = this.profileTemplateId();
    if (fromProfile !== null) {
      const profileName = this.selectedProfile()?.name ?? 'perfil';
      return `la plantilla ${nameFor(fromProfile)}, congelada por el perfil «${profileName}»`;
    }
    const store = this.storeFormatDetail();
    const fromStore = store?.template_id ?? null;
    if (fromStore !== null) {
      return store?.template_name
        ? `«${store.template_name}» (plantilla activa de la tienda)`
        : `la plantilla ${nameFor(fromStore)} (activa de la tienda)`;
    }
    return 'el defecto del sistema';
  });

  readonly formatoSummary = computed(() => this.effectivePrintLabel());

  /**
   * Precarga del selector. Corre como efecto para que cambiar el perfil (o la
   * config de tienda) reprecargue el valor; se detiene ante lo escrito a mano
   * (`dirty`), igual que la semilla del resto del formulario.
   */
  private readonly syncPrintTemplateControl = effect(() => {
    const id = this.effectiveTemplateId();
    const control = this.printFormatForm.get('template_id');
    if (!control || control.dirty) return;
    control.setValue(id == null ? '' : String(id), { emitEvent: false });
  });

  // ── «Ver como saldrá» antes de emitir (E.2) ─────────────────

  readonly printPreviewOpen = signal(false);
  readonly printPreviewLoading = signal(false);
  readonly printPreviewHtml = signal('');
  readonly printPreviewWidthMm = signal(0);
  readonly printPreviewIsRoll = signal(false);
  readonly printPreviewError = signal('');
  /** Resultado del preview con cuerpo, en lugar del HTML del formato. */
  readonly printPreviewResult = signal<ProfilePreviewResult | null>(null);
  /** `profile_id` con el que se pidió el preview (o `null` si modo manual). */
  readonly printPreviewProfileId = signal<number | null>(null);

  /**
   * Marcador que ve el iframe mientras llega el HTML. Vive como campo y no en
   * el binding: los literales de plantilla no admiten escapar la comilla que
   * abriría otro string dentro de la expresión.
   */
  private readonly printPreviewPlaceholder =
    '<div style="font-family:sans-serif;padding:24px;color:#888;text-align:center;">Generando vista previa…</div>';

  readonly printPreviewSrcdoc = computed(
    () => this.printPreviewHtml() || this.printPreviewPlaceholder,
  );

  /** Ancho del papel renderizado: rollo a escala real, hoja fija. */
  readonly printPreviewPaperWidth = computed(() => {
    if (this.printPreviewIsRoll()) {
      const mm = this.printPreviewWidthMm();
      return `${Math.max(mm * 3.78, 300)}px`;
    }
    return '600px';
  });

  /**
   * LO QUE ESTE DOCUMENTO NO PUEDE LLEVAR — medido, no supuesto.
   *
   * `CreateInvoiceDto` declara del AIU exactamente dos cosas:
   * `aiu_contract_object` y el `aiu_component` de cada línea. No declara
   * `taxable_basis`, ni el piso, ni la matriz; y `main.ts` corre con
   * `forbidNonWhitelisted: true`, así que mandar una clave que el DTO no declara
   * devuelve 400 antes de tocar nada. El backend deriva `aiu_regime`,
   * `aiu_minimum_percent` y `aiu_taxable_matrix` del `aiu_context` —la versión
   * congelada del perfil, o los ajustes de la tienda— en `invoicing.service.ts`.
   *
   * Por eso estos tres se pintan y se congelan en vez de aceptar un valor: un
   * control que acepta lo que el servidor ignora es el fallo mudo de este
   * módulo. Los demás campos de la sección SÍ gobiernan lo que se emite, porque
   * gobiernan las LÍNEAS (ver `applyAiuBase`).
   */
  readonly aiuFrozenFields: readonly AiuDepartureField[] = [
    'taxable_basis',
    'enforce_minimum_base',
    'minimum_base_percent',
  ];

  readonly aiuFrozenReason = computed<string>(() => {
    const profile = this.selectedProfile();
    return profile
      ? `Este documento no puede apartarse de la base gravable ni del piso: el servidor los toma de la versión ${profile.current_version} del perfil «${profile.name}». Cambiarlos exige una versión nueva del perfil, que rige para todas las facturas siguientes.`
      : 'Este documento no puede apartarse de la base gravable ni del piso: el servidor los toma de los ajustes AIU de la tienda.';
  });

  /**
   * Errores que la sección AIU tiene que pintar por campo.
   *
   * El validador del contrato de perfiles no corre acá —una factura no se
   * guarda como perfil—, pero el RECHAZO DEL BACKEND sí llega por campo, y el
   * del objeto del contrato se pintaba en el textarea que la sección ahora
   * aloja. Sin este puente, un 422 sobre `aiu_contract_object` dejaría de
   * verse: se traduce al nombre canónico que la sección conoce.
   */
  readonly aiuSectionIssues = computed<readonly ProfileConfigIssue[]>(() => {
    const message = this.fieldError('aiu_contract_object');
    return message
      ? [
          {
            field: 'aiu.contract_object',
            code: 'INVOICING_AIU_CONTRACT_OBJECT',
            message,
          },
        ]
      : [];
  });

  /**
   * ¿La sección AIU ya se sembró del perfil vigente?
   *
   * Sin esta marca, entre elegir un perfil y recibir su configuración el grupo
   * `aiu` sigue en blanco y la comparación con el perfil delataría un
   * «apartado» que nadie hizo — un banner de advertencia que aparece y
   * desaparece solo es lo que entrena a ignorar los banners.
   */
  private readonly aiuSeeded = signal(false);

  /** El grupo `aiu` del documento, como valor plano y reactivo. */
  private readonly aiuDraft = computed<Record<string, unknown>>(
    () => (this.rawValue()['aiu'] ?? {}) as Record<string, unknown>,
  );

  /** La matriz del documento, como filas planas para la lógica compartida. */
  private readonly aiuDraftRules = computed<AiuTaxRuleValue[]>(() =>
    ((this.rawValue()['aiu_taxes'] ?? []) as Array<Record<string, unknown>>).map(
      (row) => ({
        bucket: String(row['bucket'] ?? '') as AiuBucket,
        taxable: Boolean(row['taxable']),
        tax_code: String(row['tax_code'] ?? ''),
        rate: String(row['rate'] ?? '0.00'),
      }),
    ),
  );

  /**
   * En qué se apartó este documento del perfil que lo precargó.
   *
   * ADR-3 lo exige en pantalla: sin esto el operador cree que emitió con la
   * configuración configurada. Se compara EN CENTÉSIMAS y no como cadena —
   * `'19'` y `'19.00'` son el mismo porcentaje y señalarlos como diferencia
   * entrenaría a ignorar el aviso.
   *
   * El objeto del contrato vacío NO es apartarse: vacío significa «hereda», y
   * es su comportamiento documentado.
   */
  readonly aiuDepartures = computed<readonly AiuDepartureField[]>(() => {
    if (!this.isAiu()) return [];
    const config = this.profileConfig();
    const profileAiu = config?.aiu ?? null;
    if (!config || !profileAiu) return [];

    if (!this.aiuSeeded()) return [];

    const raw = this.rawValue();
    const draft = this.aiuDraft();
    const out: AiuDepartureField[] = [];

    const object = String(raw['aiu_contract_object'] ?? '').trim();
    if (
      object.length > 0 &&
      object !== String(profileAiu.contract_object ?? '').trim()
    ) {
      out.push('contract_object');
    }

    if (
      asAiuComponentsBasis(draft['components_basis']) !==
      resolveAiuComponentsBasis(profileAiu)
    ) {
      out.push('components_basis');
    }

    for (const component of AIU_COMPONENTS) {
      if (
        parsePercentScaled(String(draft[component] ?? '').trim()) !==
        parsePercentScaled(profileAiu.components[component])
      ) {
        out.push('components');
        break;
      }
    }

    const accounts = config.accounting.revenue_account_by_bucket ?? {};
    const same = (left: unknown, right: unknown): boolean =>
      String(left ?? '').trim() === String(right ?? '').trim();
    if (
      !same(draft['revenue_administracion'], accounts.administracion) ||
      !same(draft['revenue_imprevistos'], accounts.imprevistos) ||
      !same(draft['revenue_utilidad'], accounts.utilidad) ||
      !same(raw['default_account_code'], accounts.costo) ||
      !same(draft['vat_payable_account'], config.accounting.vat_payable_account)
    ) {
      out.push('accounts');
    }

    const profileRules = config.taxes?.rules ?? [];
    const draftRules = this.aiuDraftRules();
    const key = (rule: AiuTaxRuleValue): string =>
      rule.bucket +
      '|' +
      String(rule.taxable) +
      '|' +
      rule.tax_code +
      '|' +
      String(parsePercentScaled(rule.rate) ?? 0);
    // La fila del costo reembolsable NO se compara: es DERIVADA de la base por
    // `reprojectAiuTaxRules`, y un perfil viejo puede traerla con otra tarifa
    // sin que nadie la haya elegido. Compararla anunciaría un apartado en cuanto
    // la siembra la reproyecta, que es lo contrario de lo que el aviso significa.
    const own = (rules: readonly AiuTaxRuleValue[]): string =>
      rules
        .filter((rule) => rule.bucket !== 'costo')
        .map(key)
        .sort()
        .join(';');
    if (own(profileRules) !== own(draftRules)) out.push('taxes');

    return out;
  });

  /**
   * Siembra la sección AIU del documento con lo que trae el perfil.
   *
   * Escribe con `emitEvent` por omisión: en Zoneless la sección se redibuja por
   * `valueChanges`, y un `emitEvent: false` dejaría los porcentajes sembrados en
   * el modelo y en blanco en pantalla. Y NO marca nada como `dirty`: un control
   * que nace sucio haría que la siguiente precarga lo respetara como si el
   * operador lo hubiera escrito.
   */
  private seedAiuFromProfile(
    config: InvoiceProfileConfig,
    forced: boolean,
  ): void {
    const aiu = config.aiu;
    if (!aiu) return;
    const group = this.aiuGroup;

    const put = (name: string, value: unknown): void => {
      const control = group.get(name);
      if (!control) return;
      // Lo escrito a mano manda, salvo aplicación completa CONFIRMADA: el
      // usuario acabó de leer en el modal que se reemplaza y dijo que sí.
      if (control.dirty && !forced) return;
      control.setValue(value ?? '');
    };

    put('components_basis', resolveAiuComponentsBasis(aiu));
    // D.7 — el radio de modelo nace con lo que el perfil congeló, no siempre
    // en «sumada»: `resolveAccountingModel` es el único punto de lectura y
    // devuelve `'sumada'` cuando el perfil no opina (perfiles anteriores al
    // campo), así que ningún snapshot viejo cambia de comportamiento al leerse.
    put('accounting_model', resolveAccountingModel(aiu));
    for (const component of AIU_COMPONENTS) {
      put(component, aiu.components?.[component] ?? '');
    }

    const accounts = config.accounting.revenue_account_by_bucket ?? {};
    put('revenue_administracion', accounts.administracion ?? '');
    put('revenue_imprevistos', accounts.imprevistos ?? '');
    put('revenue_utilidad', accounts.utilidad ?? '');
    put('vat_payable_account', config.accounting.vat_payable_account ?? '');
    this.aiuSeeded.set(true);

    // LA MATRIZ. Sólo si está vacía —o si la aplicación completa lo autoriza—:
    // una fila editada a mano es una decisión sobre este documento, y
    // reemplazarla cambiaría un impuesto sin que nadie lo pidiera.
    if (this.aiuTaxesArray.length > 0 && !forced) return;
    this.aiuTaxesArray.clear();
    // Se reproyecta sobre la base del DOCUMENTO al sembrarla: un perfil viejo
    // puede traer una matriz que su propia base ya no admite, y sembrarla tal
    // cual pintaría una contradicción que el operador no causó.
    const basis = asAiuTaxableBasis(
      this.aiuGroup.get('taxable_basis')?.value,
    );
    for (const rule of reprojectAiuTaxRules(config.taxes?.rules ?? [], basis)) {
      this.aiuTaxesArray.push(
        this.fb.group({
          bucket: [rule.bucket ?? 'administracion'],
          taxable: [rule.taxable],
          tax_code: [rule.tax_code],
          rate: [rule.rate],
          taxable_basis: [rule.taxable_basis ?? basis],
        }),
      );
    }
  }

  /**
   * Las CUATRO configuraciones AIU del perfil, ya convertidas en las líneas que
   * van a escribirse — o la razón por la que hoy no se pueden aplicar.
   *
   * ## Qué aplica de cada bloque del editor
   *
   * · Bloque 1 «Modelo de contabilización» — hoy sólo existe el modelo 2 (base
   *   AIU sumada al total), y es el que estas líneas producen: son líneas del
   *   documento, así que suman. El modelo 1 no se puede aplicar todavía y el
   *   editor lo dice donde se elige, no acá.
   * · Bloque 2 «Cuentas para contabilización AIU» — `account_code` de cada
   *   línea generada.
   * · Bloque 3 «Base AIU» — los importes: es el bloque que da los porcentajes.
   * · Bloque 4 «Base impuestos» — los impuestos de cada línea generada, sólo
   *   las reglas gravables del componente y sólo tributos de documento
   *   (IVA/INC/ICA). Las retenciones se capturan en su propia sección: viajan
   *   en `withholdings` y no en la línea, y necesitan un `concept_id` del
   *   catálogo que una regla del perfil no trae.
   *
   * ## Por qué el valor del contrato no se pide
   *
   * Se deduce. Con la unidad `'contract'` los porcentajes se miden sobre el
   * valor del contrato, y lo que falte hasta el 100 % es costo reembolsable —o
   * sea, exactamente las líneas que el operador ya capturó SIN componente. Así
   * que el contrato es `costo / (1 − Σ%)` y el AIU es la diferencia. Pedir el
   * valor del contrato aparte abriría la puerta a que no cuadre con las líneas.
   *
   * `null` cuando no hay nada que aplicar (documento no AIU, o sin perfil):
   * el perfil es lo único que trae los porcentajes, y los ajustes de la tienda
   * no los tienen.
   */
  readonly aiuApplyPlan = computed<{
    ready: boolean;
    blocked: string | null;
    basis: AiuComponentsBasis;
    aiuPercentLabel: string;
    costBase: number;
    aiuAmount: number;
    contractAmount: number;
    replaces: number;
    parts: Array<{
      bucket: AiuComponentLiteral;
      label: string;
      percentLabel: string;
      amount: number;
      account: string;
      taxes: TaxSelection[];
    }>;
  } | null>(() => {
    if (!this.isAiu()) return null;

    // YA NO EXIGE PERFIL. Antes el plan devolvía `null` sin perfil elegido,
    // porque el perfil era lo único que traía los porcentajes. Ahora los trae el
    // documento, y mantener la exigencia dejaría una sección AIU entera —
    // reparto, cuentas y matriz, todo editable— sin un solo botón que la
    // aplique: una superficie muda, que es peor que no tenerla. Sin perfil los
    // tres porcentajes nacen vacíos y el plan dice exactamente qué falta.
    //
    // LOS VALORES SON LOS DEL DOCUMENTO, no los del snapshot del perfil.
    //
    // Es lo que convierte la sección AIU de esta pantalla en algo más que un
    // formulario decorativo: los porcentajes, la unidad, las cuentas y la
    // matriz que el operador tiene delante son los que escriben las líneas, y
    // las líneas son lo que viaja al backend. Leer el perfil acá haría que
    // corregir un reparto en la factura no cambiara ni un peso de lo emitido —
    // exactamente el fallo que la sección editable existe para cerrar.
    //
    // El perfil sigue siendo requisito para que el plan EXISTA: es lo único que
    // pudo sembrar un reparto acordado. Sin perfil los tres porcentajes nacen
    // vacíos y el plan lo dice, en vez de inventar un 5/2/3.
    const draft = this.aiuDraft();
    const basis = asAiuComponentsBasis(draft['components_basis']);
    const scaled = new Map<AiuComponentLiteral, number>();
    for (const component of AIU_COMPONENTS) {
      // Vacío NO es inválido: es «esta porción no lleva nada», y se cuenta como
      // cero. `parsePercentScaled` devuelve `null` para los dos casos, y
      // confundirlos diría «los porcentajes no son válidos» en un documento sin
      // reparto configurado, que es el estado normal antes de elegir perfil.
      const text = String(draft[component] ?? '').trim();
      const value = text === '' ? 0 : parsePercentScaled(text);
      if (value === null) {
        return this.blockedAiuPlan(
          basis,
          'Los porcentajes de la sección AIU no son válidos: se escriben con hasta dos decimales y punto (por ejemplo 5.00). Corrígelos arriba, en Base AIU.',
        );
      }
      scaled.set(component, value);
    }
    const sum = [...scaled.values()].reduce((total, value) => total + value, 0);

    if (basis !== 'contract') {
      return this.blockedAiuPlan(
        basis,
        'Los porcentajes están medidos sobre el AIU, no sobre el valor del contrato, así que no determinan cuánto AIU lleva este documento. Cambia la unidad arriba, en Base AIU, o captura las líneas de administración, imprevistos y utilidad a mano.',
      );
    }
    if (sum <= 0 || sum >= 10000) {
      return this.blockedAiuPlan(
        basis,
        sum <= 0
          ? 'No hay ningún porcentaje de AIU configurado. Escríbelos arriba, en Base AIU.'
          : 'El reparto declara un AIU del 100 % del contrato: no queda costo reembolsable del que deducirlo, así que las líneas hay que capturarlas a mano.',
      );
    }

    // Base = lo capturado SIN componente, o sea el costo reembolsable. Se lee
    // de `lineMath` y no de cantidad × precio para restar el descuento igual
    // que lo resta el cálculo del documento.
    const items = this.itemsValue();
    const math = this.lineMath();
    let costCents = 0;
    let replaces = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i]?.aiu_component) {
        replaces += 1;
        continue;
      }
      costCents += Math.round((math[i]?.base ?? 0) * 100);
    }

    if (costCents <= 0) {
      return this.blockedAiuPlan(
        basis,
        'Captura primero las líneas de costo del contrato (las que NO llevan la marca AIU): el AIU se deduce de ellas.',
      );
    }

    // AIU = costo × Σ% / (100 % − Σ%). Todo en centavos y con una sola
    // división, para que el contrato sea EXACTAMENTE costo + AIU y no quede un
    // centavo suelto entre la cabecera y las líneas — que es un rechazo FAU06.
    const aiuCents = Math.round((costCents * sum) / (10000 - sum));
    // Las cuentas y los tributos, también del DOCUMENTO. Ver arriba.
    const accounts: Readonly<Record<AiuComponentLiteral, string>> = {
      administracion: String(draft['revenue_administracion'] ?? ''),
      imprevistos: String(draft['revenue_imprevistos'] ?? ''),
      utilidad: String(draft['revenue_utilidad'] ?? ''),
    };
    const draftRules = this.aiuDraftRules();

    let assigned = 0;
    const parts = AIU_COMPONENTS.map((bucket) => {
      const percent = scaled.get(bucket) ?? 0;
      const cents = Math.floor((aiuCents * percent) / sum);
      assigned += cents;
      return {
        bucket,
        label: this.aiuComponentLabel(bucket),
        percentLabel: formatPercentScaled(percent),
        amount: cents / 100,
        account: accounts[bucket] ?? '',
        taxes: this.aiuTaxesForBucket(draftRules, bucket),
      };
    });

    // El residuo del truncamiento —a lo sumo dos centavos— va a la UTILIDAD,
    // que es la única porción gravable bajo las TRES bases (`'aiu'`,
    // `'utilidad'` y `'subtotal'`). El razonamiento sigue en pie con la tercera
    // y de hecho se estrecha: bajo `'aiu'` y bajo `'subtotal'` la base ya
    // contiene el AIU completo —y con `'subtotal'` también el costo—, así que
    // repartir el centavo entre componentes NO mueve la base ni un peso; el
    // destino sólo importa bajo `'utilidad'`, donde la base es ese único
    // componente. Y ahí sumarlo declara un centavo MÁS de base, que es el lado
    // recuperable del error; restarlo del componente gravable declararía de
    // menos ante la DIAN.
    const residual = aiuCents - assigned;
    if (residual !== 0) {
      const utilidad = parts.find((part) => part.bucket === 'utilidad');
      if (utilidad) utilidad.amount += residual / 100;
    }

    return {
      ready: true,
      blocked: null,
      basis,
      aiuPercentLabel: formatPercentScaled(sum),
      costBase: costCents / 100,
      aiuAmount: aiuCents / 100,
      contractAmount: (costCents + aiuCents) / 100,
      replaces,
      parts: parts.filter((part) => part.amount > 0),
    };
  });

  private blockedAiuPlan(
    basis: AiuComponentsBasis,
    blocked: string,
  ): {
    ready: false;
    blocked: string;
    basis: AiuComponentsBasis;
    aiuPercentLabel: string;
    costBase: number;
    aiuAmount: number;
    contractAmount: number;
    replaces: number;
    parts: [];
  } {
    return {
      ready: false,
      blocked,
      basis,
      aiuPercentLabel: '0.00',
      costBase: 0,
      aiuAmount: 0,
      contractAmount: 0,
      replaces: 0,
      parts: [],
    };
  }

  private aiuComponentLabel(bucket: AiuComponentLiteral): string {
    const found = AIU_COMPONENT_OPTIONS.find(
      (option) => String(option.value) === bucket,
    );
    return found ? found.label : bucket;
  }

  /**
   * Las reglas GRAVABLES del bloque 4 para una cubeta, traducidas a los
   * impuestos que la línea lleva.
   *
   * Se resuelven contra el catálogo real de la tienda (`availableTaxes`) y no
   * se fabrican: `TaxSelection.tax_rate_id` es un id de `tax_rates`, y un id
   * inventado se envía y el backend lo rechaza nombrando un impuesto que el
   * operador nunca eligió. Si la tarifa configurada no existe en el catálogo,
   * la línea sale sin ese impuesto y el aviso de
   * `aiuTaxableWithoutTax` —que ya existe— lo señala.
   *
   * Sólo tributos de DOCUMENTO. Una regla de retención (`06`/`07`/`05`) no es
   * un impuesto de línea: no suma al total y se captura en su propia sección.
   */
  private aiuTaxesForBucket(
    rules: readonly AiuTaxRuleValue[],
    bucket: AiuComponentLiteral,
  ): TaxSelection[] {
    const catalog = this.availableTaxes();
    const selections: TaxSelection[] = [];
    for (const rule of rules) {
      if (rule.bucket !== bucket || !rule.taxable) continue;
      const taxType = AIU_DOCUMENT_TAX_TYPE_BY_CODE[rule.tax_code];
      if (!taxType) continue;
      const rate = parsePercentScaled(rule.rate);
      if (rate === null) continue;
      const option = catalog.find(
        (candidate) =>
          (candidate.tax_type ?? '').toLowerCase() === taxType &&
          Math.round(candidate.rate * 100) === rate,
      );
      if (!option) continue;
      selections.push({
        tax_rate_id: option.id,
        rate: option.rate,
        name: option.name,
        tax_type: option.tax_type,
        is_inclusive: option.default_is_inclusive ?? false,
      });
    }
    return selections;
  }

  /**
   * Escribe las líneas del AIU con lo que las cuatro configuraciones del perfil
   * dicen. Acción explícita del usuario.
   *
   * REEMPLAZA las líneas que ya llevan componente y NO TOCA las de costo. Por
   * eso es idempotente —pulsarlo dos veces da el mismo documento— y por eso no
   * puede destruir lo capturado a mano: el costo es lo que el operador escribió,
   * y el AIU es lo que se deduce de él.
   */
  applyAiuBase(): void {
    const plan = this.aiuApplyPlan();
    if (!plan || !plan.ready) return;

    // Primero fuera las viejas, de atrás hacia adelante: quitar por índice
    // ascendente desplaza los que faltan y borra la línea equivocada.
    for (let i = this.itemsArray.length - 1; i >= 0; i--) {
      const component = String(
        this.itemsArray.at(i).get('aiu_component')?.value ?? '',
      ).trim();
      if (component.length > 0) this.itemsArray.removeAt(i);
    }

    for (const part of plan.parts) {
      const group = this.appendItem();
      if (!group) break;
      group.patchValue({
        description:
          part.label + ' — ' + part.percentLabel + ' % del valor del contrato',
        quantity: 1,
        unit_code: UNIT_CODE_DEFAULT,
        unit_price: part.amount,
        discount_amount: 0,
        aiu_component: part.bucket,
        account_code: part.account,
        taxes: part.taxes,
      });
      group.markAsDirty();
    }

    this.itemsArray.updateValueAndValidity();
    this.itemsArray.markAsDirty();
    this.toastService.success(
      'Base AIU aplicada: ' +
        plan.parts.length +
        ' línea(s) por ' +
        this.formatCurrency(plan.aiuAmount) +
        '.',
    );
  }

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

    if (settings.taxable_basis === 'utilidad') {
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

    // TERCERA RAMA — no había ninguna, y su ausencia era el defecto: un perfil
    // con `taxable_basis: 'subtotal'` caía en el `return` de abajo y se le
    // instruía «AIU completo, piso del 10 %» mientras el servidor gravaba el
    // contrato ENTERO sin piso. La instrucción no sólo era distinta: pedía
    // dejar SIN impuesto la línea de costo reembolsable, que bajo esta base es
    // justo la que grava.
    if (settings.taxable_basis === 'subtotal') {
      return {
        regimeLabel: 'Sin tratamiento AIU',
        regimeCitation: 'el IVA grava el valor total del contrato',
        taxableLabel: 'Contrato completo',
        instruction:
          'Declara el impuesto sobre TODAS las líneas, incluida la de costo reembolsable: este perfil declinó el desglose AIU y la base gravable es el valor total del contrato. Dejar el costo sin impuesto contradice la base declarada y la emisión se rechaza (INVOICING_AIU_004).',
        // No hay piso: el piso del art. 462-1 protege una base que es una
        // FRACCIÓN del contrato. Acá la base ya es el contrato entero, así que
        // no hay nada por debajo de lo cual pueda quedar.
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

    // Qué buckets gravan lo dice `AIU_TAXABLE_BUCKETS_BY_BASIS`, la MISMA tabla
    // que consulta `isAiuTaxable` en el backend. Se lee de ahí en vez de
    // reescribir el ternario: el ternario anterior sólo conocía dos regímenes,
    // así que bajo `'subtotal'` —donde gravan los cuatro buckets— caía en la
    // rama del Decreto y avisaba únicamente por la utilidad, callando el IVA
    // faltante de administración e imprevistos.
    const taxableBuckets = AIU_TAXABLE_BUCKETS_BY_BASIS[settings.taxable_basis];
    const isTaxable = (component: string): boolean =>
      taxableBuckets.includes(component as AiuComponentLiteral);

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

  /**
   * Resumen de la sección de perfil, legible con la sección plegada.
   *
   * Dice el nombre del perfil aplicado, o que no hay perfiles de este tipo. Lo
   * segundo importa tanto como lo primero: plegada, la sección sería un título
   * mudo y nadie la abriría para descubrir que está vacía.
   */
  readonly profileSummary = computed<string>(() => {
    if (!this.hasProfiles()) {
      return 'Sin perfiles para ' + this.operationTypeLabel();
    }
    const applied = this.selectedProfile();
    return applied ? applied.name : 'Ninguno elegido';
  });

  /**
   * Etiqueta del tipo de operación tal como la ve el comerciante.
   *
   * Sale del MISMO catálogo que alimenta el selector, no de un mapa paralelo:
   * dos listas de los mismos cuatro códigos acabarían diciendo cosas distintas
   * del mismo documento.
   */
  readonly operationTypeLabel = computed<string>(() => {
    const code = String(this.rawValue()['operation_type'] ?? '');
    return (
      this.operationTypeOptions.find((option) => option.value === code)
        ?.label ?? code
    );
  });

  /** Ayuda de la sección de perfil. Constante: no depende del documento. */
  readonly profileSectionHelp =
    'Un perfil de facturación es la preconfiguración de todo lo que se repite entre facturas del mismo tipo de operación.\n\n' +
    'Elegirlo aquí rellena la resolución, los códigos de pago, las notas de cabecera, las líneas modelo y —en un documento AIU— la base gravable y sus cuentas. Todo queda editable después: el perfil es el punto de partida, no un candado.\n\n' +
    'Sólo se listan los perfiles del tipo de operación de esta factura. Un perfil de otro tipo lo rechaza el servidor, así que ofrecerlo sería ofrecer un error tras llenar el documento.';

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
    if (amount > 0) return this.formatCurrency(amount);

    // Con filas pero sin importe, decir «Sin retenciones» es FALSO y además
    // engaña en el caso que más importa: el perfil acaba de precargar el
    // concepto y la tarifa, y la base se calcula al emitir, así que el importe
    // es 0 hasta que haya líneas. El resumen que se lee con la sección plegada
    // decía que no había nada mientras dentro había un concepto configurado.
    const rows = this.withholdingsValue().length;
    if (rows === 0) return 'Sin retenciones';
    return rows === 1
      ? '1 concepto · base pendiente'
      : rows + ' conceptos · base pendiente';
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

    // Se deriva de SECTION_FIELDS en vez de escribirse a mano: una sección
    // nueva ahí aparece aquí sola. Escribirlas dos veces es lo que hace que
    // una sección quede sin contador y su badge no se pinte nunca.
    const counts = Object.fromEntries(
      (Object.keys(SECTION_FIELDS) as SectionId[]).map((section) => [section, 0]),
    ) as Record<SectionId, number>;

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
    // Una línea sin componente NO es un error: es el costo reembolsable. Lo que
    // sí lo es —y por eso lo cuenta— es que NINGUNA línea sea del AIU: un
    // documento 09 sin administración, imprevistos ni utilidad no declara AIU
    // alguno.
    if (this.isAiu() && this.aiuWithoutAnyComponent()) {
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
      id: 'preview',
      label: 'Ver como saldrá',
      variant: 'outline',
      icon: 'eye',
      title:
        'Previsualización del formato de impresión: no emite ni toma consecutivo.',
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

    // LA BASE GRAVABLE Y EL PISO SE SIEMBRAN DE LO QUE MANDA, y llegan
    // congelados (ver `aiuFrozenFields`). Sin esto los controles mostrarían la
    // base más amplia por omisión sobre una tienda del Decreto 1372/1992, que
    // grava sólo la utilidad: la pantalla instruiría declarar de más y el
    // operador seguiría la instrucción.
    //
    // Se escribe con `emitEvent` por omisión: en Zoneless la sección se
    // redibuja por `valueChanges`, y silenciarlo dejaría el valor sembrado en el
    // modelo y la base anterior en pantalla. No hay ciclo posible porque
    // `effectiveAiu()` no lee el formulario.
    effect(() => {
      const inherited = this.effectiveAiu();
      if (!inherited) return;
      const percent = Number(inherited.minimum_base_percent);
      this.aiuGroup.patchValue({
        taxable_basis: inherited.taxable_basis,
        enforce_minimum_base: inherited.enforce_minimum_base === true,
        minimum_base_percent: Number.isFinite(percent)
          ? formatPercentScaled(Math.round(percent * 100))
          : formatPercentScaled(AIU_LEGAL_FLOOR_PERCENT_SCALED),
      });
    });

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

  get aiuGroup(): FormGroup {
    return this.invoiceForm.get('aiu') as FormGroup;
  }

  get aiuTaxesArray(): FormArray {
    return this.invoiceForm.get('aiu_taxes') as FormArray;
  }

  // ── Ciclo de vida de la página ──────────────────────────────

  ngOnInit(): void {
    // E.1 — biblioteca de la organización y config activa de la tienda para
    // la sección Formato. Lecturas de otro dominio, pedidas una sola vez.
    this.loadPrintFormats();

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
    // Autoselección: no pregunta nada porque llega sobre un formulario virgen,
    // donde la precarga conservadora ya equivale a la aplicación completa. Pero
    // sí queda registrado, o un «cancelar» posterior devolvería el selector a
    // «sin perfil» en vez de al predeterminado que estaba puesto.
    this.appliedProfileId = id;
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
    // La siembra del perfil ANTERIOR deja de valer en cuanto se cambia de
    // perfil: sin esto, la sección AIU compararía lo sembrado del perfil viejo
    // contra el nuevo y anunciaría un apartado que el operador no hizo.
    this.aiuSeeded.set(false);

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
          const config = response?.data?.current_config ?? null;
          this.profileAiu.set(config?.aiu ?? null);
          this.profileConfig.set(config);
          this.profileConfigLoading.set(false);
          if (config) this.applyProfilePrefill(config);
        },
        error: () => {
          if (request !== this.profileConfigRequest) return;
          this.profileAiu.set(null);
          this.profileConfig.set(null);
          this.profileConfigLoading.set(false);
          this.profileConfigFailed.set(true);
        },
      });
  }

  /**
   * PRECARGA. Escribe en el formulario lo que el perfil trae preconfigurado.
   *
   * ─── LA REGLA QUE GOBIERNA TODO ESTO ─────────────────────────────────────
   *
   * **Nunca se pisa lo que el usuario escribió.** La condición es `pristine`:
   * un control que el usuario tocó está `dirty`, y ese se deja intacto. Los que
   * siguen vírgenes se rellenan. Así la precarga es útil la primera vez y no
   * destructiva la segunda — y cambiar de perfil después de haber corregido un
   * campo a mano no borra la corrección.
   *
   * `setValue` programático NO marca `dirty`, así que lo que precargó el perfil
   * anterior sí se reemplaza al elegir otro. Es lo correcto: eso no lo escribió
   * el usuario.
   *
   * ─── POR QUÉ TODO LO PRECARGADO QUEDA VISIBLE Y EDITABLE ─────────────────
   *
   * Cada campo escrito se registra en `prefilledFields` y la plantilla lo marca.
   * Un preset que inyecta un valor que el usuario nunca ve y termina emitido a
   * la DIAN es el peor resultado posible de esta función. Precargar es proponer,
   * no decidir.
   *
   * ─── QUÉ NO PRECARGA, Y POR QUÉ ──────────────────────────────────────────
   *
   *  - **Adquiriente** — es del documento. Un cliente precargado es la clase de
   *    error que se descubre cuando la factura ya tiene CUFE.
   *  - **Fechas** — hoy, siempre. Una fecha de emisión guardada es un rechazo.
   *
   * ─── LA RESOLUCIÓN SÍ SE PRECARGA, PERO NO SE OBEDECE ────────────────────
   *
   * `dian.resolution_id` es una PREFERENCIA del perfil, no un dato que esta
   * pantalla acate. Se honra únicamente si ese id está entre las que pueden
   * numerar HOY —vigente, activa, con consecutivo y de producción—; si no, se
   * cae al criterio automático y `profileResolutionNotice()` dice por qué. Un
   * perfil se configura una vez y se usa durante meses: la numeración
   * autorizada que hoy sirve puede estar vencida cuando alguien lo use, y
   * preseleccionarla a ciegas emitiría con un rango que la DIAN ya no reconoce.
   *
   * Por eso tampoco se escribe con `put()`: el control de resolución lo gobierna
   * `preselectEligibleResolution`, y dos escritores sobre el mismo control se
   * pisarían en un orden que depende de cuál efecto corra primero.
   *
   * ─── EL MAPEO DE LOS DOS CÓDIGOS DE PAGO ─────────────────────────────────
   *
   * `dian.payment_method_code` → `payment_form` (FormasPago: 1 contado / 2
   * crédito) y `dian.payment_means_code` → `payment_means_code` (medio). Ningún
   * otro consumidor lee esos dos campos del perfil —se comprobó con `grep` sobre
   * los dos `src`—, así que esta precarga es lo que define su significado. Queda
   * escrito aquí para que nadie lo invierta después: invertirlos mandaría «2» a
   * un campo que sólo admite códigos de medio y el documento saldría a crédito
   * cuando es de contado.
   */
  private applyProfilePrefill(config: InvoiceProfileConfig): void {
    // Se CONSUME al leerlo: el permiso de sobrescribir vale para esta precarga y
    // no para la siguiente. Un reintento tras un fallo de red, o el catálogo que
    // llega tarde y vuelve a disparar la lectura, no heredan la autorización.
    const forced = this.forceProfileSeed;
    this.forceProfileSeed = false;

    const filled = new Set<string>();

    /** Escribe sólo si el usuario no tocó ese control. */
    const put = (path: string, value: unknown): void => {
      const control = this.invoiceForm.get(path);
      if (!control || control.dirty) return;
      const text = typeof value === 'string' ? value.trim() : value;
      if (text === null || text === undefined || text === '') return;
      control.setValue(text);
      filled.add(path);
    };

    // El TIPO primero: decide qué secciones se ven, así que escribirlo después
    // de sembrar retenciones dejaría visible un instante una sección que el
    // documento no aplica.
    put('invoice_type', config.dian.document_type);
    put('payment_form', config.dian.payment_method_code);
    put('payment_means_code', config.dian.payment_means_code);

    // Divisa: sólo si el perfil DECLARA la conversión y dice a cuál. El código
    // sin la bandera es una divisa guardada con la sección apagada, y encender
    // la conversión por él declararía un cambio que nadie pidió.
    const currencyCode = String(config.currency?.code ?? '').trim();
    if (config.currency?.declare_foreign === true && currencyCode) {
      put('use_foreign_currency', true);
      put('foreign_currency', currencyCode);
    } else if (forced) {
      // APLICACIÓN COMPLETA: el perfil NO declara conversión, así que el
      // documento tampoco. Dejarla encendida heredada del perfil anterior
      // declararía un «cac:PaymentAlternativeExchangeRate» que este perfil
      // nunca pidió, y con la tasa de la divisa vieja. La tasa se limpia con
      // la bandera: sin conversión declarada no significa nada, y guardada
      // volvería a aparecer si alguien reactiva el bloque a mano.
      this.invoiceForm.get('use_foreign_currency')?.setValue(false);
      this.invoiceForm.get('foreign_currency')?.setValue('');
      this.invoiceForm.get('exchange_rate')?.setValue(null);
      this.invoiceForm.get('exchange_rate_date')?.setValue('');
    }

    const notes = (config.dian.header_notes ?? [])
      .map((note) => String(note ?? '').trim())
      .filter((note) => note.length > 0);
    if (notes.length > 0) put('notes', notes.join('\n'));

    if (config.aiu) put('aiu_contract_object', config.aiu.contract_object);

    // Cuenta contable por omisión: se toma la del COSTO reembolsable, que es la
    // que aplica a una línea sin componente AIU. Las de A/I/U no caben en este
    // campo único —se derraman por línea al sembrar las líneas modelo—.
    put(
      'default_account_code',
      config.accounting.revenue_account_by_bucket?.costo ?? '',
    );

    this.prefilledFields.set(filled);
    this.seedAiuFromProfile(config, forced);
    this.seedWithholdings(config, forced);
    this.seedModelLines(config, forced);
  }

  /**
   * Siembra las retenciones del perfil.
   *
   * Sólo si el arreglo está VACÍO. Una fila capturada a mano es una decisión del
   * operador sobre este documento concreto, y reemplazarla por la del perfil
   * cambiaría un importe que no se cobra sin que nadie lo pidiera.
   *
   * La BASE no viene del perfil —no la guarda— y la tarifa se copia tal cual: es
   * la del contrato, no la del catálogo, y sustituirla sería cambiar un dato
   * fiscal en silencio.
   */
  private seedWithholdings(config: InvoiceProfileConfig, forced = false): void {
    const rules = config.withholdings?.rules ?? [];
    if (rules.length === 0) return;
    if (this.withholdingsArray.length > 0) {
      // Con la aplicación completa CONFIRMADA sí se reemplazan: el usuario acaba
      // de leer en el modal que se pierden y dijo que sí. Sin confirmación, la
      // fila capturada a mano manda.
      if (!forced) return;
      this.withholdingsArray.clear();
    }

    for (const rule of rules) {
      this.addWithholding();
      const group = this.withholdingsArray.at(
        this.withholdingsArray.length - 1,
      );
      const concept = this.withholdingConcepts().find(
        (candidate) => candidate.id === rule.concept_id,
      );
      group.patchValue({
        concept_id: rule.concept_id,
        // La etiqueta se resuelve contra el catálogo VIVO: un concepto borrado
        // deja la fila con su id y sin nombre, que es visible, en vez de con un
        // nombre viejo que ya no corresponde a nada.
        concept: concept ? concept.code + ' · ' + concept.name : '',
        role: rule.role,
        rate: Number(rule.rate) || 0,
      });
    }
  }

  /**
   * Siembra las líneas modelo del perfil en el `FormArray` de líneas.
   *
   * Sólo si NO hay nada que perder: el arreglo vacío, o con filas que siguen en
   * blanco (sin descripción y sin precio). Si el usuario ya capturó líneas, la
   * siembra se OFRECE con un botón —`pendingModelLines`— en vez de ejecutarse.
   * Reemplazar veinte líneas escritas a mano por las del perfil es exactamente
   * el tipo de acción que no se puede deshacer con Ctrl+Z en un formulario.
   */
  private seedModelLines(config: InvoiceProfileConfig, forced = false): void {
    const lines = config.model_lines ?? [];
    if (lines.length === 0) {
      this.pendingModelLines.set(0);
      return;
    }

    const captured = this.itemsArray.controls.some((control) => {
      const description = String(control.get('description')?.value ?? '').trim();
      const price = Number(control.get('unit_price')?.value ?? 0);
      return description.length > 0 || price > 0;
    });

    // Con la aplicación completa confirmada NO se ofrece: se hace. El botón
    // «Reemplazar por las del perfil» existe para el caso en que nadie autorizó
    // nada, y aquí la autorización es explícita.
    if (captured && !forced) {
      this.pendingModelLines.set(lines.length);
      return;
    }

    this.pendingModelLines.set(0);
    this.writeModelLines(config);
  }

  /** Reemplaza las líneas por las del perfil. Acción explícita del usuario. */
  applyModelLines(): void {
    const config = this.profileConfig();
    if (!config) return;
    this.writeModelLines(config);
    this.pendingModelLines.set(0);
  }

  private writeModelLines(config: InvoiceProfileConfig): void {
    const accounts = config.accounting.revenue_account_by_bucket ?? {};
    // El componente AIU sólo se escribe si el documento ES AIU. `bucket` es un
    // campo obligatorio de la línea modelo y su valor por omisión histórico es
    // `'administracion'`, así que un perfil ESTÁNDAR guardado sin tocar ese
    // selector traía sus líneas marcadas como Administración. Copiarlo tal cual
    // mandaba `aiu_component` en un documento tipo 10, donde el backend no tiene
    // régimen con que interpretarlo: la línea entraba a una base gravable que no
    // existe para esa operación. Fuera de AIU el componente NO se precarga.
    const isAiuProfile = this.isAiu();
    this.itemsArray.clear();
    for (const line of config.model_lines ?? []) {
      const group = this.appendItem();
      if (!group) break;
      group.patchValue({
        description: line.description,
        quantity: Number(line.quantity ?? 1) || 1,
        // El precio del perfil, o 0 si no lo trae. `Number('')` es 0 y `|| 0`
        // cubre el NaN de una cadena que no era número —el validador del
        // contrato ya la habría rechazado al guardarla, pero un snapshot viejo
        // pudo entrar antes de que el campo existiera.
        unit_price: Number(line.unit_price ?? 0) || 0,
        unit_code: line.unit_code ?? UNIT_CODE_DEFAULT,
        // Vacío también para el costo reembolsable: es la única cubeta que NO es
        // un componente del AIU, y mandarla como tal haría que el backend la
        // sumara a la base gravable del régimen.
        aiu_component:
          isAiuProfile && line.bucket !== 'costo' ? line.bucket : '',
        // La cuenta sí se copia siempre: un perfil estándar puede tener cuenta
        // de ingreso configurada por cubeta y eso es contabilidad, no fiscalidad.
        account_code: accounts[line.bucket] ?? '',
      });
    }
    this.itemsArray.updateValueAndValidity();
  }

  /**
   * Etiquetas legibles de lo que el perfil rellenó.
   *
   * Se pinta como lista bajo el selector. No es decoración: es el único lugar
   * donde el usuario puede comprobar QUÉ le tocaron sin recorrer las ocho
   * secciones campo por campo.
   */
  readonly prefillSummary = computed<string[]>(() => {
    const labels: Record<string, string> = {
      invoice_type: 'tipo de documento',
      use_foreign_currency: 'divisa',
      foreign_currency: 'divisa',
      payment_form: 'forma de pago',
      payment_means_code: 'medio de pago',
      notes: 'notas del documento',
      aiu_contract_object: 'objeto del contrato',
      default_account_code: 'cuenta contable por omisión',
    };
    // Un `Set` y no un arreglo: `use_foreign_currency` y `foreign_currency` son
    // dos controles con una sola etiqueta, y la lista diría «divisa» dos veces.
    const out = new Set<string>();
    for (const path of this.prefilledFields()) {
      out.add(labels[path] ?? path);
    }
    const lines = this.itemCount();
    if (lines > 0 && this.profileConfig()?.model_lines?.length === lines) {
      out.add(lines === 1 ? '1 línea' : lines + ' líneas');
    }
    const rules = this.profileConfig()?.withholdings?.rules?.length ?? 0;
    if (rules > 0 && this.withholdingsArray.length === rules) {
      out.add(rules === 1 ? '1 retención' : rules + ' retenciones');
    }
    return [...out];
  });

  /**
   * ¿Esta línea lleva la base AIU configurada?
   *
   * NO es un campo nuevo: es `aiu_component` no vacío. La semántica ya existía
   * —una línea con componente participa de la base del régimen; una sin él es
   * costo reembolsable y no la toca— pero estaba escondida en «dejar el selector
   * en blanco», que nadie lee como una decisión fiscal. El interruptor la hace
   * explícita sin inventar un campo que el backend no conoce.
   */
  lineCarriesAiu(item: AbstractControl): boolean {
    return String(item.get('aiu_component')?.value ?? '').trim().length > 0;
  }

  /**
   * Enciende o apaga la base AIU de una línea.
   *
   * Al encender se propone el primer componente GRAVABLE del régimen vigente:
   * bajo el Decreto 1372/1992 sólo la Utilidad lleva IVA, así que proponer
   * «Administración» ahí crearía una línea que el validador rechaza por declarar
   * una base que su propio régimen no grava (FAU04). Bajo el art. 462-1 los tres
   * son gravables y se propone Administración.
   *
   * Al apagar se limpia el componente: la línea pasa a costo reembolsable.
   */
  toggleLineAiu(item: AbstractControl, on: boolean): void {
    const control = item.get('aiu_component');
    if (!control) return;
    if (!on) {
      control.setValue('');
      control.markAsDirty();
      return;
    }
    if (this.lineCarriesAiu(item)) return;
    // Primer componente GRAVABLE de la base vigente, leído de la tabla del
    // contrato. Con `'utilidad'` sólo grava la utilidad; con `'aiu'` y con
    // `'subtotal'` graban los tres, y se propone Administración.
    const basis = this.effectiveAiu()?.taxable_basis ?? 'aiu';
    const first = AIU_TAXABLE_BUCKETS_BY_BASIS[basis].find(
      (bucket): bucket is AiuComponentLiteral => bucket !== 'costo',
    );
    control.setValue(first ?? 'administracion');
    control.markAsDirty();
  }

  /** ¿Este control lo rellenó el perfil? Lo usa la marca de la plantilla. */
  isPrefilled(path: string): boolean {
    return this.prefilledFields().has(path);
  }

  /**
   * El usuario cambió de perfil en el selector.
   *
   * ─── POR QUÉ AQUÍ HAY UNA PREGUNTA Y NO UNA ACCIÓN DIRECTA ───────────────
   *
   * Elegir un perfil no ajusta un campo: reescribe el documento —resolución,
   * códigos de pago, notas, objeto del contrato, cuenta contable, líneas y
   * retenciones—. Sobre un formulario recién abierto eso es justo lo que se
   * pide y preguntar sería ruido. Sobre uno a medio llenar es borrar trabajo
   * que no se recupera, en una pantalla que además gasta numeración autorizada.
   *
   * La diferencia entre los dos casos la da `profileOverwriteFields()`: si nada
   * de lo que el perfil precarga está escrito a mano, se aplica sin más.
   */
  onProfileChange(): void {
    this.clearSubmitError();
    const target = this.selectedProfileId();

    // Volver al flujo manual no precarga nada, así que no hay nada que perder:
    // sólo se apaga el instructivo del perfil. Lo ya escrito se queda —quitar el
    // perfil no es deshacerlo, y vaciar la factura acá sería la sorpresa opuesta
    // a la que este modal existe para evitar—.
    if (target === PROFILE_NONE) {
      this.profilePendingConfirm.set(null);
      this.profileOverwriteList.set([]);
      this.appliedProfileId = PROFILE_NONE;
      this.loadProfileConfig(PROFILE_NONE);
      return;
    }

    const risky = this.profileOverwriteFields();
    if (risky.length === 0) {
      this.applyProfileFully(target);
      return;
    }

    this.profileOverwriteList.set(risky);
    this.profilePendingConfirm.set(target);
  }

  /**
   * Qué se perdería al aplicar un perfil sobre lo que ya está escrito.
   *
   * Es un MÉTODO y no un `computed` a propósito: `dirty` no es una señal, así
   * que un `computed` que lo leyera devolvería el primer valor calculado para
   * siempre. Se llama en el instante del cambio y su resultado se congela en
   * `profileOverwriteList`, que sí es señal y es lo que pinta el modal.
   *
   * El aviso es CONSERVADOR con las líneas y las retenciones: en este punto
   * todavía no se han leído las reglas del perfil elegido —eso pasa después de
   * confirmar—, así que no se puede saber si trae líneas modelo con las que
   * reemplazarlas. Se advierte de lo que puede perderse, y el texto del modal lo
   * dice así. Al contrario —callarlo y reemplazar— sería la sorpresa que este
   * modal existe para evitar.
   */
  private profileOverwriteFields(): string[] {
    const out = new Set<string>();

    for (const [path, label] of PROFILE_PREFILL_LABELS) {
      if (this.invoiceForm.get(path)?.dirty === true) out.add(label);
    }

    const lines = this.itemsArray.controls.filter((control) => {
      const description = String(control.get('description')?.value ?? '').trim();
      const price = Number(control.get('unit_price')?.value ?? 0);
      return description.length > 0 || price > 0;
    }).length;
    if (lines > 0) {
      out.add(lines === 1 ? 'la línea capturada' : 'las ' + lines + ' líneas capturadas');
    }

    const rows = this.withholdingsArray.length;
    if (rows > 0) {
      out.add(
        rows === 1
          ? 'la retención capturada'
          : 'las ' + rows + ' retenciones capturadas',
      );
    }

    return [...out];
  }

  /** Texto del modal de confirmación. Se pinta con `innerHTML`: lleva viñetas. */
  readonly profileConfirmMessage = computed<string>(() => {
    const id = this.profilePendingConfirm();
    if (id === null) return '';
    const name =
      this.profilesForType().find((entry) => entry.id === id)?.name ?? '';
    const label = name ? '«' + escapeHtmlText(name) + '»' : 'este perfil';
    const bullets = this.profileOverwriteList()
      .map((item) => '• ' + escapeHtmlText(item))
      .join('<br>');

    return (
      'Esta factura ya tiene datos escritos a mano. Aplicar <strong>' +
      label +
      '</strong> la reconfigura por completo, empezando por la resolución.' +
      '<br><br>Puede perderse:<br>' +
      bullets +
      '<br><br>Lo que el perfil no traiga configurado se queda como está. El ' +
      'adquiriente y las fechas no se tocan nunca. Esto no se puede deshacer.'
    );
  });

  /**
   * El modal se cerró. Cerrar SIN responder —Escape, la «X»— es no aplicar.
   *
   * `cancelProfileApply()` es idempotente: cuando el cierre viene de haber
   * confirmado, `applyProfileFully` ya dejó el perfil aplicado en el control y
   * no queda nada que revertir.
   */
  onProfileConfirmOpenChange(open: boolean): void {
    if (open) return;
    this.cancelProfileApply();
  }

  /** El usuario autorizó reconfigurar la factura con el perfil elegido. */
  confirmProfileApply(): void {
    const id = this.profilePendingConfirm();
    if (id === null) return;
    this.applyProfileFully(id);
  }

  /**
   * El usuario dijo que no. El selector vuelve al perfil bajo el que trabajaba.
   *
   * Devolverlo importa: dejarlo mostrando el perfil descartado haría que la
   * pantalla afirmara una configuración que no se aplicó, y `buildPayload` toma
   * el `profile_id` de ese mismo control — la factura se timbraría contra la
   * versión de un perfil que el usuario acabó de rechazar.
   */
  cancelProfileApply(): void {
    this.profilePendingConfirm.set(null);
    this.profileOverwriteList.set([]);
    const control = this.invoiceForm.get('profile_id');
    if (!control) return;
    if (Number(control.value) === this.appliedProfileId) return;
    // `setValue` programático llega al selector por `writeValue`, que NO emite
    // `valueChange`: no se vuelve a entrar por `onProfileChange()`.
    control.setValue(this.appliedProfileId);
  }

  /**
   * APLICACIÓN COMPLETA del perfil: lo que el usuario pidió al elegirlo.
   *
   * Las dos reglas que protegen lo escrito a mano —`applyProfilePrefill` sólo
   * escribe controles `pristine`, y `preselectEligibleResolution` respeta la
   * resolución marcada a mano mientras siga `dirty`— siguen intactas. Lo que
   * hace esta función es quitarles el motivo: devuelve a `pristine` EXACTAMENTE
   * los controles que el perfil precarga, ni uno más.
   *
   * Que sean sólo esos y no `invoiceForm.markAsPristine()` no es una sutileza:
   * el adquiriente, el cliente buscado y las fechas también viven en este
   * formulario, no los precarga ningún perfil, y borrarles el `dirty` haría que
   * un cambio de perfil POSTERIOR no los contara como escritos a mano.
   *
   * El token es lo que fuerza a reevaluar la resolución cuando dos perfiles
   * prefieren la misma. Y la resolución preferida sigue pasando por la compuerta
   * de elegibilidad: si está vencida, agotada, inactiva o es de habilitación, se
   * cae al criterio automático y `profileResolutionNotice()` dice por qué.
   * Obedecer un rango muerto emitiría contra numeración que la DIAN ya no
   * reconoce, y eso no lo arregla ninguna confirmación del usuario.
   */
  private applyProfileFully(id: number): void {
    this.profilePendingConfirm.set(null);
    this.profileOverwriteList.set([]);
    this.appliedProfileId = id;

    for (const [path] of PROFILE_PREFILL_LABELS) {
      this.invoiceForm.get(path)?.markAsPristine();
    }

    this.forceProfileSeed = true;
    this.profileApplyToken.update((token) => token + 1);
    this.loadProfileConfig(id);
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

  // `withholdingUid` se retiró (B.5): `vendix-invoice-section-retenciones`
  // rastrea cada fila por identidad de control (`track row`), no por su
  // `row_uid`, mismo criterio que «Líneas» (B.3).

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

  dueDateHelp(): string {
    return this.isCredit()
      ? 'Obligatorio en venta a crédito.'
      : 'En contado vence el mismo día de la emisión.';
  }

  /**
   * Salida al editor de perfiles desde el estado vacío.
   *
   * Navega, no abre modal: crear un perfil son nueve secciones y ya se midió
   * que dentro de un modal no se encuentra nada. Lo capturado en esta factura
   * se pierde al salir, igual que con cualquier otra navegación de la pantalla.
   */
  goToProfileCreate(): void {
    void this.router.navigate(['/admin/invoicing/profiles/new']);
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

  // `productLabel` se retiró de aquí: ahora vive DENTRO de
  // `InvoiceSectionLineasComponent` (B.3), que lee `product_name` de la
  // misma fila sin necesitar esta página como intermediaria.

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
      price_unit_quantity: [null as number | null],
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
      // A.8 — el código DANE guardado en la dirección primaria del cliente
      // hidrata el buscador (el componente resuelve el chip por su cuenta);
      // si el cliente no lo tiene, queda vacío y la regla de bloqueo avisa.
      customer_municipality_code: address?.municipality_code ?? '',
      customer_city_name: address?.city ?? '',
    });
    this.inlineCustomer.set(null);
    this.linkedCustomerLabel.set(this.customerDisplayName(customer));
    this.customerResults.set([]);
    this.customerQuery.set('');
  }

  /**
   * A.8 — el buscador DANE publica el municipio completo; el control ya quedó
   * escrito por el CVA con el código, aquí se conserva el nombre legible para
   * `city_name` del XML. Se escribe SIN silenciar eventos: `rawValue` deriva
   * de `valueChanges`, y un patch mudo dejaría el payload con nombres viejos.
   */
  onCustomerMunicipality(municipality: DianMunicipalityOption | null): void {
    this.invoiceForm.patchValue({
      customer_city_name: municipality?.name ?? '',
    });
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
    // D.10: la escala viaja del catálogo a la fila para que la previsión
    // divida igual que el servidor. Se repisa en cada elección: cambiar de
    // producto sobre la misma fila cambia la escala, no la hereda.
    patch['price_unit_quantity'] = product.priceUnitQuantity ?? null;
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
      price_unit_quantity: (value as InvoiceItemFormValue).price_unit_quantity ?? null,
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
      price_unit_quantity: draft.price_unit_quantity ?? null,
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
    // A.8 — el DV ya no se verifica aquí porque ya no se DIGITA: la pantalla
    // lo deriva del NIT con el mismo módulo 11 que `@NitDvMatches()` en el
    // backend (ver `computedCustomerDv` y `buildPayload`), así que una
    // incoherencia NIT↔DV es inalcanzable desde este formulario. Verificar el
    // valor guardado de un cliente vinculado sería un falso bloqueo: el
    // payload viaja con el derivado, que es el correcto por construcción.
    //
    // Lo que SÍ se puede dejar a medias es el código DANE del municipio: es
    // el otro rechazo clásico y aquí se descubre antes del viaje.
    if (!this.isExportInvoice()) {
      const addressLine = String(raw['customer_address'] ?? '').trim();
      const cityCode = String(raw['customer_municipality_code'] ?? '').trim();
      if (addressLine && !cityCode) {
        blockers.push(
          'La dirección fiscal necesita su municipio DANE: búscalo por nombre en «Municipio (DANE)» y selecciónalo. Sin ese código la DIAN rechaza el documento.',
        );
      } else if (!addressLine && cityCode) {
        blockers.push(
          'Hay un municipio DANE elegido pero la dirección fiscal está vacía: escribe la dirección o quita el municipio.',
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
    // Antes bloqueaba toda línea sin componente diciendo que la DIAN rechazaría
    // el documento. Era FALSO y era más estricto que el servidor:
    // `resolveAiuContext` sólo rechaza lo inverso —un componente en un documento
    // que no es AIU— y el calculador documenta que `aiu_component = null` en un
    // documento AIU es la porción de costo reembolsable. Con ese bloqueo, un
    // contrato AIU real (costo + A + I + U) no se podía emitir.
    //
    // Lo que sí bloquea es el documento 09 en el que NINGUNA línea es del AIU:
    // ahí no hay base gravable que declarar y el documento contradice su propio
    // `CustomizationID`.
    if (this.isAiu() && this.aiuWithoutAnyComponent()) {
      blockers.push(
        'La operación es AIU (09) y ninguna línea es administración, imprevistos o utilidad: el documento no declararía AIU alguno. Marca las líneas del AIU o aplica la base configurada en el perfil.',
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
    // D.7 — el modelo elegido en el radio de la sección AIU viaja EXPLÍCITO.
    // `resolveAccountingModel` es el único punto de lectura del contrato: un
    // control vacío o corrupto cae en `'sumada'`, que es lo que el calculador
    // hace por construcción, en vez de viajar un valor que el servidor no
    // entiende. Mientras `ENABLED_ACCOUNTING_MODELS` no incluya
    // `'no_sumada'`, el radio lo mantiene en `'sumada'` y este envío pasa el
    // mismo `@IsIn` de siempre; el día que se habilite, la elección del
    // operador sale sola por aquí.
    if (this.isAiu()) {
      payload.aiu_accounting_model = resolveAccountingModel(
        (raw['aiu'] ?? {}) as { accounting_model?: AccountingModel },
      );
    }
    const notes = String(raw['notes'] ?? '').trim();
    if (notes) payload.notes = notes;

    // ── Adquiriente
    if (raw['customer_id']) payload.customer_id = Number(raw['customer_id']);
    const inline = this.inlineCustomer();
    if (!raw['customer_id'] && inline) {
      // `inline_customer` sólo se manda cuando NO hay `customer_id`: el backend
      // lo ignora si ambos vienen, y mandar los dos esconde cuál mandó.
      //
      // A.8 — el tipo de persona que el usuario vio y eligió en la pantalla
      // manda sobre el que trajera el modal: el selector es la última palabra
      // visible antes de emitir. Con documento no-NIT se fija NATURAL sin
      // preguntar (una cédula ES una persona natural).
      payload.inline_customer = {
        ...inline,
        person_type: this.isNitCustomer()
          ? String(raw['customer_person_type'] || 'JURIDICA')
          : 'NATURAL',
      };
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
    // A.8 — el DV NUNCA viaja tecleado: se deriva del NIT con el módulo 11
    // (misma util compartida del checkout) y SÓLO en NIT. En cédula o
    // pasaporte el campo no existe en el payload — condición ya garantizada
    // por esta rama, que el backend complementa calculándolo si faltara.
    if (this.isNitCustomer() && taxId) {
      const dv = computeNitDv(this.customerTaxIdBase());
      if (dv) payload.customer_verification_digit = dv;
    }
    const regime = String(raw['customer_tax_regime'] ?? '').trim();
    if (regime) payload.customer_tax_regime = regime;
    const responsibilities = this.responsibilitiesValue();
    if (responsibilities.length > 0) {
      payload.customer_fiscal_responsibilities = responsibilities;
    }
    // A.8 — dirección fiscal ESTRUCTURADA cuando hay municipio DANE: el
    // backend eleva este objeto a `InvoiceAddressDto` tal cual (`liftInvoiceAddress`)
    // y `normalizeAddress()` lo convierte en el `cac:PhysicalLocation` del XML.
    // Sin municipio se conserva el comportamiento histórico de siempre: el
    // string plano, que el backend desglosa en `address_line`.
    const addressLine = String(raw['customer_address'] ?? '').trim();
    const cityCode = String(raw['customer_municipality_code'] ?? '').trim();
    const cityName = String(raw['customer_city_name'] ?? '').trim();
    if (addressLine) {
      const structuredAddress: CustomerInvoiceAddressPayload = {
        address_line: addressLine,
      };
      if (cityCode) {
        structuredAddress.city_code = cityCode;
        // El DTO de dirección define el código de departamento como los DOS
        // primeros dígitos del de municipio; no hay control aparte a propósito.
        structuredAddress.department_code = cityCode.slice(0, 2);
      }
      if (cityName) structuredAddress.city_name = cityName;
      payload.customer_address = structuredAddress;
    } else if (cityCode) {
      // Alcanzado sólo si el bloqueo correspondiente fue ignorado (no debería
      // ocurrir): un objeto sin address_line sería un 400 garantizado, así que
      // se degrada a omitir la dirección antes que enviar basura fiscal.
      payload.customer_address = undefined;
    }

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

    // A.8 — el espejo `CreateInvoiceDto` de interfaces/ todavía tipa
    // customer_address como string; ampliarlo es trabajo de otro dueño (la
    // misma razón por la que este payload vive en un tipo local). En el cable
    // viaja el objeto desglosado, que el backend eleva a InvoiceAddressDto con
    // liftInvoiceAddress — ver CustomerInvoiceAddressPayload.
    return payload as CreateInvoiceDto;
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
   *
   * DOS DEFECTOS DISTINTOS, CON FECHAS DE NACIMIENTO DISTINTAS (medido por
   * el orquestador, 2026-08-25, con un parser de etiquetas multilínea sobre
   * todo `modules/store/invoicing` cruzado contra
   * `INVOICE_EMIT_REQUIREMENTS_MAP`). No confundir uno con otro ni atribuir
   * los dos a B.3: si algún día se revierte B.3, el Bug B NO se va con él.
   *
   * **Bug A (localización) — lo introdujo B.3 (`517953a4f`), sólo 4 campos
   * de línea.** `formControlName`/`formArrayName` SÍ son atributos estáticos
   * que llegan al DOM en minúsculas, pero eso vale para
   * `formControlName="x"` escrito literal en la plantilla. Los campos de
   * línea de `invoice-section-lineas.component.ts` ligan con
   * `[formControl]="rowControl(...)"` (binding de propiedad, sin atributo
   * DOM alguno) desde que B.3 extrajo la sección compartida, así que para
   * `items.<i>.<campo>` la consulta de abajo no encontraba NADA — ni un nodo
   * equivocado, cero nodos. `invoice-section-lineas.component.ts` marca
   * ahora sus 4 campos requeribles (`description`, `quantity`, `unit_code`,
   * `discount_amount`) con `[attr.data-control-name]`, un atributo propio —
   * nunca `[attr.formcontrolname]`, que suplantaría uno que Angular reserva.
   *
   * **Bug B (foco) — PRECEDE a B.3, los 10 campos requeribles (6 de
   * cabecera + los 4 de línea).** Nació cuando estos campos pasaron a
   * componentes compartidos (`<app-input>`, `<app-selector>`), no cuando se
   * extrajo la sección de líneas. Medido: los 6 campos de cabecera
   * requeribles (`customer_email`, `customer_name`, `customer_tax_id`,
   * `issue_date`, `customer_document_type`, `operation_type`) ligan
   * `formControlName` sobre el HOST `<app-input>`/`<app-selector>`, no
   * sobre un `<input>`/`<select>` nativo — y lo mismo, ahora, con
   * `[data-control-name]` en los 4 de línea. Angular sí refleja el
   * atributo al host en ambos casos, así que la consulta SÍ encontraba el
   * nodo y el `scrollIntoView` SÍ funcionaba, pero `node.focus()` sobre un
   * host no enfocable es un no-op silencioso. Por eso el paso de descender
   * al control focuseable real, más abajo, no es exclusivo de los campos de
   * línea: corrige el foco de los 10.
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
      const nodes = document.querySelectorAll<HTMLElement>(
        `[formcontrolname="${controlName}"], [formarrayname="${controlName}"], [data-control-name="${controlName}"], #${controlName}`,
      );
      // Los campos de línea repiten el mismo control name en cada fila: el
      // índice del hallazgo es lo que distingue la línea 3 de la primera.
      const node = nodes[line ? lineIndex : 0] ?? nodes[0];
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // `[data-control-name]` (y, en cabecera, `formcontrolname`) caen sobre
      // el elemento HOST del componente compartido (`<app-input>`,
      // `<app-selector>`), no sobre el `<input>`/`<select>` nativo de
      // adentro: Angular no reenvía un atributo desconocido al hijo. Sin
      // descender, `.focus()` es un no-op silencioso porque el host no es
      // enfocable. Se busca primero el control real dentro del nodo; si el
      // nodo mismo ya lo es (el fallback `#id`), se usa tal cual.
      const focusable = node?.matches(
        'input, select, textarea, button, [tabindex]',
      )
        ? node
        : node?.querySelector<HTMLElement>(
            'input, select, textarea, button, [tabindex]',
          );
      (focusable ?? node)?.focus?.();
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
    // LA MATRIZ AIU TAMBIÉN. Un `reset()` no vacía un `FormArray`: le pone
    // `null` a las filas que ya tiene, y la sección seguiría pintando filas
    // huecas con la matriz del documento anterior. Se vuelve a sembrar cuando
    // llegue la configuración del perfil.
    this.aiuTaxesArray.clear();
    this.aiuSeeded.set(false);
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
      // El AIU del documento vuelve a «nada configurado»: los porcentajes
      // vacíos, no un 5/2/3 plausible. La base y el piso los vuelve a sembrar
      // el efecto que los hereda de lo que manda.
      aiu: {
        taxable_basis: 'aiu' as AiuTaxableBasis,
        enforce_minimum_base: true,
        minimum_base_percent: formatPercentScaled(
          AIU_LEGAL_FLOOR_PERCENT_SCALED,
        ),
        components_basis: 'contract' as AiuComponentsBasis,
        administracion: '',
        imprevistos: '',
        utilidad: '',
        revenue_administracion: '',
        revenue_imprevistos: '',
        revenue_utilidad: '',
        vat_payable_account: '',
      },
      customer_id: null,
      customer_name: '',
      customer_document_type: DOCUMENT_TYPE_NIT_CODE,
      customer_tax_id: '',
      customer_verification_digit: '',
      customer_person_type: 'JURIDICA' as 'NATURAL' | 'JURIDICA',
      customer_tax_regime: '',
      customer_fiscal_responsibilities: [],
      customer_email: '',
      customer_phone: '',
      customer_address: '',
      customer_municipality_code: '',
      customer_city_name: '',
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
    if (actionId === 'preview') {
      this.openPrintPreview();
      return;
    }
    if (actionId === 'save') {
      this.onSubmit();
    }
  }

  // ── Formato de impresión y previsualización (E.1 / E.2) ─────

  /**
   * Lee la biblioteca de la organización (FB-31) y la config activa de la
   * tienda. Falla en silencio DEGREDADO: sin biblioteca el selector queda
   * con la opción de tienda y la sección avisa; nunca bloquea la emisión.
   */
  loadPrintFormats(): void {
    this.printGateway
      .listLibraryTemplates(FISCAL_INVOICE_FORMAT_TYPE)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (templates) =>
          this.printTemplates.set(
            templates.map((template) => ({
              id: template.id,
              name: template.name,
              is_system: template.is_system,
            })),
          ),
        error: () => this.printLibraryFailed.set(true),
      });

    this.refreshStoreFormatDetail();
  }

  private refreshStoreFormatDetail(): void {
    this.printGateway
      .getFormatDetail(FISCAL_INVOICE_FORMAT_TYPE)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => this.storeFormatDetail.set(detail),
        error: () => this.printLibraryFailed.set(true),
      });
  }

  /**
   * El selector cambió: persiste la plantilla ACTIVA DE TIENDA
   * (`PUT /store/print-formats/:formatType`), que es la única superficie de
   * escritura real —el DTO de creación no lleva `template_id` y el gateway
   * imprime cada documento con la plantilla que su perfil congeló cuando la
   * tiene—. '' vuelve a «plantilla activa de la tienda» (null).
   */
  onStoreTemplateSelected(value: string): void {
    if (this.storeTemplateSaving()) return;
    const trimmed = String(value ?? '').trim();
    const templateId = trimmed === '' ? null : Number(trimmed);
    if (
      trimmed !== '' &&
      (!Number.isFinite(templateId) || (templateId as number) <= 0)
    ) {
      return;
    }

    this.storeTemplateSaving.set(true);
    this.printGateway
      .updateFormat(FISCAL_INVOICE_FORMAT_TYPE, { template_id: templateId })
      .subscribe({
        next: () => {
          this.storeTemplateSaving.set(false);
          this.toastService.success(
            'Formato de impresión actualizado para toda la tienda.',
          );
        },
        error: () => {
          this.storeTemplateSaving.set(false);
          this.toastService.error(
            'No se pudo guardar la plantilla de impresión.',
          );
          // La pantalla no puede quedar enseñando una elección que el
          // servidor rechazó: se devuelve al valor efectivo.
          const control = this.printFormatForm.get('template_id');
          control?.markAsPristine();
          control?.setValue(
            this.effectiveTemplateId() == null
              ? ''
              : String(this.effectiveTemplateId()),
            { emitEvent: false },
          );
        },
      });
  }

  /**
   * E.2 — abre «Ver como saldrá» SIN persistir ni numerar. FB-29 compone con
   * DATOS DE MUESTRA del formato fiscal: no pasa por la compuerta DIAN (201
   * sin habilitación, medido) ni llama a `InvoiceNumberGenerator`, así que el
   * consecutivo autorizado no se toca. Lo que muestra es el XML que la factura
   * produciría bajo la configuración del perfil seleccionado (o el reparto
   * manual si no hay perfil), evaluado por las mismas compuertas del Anexo que
   * firman la emisión. La pantalla lo declara en el aviso: el número es
   * «PREVIEW» y los importes sí son los capturados.
   */
  openPrintPreview(): void {
    if (this.printPreviewLoading()) return;
    this.printPreviewError.set('');
    this.printPreviewHtml.set('');
    this.printPreviewResult.set(null);

    const profileId = this.selectedProfileId();
    if (profileId === PROFILE_NONE) {
      // Modo manual: sin perfil, no hay endpoint de previsualización que acepte
      // el cuerpo del documento. La pantalla lo dice en vez de fingir.
      this.printPreviewError.set(
        'Selecciona un perfil de facturación para previsualizar el XML. La previsualización refleja la configuración del perfil, no una muestra genérica.',
      );
      this.printPreviewOpen.set(true);
      this.printPreviewProfileId.set(null);
      return;
    }

    const payload = this.buildInvoicePreviewBody();
    if (!payload.lines || payload.lines.length === 0) {
      this.printPreviewError.set(
        'La factura no tiene líneas capturadas. Añade al menos una para previsualizar.',
      );
      this.printPreviewOpen.set(true);
      this.printPreviewProfileId.set(profileId);
      return;
    }

    this.printPreviewOpen.set(true);
    this.printPreviewLoading.set(true);
    this.printPreviewProfileId.set(profileId);

    this.profileService
      .preview(profileId, payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.printPreviewResult.set(response.data);
          this.printPreviewLoading.set(false);
        },
        error: () => {
          this.printPreviewLoading.set(false);
          this.printPreviewError.set(
            'No se pudo generar la previsualización. Revisa que las líneas tengan descripción, cantidad y precio.',
          );
        },
      });
  }

  /**
   * Traduce el formulario al `PreviewProfilePayload` que `POST /profiles/:id/preview`
   * espera. La línea sin `aiu_component` se mapea a `bucket: 'costo'` (no es AIU);
   * una con `aiu_component` se mapea al bucket del componente. Los importes se
   * copian TAL CUAL: el calculador y el builder truncan hoja por hoja al
   * centavo, y un redondeo acá movería el piso legal sobre un perfil
   * recién creado sin tocar un campo (ver ADR-5).
   */
  private buildInvoicePreviewBody(): PreviewProfilePayload {
    const raw = this.rawValue() ?? {};
    const aiu = (raw['aiu'] as Record<string, unknown>) ?? {};
    const items = this.itemsArray.controls
      .map((control) => control.value as InvoiceItemFormValue)
      .filter((item) => (item.description ?? '').trim().length > 0);

    const lines: PreviewProfileLinePayload[] = items.map((item) => {
      const component = (item.aiu_component ?? '').toString().trim();
      const bucket: AiuBucket = (
        component === 'administracion' ||
        component === 'imprevistos' ||
        component === 'utilidad'
          ? component
          : 'costo'
      ) as AiuBucket;
      return {
        bucket,
        description: item.description,
        quantity: Number(item.quantity) || 0,
        unit_price: Number(item.unit_price) || 0,
        discount_amount: Number(item.discount_amount) || 0,
        unit_code: item.unit_code || undefined,
      };
    });

    const contract_value = lines.reduce(
      (acc, line) =>
        acc + line.quantity * line.unit_price - (line.discount_amount ?? 0),
      0,
    );

    // Los dos modos del preview son EXCLUYENTES (ver `profile-preview.service.ts`
    // y el docblock de `PreviewProfileDto`): si mando `lines` Y
    // `contract_value`, el backend responde `422 INVOICING_PREVIEW_002`. La
    // pantalla captura líneas explícitas → mando sólo `lines` (y `aiu_value`
    // cuando AIU). Dejo `contract_value` calculado como diagnóstico local,
    // pero no en el payload.
    const lines_explicit = lines.length > 0;

    let aiu_value: number | undefined;
    if (lines_explicit && this.isAiu()) {
      const admin = Number(aiu['administracion']) || 0;
      const imp = Number(aiu['imprevistos']) || 0;
      const ut = Number(aiu['utilidad']) || 0;
      aiu_value = admin + imp + ut;
    }

    const contract_object =
      (raw['contract_object'] as string | undefined)?.trim() || undefined;

    const customer_name = (raw['customer_name'] as string | undefined)?.trim();
    const customer_doc = (raw['customer_tax_id'] as string | undefined)?.trim();
    const customer_doc_type = (raw['customer_document_type'] as string | undefined)?.trim();

    return {
      ...(lines_explicit
        ? {}
        : contract_value > 0
        ? { contract_value }
        : {}),
      ...(typeof aiu_value === 'number' ? { aiu_value } : {}),
      ...(contract_object ? { contract_object } : {}),
      ...(lines_explicit ? { lines } : {}),
      ...(customer_name || customer_doc || customer_doc_type
        ? {
            customer: {
              ...(customer_doc_type ? { document_type: customer_doc_type } : {}),
              ...(customer_doc ? { document_number: customer_doc } : {}),
              ...(customer_name ? { legal_name: customer_name } : {}),
            },
          }
        : {}),
    };
  }

  closePrintPreview(open: boolean): void {
    this.printPreviewOpen.set(open);
    if (!open) {
      this.printPreviewHtml.set('');
      this.printPreviewError.set('');
      this.printPreviewResult.set(null);
      this.printPreviewProfileId.set(null);
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

// La vigencia y el orden de las resoluciones viven en
// `utils/resolution-selection.util.ts`: el editor de perfiles decide sobre el
// MISMO rango autorizado, y una segunda implementación del predicado de
// vigencia sólo divergiría el día en que una vigencia empieza o termina.
