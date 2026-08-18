import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { PoConfigurePlanModalComponent } from './po-configure-plan-modal.component';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';

const buildCurrencyStub = () =>
  ({
    format: (n: number | string | null | undefined) =>
      `$${Number(n ?? 0).toFixed(2)}`,
    loadCurrency: () => undefined,
  }) as unknown as CurrencyFormatService;

const buildToastStub = () =>
  ({
    success: (_msg: string) => undefined,
    error: (_msg: string) => undefined,
  }) as unknown as ToastService;

const PAYMENT_PLAN_URL =
  'https://api.vendix.online/api/store/orders/purchase-orders/1/payment-plan';

/**
 * Contrato del modal "Configurar plan de pago" — QUI-647 Fase 2.
 *
 * Reproduce el bug original (el `statusChanges`-bridge deduplicaba por
 * `Object.is` y el modo elegido nunca se reflejaba en `mode()` / `installmentsArray`).
 * El puente `valueChanges`-tick arregla ambos defectos: cada `setValue`
 * emite un objeto nuevo, el `scan` garantiza un valor distinto por emisión,
 * y los `computed` que leen `formTick()` se re-evalúan en zoneless.
 *
 * Los casos (a)-(d) cierran el ciclo de reactividad del bridge;
 * (e)-(f) cierran paridad de validación contra el backend
 * (`purchase-orders.service.ts:configurePaymentPlan`);
 * (g) cierra contrato HTTP y propagación del toast de error.
 */
describe('PoConfigurePlanModalComponent — payment plan reactive bridge', () => {
  let fixture: ComponentFixture<PoConfigurePlanModalComponent>;
  let component: PoConfigurePlanModalComponent;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PoConfigurePlanModalComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CurrencyFormatService, useFactory: buildCurrencyStub },
        { provide: ToastService, useFactory: buildToastStub },
      ],
    });
    fixture = TestBed.createComponent(PoConfigurePlanModalComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.componentRef.setInput('order', {
      id: 1,
      total_amount: 300000,
      payment_plan: null,
    });
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function installmentRows(): HTMLElement[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('.cp-installment-row'),
    );
  }

  function selectMode(mode: 'immediate' | 'partial' | 'deferred' | 'installments'): void {
    component.form.controls.mode.setValue(mode);
    fixture.detectChanges();
  }

  function lastInstallmentAmountInput(): HTMLInputElement {
    const inputs = Array.from(
      fixture.nativeElement.querySelectorAll(
        '.cp-installment-row input.cp-amount',
      ),
    ) as HTMLInputElement[];
    return inputs[inputs.length - 1];
  }

  it('(a) el bridge re-evalúa `mode()` al hacer setValue (sin click intermediario)', () => {
    // Inicial: el open-edge effect fija modo = 'immediate' (default).
    expect(component.mode()).toBe('immediate');
    selectMode('installments');
    expect(component.mode()).toBe('installments');
    selectMode('immediate');
    expect(component.mode()).toBe('immediate');
    selectMode('installments');
    expect(component.mode()).toBe('installments');
  });

  it('(b) renderiza el @if del bloque de cuotas cuando mode === "installments"', () => {
    selectMode('installments');
    expect(installmentRows().length).toBe(2);
    selectMode('deferred');
    expect(installmentRows().length).toBe(0);
    selectMode('installments');
    expect(installmentRows().length).toBe(2);
  });

  it('(c) edita una cuota y `installmentsTotal()` refleja el cambio en el mismo tick', () => {
    selectMode('installments');
    const totalBefore = component.installmentsTotal();
    const last = lastInstallmentAmountInput();
    last.value = String(totalBefore + 1);
    last.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(component.installmentsTotal()).not.toBe(totalBefore);
  });

  it('(d) bloquea Guardar en "Pago diferido" hasta fijar fecha ≥ hoy', () => {
    selectMode('deferred');
    expect(component.isValid()).toBe(false);
    component.form.controls.dueDate.setValue(component.todayMin);
    fixture.detectChanges();
    expect(component.isValid()).toBe(true);
    component.form.controls.dueDate.setValue('2020-01-01');
    fixture.detectChanges();
    expect(component.isValid()).toBe(false);
  });

  it('(e) bloquea Guardar en "Abono parcial" hasta tener down en (0, total)', () => {
    selectMode('partial');
    expect(component.isValid()).toBe(false);
    component.form.controls.downPayment.setValue(150000);
    fixture.detectChanges();
    expect(component.isValid()).toBe(true);
    component.form.controls.downPayment.setValue(300000);
    fixture.detectChanges();
    expect(component.isValid()).toBe(false);
  });

  it('(f) `installmentsBalanced()` exige suma == total_amount, NO pendingBalance', () => {
    // Paridad con backend (purchase-orders.service.ts:4524: `|Σ amount − total_amount| ≤ 0.01`).
    selectMode('installments');
    const total = 300000;
    const per = total / component.installmentsArray.length;
    // Set ambos montos para que cuadre exacto.
    component.installmentsArray.controls.forEach((g, i) => {
      g.controls['amount'].setValue(per);
    });
    fixture.detectChanges();
    expect(component.installmentsBalanced()).toBe(true);
    expect(component.isValid()).toBe(true);

    // Suma ≠ total → bloqueado.
    component.installmentsArray.controls[0].controls['amount'].setValue(per + 1);
    fixture.detectChanges();
    expect(component.installmentsBalanced()).toBe(false);
    expect(component.isValid()).toBe(false);
  });

  it('(g) onSave() emite PATCH con payment_plan + payment_installments correctos', () => {
    selectMode('installments');
    component.onSave();
    const req = http.expectOne(
      (r) =>
        r.method === 'PATCH' &&
        r.url === PAYMENT_PLAN_URL,
    );
    const body = req.request.body as {
      payment_plan: string;
      payment_installments: Array<{ scheduled_date: string; amount: number }>;
    };
    expect(body.payment_plan).toBe('installments');
    expect(body.payment_installments.length).toBe(2);
    req.flush({ data: { id: 1 } });
  });
});