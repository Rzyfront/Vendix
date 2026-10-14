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
import type {
  CreateSupportDocumentDto,
  SupportDocumentRow,
  SupportDocumentType,
} from '../../interfaces/support-document.interface';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  TextareaComponent,
} from '../../../../../../shared/components/index';
import type { SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { toLocalDateString } from '../../../../../../shared/utils/date.util';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { Subscription } from 'rxjs';

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
  ],
  template: `
    <app-modal
      [(isOpen)]="isOpenModel"
      (cancel)="onClose()"
      title="Nuevo documento soporte"
      size="lg"
      [dialog]="true"
      [canClose]="canCloseModal"
    >
      <form
        [formGroup]="form"
        (ngSubmit)="onSubmit()"
        class="space-y-4 p-4"
      >
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
      </form>

      <div slot="footer">
        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
          <app-button customClasses="w-full sm:w-auto" variant="outline" [disabled]="submitting()" (clicked)="onClose()">
            Cancelar
          </app-button>
          <app-button
            customClasses="w-full sm:w-auto"
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="form.invalid || submitting() || itemsArray.length === 0"
            [loading]="submitting()"
          >
            Crear documento soporte
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class SupportDocumentCreateComponent {
  readonly isOpen = model.required<boolean>();

  /** ID inicial del proveedor (si el padre lo trae, ej: desde la pantalla del proveedor). */
  readonly initialSupplierId = input<number | null>(null);

  readonly created = output<SupportDocumentRow>();

  private fb = inject(FormBuilder);
  private service = inject(SupportDocumentService);
  private suppliersService = inject(SuppliersService);
  private currencyService = inject(CurrencyFormatService);
  private destroyRef = inject(DestroyRef);

  readonly submitting = signal(false);
  readonly submitError = signal<string | null>(null);
  readonly suppliersLoading = signal(false);
  readonly suppliersError = signal<string | null>(null);
  readonly canCloseModal = (): boolean => !this.submitting();

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
      withholding_amount: [0],
      notes: [''],
      items: this.fb.array([]),
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
  }

  get itemsArray(): FormArray {
    return this.form.get('items') as FormArray;
  }

  // ── Suppliers ────────────────────────────────────────────
  private loadSuppliers(): void {
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
    this.itemsArray.push(
      this.fb.group({
        description: ['', [Validators.required, Validators.minLength(2)]],
        quantity: [1, [Validators.required, Validators.min(1)]],
        unit_price: [0, [Validators.required, Validators.min(0)]],
        discount_amount: [0],
        tax_amount: [0],
      }),
    );
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
    this.form.reset({
      invoice_type: 'support_document',
      supplier_id: this.initialSupplierId() ?? null,
      related_invoice_id: null,
      issue_date: toLocalDateString(),
      due_date: '',
      withholding_amount: 0,
      notes: '',
    });
    this.itemsArray.clear();
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
