import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import {
  FormArray,
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Observable, firstValueFrom } from 'rxjs';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { startWith } from 'rxjs/operators';

import { environment } from '../../../../../../../../environments/environment';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import {
  AlertBannerComponent,
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
} from '../../../../../../../shared/components';
import { CurrencyPipe as VendixCurrencyPipe } from '../../../../../../../shared/pipes/currency';

// Secciones Compartidas
import { PlatformSectionWrapperComponent } from '../../components/platform-section-wrapper/platform-section-wrapper.component';
import {
  DocumentoSectionPaths,
  InvoiceSectionDocumentoComponent,
  InvoiceSectionLineasComponent,
  InvoiceSectionNotasComponent,
  NotasSectionPaths,
} from '../../../../../../../shared/components/invoice-sections';

import { TenantPickerComponent } from '../../components/tenant-picker/tenant-picker.component';
import { PlatformInvoicingStore } from '../../platform-invoicing.store';
import { FiscalBillingAdminService } from '../../../../subscriptions/services/fiscal-billing-admin.service';
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

interface NewLineDraft {
  description: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_rate: number; // 0.19, 0.05, 0
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
    CardComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    SelectorComponent,
    TenantPickerComponent,
    VendixCurrencyPipe,
    DecimalPipe,
    PlatformSectionWrapperComponent,
    InvoiceSectionDocumentoComponent,
    InvoiceSectionLineasComponent,
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

  // ── Modo de Adquiriente ─────────────────────────────────────────
  readonly acquirerMode = signal<'system' | 'external'>('system');

  // ── Formulario Principal ────────────────────────────────────────
  readonly invoiceForm = this.fb.group({
    profile_id: [null as number | null],

    // Documento
    resolution_id: [null as number | null, Validators.required],
    invoice_type: ['sales_invoice', Validators.required],
    operation_type: ['10', Validators.required], // Estándar por defecto
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

    // Guardar como perfil
    save_as_profile_enabled: [false],
    save_as_profile_name: [''],

    // Líneas
    items: this.fb.array([], Validators.required),
  });

  get itemsArray(): FormArray {
    return this.invoiceForm.get('items') as FormArray;
  }

  // Señales derivadas del Formulario
  private readonly formValue = toSignal(
    this.invoiceForm.valueChanges.pipe(startWith(this.invoiceForm.value)),
    { initialValue: this.invoiceForm.value as Record<string, any> }
  );

  private readonly itemsValue = toSignal(
    this.itemsArray.valueChanges as Observable<any[]>,
    { initialValue: [] }
  );

  readonly itemControls = computed<FormGroup[]>(() => {
    this.itemsValue();
    return [...this.itemsArray.controls] as FormGroup[];
  });

  readonly rawValue = computed<Record<string, any>>(() => {
    this.formValue();
    return this.invoiceForm.getRawValue();
  });

  readonly operationType = computed(() => this.rawValue()['operation_type']);
  readonly isCredit = computed(() => this.rawValue()['payment_form'] === '2');

  // ── Cálculo Reactivo de Totales ──────────────────────────────────
  readonly totals = computed(() => {
    const items = this.itemsValue() || [];
    let grossSubtotal = 0;
    let totalDiscount = 0;
    let taxableBase = 0;
    let totalIva = 0;

    for (const item of items) {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.unit_price) || 0;
      const discount = Number(item.discount_amount) || 0;
      const taxes = item.taxes || [];
      const ivaTax = taxes.find((t: any) => t.tax_type === 'IVA');
      const rate = ivaTax ? Number(ivaTax.rate) || 0 : 0;
      const isInclusive = Boolean(ivaTax?.is_inclusive);

      const rawLineTotal = qty * price;
      grossSubtotal += rawLineTotal;
      totalDiscount += discount;

      const netLine = Math.max(0, rawLineTotal - discount);

      if (rate > 0) {
        if (isInclusive) {
          const base = netLine / (1 + rate);
          const tax = netLine - base;
          taxableBase += base;
          totalIva += tax;
        } else {
          taxableBase += netLine;
          totalIva += netLine * rate;
        }
      } else {
        taxableBase += netLine;
      }
    }

    const total = taxableBase + totalIva;

    return {
      grossSubtotal,
      totalDiscount,
      taxableBase,
      totalIva,
      total,
    };
  });

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

  readonly lineasRowPaths = {
    quantity: 'quantity',
    unit_price: 'unit_price',
    description: 'description',
    unit_code: 'unit_code',
    discount_amount: 'discount_amount',
    taxes: 'taxes',
    product_id: null,
    account_code: null,
    aiu_component: null,
    aiu_field: 'aiu_field',
    price_unit_quantity: null,
  };

  readonly notasSectionPaths: NotasSectionPaths = {
    description: null,
    internal_note: null,
  };

  // ── Opciones de Selectores ──────────────────────────────────────
  readonly invoiceTypeOptions = [
    { value: 'sales_invoice', label: 'Factura de Venta' },
    { value: 'support_document', label: 'Documento Soporte' },
  ];
  readonly paymentFormOptions = [
    { value: '1', label: 'Contado' },
    { value: '2', label: 'Crédito' },
  ];
  readonly paymentMeansOptions = [
    { value: '10', label: 'Efectivo' },
    { value: '42', label: 'Transferencia Bancaria' },
    { value: '48', label: 'Tarjeta de Crédito' },
    { value: '49', label: 'Tarjeta de Débito' },
    { value: '1', label: 'Instrumento no definido' },
  ];
  readonly aiuComponentOptions = [
    { value: 'administracion', label: 'Administración' },
    { value: 'imprevistos', label: 'Imprevistos' },
    { value: 'utilidad', label: 'Utilidad' },
  ];

  readonly documentTypeOptions = [
    { value: '31', label: 'NIT (Número de Identificación Tributaria)' },
    { value: '13', label: 'Cédula de Ciudadanía (CC)' },
    { value: '22', label: 'Cédula de Extranjería (CE)' },
    { value: '41', label: 'Pasaporte' },
  ];

  readonly personTypeOptions = [
    { value: '1', label: 'Persona Jurídica' },
    { value: '2', label: 'Persona Natural' },
  ];

  readonly taxRegimeOptions = [
    { value: '48', label: 'Responsable de IVA (Régimen Común)' },
    { value: '49', label: 'No Responsable de IVA (Régimen Simplificado)' },
  ];

  readonly taxRateOptions = [
    { value: '0.19', label: 'IVA General 19%' },
    { value: '0.05', label: 'IVA Reducido 5%' },
    { value: '0', label: 'Exento / 0%' },
  ];

  // ── Estado de UI ────────────────────────────────────────────────
  readonly sectionExpanded = signal<Record<string, boolean>>({
    perfil: true,
    documento: true,
    adquiriente: true,
    lineas: true,
    notas: false,
  });

  readonly submitting = signal(false);
  readonly errorMessage = signal('');

  // ── Modal de Nueva Línea ─────────────────────────────────────────
  readonly showLineModal = signal(false);
  readonly newLine = signal<NewLineDraft>({
    description: '',
    quantity: 1,
    unit_price: 0,
    discount_amount: 0,
    tax_rate: 0.19,
    is_inclusive: false,
    unit_code: 'EA',
  });

  ngOnInit() {
    this.store.loadResolutions();
    this.store.loadProfiles();

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
  }

  get resolutionControl() {
    return this.invoiceForm.get('resolution_id') as any;
  }

  get rowErrors() {
    return this.itemsArray.controls.map((c) => (c.invalid ? { description: 'Requerido' } : {}));
  }
  carriesAiu = (row: any, index: number) => false;
  rowHasError(row: any, index: number): boolean {
    return row.invalid;
  }
  toggleAiu(row: any, index: number, on: boolean): void {}

  toggleSection(section: string, expanded: boolean): void {
    this.sectionExpanded.update((s) => ({ ...s, [section]: expanded }));
  }

  readonly resolutionOptions = computed(() => {
    return this.store.resolutions().map((r) => ({
      value: r.id.toString(),
      label: r.prefix
        ? `${r.prefix} (Resolución ${r.resolution_number})`
        : `Resolución ${r.resolution_number}`,
    }));
  });

  // ── Conmutador de Modo de Adquiriente ────────────────────────────
  setAcquirerMode(mode: 'system' | 'external'): void {
    this.acquirerMode.set(mode);
    if (mode === 'external') {
      this.invoiceForm.patchValue({ customer_tenant: null });
    }
  }

  // ── Adquiriente del Sistema ──────────────────────────────────────
  onTenantPicked(tenant: PlatformAcquirer | null): void {
    this.invoiceForm.patchValue({ customer_tenant: tenant });
  }

  // ── Modal de Líneas ──────────────────────────────────────────────
  updateNewLine(patch: Partial<NewLineDraft>): void {
    this.newLine.update((line) => ({ ...line, ...patch }));
  }

  openLineModal(): void {
    this.newLine.set({
      description: '',
      quantity: 1,
      unit_price: 0,
      discount_amount: 0,
      tax_rate: 0.19,
      is_inclusive: false,
      unit_code: 'EA',
    });
    this.showLineModal.set(true);
  }

  confirmLine(): void {
    const line = this.newLine();
    if (!line.description || line.quantity <= 0 || line.unit_price < 0) {
      this.toast.error('Revisa los datos de la línea: descripción, cantidad > 0 y precio ≥ 0.');
      return;
    }

    const taxesArray: any[] = [];
    if (line.tax_rate > 0) {
      taxesArray.push({
        tax_type: 'IVA',
        rate: line.tax_rate,
        is_inclusive: line.is_inclusive,
      });
    }

    const group = this.fb.group({
      row_uid: [`row-${Date.now()}`],
      description: [line.description, Validators.required],
      quantity: [line.quantity, [Validators.required, Validators.min(0.0001)]],
      unit_price: [line.unit_price, [Validators.required, Validators.min(0)]],
      unit_code: [line.unit_code || 'EA'],
      discount_amount: [line.discount_amount || 0],
      taxes: [taxesArray],
    });

    this.itemsArray.push(group);
    this.showLineModal.set(false);
  }

  removeLine(index: number): void {
    this.itemsArray.removeAt(index);
  }

  // ── Perfiles ────────────────────────────────────────────────────
  readonly profilesForOperationType = computed(() => {
    const op = this.operationType();
    return this.store.profiles().filter((p) => p.operation_type === op);
  });

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
          const cfg = detail.current_config;
          if (cfg) {
            const patch: Record<string, unknown> = {};
            if (cfg['resolution_id']) patch['resolution_id'] = cfg['resolution_id'];
            if (cfg['payment_form']) patch['payment_form'] = cfg['payment_form'];
            if (cfg['payment_means_code'])
              patch['payment_means_code'] = cfg['payment_means_code'];
            if (cfg['notes']) patch['notes'] = cfg['notes'];
            if (Object.keys(patch).length > 0) this.invoiceForm.patchValue(patch);
          }
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

  clearProfile(): void {
    this.invoiceForm.patchValue({ profile_id: null });
  }

  // ── Previsualizar & Emitir ──────────────────────────────────────
  readonly printPreviewOpen = signal(false);
  readonly printPreviewLoading = signal(false);
  readonly printPreviewResult = signal<any | null>(null);
  readonly printPreviewError = signal('');
  readonly printPreviewSrcdoc = computed(() => this.printPreviewResult()?.html || '');

  openPrintPreview(): void {
    const profileId = this.invoiceForm.value.profile_id;
    if (!profileId) {
      this.printPreviewError.set(
        'Selecciona un perfil de facturación para generar la previsualización técnica.',
      );
      this.printPreviewOpen.set(true);
      return;
    }

    const payload = this.buildPayload();
    if (!payload) return;

    this.printPreviewLoading.set(true);
    this.printPreviewOpen.set(true);
    this.printPreviewError.set('');

    this.store.previewProfile(profileId, payload).subscribe({
      next: (res) => {
        this.printPreviewResult.set(res);
        this.printPreviewLoading.set(false);
      },
      error: () => {
        this.printPreviewLoading.set(false);
        this.printPreviewError.set('No se pudo generar la previsualización del XML.');
      },
    });
  }

  closePrintPreview(open: boolean): void {
    this.printPreviewOpen.set(open);
    if (!open) {
      this.printPreviewResult.set(null);
    }
  }

  buildPayload(): any | null {
    const val = this.rawValue();

    // Validar líneas
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
      customerPayload = {
        kind: 'external',
        legal_name: val['external_legal_name'].trim(),
        tax_id: val['external_tax_id'].trim(),
        tax_id_dv: val['external_tax_id_dv'] || undefined,
        person_type: val['external_person_type'] || '2',
        tax_regime_code: val['external_tax_regime_code'] || '49',
        fiscal_responsibilities: ['R-99-PN'],
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
      customerPayload = {
        kind: tenant.kind,
        tenant_id: tenant.tenant_id,
      };
    }

    const dto: any = {
      profile_id: val['profile_id'] || undefined,
      customer: customerPayload,
      items: val['items'].map((i: any) => ({
        description: i.description,
        quantity: +i.quantity,
        unit_price: +i.unit_price,
        unit_code: i.unit_code || 'EA',
        discount_amount: +i.discount_amount || 0,
        taxes: i.taxes || [],
      })),
      operation_type: val['operation_type'] || '10',
      payment_form: val['payment_form'] || '1',
      payment_means_code: val['payment_means_code'] || '10',
      due_date: val['payment_form'] === '2' ? val['due_date'] : undefined,
      notes: val['notes']?.trim() || undefined,
    };

    if (val['save_as_profile_enabled'] && val['save_as_profile_name']?.trim()) {
      dto.save_as_profile = {
        name: val['save_as_profile_name'].trim(),
        is_default: false,
      };
    }

    return dto;
  }

  async submit(): Promise<void> {
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
        this.router.navigate([
          '/super-admin/fiscal/invoicing/invoices',
          res.data.invoice_id,
        ]);
      } else {
        this.errorMessage.set('La API no devolvió la confirmación esperada.');
      }
    } catch (error: any) {
      const msg =
        (error instanceof HttpErrorResponse && (error.error?.message ?? error.message)) ||
        (error instanceof Error ? error.message : null) ||
        'Error desconocido al emitir la factura.';
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
