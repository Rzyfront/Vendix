import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import { describeApiFailure } from '../../utils/invoicing-errors.util';
import { SupportDocumentService } from '../../services/support-document.service';
import { SuppliersService } from '../../../inventory/services/suppliers.service';
import { SupplierFormModalComponent } from '../../../inventory/suppliers/components/supplier-form-modal.component';
import type {
  CreateSupplierDto,
  Supplier,
  UpdateSupplierDto,
} from '../../../inventory/interfaces';
import type {
  CreateSupportDocumentDto,
  PurchaseOrderSupportDraft,
  PurchaseOrderSupportDraftItem,
  PurchaseOrderSupportDraftTax,
  SupportDocumentAdjustmentSource,
  SupportDocumentItemDto,
  SupportDocumentEmissionOutcome,
  SupportDocumentRow,
  SupportDocumentType,
  SupportMissingField,
} from '../../interfaces/support-document.interface';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import type { SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { toLocalDateString } from '../../../../../../shared/utils/date.util';
import { CurrencyFormatService, CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { Subscription } from 'rxjs';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Cuota de la línea con las tarifas de la OC sobre la base editada (impuesto
 * adicional, como `is_inclusive: false`). Es la misma que calcula el servidor;
 * él tiene la última palabra.
 */
function lineTaxFromRates(
  line: { quantity?: unknown; unit_price?: unknown; discount_amount?: unknown },
  rates: readonly PurchaseOrderSupportDraftTax[],
): number {
  const base =
    (Number(line.quantity) || 0) * (Number(line.unit_price) || 0) -
    (Number(line.discount_amount) || 0);
  return round2(
    rates.reduce((acc, t) => acc + round2((base * (Number(t.tax_rate) || 0)) / 100), 0),
  );
}

/** Mismas reglas de vencimiento que el backend (`DUE_DATE_*`), evaluadas en vivo. */
function dueDateGaps(form: {
  issue_date?: unknown;
  due_date?: unknown;
  payment_form?: unknown;
}): SupportMissingField[] {
  const issue = String(form.issue_date ?? '').slice(0, 10);
  const due = String(form.due_date ?? '').slice(0, 10);
  if (form.payment_form === '2' && !due) {
    return [
      {
        code: 'DUE_DATE_REQUIRED',
        field: 'due_date',
        label: 'La compra es a crédito y falta la fecha de vencimiento',
        target: 'review',
      },
    ];
  }
  if (due && issue && due < issue) {
    return [
      {
        code: 'DUE_DATE_BEFORE_ISSUE',
        field: 'due_date',
        label: 'La fecha de vencimiento es anterior a la fecha de emisión',
        target: 'review',
      },
    ];
  }
  return [];
}

const DUE_DATE_CODES = new Set(['DUE_DATE_REQUIRED', 'DUE_DATE_BEFORE_ISSUE']);

/**
 * Form de creación de un documento soporte o nota de ajuste (QUI-682).
 *
 * - `invoice_type` ∈ {support_document, support_adjustment_note}.
 * - `supplier_id` obligatorio para los tipos de soporte (lo exige el backend
 *   en `InvoicingService.loadSupportDocumentSupplier`).
 * - `related_invoice_id` sólo aplica a la nota de ajuste (lo exige
 *   `findAcceptedSupportDocumentOriginal`).
 *
 * El componente es tonto respecto a la DIAN: si el tenant no tiene habilitación
 * `support_document`, el padre ya abrió `InvoicingNotConfiguredComponent` y no
 * debería haber llegado aquí.
 */
@Component({
  selector: 'app-support-document-create',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    IconComponent,
    CurrencyPipe,
    SupplierFormModalComponent,
  ],
  template: `
    <app-modal
      [(isOpen)]="isOpenModel"
      (cancel)="onClose()"
      [title]="modalTitle()"
      size="lg"
      [dialog]="true"
      [canClose]="canCloseModal"
    >
      <form
        [formGroup]="form"
        (ngSubmit)="onSubmit()"
        class="space-y-4 p-4"
      >
        @if (isPoMode()) {
          @if (draftLoading()) {
            <p class="text-sm text-text-secondary" role="status">Consultando la orden de compra…</p>
          } @else if (draftError(); as error) {
            <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-error/30 bg-error-light p-3 text-sm text-error" role="alert">
              <span>{{ error }}</span>
              <app-button variant="outline" size="sm" [disabled]="submitting()" (clicked)="retryDraft()">Reintentar</app-button>
            </div>
          }

          @if (draft(); as d) {
            @if (activeDocument(); as active) {
              <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning-light p-3 text-sm text-text-primary" role="alert">
                <span>Esta orden ya tiene el documento soporte N° {{ active.invoice_number }} vigente.</span>
                <button
                  type="button"
                  class="font-medium text-primary underline"
                  (click)="viewActiveDocument(active.id)"
                >Ver documento</button>
              </div>
            }

            @if (d.purchase_order.has_supplier_invoice) {
              <div class="flex items-start gap-2 rounded-lg border border-info/30 bg-info-light p-3 text-sm text-text-primary" role="note">
                <app-icon name="info" [size]="16"></app-icon>
                <span>Esta orden ya tiene una factura de compra adjunta (N° {{ d.purchase_order.supplier_invoice_number || 's/n' }}). Si el proveedor ya te facturó, normalmente no necesitas documento soporte; la decisión es tuya.</span>
              </div>
            }

            <div class="rounded-lg border border-border p-3 text-sm">
              <p class="text-xs text-text-secondary">Proveedor (de la orden de compra)</p>
              <p class="font-medium text-text-primary">{{ d.supplier.name }}</p>
              <p class="text-text-secondary">
                NIT/Documento: {{ d.supplier.tax_id || 'Sin documento' }}{{ d.supplier.verification_digit ? '-' + d.supplier.verification_digit : '' }}
              </p>
            </div>
          }
        } @else {
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <app-selector
            size="lg"
            label="Tipo de documento"
            formControlName="invoice_type"
            [options]="typeOptions"
          ></app-selector>

          <app-selector
            size="lg"
            label="Proveedor"
            formControlName="supplier_id"
            [options]="supplierOptions()"
            placeholder="Seleccione un proveedor"
            [required]="true"
            [disabled]="suppliersLoading() || !!suppliersError() || submitting()"
          ></app-selector>
        </div>

        @if (suppliersLoading()) {
          <p class="text-sm text-text-secondary" role="status">Consultando proveedores…</p>
        } @else if (suppliersError(); as error) {
          <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-error/30 bg-error-light p-3 text-sm text-error" role="alert">
            <span>{{ error }}</span>
            <app-button variant="outline" size="sm" [disabled]="submitting()" (clicked)="retrySuppliers()">Reintentar</app-button>
          </div>
        } @else if (supplierOptions().length === 0) {
          <p class="text-sm text-text-secondary" role="note">No hay proveedores disponibles.</p>
        }
        }

        @if (form.controls['invoice_type'].value === 'support_adjustment_note') {
          <app-input
            size="lg"
            label="ID del documento soporte original"
            type="number"
            formControlName="related_invoice_id"
            [control]="form.controls['related_invoice_id']"
            placeholder="ID del documento soporte aceptado por la DIAN"
            [required]="true"
            min="1"
          ></app-input>
          @if (adjustmentOf(); as original) {
            <p class="text-xs text-text-secondary" role="note">
              Corrige el documento soporte {{ original.invoice_number }} (ID {{ original.id }}), aceptado por la DIAN.
            </p>
          }
        }

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <app-input
            size="lg"
            label="Fecha de emisión"
            type="date"
            formControlName="issue_date"
            [control]="form.controls['issue_date']"
            [required]="true"
          ></app-input>
          <app-input
            size="lg"
            label="Fecha de pago"
            type="date"
            formControlName="due_date"
            [control]="form.controls['due_date']"
          ></app-input>
        </div>

        @if (isPoMode()) {
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <app-selector
              size="lg"
              label="Forma de pago"
              formControlName="payment_form"
              [options]="paymentFormOptions"
              placeholder="Seleccione la forma de pago"
              [required]="true"
              [disabled]="submitting()"
            ></app-selector>
          </div>
        }

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <app-input
            size="lg"
            label="Retenciones aplicadas"
            [currency]="true"
            formControlName="withholding_amount"
            [control]="form.controls['withholding_amount']"
            placeholder="0"
          ></app-input>
        </div>

        <!-- Ítems -->
        <div class="border border-border rounded-lg p-3 space-y-3">
          <div class="flex items-center justify-between">
            <h4 class="text-sm font-medium text-text-primary">Ítems</h4>
            <app-button
              variant="outline"
              size="sm"
              type="button"
              [disabled]="submitting()"
              (clicked)="addItem()"
            >
              <app-icon slot="icon" name="plus" [size]="14"></app-icon>
              Agregar
            </app-button>
          </div>

          <div formArrayName="items" class="space-y-3">
            @for (item of itemsArray.controls; track item; let i = $index) {
              <div [formGroupName]="i" class="border border-border rounded-lg p-3 space-y-2">
                <!-- A.6(a): único botón icon-only sin nombre accesible del módulo
                     (barrido mecánico de 204 usos de app-icon). Sin aria-label un
                     lector de pantalla anuncia «botón» para una acción que
                     destruye la fila entera capturada.
                     OJO: sin acentos graves acá — la plantilla ES un literal
                     delimitado por acentos graves y uno solo la cierra. -->
                <div class="flex items-start gap-2">
                  <div class="min-w-0 flex-1">
                    <app-input
                      size="lg"
                      label="Descripción"
                      formControlName="description"
                      [control]="item.get('description')"
                      placeholder="Descripción del ítem"
                      [required]="true"
                    ></app-input>
                  </div>
                  <button
                    type="button"
                    (click)="removeItem(i)"
                    [disabled]="submitting()"
                    aria-label="Eliminar ítem"
                    class="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:text-error focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <app-icon name="x" [size]="16"></app-icon>
                  </button>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <app-input
                    size="lg"
                    label="Cantidad"
                    type="number"
                    formControlName="quantity"
                    [control]="item.get('quantity')"
                    [required]="true"
                    min="1"
                  ></app-input>
                  <app-input
                    size="lg"
                    label="Precio unitario"
                    [currency]="true"
                    formControlName="unit_price"
                    [control]="item.get('unit_price')"
                    [required]="true"
                  ></app-input>
                  <app-input
                    size="lg"
                    label="Descuento"
                    [currency]="true"
                    formControlName="discount_amount"
                    [control]="item.get('discount_amount')"
                  ></app-input>
                  <app-input
                    size="lg"
                    label="IVA"
                    [currency]="true"
                    formControlName="tax_amount"
                    [control]="item.get('tax_amount')"
                    [readonly]="isPoMode()"
                    [helperText]="isPoMode() ? 'Según las tarifas de la OC' : ''"
                  ></app-input>
                </div>
              </div>
            }
          </div>

          @if (itemsArray.length === 0) {
            <div class="text-center py-4 text-text-secondary text-sm">
              Agregue al menos un ítem
            </div>
          }
        </div>

        @if (isPoMode() && draft(); as d) {
          <div class="rounded-lg border border-border p-3 text-sm space-y-1" role="note">
            <div class="flex justify-between">
              <span class="text-text-secondary">Total de la orden de compra</span>
              <span class="font-medium text-text-primary">{{ d.purchase_order.total_amount | currency }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-text-secondary">Total del documento soporte</span>
              <span class="font-medium text-text-primary">{{ documentTotal() | currency }}</span>
            </div>
          </div>
        }

        @if (isPoMode() && effectiveMissing().length > 0) {
          <div class="rounded-lg border border-warning/40 bg-warning-light p-3 text-sm space-y-2" role="alert">
            <p class="font-medium text-text-primary">Faltan datos para emitir el documento soporte</p>
            <ul class="space-y-1">
              @for (m of effectiveMissing(); track m.code + m.field) {
                <li class="flex flex-wrap items-center justify-between gap-2">
                  <span class="text-text-primary">{{ m.label }}</span>
                  @if (m.target === 'supplier') {
                    <app-button variant="outline" size="sm" [disabled]="submitting()" (clicked)="completeSupplier()">Completar en el proveedor</app-button>
                  }
                </li>
              }
            </ul>
          </div>
        }

        <app-textarea
          label="Notas"
          formControlName="notes"
          [control]="form.controls['notes']"
          placeholder="Observaciones adicionales..."
          [rows]="3"
        ></app-textarea>

        @if (submitError(); as errorMsg) {
          <div
            class="text-sm text-error bg-error-light border border-error/30 rounded-lg p-3 flex items-start gap-2"
            role="alert"
          >
            <app-icon name="alert-circle" [size]="16"></app-icon>
            <span>{{ errorMsg }}</span>
          </div>
        }

        @if (emissionResult(); as result) {
          <div
            class="text-sm rounded-lg border p-3 flex items-start gap-2"
            [class.border-success]="result.success"
            [class.bg-success-light]="result.success"
            [class.border-error]="!result.success"
            [class.bg-error-light]="!result.success"
            role="status"
          >
            <app-icon [name]="result.success ? 'check-circle' : 'alert-circle'" [size]="16"></app-icon>
            <span>
              @if (result.success) {
                <!-- El envío puede terminar en «sent» (la DIAN aún procesa): solo «accepted» es aceptado. -->
                @if (result.status === 'accepted') {
                  El documento soporte fue aceptado por la DIAN.
                } @else {
                  El documento soporte se envió a la DIAN. Consulta su estado en el detalle del documento.
                }
              } @else {
                El documento soporte se creó, pero la DIAN no lo aceptó{{ result.message ? ': ' + result.message : '.' }} Puedes revisarlo y reintentar desde el detalle del documento.
              }
            </span>
          </div>
        }
      </form>

      <div slot="footer">
        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
          <app-button customClasses="w-full sm:w-auto" variant="outline" [disabled]="submitting()" (clicked)="onClose()">
            {{ emissionResult() ? 'Cerrar' : 'Cancelar' }}
          </app-button>
          @if (!emissionResult()) {
            <app-button
              customClasses="w-full sm:w-auto"
              variant="primary"
              (clicked)="onSubmit()"
              [disabled]="submitDisabled()"
              [loading]="submitting()"
            >
              {{ isPoMode() ? 'Generar documento soporte' : 'Crear documento soporte' }}
            </app-button>
          }
        </div>
      </div>
    </app-modal>

    @if (isPoMode()) {
      <app-supplier-form-modal
        [isOpen]="supplierModalOpen()"
        [supplier]="supplierForModal()"
        [isSubmitting]="supplierSaving()"
        (cancel)="closeSupplierModal()"
        (save)="onSaveSupplier($event)"
      ></app-supplier-form-modal>
    }
  `,
})
export class SupportDocumentCreateComponent {
  readonly isOpen = model.required<boolean>();

  /** ID inicial del proveedor (si el padre lo trae, ej: desde la pantalla del proveedor). */
  readonly initialSupplierId = input<number | null>(null);

  /**
   * Documento soporte aceptado a corregir (QUI-683). Si llega, el form abre
   * como nota de ajuste con el original y su proveedor prellenados.
   */
  readonly adjustmentOf = input<SupportDocumentAdjustmentSource | null>(null);

  /**
   * Orden de compra de origen (QUI-684). Con ella el modal abre en modo OC:
   * proveedor bloqueado, ítems precargados desde el borrador del backend y
   * emisión inmediata.
   */
  readonly purchaseOrderId = input<number | null>(null);

  readonly isPoMode = computed(() => this.purchaseOrderId() != null);

  readonly modalTitle = computed(() =>
    this.isPoMode()
      ? 'Generar documento soporte'
      : this.adjustmentOf()
        ? 'Nueva nota de ajuste'
        : 'Nuevo documento soporte',
  );

  readonly created = output<SupportDocumentRow>();

  private fb = inject(FormBuilder);
  private service = inject(SupportDocumentService);
  private suppliersService = inject(SuppliersService);
  private currencyService = inject(CurrencyFormatService);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  readonly submitting = signal(false);
  readonly submitError = signal<string | null>(null);
  readonly suppliersLoading = signal(false);
  readonly suppliersError = signal<string | null>(null);
  readonly canCloseModal = (): boolean => !this.submitting();

  // ── Modo OC (QUI-684) ────────────────────────────────────
  readonly draft = signal<PurchaseOrderSupportDraft | null>(null);
  readonly draftLoading = signal(false);
  readonly draftError = signal<string | null>(null);
  readonly activeDocument = signal<{ id: number; invoice_number: string } | null>(null);
  private readonly serverMissing = signal<SupportMissingField[]>([]);
  readonly emissionResult = signal<SupportDocumentEmissionOutcome | null>(null);
  readonly supplierModalOpen = signal(false);
  readonly supplierForModal = signal<Supplier | null>(null);
  readonly supplierSaving = signal(false);
  /** Cambia con cada edición del form para que los computed lo lean. */
  private readonly formTick = signal(0);
  private draftRequest?: Subscription;
  private draftGeneration = 0;
  /** Estable por apertura del modal: un doble clic reenvía el mismo id (idempotente). */
  private clientRequestId: string | null = null;

  readonly paymentFormOptions: SelectorOption[] = [
    { value: '1', label: 'Contado' },
    { value: '2', label: 'Crédito' },
  ];

  /**
   * Faltantes vigentes: los del servidor, menos los de `review` que el usuario
   * ya corrigió en el form. Los de proveedor / OC solo cambian al re-consultar.
   */
  readonly effectiveMissing = computed<SupportMissingField[]>(() => {
    this.formTick();
    // El vencimiento depende de la forma de pago que el usuario puede cambiar:
    // se evalúa en vivo en lugar de confiar en la foto del servidor.
    const server = this.serverMissing().filter((m) =>
      m.target !== 'review'
        ? true
        : !DUE_DATE_CODES.has(m.code) && this.reviewStillMissing(m),
    );
    return [...server, ...dueDateGaps(this.form.getRawValue())];
  });

  readonly documentTotal = computed(() => {
    this.formTick();
    return this.itemsArray.controls.reduce((sum, c) => {
      const v = c.value as Record<string, unknown>;
      return (
        sum +
        (Number(v['quantity']) || 0) * (Number(v['unit_price']) || 0) -
        (Number(v['discount_amount']) || 0) +
        (Number(v['tax_amount']) || 0)
      );
    }, 0);
  });

  readonly submitDisabled = computed(() => {
    this.formTick();
    if (this.submitting() || this.form.invalid || this.itemsArray.length === 0) {
      return true;
    }
    if (!this.isPoMode()) return false;
    return (
      this.draftLoading() ||
      !this.draft() ||
      this.activeDocument() != null ||
      this.effectiveMissing().length > 0
    );
  });

  /**
   * Marca si el usuario tocó manualmente el `supplier_id`. El `effect()` de
   * sincronización con `initialSupplierId` se aborta en cuanto el usuario
   * elige un proveedor distinto — evita pisar la selección manual cuando el
   * padre re-emite el mismo `initialSupplierId`.
   */
  private readonly supplierTouchedByUser = signal(false);

  readonly supplierOptions = signal<SelectorOption[]>([]);
  private supplierRequest?: Subscription;
  private supplierRequestGeneration = 0;

  readonly typeOptions: SelectorOption[] = [
    { value: 'support_document', label: 'Documento soporte' },
    {
      value: 'support_adjustment_note',
      label: 'Nota de ajuste al documento soporte',
    },
  ];

  form: FormGroup;

  constructor() {
    this.currencyService.loadCurrency();

    this.form = this.fb.group({
      invoice_type: ['support_document' as SupportDocumentType, Validators.required],
      supplier_id: [this.initialSupplierId() ?? null, Validators.required],
      related_invoice_id: [null as number | null],
      issue_date: [toLocalDateString(), Validators.required],
      due_date: [''],
      payment_form: [null as string | null],
      withholding_amount: [0],
      notes: [''],
      items: this.fb.array([]),
    });

    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.syncDerivedTaxes();
        this.formTick.update((n) => n + 1);
      });

    // Cuando cambia a nota de ajuste, related_invoice_id se vuelve obligatorio.
    this.form.controls['invoice_type'].valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((type) => {
        const ctrl = this.form.controls['related_invoice_id'];
        if (type === 'support_adjustment_note') {
          ctrl.setValidators([Validators.required, Validators.min(1)]);
        } else {
          ctrl.clearValidators();
          ctrl.setValue(null, { emitEvent: false });
        }
        ctrl.updateValueAndValidity({ emitEvent: false });
      });

    // Si el usuario selecciona manualmente un proveedor, marcamos el flag
    // para que el `effect()` de abajo deje de pisarlo.
    this.form.controls['supplier_id'].valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        const initial = this.initialSupplierId();
        if (value != null && value !== initial) {
          this.supplierTouchedByUser.set(true);
        }
      });

    // Si llega un initialSupplierId después de creado el form (input() tarda),
    // reflejarlo en el control. Sólo se aplica si el usuario no ha tocado
    // manualmente el proveedor — si no, pisaríamos su selección.
    effect(() => {
      const id = this.initialSupplierId();
      if (id != null && !this.supplierTouchedByUser()) {
        this.form.controls['supplier_id'].setValue(id);
      }
    });

    let wasOpen = false;
    effect(() => {
      const open = this.isOpen();
      if (open === wasOpen) return;
      wasOpen = open;
      untracked(() => {
        if (open) {
          this.reset();
          this.loadSuppliers();
        } else {
          this.cancelSupplierLoad();
          this.reset();
        }
      });
    });

    // Modo OC: al abrir, el borrador (proveedor, ítems, faltantes) viene del
    // backend. Va DESPUÉS del efecto genérico: ese hace `reset()` al abrir y
    // borraría lo que este carga.
    let wasOpenForPo = false;
    effect(() => {
      const open = this.isOpen();
      const poId = this.purchaseOrderId();
      if (open === wasOpenForPo) return;
      wasOpenForPo = open;
      untracked(() => {
        if (open && poId != null) {
          this.clientRequestId = this.newRequestId();
          this.enablePoValidators();
          this.loadDraft(poId, true);
        } else {
          this.cancelDraftLoad();
        }
      });
    });
  }

  get itemsArray(): FormArray {
    return this.form.get('items') as FormArray;
  }

  // ── Suppliers ────────────────────────────────────────────
  private loadSuppliers(): void {
    // En modo OC el proveedor es el de la orden: no hay selector que poblar.
    if (this.isPoMode()) return;
    this.cancelSupplierLoad();
    const generation = ++this.supplierRequestGeneration;
    this.suppliersLoading.set(true);
    this.suppliersError.set(null);
    this.supplierOptions.set([]);
    // Sin `state` filter: la UI padre restringe a activos, pero el form
    // admite cualquiera para no romper documentos viejos (mismo razonamiento
    // que `InvoicingService.loadSupportDocumentSupplier`).
    this.supplierRequest = this.suppliersService
      .getSuppliers({ limit: 200 } as any)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          if (generation !== this.supplierRequestGeneration || !this.isOpen()) return;
          const list = (response?.data ?? []) as Array<{
            id: number;
            name: string;
            tax_id?: string;
          }>;
          this.supplierOptions.set(
            list.map((s) => ({
              value: s.id,
              label: s.tax_id ? `${s.name} (${s.tax_id})` : s.name,
            })),
          );
          this.suppliersLoading.set(false);
        },
        error: (error: unknown) => {
          if (generation !== this.supplierRequestGeneration || !this.isOpen()) return;
          this.supplierOptions.set([]);
          this.suppliersLoading.set(false);
          this.suppliersError.set(
            describeApiFailure(error).message ?? 'No se pudieron consultar los proveedores.',
          );
        },
      });
  }

  retrySuppliers(): void {
    if (this.submitting()) return;
    this.loadSuppliers();
  }

  private cancelSupplierLoad(): void {
    this.supplierRequestGeneration++;
    this.supplierRequest?.unsubscribe();
    this.supplierRequest = undefined;
    this.suppliersLoading.set(false);
  }

  // ── Items ────────────────────────────────────────────────
  addItem(): void {
    if (this.submitting()) return;
    this.itemsArray.push(this.buildItemGroup());
  }

  private buildItemGroup(v?: Partial<PurchaseOrderSupportDraftItem>): FormGroup {
    return this.fb.group({
      description: [v?.description ?? '', [Validators.required, Validators.minLength(2)]],
      quantity: [v?.quantity ?? 1, [Validators.required, Validators.min(1)]],
      unit_price: [v?.unit_price ?? 0, [Validators.required, Validators.min(0)]],
      discount_amount: [v?.discount_amount ?? 0],
      tax_amount: [v?.tax_amount ?? 0],
      // Tarifas de la OC (modo OC). Sin ellas el servidor rechaza la cuota.
      taxes: this.fb.control<PurchaseOrderSupportDraftTax[]>(v?.taxes ?? []),
    });
  }

  /**
   * Modo OC: el IVA de cada línea es de solo lectura y sale de sus tarifas sobre
   * la base editada; así no queda una cuota vieja si cambian cantidad o precio.
   */
  private syncDerivedTaxes(): void {
    if (!this.isPoMode()) return;
    for (const group of this.itemsArray.controls) {
      const line = group.getRawValue() as Record<string, unknown>;
      const rates = (line['taxes'] as PurchaseOrderSupportDraftTax[] | null) ?? [];
      const derived = lineTaxFromRates(line, rates);
      if (Number(line['tax_amount']) !== derived) {
        group.get('tax_amount')?.setValue(derived, { emitEvent: false });
      }
    }
  }

  /** Línea del POST en modo OC: lleva las tarifas, no una cuota fija. */
  private toPurchaseOrderItem(it: Record<string, unknown>): SupportDocumentItemDto {
    const rates = ((it['taxes'] as PurchaseOrderSupportDraftTax[] | null) ?? []).map((t) => ({
      tax_name: t.tax_name,
      tax_rate: Number(t.tax_rate),
      ...(t.tax_type ? { tax_type: t.tax_type } : {}),
    }));
    return {
      description: String(it['description'] ?? ''),
      quantity: Number(it['quantity']),
      unit_price: Number(it['unit_price']),
      discount_amount: Number(it['discount_amount']) || 0,
      ...(rates.length > 0 ? { taxes: rates, is_inclusive: false } : { tax_amount: 0 }),
    };
  }

  removeItem(index: number): void {
    if (this.submitting()) return;
    this.itemsArray.removeAt(index);
  }

  // ── Submit ──────────────────────────────────────────────
  onSubmit(): void {
    if (this.submitting()) return;
    if (this.form.invalid || this.itemsArray.length === 0) {
      this.form.markAllAsTouched();
      return;
    }
    if (this.isPoMode()) {
      this.submitFromPurchaseOrder();
      return;
    }
    this.submitting.set(true);
    this.submitError.set(null);

    const raw = this.form.getRawValue();
    const dto: CreateSupportDocumentDto = {
      invoice_type: raw.invoice_type,
      supplier_id: Number(raw.supplier_id),
      issue_date: raw.issue_date,
      due_date: raw.due_date || undefined,
      withholding_amount: Number(raw.withholding_amount) || 0,
      notes: raw.notes || undefined,
      related_invoice_id:
        raw.invoice_type === 'support_adjustment_note'
          ? Number(raw.related_invoice_id)
          : undefined,
      items: raw.items.map((it: any) => ({
        description: it.description,
        quantity: Number(it.quantity),
        unit_price: Number(it.unit_price),
        discount_amount: Number(it.discount_amount) || 0,
        tax_amount: Number(it.tax_amount) || 0,
      })),
    };

    this.service
      .create(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.submitting.set(false);
          if (response?.success && response.data) {
            this.created.emit(response.data);
            this.onClose();
          } else {
            this.submitError.set(
              response?.message ?? 'No se pudo crear el documento soporte.',
            );
          }
        },
        error: (err) => {
          this.submitting.set(false);
          this.submitError.set(this.extractError(err));
        },
      });
  }

  // ── Modo OC (QUI-684) ───────────────────────────────────
  private newRequestId(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  private enablePoValidators(): void {
    const ctrl = this.form.controls['payment_form'];
    ctrl.setValidators([Validators.required]);
    ctrl.updateValueAndValidity({ emitEvent: false });
  }

  /**
   * Consulta el borrador de la OC. `prefill` solo en la apertura: al re-consultar
   * tras completar el proveedor se actualizan faltantes y proveedor, nunca lo que
   * el usuario ya editó en ítems, fechas o notas.
   */
  private loadDraft(poId: number, prefill: boolean): void {
    this.cancelDraftLoad();
    const generation = ++this.draftGeneration;
    this.draftLoading.set(true);
    this.draftError.set(null);
    this.draftRequest = this.service
      .getPurchaseOrderDraft(poId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (generation !== this.draftGeneration || !this.isOpen()) return;
          this.draftLoading.set(false);
          if (!response?.data) {
            this.draftError.set('No se pudo consultar la orden de compra.');
            return;
          }
          this.applyDraft(response.data, prefill);
        },
        error: (error: unknown) => {
          if (generation !== this.draftGeneration || !this.isOpen()) return;
          this.draftLoading.set(false);
          this.draftError.set(
            describeApiFailure(error).message ??
              'No se pudo consultar la orden de compra.',
          );
        },
      });
  }

  retryDraft(): void {
    const poId = this.purchaseOrderId();
    if (poId == null || this.submitting()) return;
    this.loadDraft(poId, this.itemsArray.length === 0);
  }

  private cancelDraftLoad(): void {
    this.draftGeneration++;
    this.draftRequest?.unsubscribe();
    this.draftRequest = undefined;
    this.draftLoading.set(false);
  }

  private applyDraft(data: PurchaseOrderSupportDraft, prefill: boolean): void {
    this.draft.set(data);
    this.activeDocument.set(
      data.active_document
        ? { id: data.active_document.id, invoice_number: data.active_document.invoice_number }
        : null,
    );
    this.serverMissing.set(data.missing ?? []);
    this.form.controls['supplier_id'].setValue(data.supplier?.id ?? data.draft.supplier_id);
    if (prefill) {
      const d = data.draft;
      this.itemsArray.clear();
      for (const it of d.items ?? []) {
        this.itemsArray.push(this.buildItemGroup(it));
      }
      this.form.patchValue({
        issue_date: d.issue_date,
        due_date: d.due_date ?? '',
        payment_form: d.payment_form,
        withholding_amount: d.withholding_amount ?? 0,
        notes: d.notes ?? '',
      });
    }
    this.markReviewFields();
    this.formTick.update((n) => n + 1);
  }

  /** Marca en el form los campos que el backend reportó como faltantes (`target: review`). */
  private markReviewFields(): void {
    for (const m of this.serverMissing()) {
      if (m.target !== 'review') continue;
      this.reviewControl(m)?.markAsTouched();
    }
  }

  private reviewControl(m: SupportMissingField) {
    const match = /^items\[(\d+)\]\.(\w+)$/.exec(m.field);
    if (match) return this.itemsArray.at(Number(match[1]))?.get(match[2]) ?? null;
    return this.form.get(m.field);
  }

  /** `true` mientras el dato que el backend echó de menos siga sin corregirse en el form. */
  private reviewStillMissing(m: SupportMissingField): boolean {
    switch (m.code) {
      case 'ITEMS_REQUIRED':
        return this.itemsArray.length === 0;
      case 'ITEM_DESCRIPTION_REQUIRED':
        return !String(this.reviewControl(m)?.value ?? '').trim();
      case 'ITEM_QUANTITY_REQUIRED':
      case 'ITEM_UNIT_PRICE_REQUIRED':
        return !(Number(this.reviewControl(m)?.value) > 0);
      case 'ISSUE_DATE_REQUIRED':
        return !this.form.controls['issue_date'].value;
      case 'PAYMENT_FORM_REQUIRED':
        return !this.form.controls['payment_form'].value;
      default:
        return true;
    }
  }

  completeSupplier(): void {
    const supplierId = this.draft()?.supplier?.id;
    if (supplierId == null || this.submitting()) return;
    this.suppliersService
      .getSupplierById(supplierId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.supplierForModal.set(response?.data ?? null);
          this.supplierModalOpen.set(response?.data != null);
        },
        error: (error: unknown) =>
          this.submitError.set(
            describeApiFailure(error).message ?? 'No se pudo abrir el proveedor.',
          ),
      });
  }

  closeSupplierModal(): void {
    this.supplierModalOpen.set(false);
    this.supplierForModal.set(null);
  }

  onSaveSupplier(data: CreateSupplierDto | UpdateSupplierDto): void {
    const supplier = this.supplierForModal();
    const poId = this.purchaseOrderId();
    if (!supplier || poId == null) return;
    this.supplierSaving.set(true);
    this.suppliersService
      .updateSupplier(supplier.id, data as UpdateSupplierDto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.supplierSaving.set(false);
          this.closeSupplierModal();
          this.toast.success('Proveedor actualizado correctamente');
          this.loadDraft(poId, false);
        },
        error: (error: unknown) => {
          this.supplierSaving.set(false);
          this.toast.error(
            describeApiFailure(error).message ?? 'Error al actualizar proveedor',
          );
        },
      });
  }

  /** Cierra el modal y deja que el padre navegue al documento vigente. */
  readonly viewDocument = output<number>();

  viewActiveDocument(id: number): void {
    this.viewDocument.emit(id);
    this.onClose();
  }

  private submitFromPurchaseOrder(): void {
    const poId = this.purchaseOrderId();
    if (poId == null || this.submitDisabled()) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.submitError.set(null);

    const raw = this.form.getRawValue();
    this.service
      .createFromPurchaseOrder(poId, {
        issue_date: raw.issue_date,
        due_date: raw.due_date || undefined,
        payment_form: raw.payment_form,
        withholding_amount: Number(raw.withholding_amount) || 0,
        notes: raw.notes || undefined,
        items: (raw.items as Record<string, unknown>[]).map((it) =>
          this.toPurchaseOrderItem(it),
        ),
        client_request_id: this.clientRequestId ?? undefined,
        emit_immediately: true,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.submitting.set(false);
          if (response?.success && response.data) {
            const emission = (response.data as unknown as { emission?: SupportDocumentEmissionOutcome })
              .emission;
            this.created.emit(response.data);
            if (emission) {
              this.emissionResult.set(emission);
            } else {
              this.onClose();
            }
          } else {
            this.submitError.set(
              response?.message ?? 'No se pudo generar el documento soporte.',
            );
          }
        },
        error: (err: unknown) => {
          this.submitting.set(false);
          this.handlePoError(err);
        },
      });
  }

  private handlePoError(err: unknown): void {
    const failure = describeApiFailure(err);
    const details = (failure.details ?? {}) as {
      missing?: SupportMissingField[];
      active_document?: { id: number; invoice_number: string };
    };
    if (failure.errorCode === 'INVOICING_SUPPORT_PO_001' && Array.isArray(details.missing)) {
      this.serverMissing.set(details.missing);
      this.markReviewFields();
      this.formTick.update((n) => n + 1);
      this.submitError.set(
        'A la orden le faltan datos para emitir el documento soporte. Revisa la lista y complétalos.',
      );
      return;
    }
    if (failure.errorCode === 'INVOICING_SUPPORT_PO_002') {
      const active = details.active_document;
      if (active) {
        this.activeDocument.set({ id: active.id, invoice_number: active.invoice_number });
        this.submitError.set(
          `Esta orden ya tiene el documento soporte N° ${active.invoice_number} vigente.`,
        );
      } else {
        this.submitError.set('Esta orden ya tiene un documento soporte vigente.');
      }
      return;
    }
    this.submitError.set(failure.message ?? 'No se pudo generar el documento soporte.');
  }

  /**
   * El `message` del backend es de DESARROLLADOR y no se muestra nunca; sobre un
   * `HttpErrorResponse` ademas devuelve "Http failure response for …: 400 Bad
   * Request", que no le dice nada a nadie. El texto visible sale del
   * `error_code` (`ERROR_MESSAGES`), igual que en el resto del modulo.
   */
  private extractError(err: unknown): string {
    return (
      describeApiFailure(err).message ??
      'No se pudo crear el documento soporte.'
    );
  }

  private reset(): void {
    // Con un original a corregir, el form abre como nota de ajuste: el cambio
    // de `invoice_type` (primer control) activa la validación del original.
    const original = this.adjustmentOf();
    this.form.reset({
      invoice_type: original ? 'support_adjustment_note' : 'support_document',
      supplier_id: original?.supplier_id ?? this.initialSupplierId() ?? null,
      related_invoice_id: original?.id ?? null,
      issue_date: toLocalDateString(),
      due_date: '',
      payment_form: null,
      withholding_amount: 0,
      notes: '',
    });
    this.itemsArray.clear();
    this.draft.set(null);
    this.draftError.set(null);
    this.activeDocument.set(null);
    this.serverMissing.set([]);
    this.emissionResult.set(null);
    this.closeSupplierModal();
    this.clientRequestId = null;
    this.form.controls['payment_form'].clearValidators();
    this.form.controls['payment_form'].updateValueAndValidity({ emitEvent: false });
    this.submitError.set(null);
    this.supplierTouchedByUser.set(false);
    this.supplierOptions.set([]);
    this.suppliersError.set(null);
  }

  onClose(): void {
    if (this.submitting()) return;
    this.isOpen.set(false);
  }

  get isOpenModel(): typeof this.isOpen {
    return this.isOpen;
  }
}
