import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';

import { VendixAccountMovementsComponent } from './vendix-account-movements.component';
import { PlatformCrmService } from './platform-crm.service';
import {
  CoveredStore,
  SubscriptionMetrics,
  SubscriptionMovement,
  SubscriptionMovementsView,
  formatMoneyAmount,
} from './platform-crm.interface';

/**
 * Cuenta Vendix · «Movimientos de la suscripción».
 * Como comercial de Vendix, veo arriba lo que el cliente ha pagado, su último
 * pago, la próxima renovación y si está en mora, y debajo sus facturas, pagos
 * y cambios de plan de todas sus cuentas; filtro por comercio o tipo y pido
 * más con «Ver más».
 */
describe('VendixAccountMovementsComponent', () => {
  const STORES: CoveredStore[] = [
    {
      store_id: 201,
      store_name: 'Espiga Centro',
      organization_name: 'Panadería La Espiga',
      plan_name: 'Plan Pro',
      subscription_state: 'active',
    },
    {
      store_id: 301,
      store_name: 'Clavo Principal',
      organization_name: 'Ferretería El Clavo',
      plan_name: 'Plan Básico',
      subscription_state: 'grace_soft',
    },
  ];
  const blank = {
    state: null,
    invoice_number: null,
    total: null,
    amount_paid: null,
    due_at: null,
    change_kind: null,
    amount: null,
    currency: null,
    payment_method: null,
    failure_reason: null,
    event_type: null,
    from_state: null,
    to_state: null,
    from_plan_name: null,
    to_plan_name: null,
  };
  const ITEMS: SubscriptionMovement[] = [
    {
      ...blank,
      key: 'event:31',
      type: 'event',
      date: '2026-11-12T09:00:00.000Z',
      store_id: 301,
      store_name: 'Clavo Principal',
      event_type: 'plan_changed',
      from_state: 'active',
      to_state: 'active',
      from_plan_name: 'Plan Básico',
      to_plan_name: 'Plan Pro',
    },
    {
      ...blank,
      key: 'payment:21',
      type: 'payment',
      date: '2026-10-02T10:00:00.000Z',
      store_id: 201,
      store_name: 'Espiga Centro',
      state: 'succeeded',
      amount: 119000,
      currency: 'COP',
      payment_method: 'card',
    },
    {
      ...blank,
      key: 'invoice:12',
      type: 'invoice',
      date: '2026-11-01T10:00:00.000Z',
      store_id: 301,
      store_name: 'Clavo Principal',
      state: 'overdue',
      invoice_number: 'VX-0012',
      total: 50,
      amount_paid: 10,
      currency: 'USD',
      due_at: '2026-11-05T00:00:00.000Z',
    },
  ];
  const total: SubscriptionMetrics = {
    total_paid: [
      { currency: 'COP', amount: 119000 },
      { currency: 'USD', amount: 25 },
    ],
    last_payment: { date: '2026-10-02T10:00:00.000Z', amount: 119000, currency: 'COP', store_id: 201 },
    next_renewal_at: '2026-11-30T00:00:00.000Z',
    overdue_count: 1,
    overdue_balance: [{ currency: 'USD', amount: 40 }],
    monthly_value: [{ currency: 'COP', amount: 100000 }],
  };
  const byStore201: SubscriptionMetrics & { store_id: number } = {
    store_id: 201,
    total_paid: [{ currency: 'COP', amount: 119000 }],
    last_payment: total.last_payment,
    next_renewal_at: '2027-01-01T00:00:00.000Z',
    overdue_count: 0,
    overdue_balance: [],
    monthly_value: [{ currency: 'COP', amount: 100000 }],
  };
  const view = (
    items: SubscriptionMovement[] = ITEMS,
    pagination = { page: 1, limit: 20, total: items.length, has_more: false },
  ): SubscriptionMovementsView => ({
    window: { from: '2025-11-20', to: '2026-11-19' },
    stores: STORES,
    summary: { total, by_store: [byStore201] },
    items,
    pagination,
  });

  let service: { getSubscriptionMovements: jasmine.Spy };
  let fixture: ComponentFixture<VendixAccountMovementsComponent>;
  let emitted: CoveredStore[][];

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => (root().textContent ?? '').replace(/\s+/g, ' ');
  const rows = () =>
    Array.from(root().querySelectorAll<HTMLElement>('[data-testid="vendix-account-movement"]')).map(
      (row) => (row.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
  /** `Intl` separa símbolo y número con espacio duro; el texto ya viene normalizado. */
  const money = (amount: number, currency: string) =>
    formatMoneyAmount(amount, currency).replace(/\s+/g, ' ');
  const buttonWith = (label: string) =>
    Array.from(root().querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(label)) ?? null;

  const setup = async (spy: jasmine.Spy) => {
    service = { getSubscriptionMovements: spy };
    TestBed.configureTestingModule({
      imports: [VendixAccountMovementsComponent],
      providers: [provideZonelessChangeDetection(), { provide: PlatformCrmService, useValue: service }],
    });
    fixture = TestBed.createComponent(VendixAccountMovementsComponent);
    fixture.componentRef.setInput('customerId', 55);
    emitted = [];
    fixture.componentInstance.storesLoaded.subscribe((stores) => emitted.push(stores));
    await settle();
  };

  it('muestra las métricas y los movimientos de todas las cuentas, con aviso de que no tocan la contabilidad', async () => {
    await setup(jasmine.createSpy('get').and.returnValue(of(view())));

    expect(service.getSubscriptionMovements).toHaveBeenCalledOnceWith(55, { page: 1, limit: 20 });
    const content = text();
    expect(content).toContain('Movimientos de la plataforma. No afectan la contabilidad de esta tienda.');
    expect(content).toContain('Total pagado (12 meses)');
    expect(content).toContain(money(119000, 'COP'));
    expect(content).toContain(money(25, 'USD'));
    expect(content).toContain('Próxima renovación');
    expect(content).toContain('1 factura');
    expect(content).toContain(money(40, 'USD'));
    expect(content).toContain('Valor mensual actual');

    const [event, payment, invoice] = rows();
    expect(event).toContain('Cambio de plan: Plan Básico → Plan Pro');
    expect(event).toContain('Clavo Principal');
    expect(payment).toContain('Pago');
    expect(payment).toContain('Exitoso');
    expect(payment).toContain(money(119000, 'COP'));
    expect(invoice).toContain('Factura VX-0012');
    expect(invoice).toContain('Vencida');
    expect(invoice).toContain('vence');
    expect(emitted).toEqual([STORES]);
  });

  it('filtrar por comercio pide solo ese comercio y muestra sus métricas', async () => {
    await setup(jasmine.createSpy('get').and.returnValue(of(view())));
    service.getSubscriptionMovements.and.returnValue(of(view([ITEMS[1]])));

    fixture.componentInstance['onStoreChange'](201);
    await settle();

    expect(service.getSubscriptionMovements.calls.mostRecent().args).toEqual([
      55,
      { page: 1, limit: 20, store_id: 201 },
    ]);
    expect(rows()).toHaveSize(1);
    expect(text()).toContain('Al día');
    expect(text()).not.toContain('1 factura');
  });

  it('filtrar por tipo pide ese tipo', async () => {
    await setup(jasmine.createSpy('get').and.returnValue(of(view())));

    fixture.componentInstance['onTypeChange']('payment');
    await settle();

    expect(service.getSubscriptionMovements.calls.mostRecent().args).toEqual([
      55,
      { page: 1, limit: 20, type: 'payment' },
    ]);
  });

  it('«Ver más» pide la página siguiente y la agrega debajo', async () => {
    const spy = jasmine
      .createSpy('get')
      .and.returnValues(
        of(view([ITEMS[0], ITEMS[1]], { page: 1, limit: 20, total: 3, has_more: true })),
        of(view([ITEMS[2]], { page: 2, limit: 20, total: 3, has_more: false })),
      );
    await setup(spy);
    expect(rows()).toHaveSize(2);

    buttonWith('Ver más')!.click();
    await settle();

    expect(spy.calls.mostRecent().args).toEqual([55, { page: 2, limit: 20 }]);
    expect(rows()).toHaveSize(3);
    expect(buttonWith('Ver más')).toBeNull();
  });

  it('sin movimientos lo dice', async () => {
    await setup(jasmine.createSpy('get').and.returnValue(of(view([]))));
    expect(text()).toContain('Sin movimientos en los últimos 12 meses.');
  });

  it('un error deja «Reintentar», que vuelve a consultar', async () => {
    const spy = jasmine
      .createSpy('get')
      .and.returnValues(throwError(() => new HttpErrorResponse({ status: 500 })), of(view()));
    await setup(spy);

    expect(text()).toContain('No pudimos cargar los movimientos.');
    buttonWith('Reintentar')!.click();
    await settle();

    expect(spy).toHaveBeenCalledTimes(2);
    expect(rows()).toHaveSize(3);
  });

  it('cambiar reloadKey (enlazar o desenlazar) recarga desde la primera página', async () => {
    await setup(jasmine.createSpy('get').and.returnValue(of(view())));

    fixture.componentRef.setInput('reloadKey', '7,8');
    await settle();

    expect(service.getSubscriptionMovements).toHaveBeenCalledTimes(2);
    expect(service.getSubscriptionMovements.calls.mostRecent().args).toEqual([55, { page: 1, limit: 20 }]);
  });
});
