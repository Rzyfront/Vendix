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
} from '@angular/core';
import { formatDate } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
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
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { InputButtonsComponent } from '../../../../../../../shared/components/input-buttons/input-buttons.component';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import {
  ConfigurePaymentPlanDto,
  ConfigurePaymentPlanMode,
  PurchaseOrdersService,
} from '../../../services';
import {
  maxValueValidator,
  minDateValidator,
  round2,
} from '../pop-checkout-shell/steps/payment-validators';
import { POP_PAYMENT_MODE_OPTIONS } from '../pop-checkout-shell/steps/pop-payment-step.component';

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
 * Modal UNIFICADO de plan de pago (QUI-647 — FASE Track B).
 *
 * Reemplaza el modal viejo "Registrar Pago" (que solo registraba un pago
 * inmediato) por un selector de modo (`immediate|partial|deferred|installments`)
 * que dispatcha a `configurePaymentPlan` igual que el modal de "Configurar plan"
 * de la esquina derecha del detalle de orden.
 *
 * Patrón idéntico a `pop-payment-step.component.ts` (wizard POP) y
 * `po-configure-plan-modal.component.ts` (modal de detalle):
 *  - `FormGroup` con `ReactiveFormsModule` (no `ngModel`).
 *  - `formTick = toSignal(merge(form.valueChanges, installments.valueChanges).pipe(scan(...)))`
 *    puentea la reactividad zoneless hacia los `computed` que leen el form.
 *  - `applyModeValidators(mode)` ajusta validadores por modo:
 *      immediate: paymentMethod/paymentDate required.
 *      partial:   downPayment required + min/max(total), dueDate opcional con minDate.
 *      deferred:  dueDate required + minDate.
 *      installments: sin validadores (los installments se validan en su FormArray).
 *  - `installmentsBalanced` exige `Σ(cuotas) == pendingBalance` con tolerancia 0.01.
 *
 * Notas:
 *  - La columna derecha de escaneo con IA del modal viejo se omitió: el plan
 *    unificado no tiene un único "monto" al que la IA pueda pre-rellenar y el
 *    escaneo OCR vive en un step aparte del wizard POP.
 *  - `CurrencyFormatService` y `ToastService` se conservan inyectados.
 *  - `app-modal` no se reemplaza: vive el `<app-modal>` wrapper.
 */
@Component({
  selector: 'app-po-payment-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
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
      <div class="po-payment-stack">
        <!-- ═══ BLOQUE 1: selector de modo (4 botones app-input-buttons) ═══ -->
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

        <!-- ═══ BLOQUE 2: campos condicionales por modo ═══ -->
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

        <!-- ═══ Notes (compartido en todos los modos) ═══ -->
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

        <!--
          AI scan column REMOVIDA en este PR: el plan unificado no tiene un
          unico "monto" al que la IA pueda pre-rellenar; el escaneo OCR vive
          en un step aparte del wizard POP (pop-checkout-shell/steps/...).
        -->
      </div>

      <!-- Footer -->
      <div slot="footer" class="po-footer">
        <app-button variant="outline" (clicked)="onModalClose(false)">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="submit()"
          [disabled]="saving() || !isValid()"
          [loading]="saving()"
        >
          Registrar Pago
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
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
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PoPaymentModalComponent {
  // ── Inputs / Outputs ────────────────────────────────────────────────
  readonly order = input<PoPaymentModalOrder | null>(null);
  readonly isOpen = input<boolean>(false);

  readonly close = output<void>();
  readonly saved = output<unknown>();

  // ── DI ──────────────────────────────────────────────────────────────
  private readonly purchaseOrdersService = inject(PurchaseOrdersService);
  private readonly toastService = inject(ToastService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly storeSettings = inject(StoreSettingsFacade);

  // ── Constantes del template ─────────────────────────────────────────
  readonly modeOptions = POP_PAYMENT_MODE_OPTIONS;
  readonly saving = signal(false);

  // ── todayMin (computed, timezone tienda, fallback 'America/Bogota') ─
  readonly todayMin = computed<string>(() => this.dateISOFromInstant(new Date()));

  private dateISOFromInstant(instant: Date): string {
    const tz = this.storeSettings.settings()?.general?.timezone || 'America/Bogota';
    return formatDate(instant, 'yyyy-MM-dd', 'en-CA', tz);
  }

  // ── FormGroup reactivo (única fuente de verdad) ─────────────────────
  /**
   * `paymentDate` se inicializa con `todayMin()` (formato 'yyyy-MM-dd' en
   * timezone tienda). `paymentMethod` y `notes` viven siempre en el form; sus
   * validadores se aplican/limpian vía `applyModeValidators(mode)`.
   */
  readonly form = new FormGroup({
    mode: new FormControl<ConfigurePaymentPlanMode>('immediate', { nonNullable: true }),
    downPayment: new FormControl<number | null>(null),
    dueDate: new FormControl<string>(''),
    installments: new FormArray<FormGroup>([]),
    paymentMethod: new FormControl<string>('cash', { nonNullable: true }),
    paymentDate: new FormControl<string>(this.todayMin(), { nonNullable: true }),
    notes: new FormControl<string>('', { nonNullable: true }),
  });

  readonly installmentsArray = this.form.controls.installments;

  /**
   * Tick monotónico alimentado por `form.valueChanges` (cualquier `setValue`
   * emite un objeto nuevo) y `installmentsArray.valueChanges` (el FormArray
   * vive dentro del FormGroup pero su `valueChanges` también lo cubre el
   * merge). `scan` garantiza un valor distinto por emisión, así que `Object.is`
   * no anula la invalidación en zoneless — el `mode` no tiene validadores,
   * por lo que `statusChanges` deduplica `'VALID' → 'VALID'` y deja congeladas
   * las computeds que aquí declaran su dependencia.
   * Mismo patrón que `pop-payment-step.component.ts:144` y
   * `po-configure-plan-modal.component.ts:405-410`.
   */
  private readonly formTick = toSignal(
    merge(this.form.valueChanges, this.installmentsArray.valueChanges).pipe(
      scan((n) => n + 1, 0),
    ),
    { initialValue: 0 },
  );

  // ── Computed derivados del form (single source of truth) ───────────
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

  readonly notes = computed<string>(() => {
    this.formTick();
    return this.form.controls.notes.value;
  });

  /**
   * El saldo que las cuotas deben cubrir. El abono SOLO aplica en `partial`;
   * en los demás modos lo que se debe es el total.
   */
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

  readonly isValid = computed<boolean>(() => {
    this.formTick();
    const m = this.mode();
    if (m === 'immediate') {
      return !!this.paymentMethod() && !!this.paymentDate();
    }
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

  // ── Reset / cierre ─────────────────────────────────────────────────
  private resetForm(order: PoPaymentModalOrder): void {
    this.form.controls.mode.setValue(
      (order.payment_plan as ConfigurePaymentPlanMode) ?? 'immediate',
    );
    this.form.controls.downPayment.setValue(null);
    this.form.controls.dueDate.setValue('');
    this.form.controls.paymentMethod.setValue('cash');
    this.form.controls.paymentDate.setValue(this.todayMin());
    this.form.controls.notes.setValue('');
    this.resetInstallments(2);
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
   * Ajusta validadores por modo. `installments` queda sin validadores en
   * downPayment/dueDate/paymentMethod/paymentDate: la cuota vive en su propio
   * FormArray y se valida allá.
   */
  private applyModeValidators(mode: ConfigurePaymentPlanMode): void {
    const down = this.form.controls.downPayment;
    const due = this.form.controls.dueDate;
    const pm = this.form.controls.paymentMethod;
    const pd = this.form.controls.paymentDate;
    down.clearValidators();
    due.clearValidators();
    pm.clearValidators();
    pd.clearValidators();
    if (mode === 'immediate') {
      pm.setValidators([Validators.required]);
      pd.setValidators([Validators.required]);
    } else if (mode === 'partial') {
      down.setValidators([
        Validators.required,
        Validators.min(0.01),
        maxValueValidator(() => this.total()),
      ]);
      // dueDate OPCIONAL: sin `Validators.required`, pero si el operador la
      // elige debe ser >= hoy (date-only, timezone tienda).
      due.setValidators([minDateValidator(() => this.todayMin())]);
    } else if (mode === 'deferred') {
      due.setValidators([Validators.required, minDateValidator(() => this.todayMin())]);
    }
    // installments: sin validadores en estos 4 controles (los installments ya
    // validados en su FormArray). `paymentMethod` queda cleared.
    this.form.updateValueAndValidity();
  }

  // ── Helpers de UI (raw inputs ↔ form controls) ─────────────────────
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

  private resetInstallments(count: number): void {
    const arr = this.installmentsArray;
    arr.clear();
    const total = this.total();
    const per = round2(total / Math.max(1, count));
    const today = this.todayMin();
    for (let i = 0; i < count; i++) {
      // Calendario cada 30 días, sumado en UTC (las fechas son date-only, sin hora).
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

  // ── Submit ─────────────────────────────────────────────────────────
  submit(): void {
    if (this.saving()) return;
    if (!this.isValid()) return;
    const o = this.order();
    if (!o) return;

    const mode = this.mode();
    const dto: ConfigurePaymentPlanDto = { payment_plan: mode };

    if (mode === 'immediate') {
      // DTO mínimo: solo `payment_plan: 'immediate'`.
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
}
