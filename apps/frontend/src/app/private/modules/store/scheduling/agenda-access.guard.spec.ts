import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { MenuFilterService } from '../../../../core/services/menu-filter.service';
import { PlanPaywallService } from '../../../../core/services/plan-paywall.service';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { agendaAccessGuard, agendaTabRedirect } from './agenda-access.guard';

describe('Agenda unificada F1 — agendaAccessGuard', () => {
  let open: string[];
  let planLock: unknown;
  let toast: jasmine.SpyObj<ToastService>;
  let paywall: { show: jasmine.Spy; notice: jasmine.Spy };
  let candidates: string[];
  let menuFilter: { openAnyOfKeys: jasmine.Spy; candidateAnyOfKeys: jasmine.Spy; planLockForKeys: jasmine.Spy; firstActiveModuleRoute: jasmine.Spy; currentMenuTree: jasmine.Spy };

  beforeEach(() => {
    open = [];
    candidates = ['orders_reservations', 'orders_scheduled'];
    planLock = null;
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['info']);
    paywall = { show: jasmine.createSpy('show').and.returnValue(true), notice: jasmine.createSpy('notice') };
    menuFilter = {
      openAnyOfKeys: jasmine.createSpy('openAnyOfKeys').and.callFake((keys: string[]) =>
        keys.filter((k) => open.includes(k)),
      ),
      candidateAnyOfKeys: jasmine.createSpy('candidateAnyOfKeys').and.callFake(() => candidates),
      planLockForKeys: jasmine.createSpy('planLockForKeys').and.callFake(() => planLock),
      firstActiveModuleRoute: jasmine.createSpy('firstActiveModuleRoute').and.returnValue('/admin/dashboard'),
      currentMenuTree: jasmine.createSpy('currentMenuTree').and.returnValue([]),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: MenuFilterService, useValue: menuFilter },
        { provide: ToastService, useValue: toast },
        { provide: PlanPaywallService, useValue: paywall },
      ],
    });
  });

  const run = () =>
    TestBed.runInInjectionContext(() => agendaAccessGuard({} as any, { url: '/admin/orders/agenda' } as any));

  it('ninguna de las dos keys abierta → fuera (al primer módulo activo) con aviso', () => {
    const result = run();
    expect(menuFilter.openAnyOfKeys).toHaveBeenCalledWith(['orders_reservations', 'orders_scheduled'], 'url');
    expect(result instanceof UrlTree).toBeTrue();
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/admin/dashboard');
    expect(toast.info).toHaveBeenCalled();
  });

  it('una key abierta → entra (dentro solo ve su parte)', () => {
    open = ['orders_scheduled'];
    expect(run()).toBeTrue();
    open = ['orders_reservations'];
    expect(run()).toBeTrue();
  });

  it('cerrada por plan → paywall del módulo', () => {
    planLock = { key: 'orders_reservations' };
    run();
    expect(paywall.show).toHaveBeenCalledWith(planLock as any);
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('las URLs viejas de configuración de Reservas solo abren su sección con Reservas abierto', () => {
    const router = TestBed.inject(Router);
    const redirect = (section: 'equipo') =>
      router.serializeUrl(TestBed.runInInjectionContext(() => agendaTabRedirect('configuracion', section)));
    open = ['orders_reservations'];
    expect(redirect('equipo')).toBe('/admin/orders/agenda?tab=configuracion&seccion=equipo');
    open = ['orders_scheduled'];
    expect(redirect('equipo')).toBe('/admin/orders/agenda?tab=calendario');
    // Las pestañas sin sección no dependen de Reservas.
    expect(
      router.serializeUrl(TestBed.runInInjectionContext(() => agendaTabRedirect('programacion'))),
    ).toBe('/admin/orders/agenda?tab=programacion');
  });

  it('N3: con pedidos apagados y Reservas fuera del plan abre el paywall de Reservas', () => {
    candidates = ['orders_reservations'];
    menuFilter.planLockForKeys.and.callFake((keys: string[]) =>
      keys.length === 1 && keys[0] === 'orders_reservations' ? { key: 'orders_reservations' } : null,
    );
    run();
    expect(menuFilter.planLockForKeys).toHaveBeenCalledWith(['orders_reservations']);
    expect(paywall.show).toHaveBeenCalledWith({ key: 'orders_reservations' } as any);
    expect(toast.info).not.toHaveBeenCalled();
  });
});
