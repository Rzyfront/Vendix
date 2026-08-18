import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { PoPaymentModalComponent } from './po-payment-modal.component';
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

/**
 * Contrato del PoPaymentModal unificado — refactor UX del OC detail.
 *
 * El modal ahora integra selector de modo + campos condicionales y dispatcha
 * `configurePaymentPlan` para los 4 modos (immediate, partial, deferred,
 * installments). Cubre reactividad del bridge (formTick), validez por modo
 * y contrato del PATCH backend.
 */
describe('PoPaymentModalComponent — payment plan unified modal', () => {
  let fixture: ComponentFixture<PoPaymentModalComponent>;
  let component: PoPaymentModalComponent;
  let http: HttpTestingController;

  const ORDER = {
    id: 1,
    total_amount: 1000,
    paid_amount: 0,
    payment_plan: null,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PoPaymentModalComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CurrencyFormatService, useFactory: buildCurrencyStub },
        { provide: ToastService, useFactory: buildToastStub },
      ],
    });
    fixture = TestBed.createComponent(PoPaymentModalComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('order', ORDER as any);
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function setMode(
    mode: 'immediate' | 'partial' | 'deferred' | 'installments',
  ): void {
    component.form.controls.mode.setValue(mode);
    fixture.detectChanges();
  }

  it('(a) initial mode es immediate', () => {
    expect(component.mode()).toBe('immediate');
  });

  it('(b) cambiar a "partial" actualiza mode() en el mismo tick', () => {
    setMode('partial');
    expect(component.mode()).toBe('partial');
  });

  it('(c) submit en immediate → PATCH /payment-plan con payment_plan=immediate', () => {
    setMode('immediate');
    component.submit();
    const req = http.expectOne(
      (r) =>
        r.method === 'PATCH' &&
        r.url === 'https://api.vendix.online/api/store/orders/purchase-orders/1/payment-plan',
    );
    expect(req.request.body).toEqual({ payment_plan: 'immediate' });
    req.flush({ data: { id: 1, payment_plan: 'immediate' } });
  });

  it('(d) submit en partial con down_payment → PATCH con payment_plan=partial + down_payment_amount', () => {
    setMode('partial');
    component.form.controls.downPayment.setValue(500);
    fixture.detectChanges();
    component.submit();
    const req = http.expectOne(
      (r) =>
        r.method === 'PATCH' &&
        r.url.endsWith('/purchase-orders/1/payment-plan'),
    );
    expect(req.request.body).toEqual({
      payment_plan: 'partial',
      down_payment_amount: 500,
    });
    req.flush({ data: { id: 1, payment_plan: 'partial' } });
  });

  it('(e) submit en deferred con due_date → PATCH con payment_plan=deferred + payment_due_date', () => {
    setMode('deferred');
    component.form.controls.dueDate.setValue('2099-01-15');
    fixture.detectChanges();
    component.submit();
    const req = http.expectOne(
      (r) =>
        r.method === 'PATCH' &&
        r.url.endsWith('/purchase-orders/1/payment-plan'),
    );
    expect(req.request.body).toEqual({
      payment_plan: 'deferred',
      payment_due_date: '2099-01-15',
    });
    req.flush({ data: { id: 1, payment_plan: 'deferred' } });
  });

  it('(f) submit en installments con N cuotas → PATCH con payment_installments', () => {
    setMode('installments');
    component.resetInstallments(2);
    fixture.detectChanges();
    component.submit();
    const req = http.expectOne(
      (r) =>
        r.method === 'PATCH' &&
        r.url.endsWith('/purchase-orders/1/payment-plan'),
    );
    const body = req.request.body as any;
    expect(body.payment_plan).toBe('installments');
    expect(Array.isArray(body.payment_installments)).toBe(true);
    expect(body.payment_installments.length).toBe(2);
    req.flush({ data: { id: 1, payment_plan: 'installments' } });
  });

  // ── Vista `pay` (POST /payments) ──
  // Re-create component with view='pay' for these cases.
  describe('vista pay — POST /payments', () => {
    beforeEach(() => {
      fixture = TestBed.createComponent(PoPaymentModalComponent);
      component = fixture.componentInstance;
      fixture.componentRef.setInput('order', ORDER as any);
      fixture.componentRef.setInput('isOpen', true);
      fixture.componentRef.setInput('view', 'pay');
      fixture.detectChanges();
      http = TestBed.inject(HttpTestingController);
    });

    it('(g) view="pay" + amount > 0 → POST /payments con {amount, payment_date, payment_method}', () => {
      component.amountValue.set(500);
      fixture.detectChanges();
      component.submit();
      const req = http.expectOne(
        (r) =>
          r.method === 'POST' &&
          r.url.endsWith('/purchase-orders/1/payments'),
      );
      const body = req.request.body as any;
      expect(body.amount).toBe(500);
      expect(body.payment_method).toBe('cash');
      expect(typeof body.payment_date).toBe('string');
      req.flush({ data: { id: 99, amount: 500, payment_date: body.payment_date } });
    });

    it('(h) view="pay" + amount > remaining → no dispatch (isPayValid=false)', () => {
      component.amountValue.set(5000); // > total=1000
      fixture.detectChanges();
      component.submit();
      http.expectNone((r) => r.url.includes('/payments'));
    });

    it('(i) presetAmount/presetDate pre-llenan amount y payment_date al abrir', () => {
      fixture = TestBed.createComponent(PoPaymentModalComponent);
      component = fixture.componentInstance;
      fixture.componentRef.setInput('order', ORDER as any);
      fixture.componentRef.setInput('isOpen', true);
      fixture.componentRef.setInput('view', 'pay');
      fixture.componentRef.setInput('presetAmount', 800);
      fixture.componentRef.setInput('presetDate', '2026-09-17');
      fixture.detectChanges();
      // resetForm() corre en el effect de isOpen → open, pre-llenó con preset.
      expect(component.amountValue()).toBe(800);
      expect(component.paymentDate()).toBe('2026-09-17');
      http.verify();
    });

    it('(j) toggle interno entre vistas: setView("plan") cambia activeView()', () => {
      expect(component.activeView()).toBe('pay');
      component.setView('plan');
      expect(component.activeView()).toBe('plan');
      component.setView('pay');
      expect(component.activeView()).toBe('pay');
      http.verify();
    });
  });
});