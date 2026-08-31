import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import {
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Observable, firstValueFrom, of } from 'rxjs';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { catchError, map, startWith } from 'rxjs/operators';

import { environment } from '../../../../../../../../environments/environment';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import {
  AlertBannerComponent,
  BadgeComponent,
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
} from '../../../../../../../shared/components';
import type { SelectorOption } from '../../../../../../../shared/components/selector/selector.component';
import { CurrencyPipe as VendixCurrencyPipe } from '../../../../../../../shared/pipes/currency';
import { AccountCodeSelectComponent } from '../../../../../store/products/components/account-code-select.component';

// Secciones Compartidas
import { PlatformSectionWrapperComponent } from '../../components/platform-section-wrapper/platform-section-wrapper.component';
import {
  DivisaSectionPaths,
  DocumentoSectionPaths,
  InvoiceSectionDivisaComponent,
  InvoiceSectionDocumentoComponent,
  InvoiceSectionImpuestosComponent,
  InvoiceSectionLineasComponent,
  InvoiceSectionNotasComponent,
  InvoiceSectionRetencionesComponent,
  LineasRowErrors,
  LineasRowPaths,
  NotasSectionPaths,
  RetencionesRowErrors,
  RetencionesRowPaths,
  TaxBreakdownRow,
  DEFAULT_UNIT_CODE,
  PLATFORM_FOREIGN_CURRENCY_OPTIONS,
  PLATFORM_TAX_CATALOG,
  UNIT_CODE_OPTIONS,
} from '../../../../../../../shared/components/invoice-sections';

import { TenantPickerComponent } from '../../components/tenant-picker/tenant-picker.component';
import { PlatformInvoicingStore } from '../../platform-invoicing.store';
import { FiscalBillingAdminService } from '../../../../subscriptions/services/fiscal-billing-admin.service';
import type { PreviewPlatformProfilePayload } from '../../../../subscriptions/interfaces/fiscal-billing.interface';
import { PlatformAcquirer } from '../../state';
import { formatDateOnlyUTC } from '../../../../../../../shared/utils/date.util';

/**
 * Cálculo estándar DIAN del Dígito de Verificación (Módulo 11).
 */
export function calculateDianDv(nit: string): string {
  const cleanNit = (nit || '').replace(/\D/g, '');
  if (!cleanNit) return '';
  const primes = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  let sum = 0;
  for (let i = 0; i < cleanNit.length; i++) {
    const digit = parseInt(cleanNit.charAt(cleanNit.length - 1 - i), 10);
    sum += digit * primes[i];
  }
  const mod = sum % 11;
  if (mod === 0 || mod === 1) return mod.toString();
  return (11 - mod).toString();
}

/**
 * Un impuesto tal como lo guarda `vendix-invoice-line-taxes` DENTRO de la fila.
 *
 * `rate` viene en PORCENTAJE (19), que es la unidad de `TaxOption`. El DTO
 * espera la fracción 0–1: la conversión ocurre en un ÚNICO sitio,
 * `buildPayload`, y nunca en los cómputos de pantalla.
 */
interface LineTaxSelection {
  tax_rate_id: number;
  rate: number;
  tax_type?: string;
  name?: string;
  is_inclusive?: boolean;
}

/** Concepto de retención tal como lo publica el backend de la plataforma. */
interface PlatformWithholdingConcept {
  id: number;
  code?: string;
  name: string;
  rate?: number;
}

/** Desglose financiero de UNA línea, con su base y sus impuestos resueltos. */
interface LineFinancials {
  gross: number;
  discount: number;
  net: number;
  base: number;
  taxes: {
    key: string;
    name: string;
    ratePercent: number;
    isInclusive: boolean;
    base: number;
    amount: number;
  }[];
  taxAmount: number;
  total: number;
}

interface NewLineDraft {
  description: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_rate_id: number;
  is_inclusive: boolean;
  unit_code: string;
}

@Component({
  selector: 'app-platform-invoice-create',
  standalone: true,
  imports: [
    FormsModule,
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    AlertBannerComponent,
    BadgeComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    SelectorComponent,
    TenantPickerComponent,
    VendixCurrencyPipe,
    AccountCodeSelectComponent,
    PlatformSectionWrapperComponent,
    InvoiceSectionDocumentoComponent,
    InvoiceSectionLineasComponent,
    InvoiceSectionImpuestosComponent,
    InvoiceSectionRetencionesComponent,
    InvoiceSectionDivisaComponent,
    InvoiceSectionNotasComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './platform-invoice-create.component.html',
})
export class PlatformInvoiceCreateComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  readonly store = inject(PlatformInvoicingStore);
  private readonly http = inject(HttpClient);
  private readonly fiscal = inject(FiscalBillingAdminService);

  /**
   * LA PLATAFORMA SÓLO EMITE FACTURA DE VENTA ESTÁNDAR.
   *
   * `operation_type` se queda fijo en `'10'` y no hay selector: AIU (`'09'`),
   * mandato (`'11'`) y consorcio (`'12'`) son contratos que esta consola no
   * factura. El control sigue existiendo porque el DTO lo exige, pero es un
   * valor constante, no una decisión del operador.
   */
  static readonly OPERATION_TYPE_STANDARD = '10';

  // ── Modo de Adquiriente ─────────────────────────────────────────
  readonly acquirerMode = signal<'system' | 'external'>('system');

  /**
   * Tenant elegido en el picker. Existe como signal aparte del control del
   * formulario porque el template lo lee para decidir si muestra el bloque de
   * datos fiscales, y `invoiceForm.value` no es reactivo bajo zoneless.
   */
  readonly selectedTenant = signal<PlatformAcquirer | null>(null);

  /**
   * La DIAN rechaza el documento sin identificacion del adquiriente. Es lo
   * unico que se marca como bloqueante en el bloque fiscal; el resto (correo,
   * telefono, direccion) el anexo lo admite ausente.
   */
  readonly acquirerFiscalIncomplete = computed(() => {
    const v = this.rawValue();
    return (
      !String(v['external_legal_name'] ?? '').trim() ||
      !String(v['external_tax_id'] ?? '').trim()
    );
  });

  // ── Formulario Principal ────────────────────────────────────────
  readonly invoiceForm = this.fb.group({
    profile_id: [null as number | null],

    // Documento
    resolution_id: [null as number | null, Validators.required],
    invoice_type: ['sales_invoice', Validators.required],
    operation_type: [
      PlatformInvoiceCreateComponent.OPERATION_TYPE_STANDARD,
      Validators.required,
    ],
    payment_form: ['1', Validators.required],
    payment_means_code: ['10'],
    issue_date: [formatDateOnlyUTC(new Date())],
    due_date: [''],
    notes: [''],

    // Adquiriente del Sistema (picker)
    customer_tenant: [null as PlatformAcquirer | null],

    // Adquiriente Externo Manual
    external_legal_name: [''],
    external_tax_id: [''],
    external_tax_id_dv: [''],
    external_document_type: ['31'], // 31 = NIT, 13 = CC, 22 = CE
    external_person_type: ['1'], // 1 = Jurídica, 2 = Natural
    external_tax_regime_code: ['48'], // 48 = Resp IVA, 49 = No resp
    external_email: [''],
    external_phone: [''],
    external_address_line: [''],
    external_city: ['Bogotá, D.C.'],
    external_department_code: ['11'],

    // Contabilidad
    counterpart_account_code: [null as string | null],

    // Divisa (declarativa: el documento se emite SIEMPRE en COP)
    declare_foreign: [false],
    foreign_currency_code: ['USD'],
    exchange_rate: [null as number | null],
    exchange_rate_date: [formatDateOnlyUTC(new Date())],

    // Guardar como perfil
    save_as_profile_enabled: [false],
    save_as_profile_name: [''],

    // Líneas y retenciones
    items: this.fb.array([], Validators.required),
    withholdings: this.fb.array([]),
  });

  get itemsArray(): FormArray {
    return this.invoiceForm.get('items') as FormArray;
  }

  get withholdingsArray(): FormArray {
    return this.invoiceForm.get('withholdings') as FormArray;
  }

  // Señales derivadas del Formulario
  private readonly formValue = toSignal(
    this.invoiceForm.valueChanges.pipe(startWith(this.invoiceForm.value)),
    { initialValue: this.invoiceForm.value as Record<string, any> },
  );

  private readonly itemsValue = toSignal(
    this.itemsArray.valueChanges as Observable<any[]>,
    { initialValue: [] },
  );

  private readonly withholdingsValue = toSignal(
    this.withholdingsArray.valueChanges as Observable<any[]>,
    { initialValue: [] },
  );

  readonly itemControls = computed<FormGroup[]>(() => {
    this.itemsValue();
    return [...this.itemsArray.controls] as FormGroup[];
  });

  readonly withholdingControls = computed<FormGroup[]>(() => {
    this.withholdingsValue();
    return [...this.withholdingsArray.controls] as FormGroup[];
  });

  readonly rawValue = computed<Record<string, any>>(() => {
    this.formValue();
    return this.invoiceForm.getRawValue();
  });

  readonly isCredit = computed(() => this.rawValue()['payment_form'] === '2');
  readonly usesForeignCurrency = computed(
    () => this.rawValue()['declare_foreign'] === true,
  );

  // ── Catálogos ───────────────────────────────────────────────────
  readonly unitCodeOptions = UNIT_CODE_OPTIONS;
  readonly availableTaxes = PLATFORM_TAX_CATALOG;
  readonly currencyOptions = PLATFORM_FOREIGN_CURRENCY_OPTIONS;

  /** Alimenta el selector de tarifa del modal de línea rápida. */
  readonly taxRateOptions: SelectorOption[] = [
    { value: '0', label: 'Sin impuesto (excluido)' },
    ...PLATFORM_TAX_CATALOG.map((t) => ({
      value: String(t.id),
      label: t.name,
    })),
  ];

  /**
   * Conceptos de retención de la organización de plataforma.
   *
   * Se leen del backend y no se inventan: `concept_id` viaja al DTO como
   * ENTERO (`@IsInt()`), así que una lista escrita a mano con códigos de texto
   * («RCO01») produce un 400 en la emisión, no un aviso en pantalla.
   */
  readonly withholdingConcepts = signal<PlatformWithholdingConcept[]>([]);

  readonly withholdingConceptOptions = computed<SelectorOption[]>(() =>
    this.withholdingConcepts().map((c) => ({
      value: c.id,
      label: c.code ? `${c.code} — ${c.name}` : c.name,
    })),
  );

  readonly withholdingRoleOptions: SelectorOption[] = [
    { value: 'practiced', label: 'Practicada (la retiene el cliente)' },
    { value: 'suffered', label: 'Sufrida (nos la retienen)' },
    { value: 'self', label: 'Autorretención' },
  ];

  // ── Cálculo Reactivo de Totales ──────────────────────────────────

  /**
   * Desglose de UNA línea.
   *
   * ## Base gravable e impuesto incluido
   *
   * La base sale del NETO de descuento, nunca del bruto. Cuando la línea
   * declara impuestos INCLUIDOS en el precio, el neto ya los contiene, así que
   * la base es `neto / (1 + Σ tarifas incluidas)` y cada impuesto se liquida
   * sobre esa base. Los impuestos AGREGADOS se liquidan sobre la misma base y
   * se suman encima. Una línea puede llevar ambos (IVA incluido + INC
   * agregado) y el reparto sigue siendo correcto.
   */
  private lineFinancials(item: any): LineFinancials {
    const qty = Number(item?.quantity) || 0;
    const price = Number(item?.unit_price) || 0;
    const discount = Number(item?.discount_amount) || 0;
    const taxes = (item?.taxes || []) as LineTaxSelection[];

    const gross = qty * price;
    const net = Math.max(0, gross - discount);

    const inclusiveFraction = taxes
      .filter((t) => t?.is_inclusive)
      .reduce((acc, t) => acc + (Number(t?.rate) || 0) / 100, 0);

    const base = inclusiveFraction > 0 ? net / (1 + inclusiveFraction) : net;

    const resolved = taxes.map((t) => {
      const ratePercent = Number(t?.rate) || 0;
      const type = (t?.tax_type || 'IVA').toUpperCase();
      const isInclusive = Boolean(t?.is_inclusive);
      return {
        key: `${type}|${ratePercent}|${isInclusive ? 'inc' : 'add'}`,
        name: t?.name || `${type} ${ratePercent}%`,
        ratePercent,
        isInclusive,
        base,
        amount: base * (ratePercent / 100),
      };
    });

    const taxAmount = resolved.reduce((acc, t) => acc + t.amount, 0);

    return {
      gross,
      discount,
      net,
      base,
      taxes: resolved,
      taxAmount,
      total: base + taxAmount,
    };
  }

  readonly totals = computed(() => {
    const items = this.itemsValue() || [];

    let grossSubtotal = 0;
    let totalDiscount = 0;
    let taxableBase = 0;
    let totalTax = 0;

    for (const item of items) {
      const line = this.lineFinancials(item);
      grossSubtotal += line.gross;
      totalDiscount += line.discount;
      taxableBase += line.base;
      // El impuesto de cabecera es la SUMA de los impuestos de línea, nunca
      // `base × tarifa` recalculado sobre el total: recalcular produce
      // diferencias de céntimos que la DIAN rechaza (FAS02).
      totalTax += line.taxAmount;
    }

    const total = taxableBase + totalTax;

    return {
      grossSubtotal,
      totalDiscount,
      taxableBase,
      totalIva: totalTax,
      total,
      totalWithheld: this.totalWithheld(),
      netPayable: total - this.totalWithheld(),
    };
  });

  /**
   * Desglose agregado por tarifa. Cada grupo suma las BASES y los IMPORTES de
   * las líneas que lo declaran; dos tarifas distintas del mismo tributo son
   * dos filas, y una misma tarifa incluida y agregada también, porque el
   * operador necesita ver por qué el total no cuadra con su intuición.
   */
  readonly taxBreakdown = computed<TaxBreakdownRow[]>(() => {
    const items = this.itemsValue() || [];
    const groups = new Map<string, TaxBreakdownRow>();

    for (const item of items) {
      for (const tax of this.lineFinancials(item).taxes) {
        const existing = groups.get(tax.key);
        if (existing) {
          groups.set(tax.key, {
            ...existing,
            base: existing.base + tax.base,
            amount: existing.amount + tax.amount,
          });
        } else {
          groups.set(tax.key, {
            key: tax.key,
            name: tax.name,
            rate: tax.ratePercent,
            isInclusive: tax.isInclusive,
            base: tax.base,
            amount: tax.amount,
          });
        }
      }
    }

    return [...groups.values()].sort((a, b) => b.rate - a.rate);
  });

  /** Importe retenido de cada fila. */
  readonly withholdingAmounts = computed<number[]>(() =>
    (this.withholdingsValue() || []).map((row: any) => {
      const base = Number(row?.base) || 0;
      const rate = Number(row?.rate) || 0;
      return base * (rate / 100);
    }),
  );

  readonly totalWithheld = computed(() =>
    this.withholdingAmounts().reduce((acc, amount) => acc + amount, 0),
  );

  // ── Paths para las secciones compartidas ────────────────────────
  readonly documentoSectionPaths: DocumentoSectionPaths = {
    invoice_type: 'invoice_type',
    payment_form: 'payment_form',
    payment_means_code: 'payment_means_code',
    issue_date: 'issue_date',
    due_date: 'due_date',
    notes: 'notes',
    header_notes: null,
  };

  readonly lineasRowPaths: LineasRowPaths = {
    description: 'description',
    quantity: 'quantity',
    unit_code: 'unit_code',
    unit_price: 'unit_price',
    discount_amount: 'discount_amount',
    taxes: 'taxes',
    // Inerte: la superficie es sólo estándar, ninguna línea entra a una base
    // AIU. El control existe porque el mapa de rutas lo exige.
    aiu_field: 'aiu_field',
  };

  readonly retencionesRowPaths: RetencionesRowPaths = {
    concept_id: 'concept_id',
    role: 'role',
    rate: 'rate',
    base: 'base',
  };

  readonly divisaSectionPaths: DivisaSectionPaths = {
    declare_foreign: 'declare_foreign',
    currency_code: 'foreign_currency_code',
    exchange_rate: 'exchange_rate',
    exchange_rate_date: 'exchange_rate_date',
  };

  readonly notasSectionPaths: NotasSectionPaths = {
    description: null,
    internal_note: null,
  };

  // ── Opciones de Selectores ──────────────────────────────────────

  /**
   * UN solo tipo de documento.
   *
   * «Documento soporte» estaba en la lista y era un botón cuyo único desenlace
   * era emitir una factura de venta igual: el `submit` siempre publica en
   * `POST /sales-invoices`, y el documento soporte exige un proveedor que este
   * formulario no captura. Ofrecerlo era ofrecer una mentira.
   */
  readonly invoiceTypeOptions: SelectorOption[] = [
    { value: 'sales_invoice', label: 'Factura de Venta' },
  ];
  readonly paymentFormOptions: SelectorOption[] = [
    { value: '1', label: 'Contado' },
    { value: '2', label: 'Crédito' },
  ];
  readonly paymentMeansOptions: SelectorOption[] = [
    { value: '10', label: 'Efectivo' },
    { value: '42', label: 'Transferencia Bancaria' },
    { value: '48', label: 'Tarjeta de Crédito' },
    { value: '49', label: 'Tarjeta de Débito' },
    { value: '1', label: 'Instrumento no definido' },
  ];

  readonly documentTypeOptions: SelectorOption[] = [
    { value: '31', label: 'NIT (Número de Identificación Tributaria)' },
    { value: '13', label: 'Cédula de Ciudadanía (CC)' },
    { value: '22', label: 'Cédula de Extranjería (CE)' },
    { value: '41', label: 'Pasaporte' },
  ];

  readonly personTypeOptions: SelectorOption[] = [
    { value: '1', label: 'Persona Jurídica' },
    { value: '2', label: 'Persona Natural' },
  ];

  readonly taxRegimeOptions: SelectorOption[] = [
    { value: '48', label: 'Responsable de IVA (Régimen Común)' },
    { value: '49', label: 'No Responsable de IVA (Régimen Simplificado)' },
  ];

  /**
   * Departamentos DIVIPOLA. La dirección del adquiriente externo viaja al
   * snapshot fiscal, y el código de departamento es obligatorio allí: sin este
   * control el formulario capturaba ciudad pero mandaba el departamento por
   * defecto de Bogotá para cualquier municipio del país.
   */
  readonly departmentOptions: SelectorOption[] = [
    { value: '05', label: 'Antioquia' },
    { value: '08', label: 'Atlántico' },
    { value: '11', label: 'Bogotá, D.C.' },
    { value: '13', label: 'Bolívar' },
    { value: '15', label: 'Boyacá' },
    { value: '17', label: 'Caldas' },
    { value: '18', label: 'Caquetá' },
    { value: '19', label: 'Cauca' },
    { value: '20', label: 'Cesar' },
    { value: '23', label: 'Córdoba' },
    { value: '25', label: 'Cundinamarca' },
    { value: '27', label: 'Chocó' },
    { value: '41', label: 'Huila' },
    { value: '44', label: 'La Guajira' },
    { value: '47', label: 'Magdalena' },
    { value: '50', label: 'Meta' },
    { value: '52', label: 'Nariño' },
    { value: '54', label: 'Norte de Santander' },
    { value: '63', label: 'Quindío' },
    { value: '66', label: 'Risaralda' },
    { value: '68', label: 'Santander' },
    { value: '70', label: 'Sucre' },
    { value: '73', label: 'Tolima' },
    { value: '76', label: 'Valle del Cauca' },
    { value: '81', label: 'Arauca' },
    { value: '85', label: 'Casanare' },
    { value: '86', label: 'Putumayo' },
    { value: '88', label: 'San Andrés y Providencia' },
    { value: '91', label: 'Amazonas' },
    { value: '94', label: 'Guainía' },
    { value: '95', label: 'Guaviare' },
    { value: '97', label: 'Vaupés' },
    { value: '99', label: 'Vichada' },
  ];

  // ── Estado de UI ────────────────────────────────────────────────
  readonly sectionExpanded = signal<Record<string, boolean>>({
    perfil: true,
    documento: true,
    adquiriente: true,
    lineas: true,
    impuestos: true,
    retenciones: false,
    contabilidad: false,
    divisa: false,
    notas: false,
  });

  readonly submitting = signal(false);
  readonly errorMessage = signal('');

  // ── Modal de Nueva Línea ─────────────────────────────────────────
  readonly showLineModal = signal(false);
  readonly newLine = signal<NewLineDraft>(this.emptyLineDraft());

  private emptyLineDraft(): NewLineDraft {
    return {
      description: '',
      quantity: 1,
      unit_price: 0,
      discount_amount: 0,
      tax_rate_id: PLATFORM_TAX_CATALOG[0]?.id ?? 0,
      is_inclusive: false,
      unit_code: DEFAULT_UNIT_CODE,
    };
  }

  ngOnInit() {
    this.store.loadResolutions();
    this.store.loadProfiles();
    this.loadWithholdingConcepts();

    // Auto-cálculo del DV cuando se escribe el NIT externo
    this.invoiceForm
      .get('external_tax_id')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((nit) => {
        if (nit && this.invoiceForm.get('external_document_type')?.value === '31') {
          const dv = calculateDianDv(nit);
          this.invoiceForm.patchValue({ external_tax_id_dv: dv }, { emitEvent: false });
        }
      });

    // La fecha de vencimiento sólo es obligatoria a crédito. Se sincroniza el
    // validador en vez de dejar que el backend conteste 400 con la forma de
    // pago que el propio formulario eligió.
    this.invoiceForm
      .get('payment_form')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((form) => {
        const dueDate = this.invoiceForm.get('due_date');
        if (!dueDate) return;
        if (form === '2') {
          dueDate.addValidators(Validators.required);
        } else {
          dueDate.removeValidators(Validators.required);
        }
        dueDate.updateValueAndValidity({ emitEvent: false });
      });
  }

  private loadWithholdingConcepts(): void {
    this.http
      .get<any>(
        `${environment.apiUrl}/superadmin/subscriptions/fiscal/withholding-concepts`,
      )
      .pipe(
        map((res) => {
          const payload = res?.data ?? res;
          const rows = Array.isArray(payload) ? payload : (payload?.data ?? []);
          return rows as PlatformWithholdingConcept[];
        }),
        // La sección de retenciones es OPCIONAL: si el catálogo no está
        // disponible el formulario debe seguir emitiendo sin ella, no romperse.
        catchError(() => of([] as PlatformWithholdingConcept[])),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((concepts) => this.withholdingConcepts.set(concepts));
  }

  get resolutionControl(): FormControl<number | null> {
    return this.invoiceForm.get('resolution_id') as FormControl<number | null>;
  }

  get counterpartControl(): FormControl<string | null> {
    return this.invoiceForm.get(
      'counterpart_account_code',
    ) as FormControl<string | null>;
  }

  accountControl(row: FormGroup): FormControl<string | null> {
    return row.get('account_code') as FormControl<string | null>;
  }

  /**
   * Errores por fila, ya resueltos.
   *
   * Es un `computed` y no un getter: un getter devuelve un ARREGLO NUEVO en
   * cada detección de cambios, y como es la entrada de un componente `OnPush`
   * la referencia distinta lo repinta en cada ciclo.
   */
  readonly lineasRowErrors = computed<LineasRowErrors[]>(() =>
    this.itemControls().map((row) => {
      const errors: LineasRowErrors = {};
      const description = row.get('description');
      const quantity = row.get('quantity');
      const unitPrice = row.get('unit_price');
      if (description?.invalid && description.touched) {
        errors.description = 'La descripción es obligatoria.';
      }
      if (quantity?.invalid && quantity.touched) {
        errors.quantity = 'La cantidad debe ser mayor que cero.';
      }
      if (unitPrice?.invalid && unitPrice.touched) {
        errors.unit_price = 'El precio no puede ser negativo.';
      }
      return errors;
    }),
  );

  /** Resumen por fila que pinta la sección compartida bajo cada renglón. */
  readonly lineasRowSummaries = computed<string[]>(() =>
    (this.itemsValue() || []).map((item: any) => {
      const line = this.lineFinancials(item);
      if (line.taxes.length === 0) {
        return `Sin impuestos · Total ${this.formatCurrencyValue(line.total)}`;
      }
      const detail = line.taxes
        .map(
          (t) =>
            `${t.name}${t.isInclusive ? ' (incl.)' : ''} ${this.formatCurrencyValue(t.amount)}`,
        )
        .join(' · ');
      return `Base ${this.formatCurrencyValue(line.base)} · ${detail} · Total ${this.formatCurrencyValue(line.total)}`;
    }),
  );

  readonly retencionesRowErrors = computed<RetencionesRowErrors[]>(() =>
    this.withholdingControls().map((row) => {
      const errors: RetencionesRowErrors = {};
      const concept = row.get('concept_id');
      const rate = row.get('rate');
      if (concept?.invalid && concept.touched) {
        errors.concept_id = 'Selecciona un concepto de retención.';
      }
      if (rate?.invalid && rate.touched) {
        errors.rate = 'La tarifa debe estar entre 0 y 100.';
      }
      return errors;
    }),
  );

  /** Tarifa de catálogo del concepto elegido, para contrastarla con la escrita. */
  readonly catalogRateForBound = (index: number): string | null => {
    const row = this.withholdingControls()[index];
    if (!row) return null;
    const conceptId = Number(row.get('concept_id')?.value);
    const concept = this.withholdingConcepts().find((c) => c.id === conceptId);
    if (!concept || concept.rate == null) return null;
    return `${(concept.rate * 100).toFixed(2)}%`;
  };

  /**
   * Inertes: la superficie es sólo estándar y ninguna línea entra a una base
   * AIU. Siguen existiendo porque `vendix-invoice-section-lineas` los declara
   * `input.required` para el riel de tienda, que sí factura contratos AIU.
   */
  readonly carriesAiu = (_row: unknown, _index: number): boolean => false;
  readonly toggleAiu = (
    _row: unknown,
    _index: number,
    _on: boolean,
  ): void => undefined;

  readonly formatCurrencyBound = (value: number): string =>
    this.formatCurrencyValue(value);

  private formatCurrencyValue(value: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 2,
    }).format(Number.isFinite(value) ? value : 0);
  }

  toggleSection(section: string, expanded: boolean): void {
    this.sectionExpanded.update((s) => ({ ...s, [section]: expanded }));
  }

  /**
   * Sólo rangos de FACTURA DE VENTA y activos. Un rango de documento soporte
   * o uno desactivado en este desplegable deja emitir contra una resolución
   * que la DIAN rechaza, y el error aparece recién en la transmisión.
   */
  readonly resolutionOptions = computed<SelectorOption[]>(() =>
    this.store
      .resolutions()
      .filter((r) => r.document_type === 'sales_invoice' && r.is_active)
      .map((r) => ({
        value: r.id,
        label: r.prefix
          ? `${r.prefix} (Resolución ${r.resolution_number})`
          : `Resolución ${r.resolution_number}`,
      })),
  );

  // ── Conmutador de Modo de Adquiriente ────────────────────────────
  setAcquirerMode(mode: 'system' | 'external'): void {
    this.acquirerMode.set(mode);
    if (mode === 'external') {
      this.invoiceForm.patchValue({ customer_tenant: null });
      this.selectedTenant.set(null);
    }
    // Cambiar de pestaña limpia los campos fiscales en los dos sentidos: los
    // datos del tenant anterior no pueden quedar colgados como si fueran los
    // que tecleó el operador para un cliente externo, ni al revés.
    this.resetAcquirerFiscalFields();
  }

  // ── Adquiriente del Sistema ──────────────────────────────────────
  onTenantPicked(tenant: PlatformAcquirer | null): void {
    this.invoiceForm.patchValue({ customer_tenant: tenant });
    this.selectedTenant.set(tenant);

    if (!tenant) {
      this.resetAcquirerFiscalFields();
      return;
    }

    // Los datos fiscales del tenant se vuelcan sobre los MISMOS controles que
    // usa el cliente externo. Antes el picker sólo guardaba el objeto y no
    // mostraba nada: si a la tienda le faltaba el NIT o el DV, la emisión
    // moria en el backend con «Captura los campos faltantes en el formulario
    // antes de emitir» y en el formulario no habia ningun campo que capturar.
    // Ahora se ven, se pueden completar y se mandan como override.
    const personType = tenant.person_type === '2' ? '2' : '1';
    this.invoiceForm.patchValue({
      external_legal_name: tenant.legal_name || tenant.name || '',
      external_tax_id: tenant.tax_id ?? '',
      external_tax_id_dv: tenant.tax_id_dv ?? '',
      external_document_type: this.normalizeDocumentType(tenant.document_type),
      external_person_type: personType,
      external_tax_regime_code: tenant.tax_regime_code || '48',
      external_email: tenant.email ?? '',
      external_phone: tenant.phone ?? '',
      external_address_line: tenant.address?.line ?? '',
      external_city: tenant.address?.city ?? '',
      external_department_code: tenant.address?.department_code || '11',
    });
  }

  /**
   * `document_type` llega de la base como codigo DIAN ('31') o como etiqueta
   * ('NIT', 'CC'). El selector del formulario trabaja con codigos, asi que una
   * etiqueta cruda dejaba el campo en blanco y el operador creia que el dato
   * no existia.
   */
  private normalizeDocumentType(raw: string | null | undefined): string {
    const value = (raw ?? '').trim().toUpperCase();
    if (!value) return '31';
    const byLabel: Record<string, string> = {
      NIT: '31',
      CC: '13',
      CE: '22',
      PASAPORTE: '41',
      PA: '41',
    };
    if (byLabel[value]) return byLabel[value];
    return this.documentTypeOptions.some((o) => String(o.value) === value)
      ? value
      : '31';
  }

  private resetAcquirerFiscalFields(): void {
    this.invoiceForm.patchValue({
      external_legal_name: '',
      external_tax_id: '',
      external_tax_id_dv: '',
      external_document_type: '31',
      external_person_type: '1',
      external_tax_regime_code: '48',
      external_email: '',
      external_phone: '',
      external_address_line: '',
      external_city: '',
      external_department_code: '11',
    });
  }

  // ── Líneas ───────────────────────────────────────────────────────
  updateNewLine(patch: Partial<NewLineDraft>): void {
    this.newLine.update((line) => ({ ...line, ...patch }));
  }

  openLineModal(): void {
    this.newLine.set(this.emptyLineDraft());
    this.showLineModal.set(true);
  }

  private buildLineGroup(draft: Partial<NewLineDraft>, taxes: LineTaxSelection[]): FormGroup {
    return this.fb.group({
      row_uid: [`row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`],
      description: [draft.description ?? '', Validators.required],
      quantity: [
        draft.quantity ?? 1,
        [Validators.required, Validators.min(0.0001)],
      ],
      unit_price: [draft.unit_price ?? 0, [Validators.required, Validators.min(0)]],
      unit_code: [draft.unit_code || DEFAULT_UNIT_CODE],
      discount_amount: [draft.discount_amount ?? 0, Validators.min(0)],
      taxes: [taxes],
      account_code: [null as string | null],
      // Inerte en una superficie sólo-estándar; ver `lineasRowPaths`.
      aiu_field: [''],
    });
  }

  confirmLine(): void {
    const line = this.newLine();
    if (!line.description?.trim() || line.quantity <= 0 || line.unit_price < 0) {
      this.toast.error('Revisa los datos de la línea: descripción, cantidad > 0 y precio ≥ 0.');
      return;
    }

    const selected = PLATFORM_TAX_CATALOG.find((t) => t.id === line.tax_rate_id);
    const taxes: LineTaxSelection[] =
      selected && selected.rate > 0
        ? [
            {
              tax_rate_id: selected.id,
              rate: selected.rate,
              tax_type: selected.tax_type,
              name: selected.name,
              is_inclusive: line.is_inclusive,
            },
          ]
        : [];

    this.itemsArray.push(this.buildLineGroup(line, taxes));
    this.showLineModal.set(false);
  }

  /** Línea en blanco, para quien prefiere teclear directo en la rejilla. */
  addBlankLine(): void {
    this.itemsArray.push(this.buildLineGroup({}, []));
  }

  removeLine(index: number): void {
    this.itemsArray.removeAt(index);
  }

  // ── Retenciones ──────────────────────────────────────────────────
  addWithholding(): void {
    this.withholdingsArray.push(
      this.fb.group({
        concept_id: [null as number | null, Validators.required],
        role: ['practiced', Validators.required],
        rate: [
          0,
          [Validators.required, Validators.min(0), Validators.max(100)],
        ],
        base: [Math.round(this.totals().taxableBase * 100) / 100, Validators.min(0)],
      }),
    );
  }

  removeWithholding(index: number): void {
    this.withholdingsArray.removeAt(index);
  }

  /**
   * Al elegir concepto se propone su tarifa de catálogo. Se PROPONE, no se
   * impone: la tarifa efectiva puede diferir por acuerdo o por base especial,
   * y el operador debe poder corregirla.
   */
  onWithholdingConceptChange(index: number): void {
    const row = this.withholdingControls()[index];
    if (!row) return;
    const conceptId = Number(row.get('concept_id')?.value);
    const concept = this.withholdingConcepts().find((c) => c.id === conceptId);
    if (concept?.rate != null) {
      row.get('rate')?.setValue(Number((concept.rate * 100).toFixed(4)));
    }
  }

  // ── Contabilidad ─────────────────────────────────────────────────

  /** Aplica la cuenta de la primera línea a todas las demás. */
  applyAccountToAllLines(): void {
    const rows = this.itemControls();
    const first = rows[0]?.get('account_code')?.value ?? null;
    for (const row of rows.slice(1)) {
      row.get('account_code')?.setValue(first);
    }
    this.toast.success('Cuenta de ingreso aplicada a todas las líneas.');
  }

  // ── Perfiles ────────────────────────────────────────────────────

  /**
   * Sólo perfiles de operación estándar: es lo único que esta consola emite.
   */
  readonly profilesForOperationType = computed(() =>
    this.store
      .profiles()
      .filter(
        (p) =>
          p.operation_type ===
          PlatformInvoiceCreateComponent.OPERATION_TYPE_STANDARD,
      ),
  );

  /**
   * El listado de perfiles (`GET /profiles`) responde con `PROFILE_SELECT`, que
   * NO incluye `current_config`: ese snapshot vive en la version vigente y solo
   * lo resuelve el detalle (`GET /profiles/:id` -> `PlatformInvoiceProfileDetail`).
   * Por eso el perfil se aplica en dos tiempos: `profile_id` de inmediato desde
   * la fila del listado, y el resto del snapshot cuando llega el detalle.
   */
  applyProfile(profileId: number): void {
    const p = this.store.profiles().find((x) => x.id === profileId);
    if (!p) return;

    this.invoiceForm.patchValue({ profile_id: p.id });

    this.fiscal
      .getProfile(p.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          const cfg = detail.current_config as Record<string, any> | null;
          if (cfg) this.applyProfileConfig(cfg);
          this.toast.success(`Perfil «${p.name}» aplicado correctamente.`);
        },
        error: () => {
          this.toast.error(
            `No se pudo cargar la configuracion del perfil «${p.name}».`,
            'Error',
          );
        },
      });
  }

  /**
   * Vuelca la configuración del perfil sobre el formulario de la factura.
   *
   * El perfil guarda la config ANIDADA (`dian.*`, `general.*`, `currency.*`,
   * `withholdings[]`, `model_lines[]`) — es la misma forma que arma
   * `buildConfig()` en el editor. Este método leía `cfg['resolution_id']`,
   * `cfg['payment_form']` y `cfg['notes']` a nivel RAÍZ, claves que la config
   * no tiene nunca. El resultado era una aplicación de perfil silenciosamente
   * vacía: el toast decía «Perfil aplicado correctamente» y no se movía ni un
   * campo, incluida la resolución DIAN, que es justamente lo que se fija en el
   * perfil para no tener que elegirla en cada emisión.
   */
  private applyProfileConfig(cfg: Record<string, any>): void {
    const dian = (cfg['dian'] ?? {}) as Record<string, any>;
    const general = (cfg['general'] ?? {}) as Record<string, any>;
    const currency = (cfg['currency'] ?? {}) as Record<string, any>;

    const patch: Record<string, unknown> = {};
    if (dian['resolution_id']) patch['resolution_id'] = dian['resolution_id'];
    if (dian['payment_method_code']) patch['payment_form'] = dian['payment_method_code'];
    if (dian['payment_means_code']) patch['payment_means_code'] = dian['payment_means_code'];

    // Las notas del documento salen de `dian.header_notes` (arreglo, tal cual
    // van al XML) y, si no hay, de la descripción libre del perfil.
    const headerNotes = Array.isArray(dian['header_notes']) ? dian['header_notes'] : [];
    const notes = headerNotes.filter((n: unknown) => !!String(n ?? '').trim()).join('\n')
      || String(general['description'] ?? '').trim();
    if (notes) patch['notes'] = notes;

    if (currency['declare_foreign'] && currency['code']) {
      patch['declare_foreign'] = true;
      patch['foreign_currency_code'] = currency['code'];
    }

    if (Object.keys(patch).length > 0) this.invoiceForm.patchValue(patch);

    // `taxes` y `withholdings` viajan como `{ rules: [...] }` — es la forma
    // canónica de `invoice-profile-config.contract`. Se acepta también el
    // arreglo suelto por snapshots viejos.
    this.applyProfileWithholdings(this.configRules(cfg['withholdings']));
    this.applyProfileModelLines(cfg['model_lines'], this.configRules(cfg['taxes']));
  }

  private configRules(raw: unknown): Record<string, any>[] {
    if (Array.isArray(raw)) return raw as Record<string, any>[];
    const nested = (raw as Record<string, any> | null)?.['rules'];
    return Array.isArray(nested) ? (nested as Record<string, any>[]) : [];
  }

  /**
   * Retenciones del perfil. Se reemplaza el arreglo entero en vez de sumar:
   * aplicar dos perfiles seguidos duplicaba cada concepto.
   */
  private applyProfileWithholdings(raw: unknown): void {
    if (!Array.isArray(raw) || raw.length === 0) return;
    this.withholdingsArray.clear();
    for (const w of raw as Record<string, any>[]) {
      const conceptId = Number(w['concept_id']);
      if (!Number.isFinite(conceptId) || conceptId <= 0) continue;
      this.withholdingsArray.push(
        this.fb.group({
          concept_id: [conceptId, Validators.required],
          role: [String(w['role'] ?? 'practiced'), Validators.required],
          rate: [
            Number(w['rate']) || 0,
            [Validators.required, Validators.min(0), Validators.max(100)],
          ],
          base: [
            Math.round(this.totals().taxableBase * 100) / 100,
            Validators.min(0),
          ],
        }),
      );
    }
    this.sectionExpanded.update((s) => ({ ...s, retenciones: true }));
  }

  /**
   * Líneas modelo del perfil. Sólo siembran una factura VACÍA: si el operador
   * ya cargó líneas, aplicar un perfil no puede borrárselas.
   *
   * Las tarifas del perfil vienen en `taxes[]` como porcentaje en texto
   * ('19.00'); se resuelven contra el catálogo para conservar el nombre y el
   * `tax_type` que después arman el desglose y el total de impuestos.
   */
  private applyProfileModelLines(rawLines: unknown, rawTaxes: unknown): void {
    if (!Array.isArray(rawLines) || rawLines.length === 0) return;
    if (this.itemsArray.length > 0) return;

    const taxes: LineTaxSelection[] = (Array.isArray(rawTaxes) ? rawTaxes : [])
      .filter((t: any) => t?.taxable !== false)
      .map((t: any) => {
        const rate = Number(t?.rate) || 0;
        // `tax_code` es el código de tributo del anexo (13.2.2): '01' IVA,
        // '04' INC. Se busca primero por código+tarifa y sólo se cae a la
        // tarifa sola cuando el perfil no lo trae, porque dos tributos pueden
        // compartir porcentaje y quedarían intercambiados en el XML.
        const type = t?.tax_code === '04' ? 'INC' : t?.tax_code === '01' ? 'IVA' : null;
        const catalog =
          (type && this.availableTaxes.find((c) => c.tax_type === type && c.rate === rate)) ||
          this.availableTaxes.find((c) => c.rate === rate);
        return {
          tax_rate_id: catalog?.id ?? 0,
          name: catalog?.name ?? `Impuesto ${rate}%`,
          rate,
          tax_type: catalog?.tax_type ?? 'IVA',
          is_inclusive: false,
        } as LineTaxSelection;
      })
      .filter((t) => t.rate > 0);

    for (const l of rawLines as Record<string, any>[]) {
      this.itemsArray.push(
        this.buildLineGroup(
          {
            description: String(l['description'] ?? ''),
            quantity: Number(l['quantity']) || 1,
            unit_price: Number(l['unit_price']) || 0,
            unit_code: String(l['unit_code'] || DEFAULT_UNIT_CODE),
            discount_amount: 0,
          },
          taxes,
        ),
      );
    }
    this.sectionExpanded.update((s) => ({ ...s, lineas: true }));
  }

  clearProfile(): void {
    this.invoiceForm.patchValue({ profile_id: null });
  }

  // ── Previsualizar & Emitir ──────────────────────────────────────
  readonly printPreviewOpen = signal(false);
  readonly printPreviewLoading = signal(false);
  readonly printPreviewResult = signal<any | null>(null);
  readonly printPreviewError = signal('');
  readonly printPreviewSrcdoc = computed(() => this.printPreviewResult()?.html || '');

  /**
   * Payload de la MUESTRA. No es el de emisión.
   *
   * El endpoint de previsualización valida `PreviewProfileDto` bajo
   * `forbidNonWhitelisted: true`: mandarle el DTO de la factura devolvía un
   * 400 en TODAS las previsualizaciones, y el modal lo pintaba como «no se
   * pudo generar» sin decir por qué.
   *
   * `bucket: 'costo'` es lo correcto para una factura estándar — el servicio lo
   * traduce a `aiu_component: null`, que es exactamente «esta línea no hace
   * parte de una base AIU».
   */
  private buildPreviewPayload(): PreviewPlatformProfilePayload {
    const val = this.rawValue();
    const items = (val['items'] || []) as any[];

    const payload: PreviewPlatformProfilePayload = {
      issue_date: val['issue_date'] || undefined,
      lines: items.map((i) => ({
        bucket: 'costo',
        description: i.description || undefined,
        quantity: Number(i.quantity) || 1,
        unit_price: Number(i.unit_price) || 0,
        discount_amount: Number(i.discount_amount) || 0,
        unit_code: i.unit_code || DEFAULT_UNIT_CODE,
      })),
    };

    if (this.acquirerMode() === 'external' && val['external_legal_name']?.trim()) {
      payload.customer = {
        legal_name: val['external_legal_name'].trim(),
        document_number: val['external_tax_id']?.trim() || undefined,
        document_type: val['external_document_type'] || undefined,
      };
    } else {
      const tenant = val['customer_tenant'] as PlatformAcquirer | null;
      if (tenant) {
        payload.customer = {
          legal_name: tenant.legal_name || tenant.name || undefined,
          document_number: tenant.tax_id || undefined,
          document_type: '31',
        };
      }
    }

    return payload;
  }

  openPrintPreview(): void {
    const profileId =
      this.invoiceForm.value.profile_id ??
      this.store.profiles().find((p) => p.is_default)?.id ??
      this.profilesForOperationType()[0]?.id ??
      null;

    if (!profileId) {
      this.printPreviewError.set(
        'No hay ningún perfil de facturación estándar configurado. Crea uno para poder previsualizar el documento.',
      );
      this.printPreviewResult.set(null);
      this.printPreviewOpen.set(true);
      return;
    }

    this.printPreviewLoading.set(true);
    this.printPreviewOpen.set(true);
    this.printPreviewError.set('');

    this.store
      .previewProfile(profileId, this.buildPreviewPayload())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.printPreviewResult.set(res);
          this.printPreviewLoading.set(false);
        },
        error: (error: unknown) => {
          this.printPreviewLoading.set(false);
          this.printPreviewError.set(this.describeError(error, 'previsualizar'));
        },
      });
  }

  closePrintPreview(open: boolean): void {
    this.printPreviewOpen.set(open);
    if (!open) {
      this.printPreviewResult.set(null);
      this.printPreviewError.set('');
    }
  }

  private describeError(error: unknown, action: string): string {
    if (error instanceof HttpErrorResponse) {
      const body = error.error;
      const message = body?.message ?? body?.error ?? error.message;
      if (Array.isArray(message)) return message.join(' · ');
      if (typeof message === 'string' && message.trim()) return message;
    }
    if (error instanceof Error && error.message) return error.message;
    return `No se pudo ${action} el documento.`;
  }

  buildPayload(): any | null {
    const val = this.rawValue();

    if (!val['items'] || val['items'].length === 0) {
      this.toast.error('Debes agregar al menos una línea a la factura.');
      return null;
    }

    let customerPayload: any;
    if (this.acquirerMode() === 'external') {
      if (!val['external_legal_name']?.trim() || !val['external_tax_id']?.trim()) {
        this.toast.error('Completa el nombre o razón social y el NIT/documento del cliente externo.');
        return null;
      }
      const personType = val['external_person_type'] || '1';
      customerPayload = {
        kind: 'external',
        legal_name: val['external_legal_name'].trim(),
        tax_id: val['external_tax_id'].trim(),
        tax_id_dv: val['external_tax_id_dv'] || undefined,
        document_type: val['external_document_type'] || '31',
        person_type: personType,
        tax_regime_code: val['external_tax_regime_code'] || '48',
        // La responsabilidad fiscal se deriva del tipo de persona en vez de
        // mandar siempre `R-99-PN` («no responsable», persona natural), que
        // declaraba mal a toda persona jurídica.
        fiscal_responsibilities: [personType === '1' ? 'O-13' : 'R-99-PN'],
        email: val['external_email']?.trim() || undefined,
        phone: val['external_phone']?.trim() || undefined,
        address: {
          line: val['external_address_line']?.trim() || undefined,
          city: val['external_city']?.trim() || undefined,
          department_code: val['external_department_code']?.trim() || undefined,
        },
      };
    } else {
      const tenant = val['customer_tenant'] as PlatformAcquirer;
      if (!tenant) {
        this.toast.error('Selecciona una tienda, usuario u organización como destinatario.');
        return null;
      }
      // Se manda el tenant_id Y los datos fiscales que quedaron en pantalla.
      // El backend resuelve la ficha por `tenant_id` y aplica encima lo que
      // venga en estos campos, que es lo que permite emitirle a una tienda a
      // la que le falta el NIT o el DV en la base sin tener que editarle la
      // ficha primero. Si un campo va vacío no se envía: `undefined` significa
      // «no lo toques», no «bórralo».
      const trimmed = (key: string): string | undefined => {
        const raw = String(val[key] ?? '').trim();
        return raw ? raw : undefined;
      };
      const addressLine = trimmed('external_address_line');
      const addressCity = trimmed('external_city');
      const addressDepartment = trimmed('external_department_code');
      customerPayload = {
        kind: tenant.kind,
        tenant_id: tenant.tenant_id,
        legal_name: trimmed('external_legal_name'),
        tax_id: trimmed('external_tax_id'),
        tax_id_dv: trimmed('external_tax_id_dv'),
        // El tipo de documento tiene que viajar: la guarda de DV del backend
        // sólo exige digito de verificacion cuando el documento es NIT ('31'),
        // asi que sin este campo una tienda con cedula quedaba imposible de
        // facturar. Va siempre con el valor que se ve en pantalla, que es el
        // que `onTenantPicked` normalizo desde la ficha.
        document_type: trimmed('external_document_type'),
        person_type: val['external_person_type'] === '2' ? '2' : '1',
        tax_regime_code: trimmed('external_tax_regime_code'),
        email: trimmed('external_email'),
        phone: trimmed('external_phone'),
        address:
          addressLine || addressCity || addressDepartment
            ? {
                line: addressLine,
                city: addressCity,
                department_code: addressDepartment,
              }
            : undefined,
      };
    }

    const items = (val['items'] as any[]).map((i) => {
      const financials = this.lineFinancials(i);
      return {
        description: i.description,
        quantity: +i.quantity,
        unit_price: +i.unit_price,
        unit_code: i.unit_code || DEFAULT_UNIT_CODE,
        discount_amount: +i.discount_amount || 0,
        account_code: i.account_code?.trim() || undefined,
        // ÚNICO punto de conversión porcentaje → fracción 0–1, que es lo que
        // valida `MvpV1InvoiceLineTaxDto` (`@Min(0) @Max(1)`).
        taxes: ((i.taxes || []) as LineTaxSelection[]).map((t, taxIndex) => ({
          tax_type: (t.tax_type || 'IVA').toUpperCase(),
          rate: (Number(t.rate) || 0) / 100,
          is_inclusive: Boolean(t.is_inclusive),
          taxable_amount: Math.round(financials.base * 100) / 100,
          tax_amount:
            Math.round((financials.taxes[taxIndex]?.amount ?? 0) * 100) / 100,
        })),
      };
    });

    const withholdings = (val['withholdings'] as any[])
      .filter((w) => w?.concept_id)
      .map((w, index) => ({
        role: w.role || 'practiced',
        concept_id: Number(w.concept_id),
        base_amount: Math.round((Number(w.base) || 0) * 100) / 100,
        rate: (Number(w.rate) || 0) / 100,
        amount: Math.round((this.withholdingAmounts()[index] ?? 0) * 100) / 100,
      }));

    const dto: any = {
      profile_id: val['profile_id'] || undefined,
      resolution_id: val['resolution_id'] || undefined,
      customer: customerPayload,
      items,
      operation_type: PlatformInvoiceCreateComponent.OPERATION_TYPE_STANDARD,
      payment_form: val['payment_form'] || '1',
      payment_means_code: val['payment_means_code'] || '10',
      issue_date: val['issue_date'] || undefined,
      notes: val['notes']?.trim() || undefined,
      counterpart_account_code: val['counterpart_account_code']?.trim() || undefined,
    };

    // `due_date` sólo viaja si de verdad hay una fecha: la cadena vacía falla
    // `@IsISO8601()` y devolvía un 400 en toda factura a crédito.
    if (val['payment_form'] === '2' && val['due_date']) {
      dto.due_date = val['due_date'];
    }

    if (withholdings.length > 0) {
      dto.withholdings = withholdings;
    }

    if (val['declare_foreign'] && val['foreign_currency_code']) {
      dto.currency = {
        iso_4217: val['foreign_currency_code'],
        exchange_rate: val['exchange_rate'] ? Number(val['exchange_rate']) : undefined,
        exchange_rate_date: val['exchange_rate_date'] || undefined,
      };
    }

    if (val['save_as_profile_enabled'] && val['save_as_profile_name']?.trim()) {
      dto.save_as_profile = {
        name: val['save_as_profile_name'].trim(),
        is_default: false,
      };
    }

    return dto;
  }

  async submit(): Promise<void> {
    // Antes se emitía sin mirar la validez: el selector de resolución era
    // `Validators.required` y aun así se podía disparar el POST sin ninguna.
    this.invoiceForm.markAllAsTouched();
    if (this.invoiceForm.invalid) {
      this.errorMessage.set(
        'Revisa los campos marcados: hay datos obligatorios sin completar.',
      );
      this.toast.error('El formulario tiene campos obligatorios sin completar.');
      return;
    }

    const dto = this.buildPayload();
    if (!dto) return;

    this.submitting.set(true);
    this.errorMessage.set('');

    const url = `${environment.apiUrl}/superadmin/subscriptions/fiscal/sales-invoices`;

    try {
      const res = await firstValueFrom(
        this.http.post<{
          success: boolean;
          data: { invoice_id: number; fiscal_number: string };
        }>(url, dto),
      );
      if (res.success && res.data?.invoice_id) {
        this.toast.success(
          `Factura ${res.data.fiscal_number || ''} emitida exitosamente. Redirigiendo al detalle...`,
        );
        // `invoice_id` es un `fiscal_transmissions.id`, NO un
        // `subscription_invoices.id`: la ruta `invoices/:id` resuelve la
        // secuencia de suscripciones y mostraba el documento equivocado.
        this.router.navigate([
          '/super-admin/fiscal/invoicing/platform-invoices',
          res.data.invoice_id,
        ]);
      } else {
        this.errorMessage.set('La API no devolvió la confirmación esperada.');
      }
    } catch (error: unknown) {
      const msg = this.describeError(error, 'emitir');
      this.errorMessage.set(msg);
      this.toast.error(msg);
    } finally {
      this.submitting.set(false);
    }
  }

  onCancel(): void {
    this.router.navigate(['/super-admin/fiscal/invoicing/invoices']);
  }
}
