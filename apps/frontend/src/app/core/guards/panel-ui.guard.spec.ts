import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { panelUiGuard, firstActiveModuleRedirectGuard } from './panel-ui.guard';
import { MenuFilterService } from '../services/menu-filter.service';
import { ToastService } from '../../shared/components/toast/toast.service';
import {
  PANEL_UI_NO_ACCESS_ROUTE,
  PANEL_UI_TERMINAL_ROUTE,
} from '../services/menu-filter.service';
import { AuthFacade } from '../store/auth/auth.facade';

const ERR_10 =
  'Ese módulo no está disponible para tu usuario. Si crees que deberías tenerlo, pídele a tu administrador que lo active.';

const hidden = {
  visible: false,
  blockedBy: 'user_panel_ui' as const,
  detail: '',
  fixPath: null,
};
const visible = {
  visible: true,
  blockedBy: null,
  detail: '',
  fixPath: null,
};

describe('panelUiGuard', () => {
  let menuFilter: jasmine.SpyObj<MenuFilterService>;
  let toast: jasmine.SpyObj<ToastService>;
  let authFacade: jasmine.SpyObj<AuthFacade>;
  let router: Router;

  beforeEach(() => {
    menuFilter = jasmine.createSpyObj('MenuFilterService', [
      'resolveKeysForRoute',
      'diagnoseModule',
      'currentMenuTree',
      'firstActiveModuleRoute',
    ]);
    toast = jasmine.createSpyObj('ToastService', [
      'info',
      'warning',
      'error',
      'success',
    ]);
    authFacade = jasmine.createSpyObj('AuthFacade', ['isOwner']);

    menuFilter.resolveKeysForRoute.and.returnValue([]);
    menuFilter.currentMenuTree.and.returnValue([]);
    menuFilter.firstActiveModuleRoute.and.returnValue('/admin/dashboard');
    menuFilter.diagnoseModule.and.returnValue(visible);
    // Default: el actor NO es owner; los tests que necesitan owner lo sobreescriben.
    authFacade.isOwner.and.returnValue(false);

    TestBed.configureTestingModule({
      imports: [RouterTestingModule],
      providers: [
        { provide: MenuFilterService, useValue: menuFilter },
        { provide: ToastService, useValue: toast },
        { provide: AuthFacade, useValue: authFacade },
      ],
    });

    router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.resolveTo(true);
  });

  const runGuard = (url: string): boolean | unknown =>
    TestBed.runInInjectionContext(() =>
      panelUiGuard({} as any, { url } as any),
    );

  it('bloquea un módulo oculto por panel_ui, muestra el toast ERR-10 y redirige al primer activo', () => {
    menuFilter.resolveKeysForRoute.and.returnValue(['pos']);
    menuFilter.diagnoseModule.and.returnValue(hidden);

    const result = runGuard('/admin/pos');

    expect(result).toBeFalse();
    expect(toast.info).toHaveBeenCalledWith(ERR_10);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/dashboard');
  });

  it('permite un módulo visible (no toca el toast ni navega)', () => {
    menuFilter.resolveKeysForRoute.and.returnValue(['pos']);
    menuFilter.diagnoseModule.and.returnValue(visible);

    const result = runGuard('/admin/pos');

    expect(result).toBeTrue();
    expect(toast.info).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('no bloquea una ruta sin módulo panel_ui gobernante', () => {
    menuFilter.resolveKeysForRoute.and.returnValue([]);

    const result = runGuard('/admin');

    expect(result).toBeTrue();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('deja pasar la ruta terminal para no entrar en bucle de redirect', () => {
    const result = runGuard(PANEL_UI_TERMINAL_ROUTE);

    expect(result).toBeTrue();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('deja pasar la ruta "no-access" para no entrar en bucle de redirect (C.1(2))', () => {
    const result = runGuard(PANEL_UI_NO_ACCESS_ROUTE);

    expect(result).toBeTrue();
    expect(toast.info).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('owner pasa siempre aunque el módulo esté bloqueado por user_panel_ui (C.1(2))', () => {
    authFacade.isOwner.and.returnValue(true);
    menuFilter.resolveKeysForRoute.and.returnValue(['pos']);
    menuFilter.diagnoseModule.and.returnValue(hidden);

    const result = runGuard('/admin/pos');

    expect(result).toBeTrue();
    expect(toast.info).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('respeta el apagado a nivel tienda (store_panel_ui) igual que el del usuario', () => {
    menuFilter.resolveKeysForRoute.and.returnValue(['pos']);
    menuFilter.diagnoseModule.and.returnValue({
      visible: false,
      blockedBy: 'store_panel_ui' as const,
      detail: '',
      fixPath: null,
    });

    const result = runGuard('/admin/pos');

    expect(result).toBeFalse();
    expect(toast.info).toHaveBeenCalledWith(ERR_10);
    expect(router.navigateByUrl).toHaveBeenCalled();
  });

  it('no bloquea un bloqueo NO de panel_ui (p. ej. fiscal_scope lo maneja otro guard)', () => {
    menuFilter.resolveKeysForRoute.and.returnValue(['accounting']);
    menuFilter.diagnoseModule.and.returnValue({
      visible: false,
      blockedBy: 'fiscal_scope' as const,
      detail: '',
      fixPath: null,
    });

    const result = runGuard('/admin/accounting');

    expect(result).toBeTrue();
    expect(toast.info).not.toHaveBeenCalled();
  });
});

describe('firstActiveModuleRedirectGuard (B.1)', () => {
  let menuFilter: jasmine.SpyObj<MenuFilterService>;
  let router: Router;

  beforeEach(() => {
    menuFilter = jasmine.createSpyObj('MenuFilterService', ['currentMenuTree', 'firstActiveModuleRoute']);
    menuFilter.currentMenuTree.and.returnValue([]);
    menuFilter.firstActiveModuleRoute.and.returnValue('/admin/pos');

    TestBed.configureTestingModule({
      imports: [RouterTestingModule],
      providers: [{ provide: MenuFilterService, useValue: menuFilter }],
    });

    router = TestBed.inject(Router);
  });

  it('devuelve un UrlTree al primer módulo activo', () => {
    const result = TestBed.runInInjectionContext(() =>
      firstActiveModuleRedirectGuard({} as any, { url: '/admin' } as any),
    );

    expect(router.serializeUrl(result as any)).toBe('/admin/pos');
  });
});
