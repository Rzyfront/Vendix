import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs/operators';

import {
  AlertBannerComponent,
  InputComponent,
  SelectorComponent,
  StickyHeaderActionButton,
} from '../../../../../../../shared/components/index';
import type { SelectorOption } from '../../../../../../../shared/components/selector/selector.component';
import {
  AIU_LEGAL_FLOOR_PERCENT_SCALED,
  CONFIG_LIMITS,
  validateInvoiceProfileConfig,
  normalizeInvoiceProfileConfig,
  blockingIssues,
  isBlockingIssue,
  formatPercentScaled,
} from '../../../../../../../core/utils/invoice-profile-config.contract';
import type { ProfileConfigIssue, AiuTaxableBasis, AiuComponentsBasis, AccountingModel } from '../../../../../../../core/utils/invoice-profile-config.contract';
import { ModuleShellActionsService } from '../../../../../../../shared/components/module-tabs-shell/module-shell-actions.service';
import { PlatformInvoicingStore } from '../../platform-invoicing.store';

/**
 * Etiquetas legibles por código de tipo de operación (`10`, `09`, `11`, `12`).
 *
 * Mismo shape que el riel tienda (`INVOICE_PROFILE_OPERATION_LABELS`) pero
 * declarado localmente porque ese vive en `store/invoicing/interfaces/` y
 * moverlo al `core/utils/` requiere un commit bisectable que ya no cabe en
 * este paso. La duplicación es deliberada y se justifica por scope:
 * plataforma solo emite `10` y `09` en producción hoy.
 */
const PLATFORM_OPERATION_LABELS: Readonly<Record<string, string>> = {
  '10': 'Estándar',
  '09': 'AIU',
  '11': 'Mandato',
  '12': 'Consorcio',
};
import { FiscalBillingAdminService } from '../../../../subscriptions/services/fiscal-billing-admin.service';
import type { PlatformInvoiceProfileDetail } from '../../../../subscriptions/interfaces/fiscal-billing.interface';
import { PlatformProfilePreviewPanelComponent } from '../../components/platform-profile-preview-panel/platform-profile-preview-panel.component';
import { PlatformProfileVersionsPanelComponent } from '../../components/platform-profile-versions-panel/platform-profile-versions-panel.component';
import { PlatformSectionWrapperComponent } from '../../components/platform-section-wrapper/platform-section-wrapper.component';
import {
  InvoiceSectionAiuComponent,
  InvoiceSectionDocumentoComponent,
  InvoiceSectionLineasComponent,
  InvoiceSectionImpuestosComponent,
  InvoiceSectionRetencionesComponent,
  InvoiceSectionDivisaComponent,
  InvoiceSectionFormatoComponent,
  InvoiceSectionNotasComponent,
} from '../../../../../../../shared/components/invoice-sections/index';
import type {
  AiuSectionPaths,
  DocumentoSectionPaths,
  DocumentoSectionErrors,
  DocumentoSectionNotice,
  LineasRowPaths,
  LineasRowErrors,
  RetencionesRowErrors,
  DivisaSectionPaths,
  FormatoSectionPaths,
  NotasSectionPaths,
} from '../../../../../../../shared/components/invoice-sections/index';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';

type SectionId =
  | 'documento' | 'aiu' | 'lineas' | 'impuestos'
  | 'retenciones' | 'divisa' | 'contabilidad'
  | 'formato' | 'notas_internas'
  | 'previsualizacion' | 'historial';

/**
 * Editor de perfil de facturación del riel plataforma.
 *
 * Mirror del editor de tienda adaptado al contexto de plataforma. Usa las secciones
 * compartidas con `context='platform'`, consume `PlatformInvoicingStore`, y actualiza
 * con PATCH (no PUT, que no existe).
 *
 * No puede importar `InvoiceFormSectionComponent` ni `invoice-dian-catalogs` desde
 * `store/invoicing/`: eso está fuera de su allow-list y moverlo requiere un commit
 * bisectable propio. Usa `PlatformSectionWrapperComponent` local y los catálogos en línea.
 */
@Component({
  selector: 'app-platform-profile-editor',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    PlatformSectionWrapperComponent,
    AlertBannerComponent,
    InputComponent,
    SelectorComponent,
    InvoiceSectionAiuComponent,
    InvoiceSectionDocumentoComponent,
    InvoiceSectionLineasComponent,
    InvoiceSectionImpuestosComponent,
    InvoiceSectionRetencionesComponent,
    InvoiceSectionDivisaComponent,
    InvoiceSectionFormatoComponent,
    InvoiceSectionNotasComponent,
    PlatformProfilePreviewPanelComponent,
    PlatformProfileVersionsPanelComponent,
  ],
  template: `
    <div class="w-full max-w-[1400px] mx-auto">
      <!--
        Sin cabecera de pagina y sin barra de acciones al pie.

        Los dos bloques repetian el titulo que ya pinta el sticky-header del
        shell y duplicaban Cancelar / Guardar: tres sitios distintos para el
        mismo par de botones. Ahora se publican UNA vez en el header del shell
        via ModuleShellActionsService (ver el effect del constructor), que es
        el unico camino posible porque el contenido de un router-outlet no se
        puede proyectar hacia el template del shell.

        OJO: nada de backticks en este comentario. Esta dentro del template
        literal del @Component, asi que un backtick lo CIERRA y el compilador
        reporta el error en la linea del @Component, no aqui.
      -->
      <div class="px-2 md:px-4 pb-6 space-y-4">
        @if (loading() && isEdit() && !hydrated()) {
          <div class="rounded-lg border border-border bg-surface-secondary px-3 py-6 text-center text-sm text-text-secondary">
            Cargando el perfil…
          </div>
        }

        <form [formGroup]="form" class="space-y-6">
          <!-- Identidad del perfil -->
          <div class="rounded-lg border border-border bg-surface-secondary p-3">
            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
              <app-input
                label="Nombre del perfil"
                formControlName="name"
                [maxlength]="120"
                [control]="form.get('name')!"
                [error]="controlError('name') ?? undefined"
                helperText="Único por organización y tipo de operación."
                size="sm"
              ></app-input>
              <!--
                La consola de plataforma emite UNA sola operación: factura de
                venta estándar, la 10. No hay selector porque no hay elección:
                ofrecer AIU, mandato o consorcio sería ofrecer perfiles que
                esta superficie nunca va a poder emitir. El control sigue en el
                formulario —el backend exige operation_type— pero fijo.
              -->
              <div class="space-y-1">
                <label class="text-xs font-medium text-text-secondary">Tipo de operación</label>
                <div
                  class="flex items-center gap-2 h-9 px-3 rounded-lg border border-border bg-surface-secondary/50"
                >
                  <span class="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[11px] font-semibold">
                    10
                  </span>
                  <span class="text-xs text-text-primary">
                    {{ operationTypeLabel() }}
                  </span>
                </div>
                <p class="text-[11px] text-text-secondary">
                  La plataforma sólo emite factura de venta estándar.
                </p>
              </div>
            </div>
          </div>

          <!-- Documento -->
          <app-platform-section-wrapper
            title="Documento"
            icon="file-text"
            [summary]="'Resolución, forma y medio de pago'"
            [errorCount]="sectionErrorCount('documento')"
            [(expanded)]="sectionExpanded()['documento']"
          >
            <vendix-invoice-section-documento
              context="platform"
              [form]="form"
              [paths]="documentoSectionPaths"
              [invoiceTypeOptions]="document_type_options"
              [paymentFormOptions]="payment_form_options"
              [paymentMeansOptions]="payment_means_options"
              [resolutionControl]="resolutionControl"
              [resolutionOptions]="resolutionOptions()"
              resolutionPlaceholder="Sin preferencia"
              resolutionHelpText="Si la organización tiene varios rangos vivos, se usa el más antiguo."
              [resolutionHint]="documentoResolutionHint()"
              [notices]="documentoNotices()"
              [errors]="documentoErrors()"
            ></vendix-invoice-section-documento>
          </app-platform-section-wrapper>

          <!-- AIU -->
          @if (isAiu()) {
            <app-platform-section-wrapper
              title="Configuración AIU"
              icon="calculator"
              [summary]="aiuSummary()"
              [errorCount]="sectionErrorCount('aiu')"
              [(expanded)]="sectionExpanded()['aiu']"
            >
              <vendix-invoice-section-aiu
                context="platform"
                [form]="form"
                [paths]="aiuSectionPaths"
                [taxRules]="taxRules"
                [issues]="issues()"
              ></vendix-invoice-section-aiu>
            </app-platform-section-wrapper>
          }

          <!-- Líneas modelo -->
          <app-platform-section-wrapper
            title="Líneas modelo"
            icon="list"
            [summary]="modelLinesSummary()"
            [errorCount]="sectionErrorCount('lineas')"
            [(expanded)]="sectionExpanded()['lineas']"
          >
            <div class="space-y-3">
              <p class="text-xs text-text-secondary">
                Las líneas con que nacerá la factura al elegir este perfil.
              </p>
              @if (modelLines.controls.length === 0) {
                <p class="text-xs text-text-secondary italic">Sin líneas modelo.</p>
              }
              <vendix-invoice-section-lineas
                context="platform"
                [rows]="modelLines.controls"
                [rowPaths]="lineasRowPaths"
                [isAiu]="isAiu()"
                [aiuComponentOptions]="component_options"
                [descriptionLimit]="line_description_limit"
                [rowErrors]="lineasRowErrors()"
                [carriesAiu]="lineCarriesAiuBound"
                [toggleAiu]="toggleLineAiuBound"
                [maxLines]="999"
                emptyStateText="Sin líneas modelo."
                (addBlankLine)="addModelLine()"
                (removeLine)="removeModelLine($event)"
              ></vendix-invoice-section-lineas>
            </div>
          </app-platform-section-wrapper>

          <!-- Impuestos (no-AIU) -->
          @if (!isAiu()) {
            <app-platform-section-wrapper
              title="Impuestos"
              icon="percent"
              [summary]="taxSummary()"
              [errorCount]="sectionErrorCount('impuestos')"
              [(expanded)]="sectionExpanded()['impuestos']"
            >
              <vendix-invoice-section-impuestos
                context="platform"
                [rows]="taxRules.controls"
                [bucketOptions]="bucket_options()"
                [taxCodeOptions]="tax_code_options"
                [rateErrors]="taxRateErrors()"
                (addRule)="addTaxRule()"
                (removeRule)="removeTaxRule($event)"
              ></vendix-invoice-section-impuestos>
            </app-platform-section-wrapper>
          }

          <!-- Retenciones -->
          <app-platform-section-wrapper
            title="Retenciones"
            icon="hand-coins"
            [summary]="withholdingsSummary()"
            [errorCount]="sectionErrorCount('retenciones')"
            [(expanded)]="sectionExpanded()['retenciones']"
          >
            <vendix-invoice-section-retenciones
              context="platform"
              [rows]="withholdingRules.controls"
              [conceptOptions]="withholding_concept_options()"
              [roleOptions]="withholding_role_options"
              [rowErrors]="retencionesRowErrors()"
              [catalogRateFor]="catalogRateForBound"
              emptyStateText="Sin retenciones."
              (addWithholding)="addWithholding()"
              (removeWithholding)="removeWithholding($event)"
            ></vendix-invoice-section-retenciones>
          </app-platform-section-wrapper>

          <!-- Divisa -->
          <app-platform-section-wrapper
            title="Divisa"
            icon="globe"
            [summary]="currencySummary()"
            [errorCount]="0"
            [(expanded)]="sectionExpanded()['divisa']"
          >
            <vendix-invoice-section-divisa
              context="platform"
              [form]="form"
              [paths]="divisaSectionPaths"
              [currencyOptions]="currency_options"
              [errors]="divisaErrors()"
            ></vendix-invoice-section-divisa>
          </app-platform-section-wrapper>

          <!-- Contabilidad -->
          <app-platform-section-wrapper
            title="Contabilidad"
            icon="book"
            [summary]="accountingSummary()"
            [errorCount]="sectionErrorCount('contabilidad')"
            [(expanded)]="sectionExpanded()['contabilidad']"
          >
            <div class="space-y-2" formGroupName="accounting">
              <p class="text-xs text-text-secondary">Vacío = se usa el mapeo de la organización.</p>
              @if (isAiu()) {
                <app-alert-banner variant="info" icon="info">
                  Las cuentas AIU se configuran en <strong>Configuración AIU</strong>.
                </app-alert-banner>
              } @else {
                <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <app-input
                    label="Ingreso · Costo reembolsable"
                    formControlName="revenue_costo"
                    placeholder="Mapeo de la organización"
                    size="sm"
                  ></app-input>
                  <app-input
                    label="Cuenta de IVA por pagar"
                    formControlName="vat_payable_account"
                    placeholder="Mapeo de la organización"
                    size="sm"
                  ></app-input>
                </div>
              }
            </div>
          </app-platform-section-wrapper>

          <!-- Formato -->
          <app-platform-section-wrapper
            title="Formato de impresión"
            icon="printer"
            [summary]="formatSummary()"
            [errorCount]="sectionErrorCount('formato')"
            [(expanded)]="sectionExpanded()['formato']"
          >
            <vendix-invoice-section-formato
              context="platform"
              [form]="form"
              [paths]="formatoSectionPaths()"
              [templateKeyLimit]="template_key_limit"
              [errors]="formatoErrors()"
            ></vendix-invoice-section-formato>
          </app-platform-section-wrapper>

          <!-- Notas internas -->
          <app-platform-section-wrapper
            title="Notas internas"
            icon="info"
            summary="No viajan al XML"
            [errorCount]="sectionErrorCount('notas_internas')"
            [(expanded)]="sectionExpanded()['notas_internas']"
          >
            <vendix-invoice-section-notas
              context="platform"
              [form]="form"
              [paths]="notasSectionPaths"
            ></vendix-invoice-section-notas>
          </app-platform-section-wrapper>
        </form>

        <!-- Previsualización e Historial (solo edición) -->
        @if (isEdit()) {
          <app-platform-section-wrapper
            title="Previsualización"
            icon="eye"
            summary="Cómo quedaría un documento con este perfil"
            [errorCount]="0"
            [(expanded)]="sectionExpanded()['previsualizacion']"
          >
            <app-platform-profile-preview-panel
              [profileId]="profileId()"
              [isAiu]="isAiu()"
            ></app-platform-profile-preview-panel>
          </app-platform-section-wrapper>

          <app-platform-section-wrapper
            title="Historial de versiones"
            icon="history"
            [summary]="'Versión vigente: v' + currentVersionNumber()"
            [errorCount]="0"
            [(expanded)]="sectionExpanded()['historial']"
          >
            <app-platform-profile-versions-panel
              [profileId]="profileId()"
              [currentVersion]="currentVersionNumber()"
            ></app-platform-profile-versions-panel>
          </app-platform-section-wrapper>
        }

        <!-- Errores de guardado -->
        @if (server_error(); as message) {
          <app-alert-banner variant="danger" icon="alert-triangle">
            {{ message }}
          </app-alert-banner>
        }

      </div>
    </div>
  `,
})
export class PlatformProfileEditorComponent {
  private readonly store = inject(PlatformInvoicingStore);
  private readonly fiscal = inject(FiscalBillingAdminService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly shellActions = inject(ModuleShellActionsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly profileId = toSignal(
    this.route.paramMap.pipe(
      map((params) => {
        const raw = params.get('id');
        if (raw === null) return null;
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : null;
      }),
    ),
    { initialValue: null as number | null },
  );

  readonly server_error = signal<string | null>(null);
  private readonly hydrated_config = signal<string | null>(null);
  readonly hydrated = computed(() => this.hydrated_config() !== null);

  readonly line_description_limit = CONFIG_LIMITS.line_description;
  readonly template_key_limit = CONFIG_LIMITS.template_key;

  readonly saving = signal(false);
  readonly loading = signal(false);

  /** Etiqueta legible de la única operación que emite la plataforma. */
  readonly operationTypeLabel = computed(
    () =>
      (PLATFORM_OPERATION_LABELS as Record<string, string>)[
        this.operationType()
      ] ?? 'Factura de venta',
  );

  readonly operation_options: SelectorOption[] = (Object.entries(PLATFORM_OPERATION_LABELS) as [string, string][]).map(
    ([value, label]) => ({ value, label }),
  );

  get resolutionControl(): FormControl<number | null> {
    return this.form.get('dian.resolution_id') as FormControl<number | null>;
  }

  readonly isEdit = computed(() => this.profileId() !== null);
  readonly isAiu = computed(() => this.operationType() === '09');

  /**
   * Sólo rangos de FACTURA DE VENTA y activos.
   *
   * Ofrecer un rango de documento soporte para un perfil de factura deja fijar
   * en el perfil una resolución que la DIAN rechaza al emitir, y el error sale
   * recién en la transmisión. Un rango inactivo tiene el mismo problema.
   */
  readonly resolutionOptions = computed<SelectorOption[]>(() =>
    this.store
      .resolutions()
      .filter((r) => r.document_type === 'sales_invoice' && r.is_active)
      .map((r) => ({
        value: r.id,
        label: `${r.prefix} · rango ${r.range_from}-${r.range_to}`,
      })),
  );

  readonly documentoResolutionHint = computed<string | null>(() =>
    this.resolutionOptions().length === 0
      ? 'No hay resoluciones de factura de venta activas. Regístralas en la pestaña Resoluciones.'
      : null,
  );

  readonly documentoNotices = computed<DocumentoSectionNotice[]>(() => []);

  readonly documentoErrors = computed<DocumentoSectionErrors>(() => ({
    resolution: this.issueFor('dian.resolution_id') ?? undefined,
    invoice_type: this.issueFor('dian.document_type') ?? undefined,
    payment_form: this.issueFor('dian.payment_method_code') ?? undefined,
    payment_means_code: this.issueFor('dian.payment_means_code') ?? undefined,
  }));

  readonly documentoSectionPaths: DocumentoSectionPaths = {
    invoice_type: 'dian.document_type',
    payment_form: 'dian.payment_method_code',
    payment_means_code: 'dian.payment_means_code',
    issue_date: null,
    due_date: null,
    notes: null,
    header_notes: 'dian.header_notes',
  };

  readonly aiuSectionPaths: AiuSectionPaths = {
    taxable_basis: 'aiu.taxable_basis',
    contract_object: 'aiu.contract_object',
    enforce_minimum_base: 'aiu.enforce_minimum_base',
    minimum_base_percent: 'aiu.minimum_base_percent',
    components_basis: 'aiu.components_basis',
    components: {
      administracion: 'aiu.administracion',
      imprevistos: 'aiu.imprevistos',
      utilidad: 'aiu.utilidad',
    },
    revenue_account: {
      administracion: 'accounting.revenue_administracion',
      imprevistos: 'accounting.revenue_imprevistos',
      utilidad: 'accounting.revenue_utilidad',
      costo: 'accounting.revenue_costo',
    },
    vat_payable_account: 'accounting.vat_payable_account',
    accounting_model: 'aiu.accounting_model',
  };

  readonly lineasRowPaths: LineasRowPaths = {
    description: 'description',
    quantity: 'quantity',
    unit_code: 'unit_code',
    unit_price: 'unit_price',
    discount_amount: null,
    aiu_field: 'bucket',
    taxes: null,
  };

  readonly bucket_options = computed<SelectorOption[]>(() => {
    const base: SelectorOption[] = [
      { value: 'administracion', label: 'Administración' },
      { value: 'imprevistos', label: 'Imprevistos' },
      { value: 'utilidad', label: 'Utilidad' },
    ];
    return this.isAiu() ? base : [...base, { value: 'costo', label: 'Costo reembolsable' }];
  });

  readonly component_options: SelectorOption[] = [
    { value: 'administracion', label: 'Administración' },
    { value: 'imprevistos', label: 'Imprevistos' },
    { value: 'utilidad', label: 'Utilidad' },
  ];

  readonly tax_code_options: SelectorOption[] = [
    { value: '01', label: 'IVA (01)' },
    { value: '04', label: 'INC (04)' },
    { value: '03', label: 'ICA (03)' },
    { value: '06', label: 'ReteFuente (06)' },
    { value: '07', label: 'ReteICA (07)' },
    { value: '05', label: 'ReteIVA (05)' },
  ];

  readonly withholding_concept_options = computed<SelectorOption[]>(() => [
    { value: 'RCO01', label: 'RCO01 · Rentas de trabajo', description: '10.00 %' },
    { value: 'RCE01', label: 'RCE01 · Rentas de capitalización', description: '4.00 %' },
  ]);

  readonly withholding_role_options: SelectorOption[] = [
    { value: 'practiced', label: 'La organización retiene' },
    { value: 'suffered', label: 'A la organización le retienen' },
  ];

  readonly catalogRateForBound = (_index: number): string | null => null;

  // Catálogos DIAN en línea (originalmente de invoice-dian-catalogs.ts)
  readonly document_type_options: SelectorOption[] = [
    { value: 'sales_invoice', label: 'Factura de venta' },
    { value: 'export_invoice', label: 'Factura de exportación' },
    { value: 'support_document', label: 'Documento soporte' },
    { value: 'credit_note', label: 'Nota crédito' },
    { value: 'debit_note', label: 'Nota débito' },
  ];

  readonly payment_form_options: SelectorOption[] = [
    { value: '1', label: '1 — Contado' },
    { value: '2', label: '2 — Crédito' },
    { value: '3', label: '3 — Otro' },
  ];

  readonly payment_means_options: SelectorOption[] = [
    { value: '10', label: '10 — Efectivo' },
    { value: '41', label: '41 — Tarjeta Débito' },
    { value: '42', label: '42 — Tarjeta Crédito' },
    { value: '47', label: '47 — Débito ACH' },
    { value: '48', label: '48 — Débito automático' },
    { value: 'ZZ', label: 'ZZ — Otro' },
  ];

  readonly currency_options: SelectorOption[] = [
    { value: 'COP', label: 'COP — Peso colombiano' },
    { value: 'USD', label: 'USD — Dólar estadounidense' },
    { value: 'EUR', label: 'EUR — Euro' },
  ];

  readonly currency_options2 = [
    { value: 'COP', label: 'COP — Peso colombiano' },
    { value: 'USD', label: 'USD — Dólar estadounidense' },
    { value: 'EUR', label: 'EUR — Euro' },
  ];

  readonly divisaSectionPaths: DivisaSectionPaths = {
    declare_foreign: 'currency.declare_foreign',
    currency_code: 'currency.code',
    exchange_rate: null,
    exchange_rate_date: null,
  };

  readonly divisaErrors = computed(() => ({}));

  readonly formatoSectionPaths = computed<FormatoSectionPaths>(() => ({
    template_id: 'format.template_id',
    template_key: null,
    show_aiu_breakdown: 'format.show_aiu_breakdown',
    display_decimals: 'format.display_decimals',
  }));

  readonly formatoErrors = computed(() => ({}));

  readonly notasSectionPaths: NotasSectionPaths = {
    description: 'general.description',
    internal_note: 'general.internal_note',
  };

  // ─── Form ────────────────────────────────────────────────────────
  readonly form: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    operation_type: [
      // La plataforma sólo emite factura de venta estándar. El default era
      // '09' (AIU), así que un perfil creado sin tocar nada nacía con una
      // operación que esta consola no puede emitir y que el creador de
      // facturas después filtraba de la lista: invisible al minuto de nacer.
      '10',
      Validators.required,
    ],
    general: this.fb.group({ description: [''], internal_note: [''] }),
    aiu: this.fb.group({
      taxable_basis: ['aiu' as AiuTaxableBasis],
      contract_object: [''],
      enforce_minimum_base: [true],
      minimum_base_percent: [formatPercentScaled(AIU_LEGAL_FLOOR_PERCENT_SCALED)],
      components_basis: ['contract' as AiuComponentsBasis],
      administracion: ['5.00'],
      imprevistos: ['2.00'],
      utilidad: ['3.00'],
      accounting_model: ['sumada' as AccountingModel],
    }),
    accounting: this.fb.group({
      revenue_administracion: [''],
      revenue_imprevistos: [''],
      revenue_utilidad: [''],
      revenue_costo: [''],
      vat_payable_account: [''],
    }),
    taxes: this.fb.array([] as FormGroup[]),
    model_lines: this.fb.array([] as FormGroup[]),
    format: this.fb.group({
      template_id: [null as number | null],
      template_key: [''],
      show_aiu_breakdown: [true],
      display_decimals: [2],
    }),
    withholdings: this.fb.array([] as FormGroup[]),
    currency: this.fb.group({ declare_foreign: [false], code: [''] }),
    dian: this.fb.group({
      document_type: ['sales_invoice'],
      resolution_id: [null as number | null],
      payment_means_code: [''],
      payment_method_code: [''],
      header_notes: this.fb.array([]),
    }),
  });

  private readonly form_value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  // ─── Sections ──────────────────────────────────────────────────
  // Each section expanded state as individual signals
  readonly sectionExpanded = signal<Record<SectionId, boolean>>({
    documento: true,
    aiu: true,
    lineas: true,
    impuestos: true,
    retenciones: false,
    divisa: false,
    contabilidad: false,
    formato: false,
    notas_internas: false,
    previsualizacion: false,
    historial: false,
  });

  // ─── Summaries ────────────────────────────────────────────────
  readonly aiuSummary = computed(() => 'Base AIU · componentes del contrato');
  readonly modelLinesSummary = computed(() => {
    this.form_value();
    const n = this.modelLines.controls.length;
    return n === 0 ? 'Sin líneas modelo' : n === 1 ? '1 línea' : n + ' líneas';
  });
  readonly taxSummary = computed(() => {
    this.form_value();
    const n = this.taxRules.controls.length;
    return n === 0 ? 'Sin reglas' : n + ' regla(s)';
  });
  readonly withholdingsSummary = computed(() => {
    this.form_value();
    const n = this.withholdingRules.controls.length;
    return n === 0 ? 'Sin retenciones' : n === 1 ? '1 retención' : n + ' retenciones';
  });
  readonly currencySummary = computed(() => {
    this.form_value();
    const decl = this.form.get('currency.declare_foreign')?.value;
    return decl ? 'Divisa extranjera' : 'Sin divisa extranjera';
  });
  readonly accountingSummary = computed(() =>
    this.isAiu() ? 'Las cuentas AIU se editan en Configuración AIU' : 'Cuentas contables',
  );
  readonly formatSummary = computed(() => 'Formato de impresión del documento');

  // ─── Issues ─────────────────────────────────────────────────
  readonly issues = computed<ProfileConfigIssue[]>(() => {
    this.form_value();
    const { config, issues: structural } = normalizeInvoiceProfileConfig(
      this.buildConfig() as any,
    );
    return [
      ...structural,
      ...validateInvoiceProfileConfig(config as any, {
        operation_type: this.operationType(),
      }),
    ];
  });

  readonly blockers = computed(() => blockingIssues(this.issues()));
  readonly warnings = computed(() => this.issues().filter((i) => !isBlockingIssue(i)));

  /**
   * Prefijo del CONTRATO que corresponde a cada sección visual.
   *
   * El identificador de la sección en pantalla y el nombre del campo que
   * emite el validador no coinciden en ningún caso salvo `aiu`: la sección
   * «documento» agrupa issues de `dian.*`, «impuestos» los de `taxes.*`,
   * «formato» los de `format.*`. Comparar el id visual contra `field` con un
   * `startsWith` directo devolvía cero para todas las secciones excepto AIU,
   * así que el contador de errores estaba apagado justo donde importaba.
   */
  private static readonly SECTION_ISSUE_PREFIXES: Record<string, string> = {
    documento: 'dian.',
    aiu: 'aiu',
    lineas: 'model_lines',
    impuestos: 'taxes.',
    retenciones: 'withholdings',
    divisa: 'currency.',
    contabilidad: 'accounting.',
    formato: 'format.',
    notas_internas: 'general.',
  };

  sectionErrorCount(section: string): number {
    const prefix =
      PlatformProfileEditorComponent.SECTION_ISSUE_PREFIXES[section];
    if (!prefix) return 0;
    return this.issues().filter((i) => i.field.startsWith(prefix)).length;
  }

  // ─── Page metadata ───────────────────────────────────────────────
  readonly saveHint = computed(() => {
    const blocked = this.blockers().length;
    if (blocked > 0) {
      return blocked === 1
        ? 'Hay 1 problema que impide guardar.'
        : 'Hay ' + blocked + ' problemas que impiden guardar.';
    }
    if (this.saving()) return 'Guardando…';
    return this.isEdit()
      ? 'Guardar crea una versión nueva.'
      : 'Al guardar, el perfil queda disponible para emitir.';
  });

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    { id: 'cancel', label: 'Cancelar', variant: 'outline', icon: 'x' },
    {
      id: 'save',
      label: this.isEdit() ? 'Guardar cambios' : 'Crear perfil',
      variant: 'primary',
      icon: 'save',
      loading: this.saving(),
      disabled: this.saving() || this.blockers().length > 0,
      title: this.saveHint(),
    },
  ]);

  // ─── Lifecycle ───────────────────────────────────────────────
  constructor() {
    // El selector de resolución del bloque «Documento» lee
    // store.resolutions(), que sólo se llena cuando alguien abre la pestaña
    // Resoluciones. Sin esta carga el desplegable salía vacío en el editor y
    // no había forma de dejarle una resolución fija al perfil: la pantalla
    // ofrecía el campo y el campo no tenía opciones.
    this.store.loadResolutions();

    // Cancelar / Guardar viven en el sticky-header del shell, no en la pagina.
    //
    // Va en un `effect` y no en un `set` de una sola vez porque los botones
    // cambian solos: `saving()` los pone en loading y `blockers()` deshabilita
    // Guardar. Publicarlos una vez dejaba un boton que nunca reflejaba el
    // estado del formulario.
    effect(() => {
      this.shellActions.set(
        this.headerActions().map((button) => ({
          ...button,
          run: () => this.onHeaderAction(button.id),
        })),
      );
    });

    // Obligatorio: sin esto los botones sobreviven al cambio de pestana y
    // disparan callbacks de un componente ya destruido.
    this.destroyRef.onDestroy(() => this.shellActions.clear());

    effect(() => {
      const id = this.profileId();
      if (id !== null) this.loadProfile(id);
    });
  }

  private loadProfile(id: number): void {
    this.loading.set(true);
    this.fiscal
      .getProfile(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (profile) => {
          this.hydrateForm(profile);
          this.loading.set(false);
        },
        error: () => {
          this.server_error.set('No se pudo cargar el perfil.');
          this.loading.set(false);
        },
      });
  }

  private hydrateForm(profile: PlatformInvoiceProfileDetail): void {
    this.form.patchValue({
      name: profile.name,
      operation_type: profile.operation_type,
    });
    const cfg = (profile as any).current_config as Record<string, unknown> | null;
    if (cfg) this.hydrateConfig(cfg);
    this.hydrated_config.set(JSON.stringify(cfg ?? {}));
  }

  private hydrateConfig(cfg: Record<string, unknown>): void {
    const dian = cfg['dian'] as Record<string, unknown> | null;
    if (dian) {
      this.form.get('dian.document_type')?.setValue(dian['document_type'] ?? 'sales_invoice');
      this.form.get('dian.resolution_id')?.setValue(dian['resolution_id'] ?? null);
      this.form.get('dian.payment_method_code')?.setValue(dian['payment_method_code'] ?? '');
      this.form.get('dian.payment_means_code')?.setValue(dian['payment_means_code'] ?? '');
    }
    const general = cfg['general'] as Record<string, unknown> | null;
    if (general) {
      this.form.get('general.description')?.setValue(general['description'] ?? '');
      this.form.get('general.internal_note')?.setValue(general['internal_note'] ?? '');
    }
    const aiu = cfg['aiu'] as Record<string, unknown> | null;
    if (aiu) {
      this.form.get('aiu.taxable_basis')?.setValue(aiu['taxable_basis'] ?? 'aiu');
      this.form.get('aiu.contract_object')?.setValue(aiu['contract_object'] ?? '');
      this.form.get('aiu.enforce_minimum_base')?.setValue(aiu['enforce_minimum_base'] ?? true);
      this.form.get('aiu.minimum_base_percent')?.setValue(
        aiu['minimum_base_percent'] ?? formatPercentScaled(AIU_LEGAL_FLOOR_PERCENT_SCALED),
      );
      this.form.get('aiu.components_basis')?.setValue(aiu['components_basis'] ?? 'contract');
      // Los tres porcentajes viven bajo `components`, no sueltos en `aiu`. Con
      // la lectura plana volvían siempre los valores por omisión y guardar
      // reescribia 5/2/3 sobre el reparto real del contrato.
      const comps = (aiu['components'] as Record<string, unknown> | null) ?? {};
      this.form.get('aiu.administracion')?.setValue(comps['administracion'] ?? '5.00');
      this.form.get('aiu.imprevistos')?.setValue(comps['imprevistos'] ?? '2.00');
      this.form.get('aiu.utilidad')?.setValue(comps['utilidad'] ?? '3.00');
      this.form.get('aiu.accounting_model')?.setValue(aiu['accounting_model'] ?? 'sumada');
    }
    const accounting = cfg['accounting'] as Record<string, unknown> | null;
    if (accounting) {
      const rev = (accounting['revenue_account_by_bucket'] as Record<string, unknown>) ?? {};
      this.form.get('accounting.revenue_administracion')?.setValue(rev['administracion'] ?? '');
      this.form.get('accounting.revenue_imprevistos')?.setValue(rev['imprevistos'] ?? '');
      this.form.get('accounting.revenue_utilidad')?.setValue(rev['utilidad'] ?? '');
      this.form.get('accounting.revenue_costo')?.setValue(rev['costo'] ?? '');
      this.form.get('accounting.vat_payable_account')?.setValue(accounting['vat_payable_account'] ?? '');
    }
    const format = cfg['format'] as Record<string, unknown> | null;
    if (format) {
      this.form.get('format.template_id')?.setValue(format['template_id'] ?? null);
      this.form.get('format.template_key')?.setValue(format['template_key'] ?? '');
      this.form.get('format.show_aiu_breakdown')?.setValue(format['show_aiu_breakdown'] ?? true);
      this.form.get('format.display_decimals')?.setValue(format['display_decimals'] ?? 2);
    }
    const currency = cfg['currency'] as Record<string, unknown> | null;
    if (currency) {
      this.form.get('currency.declare_foreign')?.setValue(currency['declare_foreign'] ?? false);
      this.form.get('currency.code')?.setValue(currency['code'] ?? '');
    }
    const modelLines = cfg['model_lines'] as Record<string, unknown>[] | null;
    if (modelLines?.length) modelLines.forEach((l) => this.addModelLine(l));

    // `taxes` y `withholdings` se guardan como { rules: [...] }, no como
    // arreglo suelto: es la forma que impone `invoice-profile-config.contract`
    // y la que devuelve el backend después de normalizar. Esto leía
    // `cfg['taxes']` como arreglo, y `.length` sobre un objeto es undefined:
    // el bucle no corría NUNCA. Reabrir un perfil mostraba cero tarifas y cero
    // retenciones aunque las tuviera, y al guardar se escribía `rules: []`
    // encima — cada edición borraba la matriz de impuestos del perfil sin
    // decir nada. Se aceptan las dos formas porque hay snapshots viejos con el
    // arreglo suelto.
    const rulesOf = (raw: unknown): Record<string, unknown>[] => {
      if (Array.isArray(raw)) return raw as Record<string, unknown>[];
      const nested = (raw as Record<string, unknown> | null)?.['rules'];
      return Array.isArray(nested) ? (nested as Record<string, unknown>[]) : [];
    };
    rulesOf(cfg['taxes']).forEach((t) => this.addTaxRule(t));
    rulesOf(cfg['withholdings']).forEach((w) => this.addWithholding(w));
  }

  // ─── Form helpers ─────────────────────────────────────────────
  get modelLines(): FormArray { return this.form.get('model_lines') as FormArray; }
  get taxRules(): FormArray { return this.form.get('taxes') as FormArray; }
  get withholdingRules(): FormArray { return this.form.get('withholdings') as FormArray; }

  operationType(): string {
    return this.form.get('operation_type')?.value ?? '09';
  }

  currentVersionNumber(): number {
    return (this.store.selectedProfile() as any)?.current_version ?? 1;
  }

  // ─── Validation ──────────────────────────────────────────────
  issueFor(path: string): string | null {
    return this.issues().find((i) => i.field === path)?.message ?? null;
  }

  controlError(path: string): string | null {
    const ctrl = this.form.get(path);
    if (!ctrl || !ctrl.errors) return null;
    if (ctrl.errors['required']) return 'Este campo es obligatorio.';
    if (ctrl.errors['maxlength']) return 'Excede la longitud máxima.';
    return null;
  }

  // ─── Array helpers ──────────────────────────────────────────
  addModelLine(data?: Record<string, unknown>): void {
    this.modelLines.push(this.fb.group({
      description: [data?.['description'] ?? ''],
      quantity: [data?.['quantity'] ?? 1],
      unit_code: [data?.['unit_code'] ?? '94'],
      unit_price: [data?.['unit_price'] ?? 0],
      bucket: [data?.['bucket'] ?? 'administracion'],
    }));
  }

  removeModelLine(index: number): void { this.modelLines.removeAt(index); }

  addTaxRule(data?: Record<string, unknown>): void {
    this.taxRules.push(this.fb.group({
      tax_code: [data?.['tax_code'] ?? '01'],
      taxable: [data?.['taxable'] ?? true],
      rate: [data?.['rate'] ?? ''],
      bucket: [data?.['bucket'] ?? 'administracion'],
    }));
  }

  removeTaxRule(index: number): void { this.taxRules.removeAt(index); }

  addWithholding(data?: Record<string, unknown>): void {
    this.withholdingRules.push(this.fb.group({
      concept_id: [data?.['concept_id'] ?? ''],
      role: [data?.['role'] ?? 'practiced'],
      rate: [data?.['rate'] ?? ''],
    }));
  }

  removeWithholding(index: number): void { this.withholdingRules.removeAt(index); }

  readonly lineCarriesAiuBound = (_row: AbstractControl, _index: number): boolean => false;
  readonly toggleLineAiuBound = (_row: AbstractControl, _index: number, _on: boolean): void => {};

  readonly lineasRowErrors = computed<LineasRowErrors[]>(() => []);
  readonly taxRateErrors = computed<readonly string[]>(() => []);
  readonly retencionesRowErrors = computed<RetencionesRowErrors[]>(() => []);

  // ─── Build config ─────────────────────────────────────────────
  private buildConfig(): Record<string, unknown> {
    const v = this.form.value;
    return {
      config_version: 1,
      general: {
        description: v.general?.description ?? null,
        internal_note: v.general?.internal_note ?? null,
      },
      // Forma canónica del contrato: `regime` obligatorio y los tres
      // porcentajes bajo `components`. Sueltos, el normalizador del backend los
      // descarta por clave desconocida y el perfil queda con el reparto por
      // omisión. `regime` se deriva de la base gravable declarada — es la
      // misma equivalencia de `aiuRegimeForTaxableBasis` del contrato.
      aiu: this.isAiu() ? {
        regime:
          (v.aiu?.taxable_basis ?? 'aiu') === 'utilidad'
            ? 'decreto_1372_1992'
            : 'et_462_1',
        taxable_basis: v.aiu?.taxable_basis ?? 'aiu',
        contract_object: v.aiu?.contract_object ?? '',
        enforce_minimum_base: v.aiu?.enforce_minimum_base ?? true,
        minimum_base_percent: v.aiu?.minimum_base_percent ?? '10.00',
        components_basis: v.aiu?.components_basis ?? 'contract',
        components: {
          administracion: v.aiu?.administracion ?? '5.00',
          imprevistos: v.aiu?.imprevistos ?? '2.00',
          utilidad: v.aiu?.utilidad ?? '3.00',
        },
        accounting_model: v.aiu?.accounting_model ?? 'sumada',
      } : null,
      accounting: {
        revenue_account_by_bucket: {
          administracion: v.accounting?.revenue_administracion ?? null,
          imprevistos: v.accounting?.revenue_imprevistos ?? null,
          utilidad: v.accounting?.revenue_utilidad ?? null,
          costo: v.accounting?.revenue_costo ?? null,
        },
        vat_payable_account: v.accounting?.vat_payable_account ?? null,
        mapping_key_overrides: {},
      },
      model_lines: (v.model_lines ?? []).map((l: Record<string, unknown>) => ({
        description: l['description'] ?? '',
        quantity: l['quantity'] ?? 1,
        unit_code: l['unit_code'] ?? '94',
        unit_price: l['unit_price'] ?? 0,
        bucket: l['bucket'] ?? 'administracion',
      })),
      format: {
        template_id: v.format?.template_id ?? null,
        template_key: v.format?.template_key ?? null,
        show_aiu_breakdown: v.format?.show_aiu_breakdown ?? true,
        display_decimals: v.format?.display_decimals ?? 2,
      },
      dian: {
        document_type: v.dian?.document_type ?? null,
        // `operation_type` NO va dentro de `dian`.
        //
        // Es una COLUMNA de `invoice_profiles`, no una clave del JSON de
        // configuracion: viaja aparte, al nivel raiz del payload (ver el
        // `save()` de mas abajo). Mandarla aqui tambien hacia que
        // `normalizeAndAssertProfileConfig` la rechazara con 422
        // INVOICING_PROFILE_005 / UNKNOWN_KEY en `dian.operation_type` — o sea
        // que ningun perfil se podia guardar. El contrato
        // (`ProfileDianConfig`) solo admite document_type,
        // payment_means_code, payment_method_code, header_notes y
        // resolution_id.
        payment_method_code: v.dian?.payment_method_code ?? null,
        payment_means_code: v.dian?.payment_means_code ?? null,
        header_notes: v.dian?.header_notes ?? [],
        resolution_id: v.dian?.resolution_id ?? null,
      },
      // `{ rules: [...] }`, no arreglo suelto. El backend normaliza a esta forma
      // igual, pero mandar el arreglo hacía que el editor leyera de vuelta algo
      // distinto de lo que escribió — y esa asimetría es la que borraba la
      // matriz en cada guardado.
      taxes: {
        rules: (v.taxes ?? []).map((t: Record<string, unknown>) => ({
          tax_code: t['tax_code'] ?? '01',
          taxable: t['taxable'] ?? true,
          rate: t['rate'] ?? '',
          bucket: t['bucket'] ?? 'administracion',
        })),
      },
      withholdings: {
        rules: (v.withholdings ?? []).map((w: Record<string, unknown>) => ({
          concept_id: Number(w['concept_id']) || 0,
          role: w['role'] ?? 'practiced',
          rate: w['rate'] ?? '',
        })),
      },
      currency: {
        declare_foreign: v.currency?.declare_foreign ?? false,
        code: v.currency?.code ?? null,
      },
    };
  }

  // ─── Actions ────────────────────────────────────────────────
  onHeaderAction(actionId: string): void {
    if (actionId === 'cancel') this.cancel();
    if (actionId === 'save') this.save();
  }

  /**
   * Ruta del primer control inválido, en notación de puntos. Recorre grupos y
   * arreglos porque el formulario del perfil anida nueve secciones y el
   * campo que bloquea casi nunca está en la raíz.
   */
  private firstInvalidControlLabel(): string | null {
    const walk = (control: AbstractControl, path: string): string | null => {
      if (control instanceof FormGroup) {
        for (const [key, child] of Object.entries(control.controls)) {
          const found = walk(child, path ? `${path}.${key}` : key);
          if (found) return found;
        }
        return null;
      }
      if (control instanceof FormArray) {
        for (let i = 0; i < control.length; i++) {
          const found = walk(control.at(i), `${path}[${i}]`);
          if (found) return found;
        }
        return null;
      }
      return control.invalid ? path : null;
    };
    return walk(this.form, '');
  }

  save(): void {
    if (this.form.invalid) {
      // Antes era un `return` mudo: el operador pulsaba «Guardar», no pasaba
      // nada y no había forma de saber por qué. Marcar los controles es lo
      // que hace aparecer los mensajes de error, y el toast nombra el primero
      // para que no haya que ir buscándolo por las nueve secciones.
      this.form.markAllAsTouched();
      const first = this.firstInvalidControlLabel();
      this.server_error.set(
        first
          ? `Revisa el formulario: ${first} no es válido.`
          : 'Revisa el formulario: hay campos obligatorios sin completar.',
      );
      this.toast.error('No se pudo guardar', 'Hay campos inválidos en el perfil.');
      return;
    }
    this.saving.set(true);
    this.server_error.set(null);

    const config = this.buildConfig();
    const v = this.form.value;
    const id = this.profileId();
    const payload = { name: v.name?.trim(), operation_type: v.operation_type, config };

    const obs$ = id === null
      ? this.store.createProfile(payload as any)
      : this.store.updateProfile(id, payload as any);

    obs$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toast.success(
          id === null ? 'Perfil creado' : 'Cambios guardados',
          v.name,
        );
        // Ruta ABSOLUTA: `['../']` relativo resuelve distinto en alta
        // (`profiles/new` → `profiles`) que en edición (`profiles/7/edit` →
        // `profiles/7`, que no existe y deja al operador en un 404 después de
        // haber guardado bien.
        this.router.navigate(['/super-admin/fiscal/invoicing/profiles']);
      },
      error: (err: any) => {
        this.saving.set(false);
        const issues: ProfileConfigIssue[] = err?.issues ?? [];
        if (issues.length > 0) {
          this.server_error.set(issues.map((i) => i.message).join('; '));
        } else {
          this.server_error.set(`${err?.error_code ?? 'ERR'}: ${err?.message ?? 'Error al guardar'}`);
        }
      },
    });
  }

  cancel(): void {
    this.router.navigate(['../'], { relativeTo: this.route });
  }
}
