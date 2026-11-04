import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import {
  firstActiveModuleRedirectGuard,
  orgPanelUiGuard,
  panelUiGuard,
} from './panel-ui.guard';
import { AccessGateService } from '../services/access-gate.service';
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
  let accessGate: jasmine.SpyObj<AccessGateService>;
  let router: Router;

  beforeEach(() => {
    menuFilter = jasmine.createSpyObj('MenuFilterService', [
      'resolveKeysForRoute',
      'diagnoseModule',
      'currentMenuTree',
      'firstActiveModuleRoute',
      'resolveGateKeysForRoute',
      'applyAccessGate',
      'industryBlockMessage',
      'fiscalStageBlockForUrl',
    ]);
    menuFilter.fiscalStageBlockForUrl.and.returnValue(null);
    accessGate = jasmine.createSpyObj('AccessGateService', ['ensureLoaded']);
    accessGate.ensureLoaded.and.resolveTo();
    menuFilter.resolveGateKeysForRoute.and.returnValue([]);
    // Audit mode: the F4 gate never blocks beyond the pre-F4 verdict.
    menuFilter.applyAccessGate.and.callFake((_keys, legacyAllowed) => legacyAllowed);
    menuFilter.industryBlockMessage.and.callFake((keys: string[]) =>
      MenuFilterService.prototype.industryBlockMessage.call(null, keys),
    );
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
        { provide: AccessGateService, useValue: accessGate },
      ],
    });

    router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.resolveTo(true);
  });

  const runGuard = (url: string): Promise<unknown> =>
    TestBed.runInInjectionContext(() =>
      Promise.resolve(panelUiGuard({} as any, { url } as any)),
    );

  it('bloquea un módulo oculto por panel_ui, muestra el toast ERR-10 y redirige al primer activo', async () => {
    menuFilter.resolveKeysForRoute.and.returnValue(['pos']);
    menuFilter.diagnoseModule.and.returnValue(hidden);

    const result = await runGuard('/admin/pos');

    expect(result).toBeFalse();
    expect(toast.info).toHaveBeenCalledWith(ERR_10);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/dashboard');
  });

  it('permite un módulo visible (no toca el toast ni navega)', async () => {
    menuFilter.resolveKeysForRoute.and.returnValue(['pos']);
    menuFilter.diagnoseModule.and.returnValue(visible);

    const result = await runGuard('/admin/pos');

    expect(result).toBeTrue();
    expect(toast.info).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('no bloquea una ruta sin módulo panel_ui gobernante', async () => {
    menuFilter.resolveKeysForRoute.and.returnValue([]);

    const result = await runGuard('/admin');

    expect(result).toBeTrue();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('deja pasar la ruta terminal para no entrar en bucle de redirect', async () => {
    const result = await runGuard(PANEL_UI_TERMINAL_ROUTE);

    expect(result).toBeTrue();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('deja pasar la ruta "no-access" para no entrar en bucle de redirect (C.1(2))', async () => {
    const result = await runGuard(PANEL_UI_NO_ACCESS_ROUTE);

    expect(result).toBeTrue();
    expect(toast.info).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('owner pasa siempre aunque el módulo esté bloqueado por user_panel_ui (C.1(2))', async () => {
    authFacade.isOwner.and.returnValue(true);
    menuFilter.resolveKeysForRoute.and.returnValue(['pos']);
    menuFilter.diagnoseModule.and.returnValue(hidden);

    const result = await runGuard('/admin/pos');

    expect(result).toBeTrue();
    expect(toast.info).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('respeta el apagado a nivel tienda (store_panel_ui) igual que el del usuario', async () => {
    menuFilter.resolveKeysForRoute.and.returnValue(['pos']);
    menuFilter.diagnoseModule.and.returnValue({
      visible: false,
      blockedBy: 'store_panel_ui' as const,
      detail: '',
      fixPath: null,
    });

    const result = await runGuard('/admin/pos');

    expect(result).toBeFalse();
    expect(toast.info).toHaveBeenCalledWith(ERR_10);
    expect(router.navigateByUrl).toHaveBeenCalled();
  });

  it('no bloquea un bloqueo NO de panel_ui (p. ej. fiscal_scope lo maneja otro guard)', async () => {
    menuFilter.resolveKeysForRoute.and.returnValue(['accounting']);
    menuFilter.diagnoseModule.and.returnValue({
      visible: false,
      blockedBy: 'fiscal_scope' as const,
      detail: '',
      fixPath: null,
    });

    const result = await runGuard('/admin/accounting');

    expect(result).toBeTrue();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('Finanzas: bloquea la URL de una etapa fiscal sin completar, también al owner', async () => {
    authFacade.isOwner.and.returnValue(true);
    const detail =
      'Esta sección aparece cuando completes la etapa «Impuestos» de la configuración fiscal.';
    menuFilter.fiscalStageBlockForUrl.and.returnValue({
      visible: false,
      blockedBy: 'fiscal_area',
      detail,
      fixPath: '/admin/fiscal/wizard',
    });

    const result = await runGuard('/admin/taxes');

    expect(menuFilter.fiscalStageBlockForUrl).toHaveBeenCalledWith('/admin/taxes');
    expect(result).toBeFalse();
    expect(toast.info).toHaveBeenCalledWith(detail);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/dashboard');
  });

  it('Finanzas: deja pasar la URL fiscal cuando su etapa está lista', async () => {
    authFacade.isOwner.and.returnValue(true);

    const result = await runGuard('/admin/taxes');

    expect(result).toBeTrue();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('bloquea por industria (A.2) con el mensaje ERR-03 y redirige', async () => {
    menuFilter.resolveKeysForRoute.and.returnValue(['orders_contracts']);
    menuFilter.diagnoseModule.and.returnValue({
      visible: false,
      blockedBy: 'industry' as const,
      detail: '',
      fixPath: null,
    });

    const result = await runGuard('/admin/orders/contracts');

    expect(result).toBeFalse();
    expect(toast.info).toHaveBeenCalledWith(
      'No disponible en tu industria. Este módulo aplica solo a tiendas de construcción.',
    );
    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/dashboard');
  });
  // ── apps-f4 S4: compuerta canSeeKey en la URL ─────────────────────────

  it('S4: el owner ya no salta la industria; en auditoría la compuerta registra y deja pasar', async () => {
    authFacade.isOwner.and.returnValue(true);
    menuFilter.resolveGateKeysForRoute.and.returnValue([
      'restaurant_ops',
      'restaurant_ops_recipes',
    ]);

    const result = await runGuard('/admin/restaurant-ops/recipes');

    expect(result).toBeTrue();
    expect(accessGate.ensureLoaded).toHaveBeenCalledWith('STORE_ADMIN');
    expect(menuFilter.applyAccessGate).toHaveBeenCalledWith(
      ['restaurant_ops', 'restaurant_ops_recipes'],
      true,
      'url',
      '/admin/restaurant-ops/recipes',
    );
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('S4: un admin retail que pega recetas sigue entrando en auditoría (ruta antes sin guard por industria)', async () => {
    menuFilter.resolveKeysForRoute.and.returnValue(['restaurant_ops_recipes']);
    menuFilter.diagnoseModule.and.returnValue(visible);
    menuFilter.resolveGateKeysForRoute.and.returnValue(['restaurant_ops_recipes']);

    const result = await runGuard('/admin/restaurant-ops/recipes');

    expect(result).toBeTrue();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('S4: con el flag encendido la compuerta bloquea, avisa la industria real y redirige', async () => {
    menuFilter.resolveGateKeysForRoute.and.returnValue(['restaurant_ops_recipes']);
    menuFilter.applyAccessGate.and.returnValue(false);

    const result = await runGuard('/admin/restaurant-ops/recipes');

    expect(result).toBeFalse();
    expect(toast.info).toHaveBeenCalledWith(
      'No disponible en tu industria. Este módulo aplica solo a tiendas de restaurante.',
    );
    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/dashboard');
  });

  it('S4: un bloqueo pre-F4 no pasa por la compuerta (no la amplía)', async () => {
    menuFilter.resolveKeysForRoute.and.returnValue(['pos']);
    menuFilter.diagnoseModule.and.returnValue(hidden);

    await runGuard('/admin/pos');

    expect(menuFilter.applyAccessGate).not.toHaveBeenCalled();
  });
});


describe('orgPanelUiGuard (apps-f4 S5)', () => {
  let menuFilter: jasmine.SpyObj<MenuFilterService>;
  let accessGate: jasmine.SpyObj<AccessGateService>;
  let toast: jasmine.SpyObj<ToastService>;
  let router: Router;

  beforeEach(() => {
    menuFilter = jasmine.createSpyObj('MenuFilterService', [
      'resolveGateKeysForRoute',
      'applyAccessGate',
      'industryBlockMessage',
    ]);
    accessGate = jasmine.createSpyObj('AccessGateService', ['ensureLoaded']);
    toast = jasmine.createSpyObj('ToastService', ['info']);
    accessGate.ensureLoaded.and.resolveTo();
    menuFilter.resolveGateKeysForRoute.and.returnValue(['stores']);
    menuFilter.industryBlockMessage.and.returnValue('No disponible en tu industria.');
    TestBed.configureTestingModule({
      imports: [RouterTestingModule],
      providers: [
        { provide: MenuFilterService, useValue: menuFilter },
        { provide: AccessGateService, useValue: accessGate },
        { provide: ToastService, useValue: toast },
      ],
    });
    router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.resolveTo(true);
  });

  const run = (url: string): Promise<unknown> =>
    TestBed.runInInjectionContext(() =>
      Promise.resolve(orgPanelUiGuard({} as any, { url } as any)),
    );

  it('consulta la compuerta con el índice ORG y, en auditoría, deja pasar', async () => {
    menuFilter.applyAccessGate.and.returnValue(true);

    const result = await run('/admin/stores');

    expect(result).toBeTrue();
    expect(accessGate.ensureLoaded).toHaveBeenCalledWith('ORG_ADMIN');
    expect(menuFilter.resolveGateKeysForRoute).toHaveBeenCalledWith('/admin/stores', 'ORG_ADMIN');
    expect(menuFilter.applyAccessGate).toHaveBeenCalledWith(['stores'], true, 'url', '/admin/stores');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('con el flag global encendido bloquea y vuelve al dashboard', async () => {
    menuFilter.applyAccessGate.and.returnValue(false);

    const result = await run('/admin/stores');

    expect(result).toBeFalse();
    expect(toast.info).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/dashboard');
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
