import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../../../../../environments/environment';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import {
  ButtonComponent,
  SelectorComponent,
} from '../../../../../../../shared/components';
import { CurrencyPipe as VendixCurrencyPipe } from '../../../../../../../shared/pipes/currency';
import { TenantPickerComponent } from '../../components/tenant-picker/tenant-picker.component';
import { PlatformAcquirer } from '../../state';

/**
 * CP-platform-fiscal-invoicing-mvp · Phase C.5 — create page V1.
 *
 * Form completo para crear platform-invoice (sales_invoice + support_document):
 *   - TenantPicker (ADR-7): el cliente son stores u organizations
 *   - Resolution selector (filtra por document_type vigente + ClTec)
 *   - Items table con discount + taxes[] + is_inclusive + aiu_component + unit_code
 *   - Modal de linea custom para capturar tax_type (IVA/INC/ICUI/RETE_*)
 *   - Collapsibles: AIU regime (nota 4900 char), Withholdings (practiced/suffered/self),
 *     Global discount (AllowanceCharge), TRM (USD),
 *     Payment form (contado/credito + payment_means_code)
 *   - Submit deshabilitado si hay blockers (consume el flujo de readiness V1)
 *
 * El cliente es un TenantRef discriminated (`{kind, tenant_id}`).
 * El backend (Phase B.1 facade) traduce a CreateInvoiceDto del rail tienda
 * + persiste snapshots de acquirer + invoice en fiscal_evidences.
 *
 * Local state es signals (zoneless). Submit orquestado por signal:
 *   local `submitted` -> disabled buttons + spinner.
 */

// ── Tipos del form ───────────────────────────────────────────────────────

interface FormLineTax {
  tax_type: 'IVA' | 'INC' | 'ICUI' | 'RETE_FUENTE' | 'RETE_IVA' | 'RETE_ICA';
  rate: number; // 0..1
  taxable_amount?: number;
  tax_amount?: number;
  is_inclusive?: boolean;
}

interface FormLine {
  id: string; // uuid local
  description: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  taxes: FormLineTax[];
  unit_code: string; // default 'EA'
  account_code?: string;
  aiu_component?: 'administracion' | 'imprevistos' | 'utilidad';
  is_inclusive: boolean;
}

interface FormWithholding {
  id: string; // uuid local
  role: 'practiced' | 'suffered' | 'self';
  concept_id: number;
  base_amount: number;
  rate: number; // 0..1
  amount?: number; // auto-resuelto
}

interface FormSelectedResolution {
  id: number;
  prefix: string;
  technical_key_fingerprint?: string;
  cltec_status: 'present' | 'absent' | 'invalid';
  emittable: boolean;
}

interface ResolutionListItem {
  id: number;
  prefix: string;
  resolution_number?: string;
  range_from: number;
  range_to: number;
  current_number: number;
  document_type: 'sales_invoice' | 'support_document';
  technical_key_fingerprint: string | null;
  emittable?: boolean;
  cltec_status?: 'present' | 'absent' | 'invalid';
}

@Component({
  selector: 'app-platform-invoice-create',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    ButtonComponent,
    VendixCurrencyPipe,
    SelectorComponent,
    TenantPickerComponent,
  ],
  template: `
    <div class="p-6 max-w-5xl mx-auto">
      <a
        routerLink="/super-admin/fiscal/invoicing/invoices"
        class="text-sm text-primary-600 hover:underline"
      >← Volver al listado</a>

      <h2 class="mt-4 text-2xl font-semibold text-gray-900">
        Nueva factura de plataforma (V1)
      </h2>
      <p class="text-sm text-gray-500 mt-1">
        Emisión contra un tenant (ADR-7). Cubre sales_invoice y support_document.
      </p>

      <form (ngSubmit)="submit()" #f="ngForm" class="mt-6 space-y-6">
        <!-- Section: DocumentType + Resolution + TenantPicker + Items -->
        <fieldset class="bg-white rounded-lg shadow p-4 space-y-4">
          <legend class="font-semibold text-gray-900 px-2">Documento</legend>

          <div class="grid grid-cols-2 gap-3">
            <label class="text-sm">
              <span class="text-gray-700">Tipo de documento</span>
              <app-selector
                [options]="documentTypeOptions"
                (valueChange)="onDocumentTypeChange(($event ?? '').toString())"
              ></app-selector>
            </label>

            <label class="text-sm">
              <span class="text-gray-700">Resolución</span>
              <app-selector
                [options]="resolutionOptions()"
                (valueChange)="onResolutionChange(($event ?? '').toString())"
                [placeholder]="resolutionOptions().length === 0 ? 'Cargando resoluciones...' : 'Seleccionar'"
              ></app-selector>
              @if (selectedResolution() && !selectedResolution()!.emittable) {
                <p class="text-xs text-warning mt-1">
                  Resolución no emitible: {{ selectedResolution()!.cltec_status }} ClTec.
                </p>
              }
            </label>
          </div>

          <label class="text-sm">
            <span class="text-gray-700">Operación</span>
            <app-selector
              [options]="operationTypeOptions"
              (valueChange)="onOperationTypeChange($event)"
            ></app-selector>
          </label>

          @if (operationType() === '09') {
            <label class="text-sm block">
              <span class="text-gray-700">Objeto del contrato AIU <span class="text-red-600">*</span></span>
              <textarea
                [ngModel]="aiuContractObject()"
                (ngModelChange)="aiuContractObject.set($event)"
                name="aiu_contract_object"
                rows="3"
                maxlength="4900"
                required
                class="mt-1 w-full border rounded px-3 py-2 text-sm"
              ></textarea>
              <span class="text-xs text-gray-500">{{ aiuContractObject().length }} / 4900 caracteres (DIAN)</span>
            </label>
          }

          <app-platform-tenant-picker
            (tenantPicked)="onTenantPicked($event)"
          ></app-platform-tenant-picker>

          <!-- Tarjeta de perfil colapsable (P3.5) -->
          <div class="bg-white rounded-lg shadow p-4 space-y-3">
            <button
              type="button"
              (click)="profileCardCollapsed.set(!profileCardCollapsed())"
              class="flex items-center justify-between w-full text-left"
            >
              <span class="font-semibold text-gray-900">
                Perfil de facturación
                @if (profileAppliedName()) {
                  <span class="ml-2 text-xs text-green-700">✓ {{ profileAppliedName() }}</span>
                }
              </span>
              <span class="text-gray-400">{{ profileCardCollapsed() ? '▶' : '▼' }}</span>
            </button>

            @if (!profileCardCollapsed()) {
              @if (profileCatalog().length === 0) {
                <p class="text-sm text-gray-500">
                  No hay perfiles plataforma para op_type {{ operationType() }}. Cree uno en
                  <a routerLink="../profiles/new" class="text-blue-600 underline">Perfiles</a>.
                </p>
              } @else {
                <div class="space-y-2">
                  @for (p of profileCatalog(); track p.id) {
                    @if (p.operation_type === operationType()) {
                      <div
                        class="flex items-center justify-between p-2 border rounded"
                        [class.border-blue-500]="profileSelectedId() === p.id"
                        [class.bg-blue-50]="profileSelectedId() === p.id"
                      >
                        <div>
                          <p class="font-medium text-sm">{{ p.name }}</p>
                          <p class="text-xs text-gray-500">
                            op {{ p.operation_type }} · v{{ p.current_version }}
                            @if (p.is_default) { · predeterminado }
                          </p>
                        </div>
                        <div class="flex gap-2">
                          @if (profileSelectedId() === p.id) {
                            <button
                              type="button"
                              (click)="clearAppliedProfile()"
                              class="text-xs text-red-600 underline"
                            >Quitar</button>
                          } @else {
                            <button
                              type="button"
                              (click)="applyProfile(p.id, p.name)"
                              class="text-xs text-blue-600 underline"
                            >Aplicar</button>
                          }
                        </div>
                      </div>
                    }
                  }
                  @if (profilesForOpType().length === 0) {
                    <p class="text-sm text-gray-500">
                      Sin perfiles para op_type {{ operationType() }}. Cree uno en
                      <a routerLink="../profiles/new" class="text-blue-600 underline">Perfiles</a>.
                    </p>
                  }
                </div>
              }
            }
          </div>
        </fieldset>

        <!-- Items -->
        <fieldset class="bg-white rounded-lg shadow p-4 space-y-3">
          <legend class="font-semibold text-gray-900 px-2">Líneas</legend>

          @if (lines().length === 0) {
            <p class="text-sm text-gray-500">Sin líneas. Agregue al menos una.</p>
          } @else {
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-xs text-gray-500 border-b">
                  <th>Descripción</th>
                  <th class="w-20 text-right">Cant</th>
                  <th class="w-28 text-right">Precio</th>
                  <th class="w-24 text-right">Desc</th>
                  <th class="w-20">UD</th>
                  <th class="w-32">Impuestos</th>
                  <th class="w-24">AIU</th>
                  <th class="w-12"></th>
                </tr>
              </thead>
              <tbody>
                @for (line of lines(); track line.id; let i = $index) {
                  <tr class="border-b">
                    <td class="py-2">{{ line.description }}</td>
                    <td class="text-right">{{ line.quantity }}</td>
                    <td class="text-right">{{ line.unit_price | currency }}</td>
                    <td class="text-right">
                      @if (line.discount_amount) { {{ line.discount_amount | currency }} }
                    </td>
                    <td>{{ line.unit_code }}</td>
                    <td class="text-xs">{{ line.taxes.length }} imp</td>
                    <td class="text-xs">{{ line.aiu_component ?? '—' }}</td>
                    <td>
                      <button type="button" (click)="removeLine(i)" class="text-red-600">×</button>
                    </td>
                  </tr>
                }
              </tbody>
              <tfoot class="text-sm border-t">
                <tr>
                  <td colspan="2" class="py-2 text-right font-semibold">Subtotal</td>
                  <td class="text-right">{{ subtotal() | currency }}</td>
                  <td></td>
                </tr>
                <tr>
                  <td colspan="2" class="text-right">Impuestos</td>
                  <td class="text-right">{{ taxesTotal() | currency }}</td>
                  <td></td>
                </tr>
                <tr class="border-t">
                  <td colspan="2" class="py-2 text-right font-semibold">Total</td>
                  <td class="text-right font-semibold">{{ total() | currency }}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          }

          <!-- Modal inline para linea (C.3 — CustomItemModal) -->
          @if (showLineModal()) {
            <div class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
              <div class="bg-white rounded-lg shadow-xl w-full max-w-lg p-5 space-y-3">
                <h3 class="font-semibold text-gray-900">Nueva línea</h3>
                <div class="grid grid-cols-12 gap-2 items-end">
                  <label class="col-span-12 text-sm">
                    <span class="text-gray-700">Descripción <span class="text-red-600">*</span></span>
                    <input
                      [ngModel]="newLine().description"
                      (ngModelChange)="onNewLineDescription($event)"
                      name="line_desc"
                      maxlength="500"
                      required
                      class="mt-1 w-full border rounded px-3 py-2"
                    />
                  </label>
                  <label class="col-span-4 text-sm">
                    <span class="text-gray-700">Cant <span class="text-red-600">*</span></span>
                    <input
                      type="number"
                      step="0.0001"
                      [ngModel]="newLine().quantity"
                      (ngModelChange)="onNewLineQuantity($event)"
                      name="line_qty"
                      required
                      class="mt-1 w-full border rounded px-3 py-2 text-right"
                    />
                  </label>
                  <label class="col-span-4 text-sm">
                    <span class="text-gray-700">Precio unit <span class="text-red-600">*</span></span>
                    <input
                      type="number"
                      step="0.0001"
                      [ngModel]="newLine().unit_price"
                      (ngModelChange)="onNewLinePrice($event)"
                      name="line_price"
                      required
                      class="mt-1 w-full border rounded px-3 py-2 text-right"
                    />
                  </label>
                  <label class="col-span-4 text-sm">
                    <span class="text-gray-700">Desc</span>
                    <input
                      type="number"
                      step="0.01"
                      [ngModel]="newLine().discount_amount"
                      (ngModelChange)="onNewLineDiscount($event)"
                      name="line_disc"
                      class="mt-1 w-full border rounded px-3 py-2 text-right"
                    />
                  </label>

                  <fieldset class="col-span-12 text-sm border rounded p-2">
                    <legend class="text-xs text-gray-700 px-1">Impuestos por línea (rate 0..1)</legend>
                    @for (tax of newLine().taxes; track $index; let i = $index) {
                      <div class="grid grid-cols-12 gap-2 items-center">
                        <select
                          [ngModel]="tax.tax_type"
                          (ngModelChange)="updateLineTax(i, 'tax_type', $event)"
                          name="line_tax_type_{{ i }}"
                          class="col-span-3 border rounded px-2 py-1"
                        >
                          <option value="IVA">IVA</option>
                          <option value="INC">INC</option>
                          <option value="ICUI">ICUI</option>
                          <option value="RETE_FUENTE">ReteFuente</option>
                          <option value="RETE_IVA">ReteIVA</option>
                          <option value="RETE_ICA">ReteICA</option>
                        </select>
                        <input
                          type="number"
                          step="0.0001"
                          min="0"
                          max="1"
                          [ngModel]="tax.rate"
                          (ngModelChange)="updateLineTax(i, 'rate', +$event || 0)"
                          name="line_tax_rate_{{ i }}"
                          class="col-span-4 border rounded px-2 py-1 text-right"
                        />
                        <label class="col-span-3 flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            [ngModel]="tax.is_inclusive"
                            (ngModelChange)="updateLineTax(i, 'is_inclusive', $event)"
                            name="line_tax_incl_{{ i }}"
                          />inclusivo
                        </label>
                        <button type="button" (click)="removeLineTax(i)" class="col-span-2 text-red-600 text-xs">Quitar</button>
                      </div>
                    }
                    <button type="button" (click)="addLineTax()" class="text-xs text-primary-600 mt-2">
                      + Añadir impuesto
                    </button>
                  </fieldset>

                  @if (operationType() === '09') {
                    <fieldset class="col-span-12 text-sm border rounded p-2">
                      <legend class="text-xs text-gray-700 px-1">Componente AIU</legend>
                      <app-selector
                        [options]="aiuComponentOptions"
                        (valueChange)="onNewLineAiuComponent($event)"
                      ></app-selector>
                    </fieldset>
                  }

                  <label class="col-span-6 text-sm">
                    <span class="text-gray-700">Unidad (UN/ECE)</span>
                    <input
                      [ngModel]="newLine().unit_code"
                      (ngModelChange)="onNewLineUnitCode($event)"
                      name="line_unit_code"
                      maxlength="10"
                      class="mt-1 w-full border rounded px-3 py-2"
                    />
                  </label>
                </div>

                <div class="flex justify-end gap-2 pt-2">
                  <button app-button type="button" variant="secondary" (click)="cancelLine()">
                    Cancelar
                  </button>
                  <button app-button type="button" variant="primary" (click)="confirmLine()">
                    Añadir línea
                  </button>
                </div>
              </div>
            </div>
          }

          <button type="button" app-button variant="primary" (click)="openLineModal()">
            + Añadir línea
          </button>
        </fieldset>

        <!-- Withholdings -->
        <fieldset class="bg-white rounded-lg shadow p-4 space-y-3">
          <legend class="font-semibold text-gray-900 px-2">Retenciones</legend>
          @for (wh of withholdings(); track wh.id; let i = $index) {
            <div class="grid grid-cols-12 gap-2 items-end">
              <app-selector
                [options]="withholdingRoleOptions"
                (valueChange)="updateWithholding(i, 'role', ($event ?? 'practiced').toString())"
                class="col-span-3"
              ></app-selector>
              <label class="col-span-2 text-sm">
                <span class="text-gray-700">Concept ID</span>
                <input
                  type="number"
                  [ngModel]="wh.concept_id"
                  (ngModelChange)="updateWithholding(i, 'concept_id', +$event || 0)"
                  name="wh_concept_{{ i }}"
                  class="mt-1 w-full border rounded px-3 py-2 text-right"
                />
              </label>
              <label class="col-span-3 text-sm">
                <span class="text-gray-700">Base</span>
                <input
                  type="number"
                  step="0.01"
                  [ngModel]="wh.base_amount"
                  (ngModelChange)="updateWithholding(i, 'base_amount', +$event || 0)"
                  name="wh_base_{{ i }}"
                  class="mt-1 w-full border rounded px-3 py-2 text-right"
                />
              </label>
              <label class="col-span-2 text-sm">
                <span class="text-gray-700">Rate (0..1)</span>
                <input
                  type="number"
                  step="0.000001"
                  min="0"
                  max="1"
                  [ngModel]="wh.rate"
                  (ngModelChange)="updateWithholding(i, 'rate', +$event || 0)"
                  name="wh_rate_{{ i }}"
                  class="mt-1 w-full border rounded px-3 py-2 text-right"
                />
              </label>
              <span class="col-span-1 text-xs text-gray-500">{{ wh.rate * 100 }}%</span>
              <button type="button" (click)="removeWithholding(i)" class="col-span-1 text-red-600">×</button>
            </div>
          }
          <button type="button" app-button variant="secondary" (click)="addWithholding()">
            + Añadir retención
          </button>
        </fieldset>

        <!-- Global discount + TRM + Payment form -->
        <fieldset class="bg-white rounded-lg shadow p-4 space-y-3">
          <legend class="font-semibold text-gray-900 px-2">Más opciones</legend>

          <div class="grid grid-cols-2 gap-3">
            <label class="text-sm">
              <span class="text-gray-700">Descuento global (AllowanceCharge)</span>
              <input
                type="number"
                step="0.01"
                min="0"
                [ngModel]="globalDiscountAmount()"
                (ngModelChange)="globalDiscountAmount.set(+$event || 0)"
                name="global_discount"
                class="mt-1 w-full border rounded px-3 py-2 text-right"
              />
            </label>
            <label class="text-sm">
              <span class="text-gray-700">Currency</span>
              <app-selector
                [options]="currencyOptions"
                (valueChange)="currencyIso.set(($event ?? 'COP').toString())"
              ></app-selector>
            </label>
          </div>

          @if (currencyIso() !== 'COP') {
            <div class="grid grid-cols-2 gap-3 border-t pt-3">
              <label class="text-sm">
                <span class="text-gray-700">Fecha TRM</span>
                <input
                  type="date"
                  [ngModel]="exchangeRateDate()"
                  (ngModelChange)="exchangeRateDate.set($event)"
                  name="erm_date"
                  class="mt-1 w-full border rounded px-3 py-2"
                />
              </label>
              <label class="text-sm">
                <span class="text-gray-700">TRM</span>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  [ngModel]="exchangeRate()"
                  (ngModelChange)="exchangeRate.set(+$event || 0)"
                  name="erm"
                  class="mt-1 w-full border rounded px-3 py-2 text-right"
                />
              </label>
            </div>
          }

          <div class="grid grid-cols-2 gap-3">
            <label class="text-sm">
              <span class="text-gray-700">Forma de pago</span>
              <app-selector
                [options]="paymentFormOptions"
                (valueChange)="onPaymentFormChange($event)"
              ></app-selector>
            </label>
            @if (paymentForm() === '2') {
              <label class="text-sm">
                <span class="text-gray-700">Vencimiento</span>
                <input
                  type="date"
                  [ngModel]="dueDate()"
                  (ngModelChange)="dueDate.set($event)"
                  name="due_date"
                  class="mt-1 w-full border rounded px-3 py-2"
                />
              </label>
            }
          </div>
        </fieldset>

        @if (errorMessage(); as err) {
          <p class="text-sm text-red-600">{{ err }}</p>
        }

        <div class="flex justify-end gap-2">
          <a routerLink="/super-admin/fiscal/invoicing/invoices" app-button variant="secondary">
            Cancelar
          </a>
          <button
            type="submit"
            app-button
            variant="primary"
            [disabled]="submitting() || !canSubmit()"
          >
            {{ submitting() ? 'Creando…' : 'Crear y emitir' }}
          </button>
        </div>
      </form>
    </div>
  `,
})
export class PlatformInvoiceCreateComponent {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  private readonly base = `${environment.apiUrl}/superadmin/subscriptions/fiscal`;

  // ── Document state ──────────────────────────────────────────────────────

  readonly documentType = signal<'sales_invoice' | 'support_document'>('sales_invoice');
  readonly operationType = signal<'10' | '09' | '11' | '12'>('10');
  readonly aiuContractObject = signal<string>('');

  readonly resolutionId = signal<number | null>(null);
  readonly resolutions = signal<ResolutionListItem[]>([]);
  readonly selectedResolution = computed(() => {
    const id = this.resolutionId();
    return id ? (this.resolutions().find((r) => r.id === id) ?? null) : null;
  });
  readonly resolutionOptions = computed(() =>
    this.resolutions().map((r) => ({
      value: r.id.toString(),
      label: `${r.prefix} (${r.document_type}) · ${r.current_number}/${r.range_to}${
        r.emittable === false ? ' — ! emitible' : ''
      }`,
    })),
  );

  // ── TenantPicker integration ──────────────────────────────────────────
  // TenantPicker is its own component that emits (tenantPicked).
  // We capture here and lock the acquirer into the form.

  readonly acquirer = signal<PlatformAcquirer | null>(null);

  // ── Profile catalog (P3.5: tarjeta colapsable) ─────────────────────────
  readonly profileCatalog = signal<any[]>([]);
  readonly profileSelectedId = signal<number | null>(null);
  readonly profileAppliedName = signal<string | null>(null);
  readonly profileCardCollapsed = signal(false);
  /** Perfiles del catálogo que coinciden con el operationType actual. */
  readonly profilesForOpType = computed(() => {
    const op = this.operationType();
    return this.profileCatalog().filter((p) => p.operation_type === op);
  });

  // ── Items state (signals para zoneless) ────────────────────────────────

  readonly lines = signal<FormLine[]>([]);
  readonly newLine = signal<FormLine>(this.makeEmptyLine());
  readonly showLineModal = signal(false);

  // Computeds (subtotal / taxes / total con redondeo por línea).
  readonly subtotal = computed(() =>
    Math.round(
      this.lines().reduce(
        (acc, l) => acc + (l.quantity * l.unit_price - (l.discount_amount ?? 0)),
        0,
      ) * 100,
    ) / 100,
  );
  readonly taxesTotal = computed(() => {
    let total = 0;
    for (const l of this.lines()) {
      const lineSubtotal = l.quantity * l.unit_price - (l.discount_amount ?? 0);
      for (const t of l.taxes) {
        total += lineSubtotal * (t.rate ?? 0);
      }
    }
    return Math.round(total * 100) / 100;
  });
  readonly total = computed(
    () => this.subtotal() + this.taxesTotal() - (this.globalDiscountAmount() ?? 0),
  );

  // ── Withholdings ──────────────────────────────────────────────────────

  readonly withholdings = signal<FormWithholding[]>([]);

  // ── Discount + Currency + Payment ──────────────────────────────────────

  readonly globalDiscountAmount = signal<number>(0);
  readonly currencyIso = signal<string>('COP');
  readonly exchangeRate = signal<number>(0);
  readonly exchangeRateDate = signal<string>('');
  readonly paymentForm = signal<'1' | '2'>('1');
  readonly dueDate = signal<string>('');

  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly canSubmit = computed(() => {
    return (
      this.lines().length > 0 &&
      !!this.acquirer() &&
      !!this.resolutionId() &&
      (this.operationType() !== '09' || this.aiuContractObject().length >= 4900)
    );
  });

  // ── Selectors ──────────────────────────────────────────────────────────

  readonly documentTypeOptions = [
    { value: 'sales_invoice', label: 'Factura de venta' },
    { value: 'support_document', label: 'Documento soporte' },
  ];

  readonly operationTypeOptions = [
    { value: '10', label: 'Estandar' },
    { value: '09', label: 'AIU' },
    { value: '11', label: 'Mandato' },
    { value: '12', label: 'Consorcio' },
  ];

  readonly aiuComponentOptions = [
    { value: '', label: '— ninguno —' },
    { value: 'administracion', label: 'Administración' },
    { value: 'imprevistos', label: 'Imprevistos' },
    { value: 'utilidad', label: 'Utilidad' },
  ];

  readonly currencyOptions = [
    { value: 'COP', label: 'COP' },
    { value: 'USD', label: 'USD' },
  ];

  readonly paymentFormOptions = [
    { value: '1', label: 'Contado' },
    { value: '2', label: 'Crédito' },
  ];

  readonly withholdingRoleOptions = [
    { value: 'practiced', label: 'Practiced' },
    { value: 'suffered', label: 'Suffered' },
    { value: 'self', label: 'Self' },
  ];

  // ── Lifecycle ─────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.loadResolutions();
    this.loadProfileCatalog();
  }

  async loadResolutions(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ success: boolean; data: { data: ResolutionListItem[]; meta: any } }>(
          `${this.base}/resolutions-for-emission`,
          { params: { document_type: this.documentType() } },
        ),
      );
      this.resolutions.set(res.data.data ?? []);
    } catch {
      this.resolutions.set([]);
    }
  }

  async loadProfileCatalog(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ success: boolean; data: any[] }>(
          `${this.base}/profiles/catalog`,
        ),
      );
      this.profileCatalog.set(res.data ?? []);
    } catch {
      this.profileCatalog.set([]);
    }
  }

  /**
   * Aplica un perfil al wizard. El backend acepta `profile_id` en el DTO y
   * persiste el snapshot. Por ahora sólo guardamos el `profile_id` para
   * enviarlo en submit; un slice futuro precarga secciones desde el profile
   * (config.aiu, config.taxes, etc.).
   */
  applyProfile(profileId: number, profileName: string): void {
    this.profileSelectedId.set(profileId);
    this.profileAppliedName.set(profileName);
    this.toast.info(`Perfil aplicado: ${profileName}`, '');
  }

  clearAppliedProfile(): void {
    this.profileSelectedId.set(null);
    this.profileAppliedName.set(null);
  }

  onDocumentTypeChange(value: string): void {
    const next = value === 'support_document' ? 'support_document' : 'sales_invoice';
    this.documentType.set(next);
    this.resolutionId.set(null);
    this.loadResolutions();
  }

  onOperationTypeChange(value: string | number | null): void {
    const v = (value ?? '10').toString();
    if (v === '09' || v === '11' || v === '12') {
      this.operationType.set(v);
    } else {
      this.operationType.set('10');
    }
  }

  onPaymentFormChange(value: string | number | null): void {
    const v = (value ?? '1').toString();
    this.paymentForm.set(v === '2' ? '2' : '1');
  }

  onNewLineDescription(value: string): void {
    this.newLine.update((l) => ({ ...l, description: value }));
  }

  onNewLineQuantity(value: string | number): void {
    this.newLine.update((l) => ({ ...l, quantity: Number(value) || 0 }));
  }

  onNewLinePrice(value: string | number): void {
    this.newLine.update((l) => ({ ...l, unit_price: Number(value) || 0 }));
  }

  onNewLineDiscount(value: string | number): void {
    this.newLine.update((l) => ({ ...l, discount_amount: Number(value) || 0 }));
  }

  onNewLineUnitCode(value: string): void {
    this.newLine.update((l) => ({ ...l, unit_code: value || 'EA' }));
  }

  onNewLineAiuComponent(value: string | number | null): void {
    const v = (value ?? '').toString();
    const valid = v === 'administracion' || v === 'imprevistos' || v === 'utilidad';
    this.newLine.update((l) => ({
      ...l,
      aiu_component: valid ? (v as 'administracion' | 'imprevistos' | 'utilidad') : undefined,
    }));
  }

  onResolutionChange(value: string): void {
    const id = value ? Number(value) : null;
    this.resolutionId.set(id && !Number.isNaN(id) ? id : null);
  }

  onTenantPicked(tenant: PlatformAcquirer | null): void {
    this.acquirer.set(tenant);
  }

  // ── Lines ────────────────────────────────────────────────────────────

  openLineModal(): void {
    this.newLine.set(this.makeEmptyLine());
    this.showLineModal.set(true);
  }
  cancelLine(): void {
    this.showLineModal.set(false);
  }
  confirmLine(): void {
    const line = this.newLine();
    if (!line.description || line.quantity <= 0 || line.unit_price < 0) {
      this.toast.error('La línea requiere descripción, cantidad > 0 y precio >= 0.');
      return;
    }
    this.lines.update((arr) => [...arr, line]);
    this.showLineModal.set(false);
  }
  removeLine(i: number): void {
    this.lines.update((arr) => arr.filter((_, idx) => idx !== i));
  }

  addLineTax(): void {
    this.newLine.update((l) => ({
      ...l,
      taxes: [...l.taxes, { tax_type: 'IVA', rate: 0.19 }],
    }));
  }
  removeLineTax(i: number): void {
    this.newLine.update((l) => ({
      ...l,
      taxes: l.taxes.filter((_, idx) => idx !== i),
    }));
  }
  updateLineTax(i: number, key: 'tax_type' | 'rate' | 'is_inclusive', value: any): void {
    this.newLine.update((l) => ({
      ...l,
      taxes: l.taxes.map((t, idx) =>
        idx === i
          ? key === 'tax_type'
            ? { ...t, tax_type: value }
            : key === 'rate'
            ? { ...t, rate: Number(value) }
            : { ...t, is_inclusive: Boolean(value) }
          : t,
      ),
    }));
  }

  // ── Withholdings ──────────────────────────────────────────────────────

  addWithholding(): void {
    this.withholdings.update((arr) => [
      ...arr,
      { id: this.uuid(), role: 'practiced', concept_id: 0, base_amount: 0, rate: 0 },
    ]);
  }
  removeWithholding(i: number): void {
    this.withholdings.update((arr) => arr.filter((_, idx) => idx !== i));
  }
  updateWithholding(i: number, key: keyof FormWithholding, value: any): void {
    this.withholdings.update((arr) =>
      arr.map((wh, idx) => (idx === i ? { ...wh, [key]: value } : wh)),
    );
  }

  // ── Submit ────────────────────────────────────────────────────────────

  async submit(): Promise<void> {
    if (!this.canSubmit()) {
      this.toast.error('Formulario incompleto. Verifica destinatario, resolución y líneas.');
      return;
    }
    const tenant = this.acquirer();
    if (!tenant) {
      this.toast.error('Selecciona un destinatario.');
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);

    const customer = {
      kind: tenant.kind,
      tenant_id: tenant.tenant_id,
      // overrides inline si el operador los lleno en el form
      legal_name_override: tenant.legal_name,
      person_type_override: tenant.person_type ?? '2',
      tax_regime_code_override: tenant.tax_regime_code,
    } as any;

    const body =
      this.documentType() === 'sales_invoice'
        ? {
            customer,
            items: this.lines().map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unit_price: l.unit_price,
              discount_amount: l.discount_amount || undefined,
              taxes: l.taxes.length > 0 ? l.taxes : undefined,
              unit_code: l.unit_code,
              account_code: l.account_code,
              aiu_component: l.aiu_component,
              is_inclusive: l.is_inclusive,
            })),
            operation_type: this.operationType(),
            aiu_contract_object:
              this.operationType() === '09' ? this.aiuContractObject() : undefined,
            payment_form: this.paymentForm(),
            due_date: this.dueDate() || undefined,
            currency: {
              iso_4217: this.currencyIso(),
              exchange_rate: this.exchangeRate() || undefined,
              exchange_rate_date: this.exchangeRateDate() || undefined,
            },
            withholdings:
              this.withholdings().length > 0
                ? this.withholdings().map((wh) => ({
                    role: wh.role,
                    concept_id: wh.concept_id,
                    base_amount: wh.base_amount,
                    rate: wh.rate,
                    amount: wh.amount,
                  }))
                : undefined,
            global_discount_amount: this.globalDiscountAmount() || undefined,
            resolution_id: this.resolutionId(),
            profile_id: this.profileSelectedId() ?? undefined,
          }
        : {
            supplier: customer,
            items: this.lines().map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unit_price: l.unit_price,
              discount_amount: l.discount_amount || undefined,
              taxes: l.taxes.length > 0 ? l.taxes : undefined,
              unit_code: l.unit_code,
            })),
            operation_type: this.operationType(),
            payment_means_code: '10',
            due_date: this.dueDate() || undefined,
            currency: {
              iso_4217: this.currencyIso(),
              exchange_rate: this.exchangeRate() || undefined,
              exchange_rate_date: this.exchangeRateDate() || undefined,
            },
            global_discount_amount: this.globalDiscountAmount() || undefined,
            resolution_id: this.resolutionId(),
            profile_id: this.profileSelectedId() ?? undefined,
          };

    const url =
      this.documentType() === 'sales_invoice'
        ? `${this.base}/sales-invoices`
        : `${this.base}/support-documents`;

    try {
      const res = await firstValueFrom(
        this.http.post<{ success: boolean; data: { invoice_id: number; fiscal_number: string } }>(
          url,
          body,
        ),
      );
      if (res.success && res.data?.invoice_id) {
        this.toast.success(
          `Factura ${res.data.fiscal_number} creada. Redirigiendo al detalle.`,
        );
        this.router.navigate([
          '/super-admin/fiscal/invoicing/platform-invoices',
          res.data.invoice_id,
        ]);
      } else {
        this.errorMessage.set('La API no devolvió el resultado esperado.');
      }
    } catch (error) {
      const msg =
        (error instanceof HttpErrorResponse && (error.error?.message ?? error.message)) ||
        (error instanceof Error ? error.message : null) ||
        'Error desconocido al crear la factura.';
      this.errorMessage.set(msg);
      this.toast.error(msg);
    } finally {
      this.submitting.set(false);
    }
  }

  // ── Utils ────────────────────────────────────────────────────────────

  private makeEmptyLine(): FormLine {
    return {
      id: this.uuid(),
      description: '',
      quantity: 1,
      unit_price: 0,
      discount_amount: 0,
      taxes: [],
      unit_code: 'EA',
      is_inclusive: false,
    };
  }

  private uuid(): string {
    return `l-${Math.random().toString(36).slice(2, 10)}`;
  }
}
