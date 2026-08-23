import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { formatDate } from '@angular/common';
import { extractApiErrorMessage } from '../../../../../../../core/utils/api-error-handler';
import { DestroyRef } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { merge } from 'rxjs';
import { scan } from 'rxjs/operators';
import {
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { FileUploadDropzoneComponent } from '../../../../../../../shared/components/file-upload-dropzone/file-upload-dropzone.component';
import { AiReviewAckComponent } from '../../../../../../../shared/components/ai-review-ack/ai-review-ack.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { InputButtonsComponent } from '../../../../../../../shared/components/input-buttons/input-buttons.component';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import {
  ConfigurePaymentPlanDto,
  ConfigurePaymentPlanMode,
  PaymentScanResult,
  PurchaseOrdersService,
} from '../../../services';
import {
  maxValueValidator,
  minDateValidator,
  round2,
} from '../pop-checkout-shell/steps/payment-validators';
import { POP_PAYMENT_MODE_OPTIONS } from '../pop-checkout-shell/steps/pop-payment-step.component';
import { toLocalDateString } from '../../../../../../../shared/utils/date.util';

/**
 * Forma de la orden que consume este modal. NO redefinir localmente los DTOs:
 * `ConfigurePaymentPlanMode` y `ConfigurePaymentPlanDto` ya viven en
 * `purchase-orders.service.ts:346-362` y son la única fuente de verdad.
 */
export interface PoPaymentModalOrder {
  id: number;
  total_amount: number | string;
  paid_amount: number | string;
  payment_plan?: string | null;
  status?: string | null;
}

/**
 * Modal DUAL del OC detail (QUI-647 — FASE Track B + Track C).
 *
 * Vista `pay` (default al abrir desde el header button "Pagar"):
 *   - Layout 50/50 (md+): izquierda formulario manual (monto/fecha/método/
 *     referencia/notas), derecha escáner OCR async de comprobante.
 *   - Submit → POST /payments (`registerPurchaseOrderPayment`).
 *   - El escáner pre-rellena los campos vía `applyScanResult()`. Si hubo
 *     precarga, exige `aiAck` (verificación obligatoria de los datos de IA).
 *   - Si el modal se abrió desde el ícono "Pagar" de una cuota del plan, los
 *     inputs `presetAmount` / `presetDate` quedan pre-llenados y son editables.
 *
 * Vista `plan` (default al abrir desde "Configurar pago"):
 *   - Selector de modo (`immediate|partial|deferred|installments`) + campos
 *     condicionales. Misma lógica que el wizard POP.
 *   - Submit → PATCH /payment-plan (`configurePaymentPlan`).
 *
 * Toggle interno entre vistas: dos botones segmentados en el header del modal
 * ("Registrar pago" | "Configurar plan"). No se cierra el modal al alternar.
 *
 * Patrón reactivo: bridge `formTick = toSignal(merge(form.valueChanges,
 * installments.valueChanges).pipe(scan(...)))` para que las computeds que leen
 * el form re-evalúen en zoneless (ver `vendix-zoneless-signals`: puentea
 * `valueChanges`, nunca `statusChanges` cuando el control no tiene validators).
 */
@Component({
  selector: 'app-po-payment-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    FileUploadDropzoneComponent,
    AiReviewAckComponent,
    IconComponent,
    InputComponent,
    InputButtonsComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onModalClose($event)"
      title="Registrar Pago"
      size="xl"
    >
      <!-- Toggle interno entre vistas (segmented buttons) -->
      <div slot="header-actions" class="po-view-toggle">
        <button
          type="button"
          class="po-view-toggle-btn"
          [class.po-view-toggle-active]="activeView() === 'pay'"
          (click)="setView('pay')"
          data-testid="po-view-pay"
        >
          <app-icon name="credit-card" [size]="14"></app-icon>
          Registrar pago
        </button>
        <button
          type="button"
          class="po-view-toggle-btn"
          [class.po-view-toggle-active]="activeView() === 'plan'"
          (click)="setView('plan')"
          data-testid="po-view-plan"
        >
          <app-icon name="calendar" [size]="14"></app-icon>
          Configurar plan
        </button>
      </div>

      <!-- ════════ VISTA: REGISTRAR PAGO (default) ════════ -->
      @if (activeView() === 'pay') {
        <div class="po-payment-grid">
          <!-- COLUMNA IZQUIERDA: formulario manual -->
          <div class="space-y-4">
            <div>
              <label for="payment-amount" class="text-sm font-medium text-text-primary block mb-1.5">Monto</label>
              <input
                id="payment-amount"
                type="number"
                class="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                [value]="amountValue()"
                (input)="onAmountChange($event)"
                [min]="0"
                [step]="0.01"
                placeholder="0.00"
                data-testid="po-amount-input"
              />
              <p class="text-xs text-text-muted mt-1">
                Total orden: {{ formatCurrency(total()) }} · Pagado: {{ formatCurrency(paidAmount()) }} · Pendiente: {{ formatCurrency(remaining()) }}
              </p>
              <!--
                Los dos límites del monto tienen que DECIRSE, no solo apagar el
                submit: isPayValid() exige "a > 0 && a <= remaining", y hasta
                aquí el sobrepago se explicaba pero un monto en cero o negativo
                dejaba el botón muerto sin motivo visible (camino triste sin
                salida legible). El piso coincide con lo que el servidor rechaza
                desde RegisterPaymentDto (Min 0.01): cero también es un pago
                inválido, no solo los negativos.
              -->
              @if (amountValue() <= 0) {
                <p class="text-xs text-destructive mt-1">El monto debe ser mayor que cero.</p>
              } @else if (amountValue() > remaining()) {
                <p class="text-xs text-destructive mt-1">El monto no puede superar el saldo pendiente.</p>
              }
            </div>

            <div>
              <label for="payment-date" class="text-sm font-medium text-text-primary block mb-1.5">Fecha de pago</label>
              <input
                id="payment-date"
                type="date"
                class="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                [value]="paymentDate()"
                (input)="onPaymentDateChange($event)"
                data-testid="po-date-input"
              />
            </div>

            <div>
              <label for="payment-method" class="text-sm font-medium text-text-primary block mb-1.5">Método de pago</label>
              <select
                id="payment-method"
                class="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                [value]="paymentMethod()"
                (change)="onPaymentMethodChange($event)"
                data-testid="po-method-select"
              >
                <option value="cash">Efectivo</option>
                <option value="bank_transfer">Transferencia bancaria</option>
                <option value="check">Cheque</option>
                <option value="credit_card">Tarjeta de crédito</option>
              </select>
            </div>

            <div>
              <label for="payment-ref" class="text-sm font-medium text-text-primary block mb-1.5">Referencia</label>
              <input
                id="payment-ref"
                type="text"
                class="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                [value]="reference()"
                (input)="onReferenceChange($event)"
                placeholder="No. de transferencia, cheque, etc."
                data-testid="po-reference-input"
              />
            </div>

            <div>
              <label for="payment-notes" class="text-sm font-medium text-text-primary block mb-1.5">Notas</label>
              <textarea
                id="payment-notes"
                class="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                rows="2"
                [value]="notes()"
                (input)="onNotesChange($event)"
                placeholder="Notas opcionales..."
              ></textarea>
            </div>
          </div>

          <!-- COLUMNA DERECHA: AI scan async del comprobante -->
          <div class="po-payment-scan-col">
            <div class="flex items-center gap-2 mb-2">
              <app-icon name="sparkles" [size]="18" class="text-primary"></app-icon>
              <h4 class="text-sm font-semibold text-text-primary">Escanear comprobante con IA</h4>
            </div>
            <p class="text-xs text-text-muted mb-3">
              Sube la foto del recibo/transferencia y pre-rellenaremos los campos. El documento se adjuntará al pago.
            </p>

            <app-file-upload-dropzone
              label="Comprobante de pago"
              helperText="Imagen JPG/PNG/WebP hasta 10MB"
              accept="image/*"
              icon="image"
              [disabled]="isScanning()"
              (fileSelected)="onScanFileSelected($event)"
              (fileRemoved)="onScanFileRemoved()"
            ></app-file-upload-dropzone>

            @if (isScanning()) {
              <div class="po-scan-progress mt-3 flex items-center gap-2 text-xs text-text-muted">
                <app-icon name="loader-2" [size]="14" class="animate-spin"></app-icon>
                <span>Extrayendo datos del comprobante...</span>
              </div>
            }

            @if (scanConfidence() !== null) {
              <div class="po-scan-result mt-3 p-3 rounded-md border border-success/30 bg-success/5">
                <div class="flex items-center gap-2 mb-1">
                  <app-icon name="check-circle-2" [size]="14" class="text-success"></app-icon>
                  <span class="text-xs font-medium text-success">
                    Datos extraídos (confianza {{ scanConfidence() }}%)
                  </span>
                </div>
                <p class="text-xs text-text-muted">
                  Los campos del formulario se pre-rellenaron. Revísalos y ajusta antes de guardar.
                </p>
              </div>

              <div class="mt-3">
                <app-ai-review-ack
                  #ackBlock
                  [(acknowledged)]="aiAck"
                  variant="compact"
                  entityLabel="datos del comprobante"
                  [disabled]="saving()"
                ></app-ai-review-ack>
              </div>
            }
          </div>
        </div>
      }

      <!-- ════════ VISTA: CONFIGURAR PLAN DE PAGO ════════ -->
      @if (activeView() === 'plan') {
        <div class="po-payment-stack">
          <section class="po-mode-section">
            <div class="po-section-header">
              <app-icon name="credit-card" [size]="16" class="po-section-icon"></app-icon>
              <h3 class="po-section-title">Modo de pago</h3>
            </div>
            <app-input-buttons
              label="¿Cómo se paga esta orden?"
              [options]="modeOptions"
              [formControl]="form.controls.mode"
              (valueChange)="onModeChange($event)"
            ></app-input-buttons>
          </section>

          @switch (mode()) {
            @case ('immediate') {
              <section class="po-fields-section">
                <div class="po-field">
                  <label for="po-payment-date" class="po-field-label">Fecha de pago</label>
                  <input
                    id="po-payment-date"
                    type="date"
                    class="po-input"
                    [value]="paymentDate()"
                    (input)="onPaymentDateChange($event)"
                  />
                </div>
                <div class="po-field">
                  <label for="po-payment-method" class="po-field-label">Método de pago</label>
                  <select
                    id="po-payment-method"
                    class="po-input"
                    [value]="paymentMethod()"
                    (change)="onPaymentMethodChange($event)"
                  >
                    <option value="cash">Efectivo</option>
                    <option value="bank_transfer">Transferencia bancaria</option>
                    <option value="check">Cheque</option>
                    <option value="credit_card">Tarjeta de crédito</option>
                  </select>
                </div>
              </section>
            }
            @case ('partial') {
              <section class="po-fields-section">
                <div class="po-field">
                  <app-input
                    type="number"
                    inputId="po-down-payment"
                    label="Monto abonado"
                    helperText="Mayor que 0 y menor que el total"
                    [required]="true"
                    [currency]="true"
                    [currencyDecimals]="2"
                    [formControl]="form.controls.downPayment"
                    [control]="form.controls.downPayment"
                  ></app-input>
                </div>
                <div class="po-field">
                  <app-input
                    type="date"
                    inputId="po-due-date"
                    label="Fecha de pago del saldo (opcional)"
                    helperText="Si la defines, el saldo queda con fecha en CxP. Vacío = sin fecha."
                    [min]="todayMin()"
                    [formControl]="form.controls.dueDate"
                    [control]="form.controls.dueDate"
                  ></app-input>
                </div>
                <p class="po-balance-line">
                  Total: {{ formatCurrency(total()) }} · Queda debiendo:
                  {{ formatCurrency(pendingBalance()) }}
                </p>
              </section>
            }
            @case ('deferred') {
              <section class="po-fields-section">
                <div class="po-field">
                  <app-input
                    type="date"
                    inputId="po-due-date"
                    label="Fecha de pago"
                    helperText="Debe ser hoy o posterior"
                    [required]="true"
                    [min]="todayMin()"
                    [formControl]="form.controls.dueDate"
                    [control]="form.controls.dueDate"
                  ></app-input>
                </div>
              </section>
            }
            @case ('installments') {
              <section class="po-fields-section">
                <div class="po-installments-row">
                  <span class="po-installments-label">Cuotas</span>
                  <input
                    type="number"
                    class="po-installments-input"
                    [value]="installmentsCount()"
                    min="1"
                    (input)="onInstallmentsCountChange($event)"
                  />
                  <span class="po-installments-every">cada 30 días</span>
                </div>
                @for (g of installmentsArray.controls; track $index; let i = $index) {
                  <div class="po-installment-row">
                    <input
                      type="date"
                      class="po-input"
                      [min]="todayMin()"
                      [value]="g.controls['scheduled_date'].value"
                      (input)="onInstallmentDateChange(i, $event)"
                    />
                    <input
                      type="number"
                      class="po-input po-amount"
                      placeholder="0.00"
                      min="0.01"
                      step="0.01"
                      [value]="g.controls['amount'].value"
                      (input)="onInstallmentAmountChange(i, $event)"
                    />
                    <button
                      type="button"
                      class="po-remove"
                      (click)="removeInstallment(i)"
                      aria-label="Quitar cuota"
                    >
                      <app-icon name="trash-2" [size]="14"></app-icon>
                    </button>
                  </div>
                }
                <button type="button" class="po-add" (click)="addInstallment()">
                  + Agregar cuota
                </button>
                <p class="po-balance-line">
                  Cuotas: {{ formatCurrency(installmentsTotal()) }} · Saldo:
                  {{ formatCurrency(pendingBalance()) }}
                  @if (installmentsBalanced()) {
                    <span class="po-ok">cuadra</span>
                  } @else {
                    <span class="po-warn">no cuadra</span>
                  }
                </p>
              </section>
            }
          }

          <section class="po-notes-section">
            <label for="po-notes" class="po-field-label">Notas</label>
            <textarea
              id="po-notes"
              class="po-input po-textarea"
              rows="2"
              [value]="notes()"
              (input)="onNotesChange($event)"
              placeholder="Notas opcionales..."
            ></textarea>
          </section>
        </div>
      }

      <!-- Footer -->
      <div slot="footer" class="po-footer">
        <app-button variant="outline" (clicked)="onModalClose(false)">
          Cancelar
        </app-button>
        @if (activeView() === 'pay') {
          <app-button
            variant="primary"
            (clicked)="submit()"
            [disabled]="saving() || isScanning() || !isPayValid()"
            [loading]="saving()"
            data-testid="po-submit-pay"
          >
            Registrar Pago
          </app-button>
        } @else {
          <app-button
            variant="primary"
            (clicked)="submit()"
            [disabled]="saving() || !isPlanValid()"
            [loading]="saving()"
            data-testid="po-submit-plan"
          >
            Guardar Plan
          </app-button>
        }
      </div>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      input::-webkit-outer-spin-button,
      input::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }
      input[type='number'] {
        -moz-appearance: textfield;
      }
      .po-view-toggle {
        display: inline-flex;
        gap: 2px;
        padding: 2px;
        border-radius: 8px;
        background: var(--color-surface-2, rgba(0, 0, 0, 0.04));
        border: 1px solid var(--color-border, #e5e7eb);
      }
      .po-view-toggle-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        font-size: 12px;
        font-weight: 500;
        border-radius: 6px;
        background: transparent;
        border: none;
        cursor: pointer;
        color: var(--color-text-secondary);
        transition: background 120ms ease, color 120ms ease;
      }
      .po-view-toggle-btn:hover {
        color: var(--color-text-primary);
      }
      .po-view-toggle-active {
        background: var(--color-surface, #fff);
        color: var(--color-primary, #2563eb);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
      }
      .po-payment-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 1.25rem;
      }
      @media (min-width: 768px) {
        .po-payment-grid {
          grid-template-columns: 1fr 1fr;
          gap: 1.5rem;
        }
      }
      .po-payment-scan-col {
        padding: 1rem;
        border-radius: 0.5rem;
        border: 1px dashed var(--color-border, #e5e7eb);
        background: var(--color-surface-2, rgba(0, 0, 0, 0.02));
      }
      .po-payment-stack {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
      .po-mode-section,
      .po-fields-section,
      .po-notes-section {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .po-fields-section {
        border: 1px solid var(--color-border);
        border-radius: 14px;
        padding: 14px;
        background: var(--color-background);
      }
      .po-section-header {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .po-section-icon {
        color: var(--color-primary);
      }
      .po-section-title {
        font-size: 13px;
        font-weight: 700;
        color: var(--color-text-primary);
        margin: 0;
      }
      .po-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-width: 420px;
      }
      .po-field-label {
        font-size: 13px;
        font-weight: 500;
        color: var(--color-text-primary);
      }
      .po-input {
        padding: 6px 8px;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        background: var(--color-surface);
        color: var(--color-text-primary);
        font-size: 13px;
        width: 100%;
      }
      .po-textarea {
        resize: vertical;
        min-height: 60px;
      }
      .po-balance-line {
        font-size: 13px;
        color: var(--color-text-secondary);
        margin: 4px 0 0;
      }
      .po-ok {
        color: var(--color-success, #10b981);
        font-weight: 600;
      }
      .po-warn {
        color: var(--color-destructive, #ef4444);
        font-weight: 600;
      }
      .po-installments-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .po-installments-input {
        width: 64px;
        padding: 6px 8px;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        background: var(--color-surface);
        color: var(--color-text-primary);
      }
      .po-installments-every {
        font-size: 12px;
        color: var(--color-text-muted);
      }
      .po-installment-row {
        display: grid;
        grid-template-columns: 1fr 1fr 32px;
        gap: 6px;
        margin-top: 6px;
      }
      .po-amount {
        text-align: right;
      }
      .po-remove {
        background: transparent;
        border: none;
        cursor: pointer;
        color: var(--color-text-muted);
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .po-add {
        margin-top: 8px;
        background: transparent;
        border: 1px dashed var(--color-border);
        padding: 6px 10px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        color: var(--color-text-secondary);
        align-self: flex-start;
      }
      .po-footer {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      .animate-spin {
        animation: po-spin 1s linear infinite;
      }
      @keyframes po-spin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PoPaymentModalComponent {
  // ── Inputs / Outputs ────────────────────────────────────────────────
  readonly order = input<PoPaymentModalOrder | null>(null);
  readonly isOpen = input<boolean>(false);

  /**
   * Vista inicial del modal. El padre SIEMPRE debe setearla:
   *  - `pay`   → botón header "Pagar" o ícono "Pagar" de una cuota.
   *  - `plan`  → botón header "Configurar pago".
   * El usuario puede alternar internamente con el toggle.
   *
   * Default `plan` para preservar el contrato del spec (los casos existentes
   * de `configurePaymentPlan` siguen testeando la vista `plan`).
   */
  readonly view = input<'pay' | 'plan'>('plan');

  /**
   * Pre-relleno opcional cuando el modal se abre desde el ícono "Pagar" de
   * una cuota del plan (`paymentSchedules[i]`). Si vienen set, el form de la
   * vista `pay` arranca con esos valores; el usuario los puede editar antes
   * de submit.
   *
   * `presetScheduleId` propaga el id de la cuota al payload del POST /payments
   * como `payment_schedule_id` para que el backend marque esa fila de
   * `purchase_order_payment_schedules` como `paid` (QUI-647 — fix de status
   * que quedaba en `planned` aunque el pago se registrara).
   */
  readonly presetAmount = input<number | null>(null);
  readonly presetDate = input<string | null>(null);
  readonly presetScheduleId = input<number | null>(null);

  readonly close = output<void>();
  readonly saved = output<unknown>();

  // ── DI ──────────────────────────────────────────────────────────────
  private readonly purchaseOrdersService = inject(PurchaseOrdersService);
  private readonly toastService = inject(ToastService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly storeSettings = inject(StoreSettingsFacade);
  private readonly destroyRef = inject(DestroyRef);

  // ── Constantes del template ─────────────────────────────────────────
  readonly modeOptions = POP_PAYMENT_MODE_OPTIONS;
  readonly saving = signal(false);

  // ── todayMin (computed, timezone tienda, fallback 'America/Bogota') ─
  readonly todayMin = computed<string>(() => this.dateISOFromInstant(new Date()));

  private dateISOFromInstant(instant: Date): string {
    const tz = this.storeSettings.settings()?.general?.timezone || 'America/Bogota';
    return formatDate(instant, 'yyyy-MM-dd', 'en-CA', tz);
  }

  // ── FormGroup reactivo (campos de `pay` + estructura de `plan`) ──────
  /**
   * El formGroup es la columna vertebral del modal — el bridge `formTick` que
   * mantiene reactividad zoneless en las computeds. `amount`/`paymentDate`/
   * `paymentMethod`/`reference`/`notes` viven aquí y se usan en AMBAS vistas
   * (`pay` los envía como pago; `plan` los usa como datos contextuales del
   * modo elegido). `mode`/`downPayment`/`dueDate`/`installments` solo aplican
   * a `plan`.
   */
  readonly form = new FormGroup({
    mode: new FormControl<ConfigurePaymentPlanMode>('immediate', { nonNullable: true }),
    downPayment: new FormControl<number | null>(null),
    dueDate: new FormControl<string>(''),
    installments: new FormArray<FormGroup>([]),
    paymentMethod: new FormControl<string>('cash', { nonNullable: true }),
    paymentDate: new FormControl<string>(this.todayMin(), { nonNullable: true }),
    reference: new FormControl<string>('', { nonNullable: true }),
    notes: new FormControl<string>('', { nonNullable: true }),
  });

  readonly installmentsArray = this.form.controls.installments;

  /**
   * Tick monotónico alimentado por `form.valueChanges` y por el FormArray de
   * cuotas. Mismo patrón que `pop-payment-step.component.ts:121` y
   * `po-configure-plan-modal.component.ts`. `scan` garantiza un valor
   * distinto por emisión — `Object.is` no anula la invalidación en zoneless.
   */
  private readonly formTick = toSignal(
    merge(this.form.valueChanges, this.installmentsArray.valueChanges).pipe(
      scan((n) => n + 1, 0),
    ),
    { initialValue: 0 },
  );

  // ── Estado OCR (vista `pay`) ────────────────────────────────────────
  readonly isScanning = signal(false);
  readonly scanConfidence = signal<number | null>(null);
  /** Archivo pendiente de subir (con o sin OCR exitoso). */
  private readonly scannedFile = signal<File | null>(null);

  /**
   * Verificación obligatoria de los datos precargados por la IA. Solo aplica
   * cuando hubo un escaneo exitoso (`scanConfidence() !== null`): un pago
   * cargado a mano no debe quedar bloqueado por una casilla sobre datos de
   * IA que nunca se generaron.
   */
  readonly aiAck = signal(false);
  private readonly ackBlock = viewChild<AiReviewAckComponent>('ackBlock');

  // ── Computed derivados del form ────────────────────────────────────
  readonly mode = computed<ConfigurePaymentPlanMode>(() => {
    this.formTick();
    return this.form.controls.mode.value;
  });

  readonly total = computed<number>(() =>
    round2(Number(this.order()?.total_amount ?? 0)),
  );

  readonly paidAmount = computed<number>(() =>
    round2(Number(this.order()?.paid_amount ?? 0)),
  );

  readonly remaining = computed<number>(() =>
    Math.max(0, this.total() - this.paidAmount()),
  );

  /**
   * `amount` (vista `pay`) — signal mutable directo. El OCR lo escribe vía
   * `applyScanResult`, los presets al abrir el modal, y los inputs manuales
   * lo editan con `onAmountChange`. NO va en el FormGroup: vive solo para la
   * vista `pay` y se envía como `amount` en el payload de
   * `registerPurchaseOrderPayment`.
   */
  readonly amountValue = signal<number>(0);

  readonly downPayment = computed<number>(() => {
    this.formTick();
    return Number(this.form.controls.downPayment.value ?? 0);
  });

  readonly dueDate = computed<string>(() => {
    this.formTick();
    return this.form.controls.dueDate.value ?? '';
  });

  readonly paymentMethod = computed<string>(() => {
    this.formTick();
    return this.form.controls.paymentMethod.value;
  });

  readonly paymentDate = computed<string>(() => {
    this.formTick();
    return this.form.controls.paymentDate.value;
  });

  readonly reference = computed<string>(() => {
    this.formTick();
    return this.form.controls.reference.value;
  });

  readonly notes = computed<string>(() => {
    this.formTick();
    return this.form.controls.notes.value;
  });

  /** Saldo que las cuotas deben cubrir en vista `plan`. */
  readonly pendingBalance = computed<number>(() => {
    this.formTick();
    const m = this.mode();
    const down = m === 'partial' ? this.downPayment() : 0;
    return round2(this.total() - down);
  });

  readonly installmentsTotal = computed<number>(() => {
    this.formTick();
    return round2(
      this.installmentsArray.controls.reduce(
        (s, g) => s + Number(g.controls['amount'].value ?? 0),
        0,
      ),
    );
  });

  readonly installmentsBalanced = computed<boolean>(
    () =>
      Math.abs(this.installmentsTotal() - this.pendingBalance()) <= 0.01 &&
      this.installmentsArray.controls.length > 0,
  );

  readonly installmentsCount = computed<number>(() => {
    this.formTick();
    return this.installmentsArray.controls.length;
  });

  // ── Validez por vista ──────────────────────────────────────────────
  readonly isPayValid = computed<boolean>(() => {
    this.formTick();
    const a = this.amountValue();
    return a > 0 && a <= this.remaining() && !!this.paymentDate();
  });

  readonly isPlanValid = computed<boolean>(() => {
    this.formTick();
    const m = this.mode();
    if (m === 'immediate') return !!this.paymentMethod() && !!this.paymentDate();
    if (m === 'partial') {
      const d = this.downPayment();
      const total = this.total();
      if (!(d > 0 && d < total)) return false;
      const due = this.dueDate();
      if (due && due < this.todayMin()) return false;
      return this.form.controls.downPayment.valid;
    }
    if (m === 'deferred') {
      const due = this.dueDate();
      return !!due && due >= this.todayMin() && this.form.controls.dueDate.valid;
    }
    if (m === 'installments') {
      return this.installmentsArray.controls.length >= 1 && this.installmentsBalanced();
    }
    return false;
  });

  // ── Lifecycle ──────────────────────────────────────────────────────
  constructor() {
    // Reset SOLO en la transición cerrado→abierto, no cada vez que el padre
    // re-renderice con un `order` distinto. Mantiene untracked para no leer
    // `order()` dentro del effect (igual que po-configure-plan-modal).
    let prevOpen = false;
    effect(() => {
      const open = this.isOpen();
      if (open && !prevOpen) {
        const o = untracked(() => this.order());
        if (o) {
          this.resetForm(o);
          this.applyModeValidators(this.form.controls.mode.value);
        }
      }
      prevOpen = open;
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────
  formatCurrency(value: number): string {
    return this.currencyService.format(Number(value) || 0);
  }

  /**
   * Toggle interno entre vistas. NO cierra el modal. Si el usuario ya tocó el
   * toggle, gana sobre el `view()` input del padre; si no, respetamos el input.
   */
  private readonly _localView = signal<'pay' | 'plan' | null>(null);

  /** Vista activa: override local del usuario si lo usó, si no el input del padre. */
  readonly activeView = computed<'pay' | 'plan'>(() => this._localView() ?? this.view());

  setView(v: 'pay' | 'plan'): void {
    this._localView.set(v);
  }

  // ── Reset / cierre ─────────────────────────────────────────────────
  /**
   * Normaliza cualquier ISO datetime / Date a `yyyy-MM-dd` (date-only).
   * Si ya es date-only (10 chars sin `T`), lo devuelve tal cual.
   * Defensivo: si el padre ya normalizó, esto es un no-op; si pasó un ISO
   * datetime crudo, evitamos que el campo date quede vacío en silencio.
   */
  private normalizeDateOnly(v?: string | null): string | null {
    if (!v) return null;
    if (typeof v !== 'string') return null;
    if (v.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    return null;
  }

  private resetForm(order: PoPaymentModalOrder): void {
    this.form.controls.mode.setValue(
      (order.payment_plan as ConfigurePaymentPlanMode) ?? 'immediate',
    );
    this.form.controls.downPayment.setValue(null);
    this.form.controls.dueDate.setValue('');
    this.form.controls.paymentMethod.setValue('cash');
    this.form.controls.paymentDate.setValue(this.todayMin());
    this.form.controls.reference.setValue('');
    this.form.controls.notes.setValue('');
    this.resetInstallments(2);

    // Pre-relleno desde preset (ícono "Pagar" de una cuota del plan).
    // El backend devuelve `scheduled_date` como ISO datetime ("2026-08-18T00:00:00.000Z");
    // input[type=date] exige "yyyy-MM-dd". Cortamos acá para que el campo no quede
    // silenciosamente vacío por formato inválido.
    const presetAmt = this.presetAmount();
    const presetDt = this.normalizeDateOnly(this.presetDate());
    if (presetAmt !== null && presetAmt > 0) {
      this.amountValue.set(Math.min(presetAmt, this.remaining()));
    } else {
      this.amountValue.set(this.remaining() || this.total() || 0);
    }
    if (presetDt) {
      this.form.controls.paymentDate.setValue(presetDt);
    }

    // Estado OCR limpio al abrir.
    this.scannedFile.set(null);
    this.scanConfidence.set(null);
    this.isScanning.set(false);
    this.aiAck.set(false);
  }

  onModalClose(value: boolean): void {
    if (!value) {
      this.close.emit();
    }
  }

  // ── Cambio de modo desde app-input-buttons (CVA ya escribió el control) ──
  onModeChange(value: string): void {
    const mode = value as ConfigurePaymentPlanMode;
    this.form.controls.mode.setValue(mode);
    this.applyModeValidators(mode);
    if (mode === 'installments' && this.installmentsArray.controls.length === 0) {
      this.resetInstallments(2);
    }
  }

  /**
   * Ajusta validadores por modo. Solo aplica a la vista `plan`. La vista
   * `pay` no requiere validators porque `isPayValid` los hace explícitos
   * (amount > 0, <= remaining, fecha presente).
   */
  private applyModeValidators(mode: ConfigurePaymentPlanMode): void {
    const down = this.form.controls.downPayment;
    const due = this.form.controls.dueDate;
    down.clearValidators();
    due.clearValidators();
    if (mode === 'partial') {
      down.setValidators([
        Validators.required,
        Validators.min(0.01),
        maxValueValidator(() => this.total()),
      ]);
      due.setValidators([minDateValidator(() => this.todayMin())]);
    } else if (mode === 'deferred') {
      due.setValidators([Validators.required, minDateValidator(() => this.todayMin())]);
    }
    this.form.updateValueAndValidity();
  }

  // ── Helpers de UI (raw inputs ↔ form controls) ─────────────────────
  onAmountChange(event: Event): void {
    const v = Number((event.target as HTMLInputElement).value) || 0;
    this.amountValue.set(v);
  }

  onPaymentDateChange(event: Event): void {
    const v = (event.target as HTMLInputElement).value;
    this.form.controls.paymentDate.setValue(v);
    this.form.controls.paymentDate.markAsDirty();
  }

  onPaymentMethodChange(event: Event): void {
    const v = (event.target as HTMLSelectElement).value;
    this.form.controls.paymentMethod.setValue(v);
    this.form.controls.paymentMethod.markAsDirty();
  }

  onReferenceChange(event: Event): void {
    const v = (event.target as HTMLInputElement).value;
    this.form.controls.reference.setValue(v);
    this.form.controls.reference.markAsDirty();
  }

  onNotesChange(event: Event): void {
    const v = (event.target as HTMLTextAreaElement).value;
    this.form.controls.notes.setValue(v);
    this.form.controls.notes.markAsDirty();
  }

  // ── Installments FormArray ─────────────────────────────────────────
  onInstallmentsCountChange(event: Event): void {
    const n = Math.max(1, Number((event.target as HTMLInputElement).value) || 1);
    this.resetInstallments(n);
  }

  onInstallmentDateChange(index: number, event: Event): void {
    const v = (event.target as HTMLInputElement).value;
    const g = this.installmentsArray.at(index);
    g.controls['scheduled_date'].setValue(v);
    g.controls['scheduled_date'].markAsDirty();
  }

  onInstallmentAmountChange(index: number, event: Event): void {
    const v = Number((event.target as HTMLInputElement).value) || 0;
    const g = this.installmentsArray.at(index);
    g.controls['amount'].setValue(v);
    g.controls['amount'].markAsDirty();
  }

  addInstallment(): void {
    this.installmentsArray.push(
      new FormGroup({
        scheduled_date: new FormControl<string>('', { nonNullable: true }),
        amount: new FormControl<number>(0, { nonNullable: true }),
      } as any),
    );
  }

  removeInstallment(index: number): void {
    this.installmentsArray.removeAt(index);
  }

  /**
   * Regenera la lista de `installments` con `count` cuotas cada 30 días.
   * Público para uso del spec y del reset del form.
   */
  resetInstallments(count: number): void {
    const arr = this.installmentsArray;
    arr.clear();
    const total = this.total();
    const per = round2(total / Math.max(1, count));
    const today = this.todayMin();
    for (let i = 0; i < count; i++) {
      const d = new Date(today + 'T00:00:00Z');
      d.setUTCMonth(d.getUTCMonth() + i);
      const dateStr = d.toISOString().slice(0, 10);
      arr.push(
        new FormGroup({
          scheduled_date: new FormControl<string>(dateStr, { nonNullable: true }),
          amount: new FormControl<number>(per, { nonNullable: true }),
        }),
      );
    }
  }

  // ── AI scan (vista `pay`) ──────────────────────────────────────────
  onScanFileSelected(file: File): void {
    const o = this.order();
    if (!o) return;
    this.scannedFile.set(file);
    this.isScanning.set(true);
    this.scanConfidence.set(null);

    this.purchaseOrdersService
      .scanPaymentReceipt(o.id, file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result: PaymentScanResult) => {
          this.applyScanResult(result);
          this.isScanning.set(false);
          this.scanConfidence.set(result.confidence ?? null);
          this.toastService.success('Datos del comprobante extraídos');
        },
        error: (err: any) => {
          this.isScanning.set(false);
          this.scanConfidence.set(null);
          // Errores suaves — el modal sigue usable manualmente y el archivo
          // queda adjunto. Ver skill vendix-ai-queue.
          const code = err?.message ?? '';
          if (code === 'scan_payment_timeout') {
            this.toastService.error('Tiempo agotado extrayendo datos. Puedes llenar el formulario manualmente.');
          } else if (code === 'scan_payment_not_found') {
            this.toastService.error('La extracción expiró del caché. Puedes llenar el formulario manualmente.');
          } else {
            this.toastService.error('No se pudo escanear el comprobante. Puedes llenar el formulario manualmente.');
          }
        },
      });
  }

  onScanFileRemoved(): void {
    this.scannedFile.set(null);
    this.scanConfidence.set(null);
    this.isScanning.set(false);
    // Sin esto, un segundo escaneo mostraría el bloque con el check ya
    // marcado y el guard quedaría anulado para los datos nuevos.
    this.aiAck.set(false);
  }

  /**
   * Aplica el resultado del OCR a los controles del form. Mapeo de método:
   * el scanner devuelve `cash|transfer|card|check|other`; el form usa
   * `cash|bank_transfer|check|credit_card`. Mantener compatibilidad.
   */
  private applyScanResult(r: PaymentScanResult): void {
    if (r.amount > 0) {
      this.amountValue.set(Math.min(Number(r.amount), this.remaining()));
    }
    if (r.payment_date) {
      this.form.controls.paymentDate.setValue(r.payment_date);
      this.form.controls.paymentDate.markAsDirty();
    }
    if (r.payment_method) {
      const map: Record<string, string> = {
        cash: 'cash',
        transfer: 'bank_transfer',
        card: 'credit_card',
        check: 'check',
        other: 'bank_transfer',
      };
      const mapped = map[r.payment_method] ?? 'bank_transfer';
      this.form.controls.paymentMethod.setValue(mapped);
      this.form.controls.paymentMethod.markAsDirty();
    }
    if (r.reference) {
      this.form.controls.reference.setValue(r.reference);
      this.form.controls.reference.markAsDirty();
    }
    if (r.notes) {
      this.form.controls.notes.setValue(r.notes);
      this.form.controls.notes.markAsDirty();
    }
  }

  // ── Submit ─────────────────────────────────────────────────────────
  submit(): void {
    if (this.saving()) return;
    const o = this.order();
    if (!o) return;

    const v = this.activeView();
    if (v === 'pay') {
      this.submitPay(o);
    } else {
      this.submitPlan(o);
    }
  }

  /** Submit de la vista `pay` → POST /payments (`registerPurchaseOrderPayment`). */
  private submitPay(o: PoPaymentModalOrder): void {
    if (!this.isPayValid()) return;

    // Solo exigimos la verificación de IA si la IA precargó campos. Si el
    // usuario carga manual, la casilla no aplica y el botón debe proceder.
    if (this.scanConfidence() !== null && !this.aiAck()) {
      this.ackBlock()?.requestAttention();
      return;
    }

    this.saving.set(true);
    const payload: Record<string, unknown> = {
      amount: this.amountValue(),
      payment_date: this.paymentDate(),
      payment_method: this.paymentMethod(),
    };
    if (this.reference().trim()) payload['reference'] = this.reference().trim();
    if (this.notes().trim()) payload['notes'] = this.notes().trim();
    // QUI-647 — si el modal se abrió desde el ícono "Pagar" de una cuota del
    // plan, propagamos el id de la cuota. El backend lo usa para marcar la fila
    // de `purchase_order_payment_schedules` como `paid` dentro del mismo
    // $transaction que crea el payment (no deja el schedule en estado
    // inconsistente si la creación del pago falla).
    const schedId = this.presetScheduleId();
    if (schedId !== null && schedId > 0) {
      payload['payment_schedule_id'] = schedId;
    }

    this.purchaseOrdersService.registerPurchaseOrderPayment(o.id, payload).subscribe({
      next: (res: any) => {
        // Adjuntar el documento (si hay) al pago creado. payment_id viaja
        // en metadata; el backend lo persiste en purchase_order_attachments.
        const file = this.scannedFile();
        const paymentId = res?.data?.id;
        if (file && paymentId) {
          this.purchaseOrdersService
            .uploadPurchaseOrderAttachment(o.id, file, { payment_id: paymentId })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: () => this.afterSaveOk(),
              error: (attErr: unknown) => {
                // Pago ya registrado pero adjunto falló: warning no destructivo.
                // `attErr` es un HttpErrorResponse desde que el controller dejó
                // de envolver el fallo en un 200: interpolarlo crudo imprimía
                // «[object Object]» al operador.
                this.afterSaveOk();
                const detail =
                  extractApiErrorMessage(attErr) || 'no se pudo adjuntar el comprobante';
                this.toastService.error(`Pago guardado, pero el adjunto falló: ${detail}`);
              },
            });
        } else {
          this.afterSaveOk();
        }
      },
      error: (err: any) => {
        this.saving.set(false);
        // `err.message` de un HttpErrorResponse es «Http failure response for
        // …: 400 Bad Request», no el mensaje de negocio. El extractor lee el
        // cuerpo del error, que es donde viaja.
        const msg = extractApiErrorMessage(err) || 'Error al registrar pago';
        this.toastService.error(msg);
      },
    });
  }

  /** Submit de la vista `plan` → PATCH /payment-plan (`configurePaymentPlan`). */
  private submitPlan(o: PoPaymentModalOrder): void {
    if (!this.isPlanValid()) return;

    const mode = this.mode();
    const dto: ConfigurePaymentPlanDto = { payment_plan: mode };

    if (mode === 'immediate') {
      // Sin campos extra: el plan se setea y nada más.
    } else if (mode === 'partial') {
      dto.down_payment_amount = this.downPayment();
      const due = this.dueDate();
      if (due) dto.payment_due_date = due;
    } else if (mode === 'deferred') {
      dto.payment_due_date = this.dueDate() || undefined;
    } else if (mode === 'installments') {
      dto.payment_installments = this.installmentsArray.controls.map((g) => ({
        scheduled_date: g.controls['scheduled_date'].value,
        amount: Number(g.controls['amount'].value ?? 0),
      }));
    }

    this.saving.set(true);
    this.purchaseOrdersService.configurePaymentPlan(o.id, dto).subscribe({
      next: (res: any) => {
        this.saving.set(false);
        this.saved.emit(res?.data ?? res);
        this.close.emit();
      },
      error: (err: any) => {
        this.saving.set(false);
        const msg =
          err?.error?.message ?? err?.message ?? 'Error al configurar el plan de pago';
        this.toastService.error(msg);
      },
    });
  }

  private afterSaveOk(): void {
    this.saving.set(false);
    this.toastService.success('Pago registrado correctamente');
    this.saved.emit(undefined);
    this.close.emit();
  }
}