import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { PoPaymentModalComponent } from './po-payment-modal.component';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';

const buildCurrencyStub = () =>
  ({
    format: (n: number | string | null | undefined) =>
      `$${Number(n ?? 0).toFixed(2)}`,
    loadCurrency: () => undefined,
    // El app-input en modo moneda lee estas dos senales del servicio para
    // decidir separadores y decimales al escribir el valor (writeValue ->
    // currencyFormatForDisplay). Sin ellas el stub explota con
    // "currencyFormatStyle is not a function" en cuanto un FormControl de
    // dinero recibe setValue.
    currencyFormatStyle: () => 'comma_dot' as const,
    currencyDecimals: () => 2,
  }) as unknown as CurrencyFormatService;

/**
 * El modal lee storeSettings.settings()?.general?.timezone para fechar el pago.
 * Sin este stub, TestBed construye el facade real, que inyecta el Store de NgRx
 * y revienta con NG0201 al crear el componente: los 14 casos fallaban ahi, antes
 * de ejercitar una sola linea de logica del modal.
 */
const buildStoreSettingsStub = () =>
  ({
    settings: () => null,
  }) as unknown as StoreSettingsFacade;

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
        { provide: StoreSettingsFacade, useFactory: buildStoreSettingsStub },
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

    /**
     * Camino triste legible. `isPayValid()` apaga el submit con "a > 0 &&
     * a <= remaining", pero hasta ahora solo el techo se explicaba: un monto
     * en cero o negativo dejaba el botón muerto sin decir por qué. El piso
     * coincide con lo que el servidor rechaza desde RegisterPaymentDto
     * (Min 0.01, commit 2762dd995): cero incluido, no solo los negativos.
     */
    const errorTexts = (): string[] =>
      Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('p.text-destructive'),
      ).map((el) => (el.textContent ?? '').trim());

    it('(k) amount negativo → explica el piso y no dispara POST', () => {
      component.amountValue.set(-5000);
      fixture.detectChanges();

      expect(errorTexts()).toContain('El monto debe ser mayor que cero.');
      component.submit();
      http.expectNone((r) => r.url.includes('/payments'));
    });

    it('(l) amount en cero → mismo mensaje: cero tampoco es un pago válido', () => {
      component.amountValue.set(0);
      fixture.detectChanges();

      expect(errorTexts()).toContain('El monto debe ser mayor que cero.');
      component.submit();
      http.expectNone((r) => r.url.includes('/payments'));
    });

    it('(m) amount > pendiente → sigue explicando el techo, y solo el techo', () => {
      component.amountValue.set(5000); // > total=1000
      fixture.detectChanges();

      expect(errorTexts()).toContain('El monto no puede superar el saldo pendiente.');
      expect(errorTexts()).not.toContain('El monto debe ser mayor que cero.');
    });

    it('(n) amount válido → ningún mensaje de monto', () => {
      component.amountValue.set(500);
      fixture.detectChanges();

      expect(errorTexts()).not.toContain('El monto debe ser mayor que cero.');
      expect(errorTexts()).not.toContain('El monto no puede superar el saldo pendiente.');
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