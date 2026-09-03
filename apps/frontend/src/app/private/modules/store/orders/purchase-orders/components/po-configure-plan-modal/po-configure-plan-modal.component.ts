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
import {
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { merge } from 'rxjs';
import { scan } from 'rxjs/operators';

import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { InputButtonsComponent } from '../../../../../../../shared/components/input-buttons/input-buttons.component';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';

import {
  ConfigurePaymentPlanDto,
  ConfigurePaymentPlanMode,
  PurchaseOrdersService,
} from '../../../../inventory/services/purchase-orders.service';

const MODES: Array<{
  value: ConfigurePaymentPlanMode;
  label: string;
  hint: string;
}> = [
  { value: 'immediate', label: 'Pago inmediato', hint: 'Pago único al contado' },
  { value: 'partial', label: 'Abono parcial', hint: 'Se abona una parte; el resto queda debiendo (con o sin fecha)' },
  { value: 'deferred', label: 'Pago diferido', hint: 'Una sola fecha de pago' },
  { value: 'installments', label: 'Crédito con cuotas', hint: 'Calendario de cuotas' },
];

const MODE_OPTIONS = MODES.map((m) => ({ value: m.value, label: m.label }));

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function todayISO(): string {
  const tz = 'America/Bogota';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

@Component({
  selector: 'app-po-configure-plan-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    IconComponent,
    InputComponent,
    InputButtonsComponent,
  ],
  template: `
    @if (isOpen()) {
    <div class="cp-overlay" (click)="onCancel()">
      <div class="cp-modal" (click)="$event.stopPropagation()">
        <header class="cp-header">
          <div>
            <h3 class="cp-title">Configurar plan de pago</h3>
            <p class="cp-subtitle">
              Total de la orden: {{ money(order()?.total_amount) }} ·
              Estado actual: {{ order()?.payment_plan ?? 'sin plan' }}
            </p>
          </div>
          <button type="button" class="cp-close" (click)="onCancel()" aria-label="Cerrar">
            <app-icon name="x" [size]="18"></app-icon>
          </button>
        </header>

        <section class="cp-body">
          <app-input-buttons
            label="Modo de pago"
            [options]="modeOptions"
            [formControl]="form.controls.mode"
          ></app-input-buttons>

          @if (modeHint(); as hint) {
            <p class="cp-hint">{{ hint }}</p>
          }

          @if (mode() === 'partial') {
            <div class="cp-field">
              <app-input
                type="number"
                inputId="cp-down"
                label="Monto abonado"
                helperText="Mayor que 0 y menor que el total"
                [required]="true"
                [formControl]="form.controls.downPayment"
                [control]="form.controls.downPayment"
              ></app-input>
              <app-input
                type="date"
                inputId="cp-due"
                label="Fecha de pago del saldo (opcional)"
                helperText="Si la defines, el saldo queda con fecha en CxP. Vacío = sin fecha."
                [min]="todayMin"
                [formControl]="form.controls.dueDate"
                [control]="form.controls.dueDate"
              ></app-input>
              <p class="cp-balance">
                Total: {{ money(order()?.total_amount) }} ·
                Queda debiendo: {{ money(pendingBalance()) }}
              </p>
            </div>
          }

          @if (mode() === 'deferred') {
            <div class="cp-field">
              <app-input
                type="date"
                inputId="cp-due"
                label="Fecha de pago"
                helperText="Debe ser hoy o posterior"
                [required]="true"
                [min]="todayMin"
                [formControl]="form.controls.dueDate"
                [control]="form.controls.dueDate"
              ></app-input>
            </div>
          }

          @if (mode() === 'installments') {
            <div class="cp-field">
              <div class="cp-installments-row">
                <span class="cp-installments-label">Cuotas</span>
                <input
                  type="number"
                  class="cp-installments-input"
                  [value]="installmentsCount()"
                  min="1"
                  (input)="onInstallmentsCountChange($event)"
                />
                <span class="cp-installments-every">cada 30 días</span>
              </div>
              @for (g of installmentsArray.controls; track $index; let i = $index) {
                <div class="cp-installment-row">
                  <input
                    type="date"
                    class="cp-input"
                    [min]="todayMin"
                    [value]="g.controls['scheduled_date'].value"
                    (input)="onInstallmentDateChange(i, $event)"
                  />
                  <input
                    type="number"
                    class="cp-input cp-amount"
                    placeholder="0.00"
                    [value]="g.controls['amount'].value"
                    (input)="onInstallmentAmountChange(i, $event)"
                  />
                  <button
                    type="button"
                    class="cp-remove"
                    (click)="removeInstallment(i)"
                    aria-label="Quitar cuota"
                  >
                    <app-icon name="trash-2" [size]="14"></app-icon>
                  </button>
                </div>
              }
              <button type="button" class="cp-add" (click)="addInstallment()">
                + Agregar cuota
              </button>
              <p class="cp-balance">
                Cuotas: {{ money(installmentsTotal()) }} ·
                Saldo: {{ money(pendingBalance()) }} ·
                @if (installmentsBalanced()) {
                  <span class="cp-ok">cuadra</span>
                } @else {
                  <span class="cp-warn">no cuadra</span>
                }
              </p>
            </div>
          }
        </section>

        <footer class="cp-footer">
          <button type="button" class="cp-btn cp-btn-ghost" (click)="onCancel()">
            Cancelar
          </button>
          <button
            type="button"
            class="cp-btn cp-btn-primary"
            [disabled]="!isValid() || saving()"
            (click)="onSave()"
          >
            @if (saving()) {
              Guardando…
            } @else {
              Guardar plan
            }
          </button>
        </footer>
      </div>
    </div>
    }
  `,
  styles: [
    `
      .cp-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }
      .cp-modal {
        background: var(--color-surface, #fff);
        border-radius: 12px;
        width: min(560px, 92vw);
        max-height: 88vh;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--color-border, #e5e7eb);
        box-shadow: 0 24px 48px rgba(0, 0, 0, 0.18);
      }
      .cp-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding: 16px 18px;
        border-bottom: 1px solid var(--color-border, #e5e7eb);
      }
      .cp-title {
        font-size: 16px;
        font-weight: 700;
        color: var(--color-text-primary);
        margin: 0;
      }
      .cp-subtitle {
        font-size: 12px;
        color: var(--color-text-muted);
        margin-top: 4px;
      }
      .cp-close {
        background: transparent;
        border: none;
        cursor: pointer;
        color: var(--color-text-muted);
        padding: 4px;
      }
      .cp-body {
        padding: 18px;
        overflow-y: auto;
        flex: 1;
      }
      .cp-hint {
        font-size: 12px;
        color: var(--color-text-muted);
        margin: 8px 0 14px;
      }
      .cp-field {
        margin-top: 14px;
        display: grid;
        gap: 10px;
      }
      .cp-balance {
        font-size: 13px;
        color: var(--color-text-secondary);
        margin: 4px 0 0;
      }
      .cp-ok {
        color: var(--color-success, #10b981);
        font-weight: 600;
      }
      .cp-warn {
        color: var(--color-destructive, #ef4444);
        font-weight: 600;
      }
      .cp-installments-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .cp-installments-input {
        width: 64px;
        padding: 6px 8px;
        border: 1px solid var(--color-border, #e5e7eb);
        border-radius: 6px;
        background: var(--color-input, #fff);
        color: var(--color-text-primary);
      }
      .cp-installment-row {
        display: grid;
        grid-template-columns: 1fr 1fr 32px;
        gap: 6px;
        margin-top: 6px;
      }
      .cp-input {
        padding: 6px 8px;
        border: 1px solid var(--color-border, #e5e7eb);
        border-radius: 6px;
        background: var(--color-input, #fff);
        color: var(--color-text-primary);
      }
      .cp-remove {
        background: transparent;
        border: none;
        cursor: pointer;
        color: var(--color-text-muted);
      }
      .cp-add {
        margin-top: 8px;
        background: transparent;
        border: 1px dashed var(--color-border, #e5e7eb);
        padding: 6px 10px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        color: var(--color-text-secondary);
      }
      .cp-footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 18px;
        border-top: 1px solid var(--color-border, #e5e7eb);
      }
      .cp-btn {
        padding: 8px 14px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        border: 1px solid transparent;
      }
      .cp-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .cp-btn-ghost {
        background: transparent;
        color: var(--color-text-secondary);
        border-color: var(--color-border, #e5e7eb);
      }
      .cp-btn-primary {
        background: var(--color-primary, #4f46e5);
        color: var(--color-text-on-primary, #fff);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PoConfigurePlanModalComponent {
  readonly order = input<{
    id: number;
    total_amount: number | string;
    payment_plan?: string | null;
  } | null>(null);

  readonly isOpen = input<boolean>(false);
  readonly configured = output<unknown>();
  readonly closed = output<void>();

  private readonly service = inject(PurchaseOrdersService);
  private readonly toast = inject(ToastService);
  private readonly currencyService = inject(CurrencyFormatService);

  readonly modeOptions = MODE_OPTIONS;
  readonly todayMin = todayISO();
  readonly saving = signal(false);

  readonly form = new FormGroup({
    mode: new FormControl<ConfigurePaymentPlanMode>('immediate', {
      nonNullable: true,
    }),
    downPayment: new FormControl<number | null>(null),
    dueDate: new FormControl<string>(''),
  });

  readonly installmentsArray = new FormArray<FormGroup>([]);

  /**
   * Tick monotónico alimentado por `form.valueChanges` (cualquier `setValue`
   * emite un objeto nuevo) y `installmentsArray.valueChanges` (el FormArray vive
   * fuera del FormGroup y no se entera por `form.statusChanges`). `scan` garantiza
   * un valor distinto por emisión, así que `Object.is` no anula la invalidación
   * y los `computed` que leen `formTick()` se re-evalúan en zoneless.
   */
  private readonly formTick = toSignal(
    merge(this.form.valueChanges, this.installmentsArray.valueChanges).pipe(
      scan((n) => n + 1, 0),
    ),
    { initialValue: 0 },
  );

  readonly mode = computed<ConfigurePaymentPlanMode>(() => {
    this.formTick();
    return this.form.controls.mode.value;
  });

  readonly modeHint = computed<string | null>(() => {
    const m = MODES.find((x) => x.value === this.mode());
    return m ? m.hint : null;
  });

  readonly pendingBalance = computed<number>(() => {
    this.formTick();
    const total = Number(this.order()?.total_amount ?? 0);
    const m = this.mode();
    const down =
      m === 'partial' ? Number(this.form.controls.downPayment.value ?? 0) : 0;
    return round2(total - down);
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

  /**
   * Lee `formTick()` igual que el resto: sin una dependencia reactiva el
   * `computed` no tiene qué invalidarlo, así que evaluaba una sola vez y el
   * input de cantidad se quedaba en el valor inicial ante `addInstallment()`
   * o `removeInstallment()`.
   */
  readonly installmentsCount = computed<number>(() => {
    this.formTick();
    return this.installmentsArray.controls.length;
  });

  readonly isValid = computed<boolean>(() => {
    this.formTick();
    const m = this.mode();
    if (m === 'immediate') return true;
    if (m === 'partial') {
      const down = Number(this.form.controls.downPayment.value ?? 0);
      const total = Number(this.order()?.total_amount ?? 0);
      if (!(down > 0 && down < total)) return false;
      const due = this.form.controls.dueDate.value;
      if (due && due < this.todayMin) return false;
      return true;
    }
    if (m === 'deferred') {
      const due = this.form.controls.dueDate.value;
      return !!due && due >= this.todayMin;
    }
    if (m === 'installments') {
      const groups = this.installmentsArray.controls;
      if (groups.length === 0) return false;
      // Paridad con backend (purchase-orders.service.ts:4530-4534):
      // toda cuota debe tener fecha ≥ hoy y monto ≥ 0.01, y la suma debe
      // cuadrar contra `total_amount` (no `pendingBalance`).
      const total = Number(this.order()?.total_amount ?? 0);
      const today = this.todayMin;
      for (const g of groups) {
        const date = g.controls['scheduled_date'].value;
        const amount = Number(g.controls['amount'].value ?? 0);
        if (!date || date < today) return false;
        if (!(amount >= 0.01)) return false;
      }
      return Math.abs(this.installmentsTotal() - total) <= 0.01;
    }
    return false;
  });

  constructor() {
    // Bug 2 (candidato): reset SOLO en la transición de cerrado→abierto, no
    // cada vez que el padre re-renderice con un `order` distinto. Antes leía
    // `order()` dentro del effect y se gatillaba también ante cualquier
    // update del padre (e.g. polling HTTP), pisando el input del usuario
    // mientras tipeaba. Se rastrea la apertura anterior con untracked.
    let prevOpen = false;
    effect(() => {
      const open = this.isOpen();
      if (open && !prevOpen) {
        const o = untracked(() => this.order());
        if (o) {
          this.form.controls.mode.setValue(
            (o.payment_plan as ConfigurePaymentPlanMode) ?? 'immediate',
          );
          this.form.controls.downPayment.setValue(null);
          this.form.controls.dueDate.setValue('');
          this.resetInstallments(2);
        }
      }
      prevOpen = open;
    });
  }

  money(value: number | string | null | undefined): string {
    const n = Number(value ?? 0);
    return this.currencyService.format(n);
  }

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
    this.installmentsArray.clear();
    const total = Number(this.order()?.total_amount ?? 0);
    const per = round2(total / Math.max(1, count));
    const today = this.todayMin;
    for (let i = 0; i < count; i++) {
      const d = new Date(today + 'T00:00:00Z');
      d.setUTCMonth(d.getUTCMonth() + i);
      const dateStr = d.toISOString().slice(0, 10);
      this.installmentsArray.push(
        new FormGroup({
          scheduled_date: new FormControl<string>(dateStr, { nonNullable: true }),
          amount: new FormControl<number>(per, { nonNullable: true }),
        }),
      );
    }
  }

  onCancel(): void {
    this.closed.emit();
  }

  onSave(): void {
    const o = this.order();
    if (!o) return;
    const mode = this.mode();
    const dto: ConfigurePaymentPlanDto = { payment_plan: mode };
    if (mode === 'partial') {
      dto.down_payment_amount = Number(
        this.form.controls.downPayment.value ?? 0,
      );
      const due = this.form.controls.dueDate.value;
      if (due) dto.payment_due_date = due;
    } else if (mode === 'deferred') {
      dto.payment_due_date = this.form.controls.dueDate.value || undefined;
    } else if (mode === 'installments') {
      dto.payment_installments = this.installmentsArray.controls.map((g) => ({
        scheduled_date: g.controls['scheduled_date'].value,
        amount: Number(g.controls['amount'].value ?? 0),
      }));
    }

    this.saving.set(true);
    this.service.configurePaymentPlan(o.id, dto).subscribe({
      next: (res: any) => {
        this.saving.set(false);
        this.toast.success('Plan de pago actualizado');
        this.configured.emit(res?.data ?? res);
      },
      error: (err: any) => {
        this.saving.set(false);
        const msg =
          err?.error?.message ??
          err?.message ??
          'Error al configurar el plan de pago';
        this.toast.error(msg);
      },
    });
  }
}
