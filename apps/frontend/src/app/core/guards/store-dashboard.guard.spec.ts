import { AccessGateService } from '../services/access-gate.service';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { storeDashboardGuard } from './store-dashboard.guard';
import { MenuFilterService, PANEL_UI_NO_ACCESS_ROUTE } from '../services/menu-filter.service';
import { ToastService } from '../../shared/components/toast/toast.service';
import { AuthFacade } from '../store/auth/auth.facade';
import { HomePanelService } from '../../private/modules/store/dashboard/home-panels/home-panel.service';

describe('storeDashboardGuard (QUI-860)', () => {
  let menuFilter: jasmine.SpyObj<MenuFilterService>;
  let toast: jasmine.SpyObj<ToastService>;
  let authFacade: jasmine.SpyObj<AuthFacade>;
  let router: Router;
  let canEnterDashboard: boolean;

  beforeEach(() => {
    canEnterDashboard = false;
    menuFilter = jasmine.createSpyObj('MenuFilterService', [
      'currentMenuTree',
      'firstActiveModuleRoute',
    ]);
    toast = jasmine.createSpyObj('ToastService', [
      'info',
      'warning',
      'error',
      'success',
    ]);
    authFacade = jasmine.createSpyObj('AuthFacade', [
      'isOwner',
      'isAdmin',
      'hasAnyRole',
      'hasAnyPermission',
    ]);

    menuFilter.currentMenuTree.and.returnValue([]);
    menuFilter.firstActiveModuleRoute.and.returnValue('/admin/pos');
    authFacade.isOwner.and.returnValue(false);
    authFacade.isAdmin.and.returnValue(false);
    authFacade.hasAnyRole.and.returnValue(false);
    authFacade.hasAnyPermission.and.returnValue(false);

    TestBed.configureTestingModule({
      imports: [RouterTestingModule],
      providers: [
        { provide: MenuFilterService, useValue: menuFilter },
        { provide: ToastService, useValue: toast },
        { provide: AuthFacade, useValue: authFacade },
        {
          provide: HomePanelService,
          useValue: { canEnterDashboard: () => canEnterDashboard },
        },
        {
          provide: AccessGateService,
          useValue: { mode: () => 'audit', industries: () => null, orgPanelUi: () => null, report: () => undefined, planMode: () => 'audit', planBlocked: () => [], planOffers: () => ({}), currentPlan: () => null },
        },
      ],
    });

    router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.returnValue(Promise.resolve(true));
  });

  it('permite el acceso si el usuario es owner', () => {
    authFacade.isOwner.and.returnValue(true);
    const result = TestBed.runInInjectionContext(() =>
      storeDashboardGuard({} as any, {} as any),
    );
    expect(result).toBeTrue();
    expect(toast.info).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('permite el acceso si el usuario es admin', () => {
    authFacade.isAdmin.and.returnValue(true);
    const result = TestBed.runInInjectionContext(() =>
      storeDashboardGuard({} as any, {} as any),
    );
    expect(result).toBeTrue();
  });

  it('permite el acceso si el usuario tiene rol manager', () => {
    authFacade.hasAnyRole.and.callFake((roles: string[]) => roles.includes('manager'));
    const result = TestBed.runInInjectionContext(() =>
      storeDashboardGuard({} as any, {} as any),
    );
    expect(result).toBeTrue();
  });

  it('permite el acceso si el usuario tiene permiso store:dashboard:view', () => {
    authFacade.hasAnyPermission.and.callFake((perms: string[]) => perms.includes('store:dashboard:view'));
    const result = TestBed.runInInjectionContext(() =>
      storeDashboardGuard({} as any, {} as any),
    );
    expect(result).toBeTrue();
  });

  it('muestra toast y redirige a la primera ruta operativa si el usuario no tiene acceso a dashboard', () => {
    menuFilter.firstActiveModuleRoute.and.returnValue('/admin/pos');
    const result = TestBed.runInInjectionContext(() =>
      storeDashboardGuard({} as any, {} as any),
    );
    expect(result).toBeFalse();
    expect(toast.info).toHaveBeenCalledWith('No tienes permisos para acceder al Panel Principal.');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/pos');
  });

  it('redirige a /admin/no-access cuando firstActiveModuleRoute retorna /admin/dashboard para evitar pantalla en blanco', () => {
    menuFilter.firstActiveModuleRoute.and.returnValue('/admin/dashboard');
    const result = TestBed.runInInjectionContext(() =>
      storeDashboardGuard({} as any, {} as any),
    );
    expect(result).toBeFalse();
    expect(toast.info).toHaveBeenCalledWith('No tienes permisos para acceder al Panel Principal.');
    expect(router.navigateByUrl).toHaveBeenCalledWith(PANEL_UI_NO_ACCESS_ROUTE);
  });

  it('QUI-967: sin permisos de dashboard pero con un panel configurado visible, entra', () => {
    canEnterDashboard = true;
    const result = TestBed.runInInjectionContext(() =>
      storeDashboardGuard({} as any, {} as any),
    );
    expect(result).toBeTrue();
    expect(toast.info).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('QUI-967: sin ninguna pestaña visible, conserva la redirección anterior', () => {
    canEnterDashboard = false;
    menuFilter.firstActiveModuleRoute.and.returnValue('/admin/pos');
    const result = TestBed.runInInjectionContext(() =>
      storeDashboardGuard({} as any, {} as any),
    );
    expect(result).toBeFalse();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/pos');
  });
});
