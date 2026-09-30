import { TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { MenuFilterService } from './menu-filter.service';
import { AuthFacade } from '../store/auth/auth.facade';
import { SubscriptionAccessService } from './subscription-access.service';
import { MenuItem } from '../../shared/components/sidebar/sidebar.component';
import {
  MODULE_ROUTES,
  STORE_MODULE_CATALOG,
  resolveStoreModule,
} from '../../shared/constants/store-module-catalog.constant';
import { APP_MODULES } from '../../shared/constants/app-modules.constant';
import { getModulesHiddenByIndustries } from '../../shared/constants/industry-modules.constant';
import { BehaviorSubject, firstValueFrom, of, take } from 'rxjs';

/**
 * Collects every key in the STORE_ADMIN tree, parents and children alike.
 */
function allStoreAdminKeys(): string[] {
  const keys: string[] = [];
  const walk = (modules: typeof APP_MODULES.STORE_ADMIN) => {
    for (const module of modules) {
      keys.push(module.key);
      if (module.children?.length) walk(module.children);
    }
  };
  walk(APP_MODULES.STORE_ADMIN);
  return keys;
}

describe('store module catalog', () => {
  it('no deja rutas huérfanas: toda key de MODULE_ROUTES existe en APP_MODULES.STORE_ADMIN', () => {
    const known = new Set(allStoreAdminKeys());
    const orphans = Object.keys(MODULE_ROUTES).filter((key) => !known.has(key));
    expect(orphans)
      .withContext(
        `MODULE_ROUTES declara rutas para keys que ya no existen en APP_MODULES: ${orphans.join(', ')}`,
      )
      .toEqual([]);
  });

  it('no deja módulos inalcanzables: toda key de APP_MODULES.STORE_ADMIN tiene ruta', () => {
    const missing = allStoreAdminKeys().filter((key) => !MODULE_ROUTES[key]);
    expect(missing)
      .withContext(
        `Estos módulos existen en el editor de panel pero Vexi no sabría a dónde llevar al usuario: ${missing.join(', ')}`,
      )
      .toEqual([]);
  });

  it('toda entrada del catálogo trae label, ruta absoluta y descripción', () => {
    for (const entry of STORE_MODULE_CATALOG) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.route.startsWith('/admin/'))
        .withContext(`"${entry.key}" apunta a "${entry.route}"`)
        .toBe(true);
    }
  });

  it('resuelve texto libre a un módulo, y devuelve null cuando es ambiguo', () => {
    expect(resolveStoreModule('inventory_pop')?.key).toBe('inventory_pop');
    expect(resolveStoreModule('Punto de Compra')?.key).toBe('inventory_pop');
    // Sin tildes ni mayúsculas.
    expect(resolveStoreModule('punto de venta')?.key).toBe('pos');
    // "Inventario" es subcadena de "Analíticas de Inventario", pero el label
    // exacto gana antes de llegar a la etapa de subcadenas: el usuario que
    // dice "inventario" quiere el módulo, no su pestaña de analíticas.
    expect(resolveStoreModule('inventario')?.key).toBe('inventory');
    // Sin label exacto y con varias coincidencias parciales, prefiere no
    // adivinar: "fiscal" toca siete módulos distintos.
    expect(resolveStoreModule('fiscal')).toBeNull();
    expect(resolveStoreModule('   ')).toBeNull();
  });
});

describe('MenuFilterService.diagnose', () => {
  let service: MenuFilterService;
  let authFacade: {
    fiscalScope: ReturnType<typeof signal<string>>;
    operatingScope: ReturnType<typeof signal<string>>;
    activeFiscalAreas: ReturnType<typeof signal<string[]>>;
    storeSettings: ReturnType<typeof signal<any>>;
    userIndustries: ReturnType<typeof signal<string[]>>;
    userStoreType: ReturnType<typeof signal<string | null>>;
    isModuleVisible: jasmine.Spy;
    hasPermission: jasmine.Spy;
    hasAnyRole: jasmine.Spy;
    hasAnyPermission: jasmine.Spy;
    isOwner: jasmine.Spy;
    isAdmin: jasmine.Spy;
    getVisibleModules$: jasmine.Spy;
    userStoreType$: unknown;
    userIndustries$: unknown;
    storeSettings$: unknown;
    userOrganization$: unknown;
    activeFiscalAreas$: unknown;
  };

  const item = (over: Partial<MenuItem> = {}): MenuItem =>
    ({ label: 'Inventario', icon: '', ...over }) as MenuItem;

  beforeEach(() => {
    authFacade = {
      fiscalScope: signal('STORE'),
      operatingScope: signal('STORE'),
      activeFiscalAreas: signal<string[]>([]),
      storeSettings: signal<any>(null),
      userIndustries: signal<string[]>(['retail']),
      userStoreType: signal<string | null>('physical'),
      isModuleVisible: jasmine.createSpy('isModuleVisible').and.returnValue(true),
      hasPermission: jasmine.createSpy('hasPermission').and.returnValue(true),
      hasAnyRole: jasmine.createSpy('hasAnyRole').and.returnValue(true),
      hasAnyPermission: jasmine.createSpy('hasAnyPermission').and.returnValue(true),
      isOwner: jasmine.createSpy('isOwner').and.returnValue(true),
      isAdmin: jasmine.createSpy('isAdmin').and.returnValue(true),
      getVisibleModules$: jasmine.createSpy('getVisibleModules$'),
      userStoreType$: null,
      userIndustries$: null,
      storeSettings$: null,
      userOrganization$: null,
      activeFiscalAreas$: null,
    };

    TestBed.configureTestingModule({
      providers: [
        MenuFilterService,
        { provide: AuthFacade, useValue: authFacade },
        {
          provide: SubscriptionAccessService,
          useValue: { canUseAI: () => () => true },
        },
      ],
    });
    service = TestBed.inject(MenuFilterService);
  });

  it('reporta visible cuando ninguna capa bloquea', () => {
    const result = service.diagnose(item());
    expect(result.visible).toBe(true);
    expect(result.blockedBy).toBeNull();
  });

  it('culpa al panel del usuario cuando su mapa oculta el módulo', () => {
    // El owner ignora la capa user_panel_ui (C.1(2)): forzamos un usuario
    // SIN rol de owner para que el bloqueo siga siendo user_panel_ui.
    authFacade.isOwner.and.returnValue(false);
    authFacade.isModuleVisible.and.returnValue(false);
    const result = service.diagnose(item());
    expect(result.visible).toBe(false);
    expect(result.blockedBy).toBe('user_panel_ui');
    expect(result.fixPath).toBe('/admin/settings/general');
  });

  it('el apagado a nivel tienda gana sobre el del usuario', () => {
    authFacade.storeSettings.set({
      panel_ui: { STORE_ADMIN: { inventory: false } },
    });
    authFacade.isModuleVisible.and.returnValue(false);
    expect(service.diagnose(item()).blockedBy).toBe('store_panel_ui');
  });

  it('detecta el bloqueo por store_type', () => {
    authFacade.userStoreType.set('online');
    const result = service.diagnose(item({ label: 'Punto de Venta' }));
    expect(result.visible).toBe(false);
    expect(result.blockedBy).toBe('store_type');
  });

  it('detecta el bloqueo por área fiscal no activada', () => {
    const result = service.diagnose(
      item({ label: 'Facturación', requiresFiscalArea: 'invoicing' } as any),
    );
    expect(result.visible).toBe(false);
    expect(result.blockedBy).toBe('fiscal_area');
    expect(result.fixPath).toBe('/admin/fiscal/activation');
  });

  it('explica la entrada de Usuarios sin permiso en lugar de solo ocultarla', () => {
    authFacade.hasPermission.and.returnValue(false);
    authFacade.isOwner.and.returnValue(false);
    authFacade.isAdmin.and.returnValue(false);
    const result = service.diagnose(
      item({ label: 'Usuarios', route: '/admin/settings/users' }),
    );
    expect(result.visible).toBe(false);
    expect(result.blockedBy).toBe('permission');
    expect(result.fixPath).toBeNull();
  });

  it('isMenuItemVisible es la proyección booleana de diagnose', () => {
    // Mismo motivo: con `isOwner=true` el filtro ignora user_panel_ui, así
    // que para verificar la proyección booleana del bloqueo necesitamos un
    // actor sin owner.
    authFacade.isOwner.and.returnValue(false);
    authFacade.isModuleVisible.and.returnValue(false);
    const menuItem = item();
    expect(service.isMenuItemVisible(menuItem)).toBe(
      service.diagnose(menuItem).visible,
    );
    expect(service.isMenuItemVisible(menuItem)).toBe(false);
  });

  it('diagnoseModule resuelve por key usando el catálogo', () => {
    // Forzamos no-owner por la misma razón (C.1(2)).
    authFacade.isOwner.and.returnValue(false);
    authFacade.isModuleVisible.and.returnValue(false);
    const result = service.diagnoseModule('inventory_pop');
    expect(result.visible).toBe(false);
    expect(result.blockedBy).toBe('user_panel_ui');
  });
});

describe('gating de contratos por industria (A.2, ADR-02)', () => {
  it('toda industria sin construction oculta orders_contracts', () => {
    for (const industries of [
      ['retail'],
      ['restaurant'],
      ['manufacturing'],
      ['service'],
      ['gym'],
    ]) {
      expect(getModulesHiddenByIndustries(industries))
        .withContext(`industrias [${industries.join(',')}]`)
        .toContain('orders_contracts');
    }
  });

  it('construction (sola o multi-industria) conserva orders_contracts', () => {
    expect(getModulesHiddenByIndustries(['construction'])).not.toContain(
      'orders_contracts',
    );
    expect(
      getModulesHiddenByIndustries(['retail', 'construction']),
    ).not.toContain('orders_contracts');
  });

  it('sin industrias no oculta nada (fallback defensivo existente)', () => {
    expect(getModulesHiddenByIndustries([])).toEqual([]);
    expect(getModulesHiddenByIndustries(null)).toEqual([]);
  });
});

describe('MenuFilterService.firstActiveModuleRoute (QUI-860)', () => {
  let service: MenuFilterService;
  let authFacade: {
    fiscalScope: ReturnType<typeof signal<string>>;
    operatingScope: ReturnType<typeof signal<string>>;
    activeFiscalAreas: ReturnType<typeof signal<string[]>>;
    storeSettings: ReturnType<typeof signal<any>>;
    userIndustries: ReturnType<typeof signal<string[]>>;
    userStoreType: ReturnType<typeof signal<string | null>>;
    isModuleVisible: jasmine.Spy;
    hasPermission: jasmine.Spy;
    hasAnyRole: jasmine.Spy;
    hasAnyPermission: jasmine.Spy;
    isOwner: jasmine.Spy;
    isAdmin: jasmine.Spy;
    getVisibleModules$: jasmine.Spy;
    userStoreType$: unknown;
    userIndustries$: unknown;
    storeSettings$: unknown;
    userOrganization$: unknown;
    activeFiscalAreas$: unknown;
  };

  beforeEach(() => {
    authFacade = {
      fiscalScope: signal('STORE'),
      operatingScope: signal('STORE'),
      activeFiscalAreas: signal<string[]>([]),
      storeSettings: signal<any>(null),
      userIndustries: signal<string[]>(['retail']),
      userStoreType: signal<string | null>('physical'),
      isModuleVisible: jasmine.createSpy('isModuleVisible').and.returnValue(false),
      hasPermission: jasmine.createSpy('hasPermission').and.returnValue(true),
      hasAnyRole: jasmine.createSpy('hasAnyRole').and.returnValue(false),
      hasAnyPermission: jasmine.createSpy('hasAnyPermission').and.returnValue(false),
      isOwner: jasmine.createSpy('isOwner').and.returnValue(false),
      isAdmin: jasmine.createSpy('isAdmin').and.returnValue(false),
      getVisibleModules$: jasmine.createSpy('getVisibleModules$'),
      userStoreType$: null,
      userIndustries$: null,
      storeSettings$: null,
      userOrganization$: null,
      activeFiscalAreas$: null,
    };

    TestBed.configureTestingModule({
      providers: [
        MenuFilterService,
        { provide: AuthFacade, useValue: authFacade },
        {
          provide: SubscriptionAccessService,
          useValue: { canUseAI: () => () => true },
        },
      ],
    });
    service = TestBed.inject(MenuFilterService);
  });

  it('un usuario operativo cajero con pos activo es enrutado a /admin/pos', () => {
    authFacade.isModuleVisible.and.callFake((key: string) => key === 'pos');
    const route = service.firstActiveModuleRoute([]);
    expect(route).toBe('/admin/pos');
  });

  it('un usuario operativo con dashboard: true en panel_ui pero sin permisos omite el dashboard y es enrutado a /admin/pos', () => {
    // Simular que el usuario tiene 'dashboard' y 'pos' en panel_ui, pero sin permisos para dashboard
    authFacade.isModuleVisible.and.callFake(
      (key: string) => key === 'dashboard' || key === 'pos',
    );
    const route = service.firstActiveModuleRoute([]);
    expect(route).toBe('/admin/pos');
  });

  it('diagnose para /admin/dashboard devuelve visible: false con blockedBy: permission si no tiene acceso', () => {
    // panel_ui lo muestra: el bloqueo debe venir del permiso, no de panel_ui.
    authFacade.isModuleVisible.and.returnValue(true);
    authFacade.isOwner.and.returnValue(false);
    authFacade.isAdmin.and.returnValue(false);
    authFacade.hasAnyRole.and.returnValue(false);
    authFacade.hasAnyPermission.and.returnValue(false);
    const diagnosis = service.diagnose({
      label: 'Panel Principal',
      route: '/admin/dashboard',
      icon: '',
    } as any);
    expect(diagnosis.visible).toBeFalse();
    expect(diagnosis.blockedBy).toBe('permission');
  });

  it('un usuario operativo con solo pedidos es enrutado a la primera ruta de pedidos visible', () => {
    authFacade.isModuleVisible.and.callFake(
      (key: string) => key === 'orders' || key === 'orders_sales',
    );
    const route = service.firstActiveModuleRoute([]);
    expect(route).toBe('/admin/orders/sales');
  });

  it('un usuario sin ningún módulo visible es llevado a /admin/no-access', () => {
    authFacade.isModuleVisible.and.returnValue(false);
    const route = service.firstActiveModuleRoute([]);
    expect(route).toBe('/admin/no-access');
  });

  it('un propietario (owner) siempre tiene acceso al panel y no cae a /admin/no-access', () => {
    authFacade.isOwner.and.returnValue(true);
    authFacade.isModuleVisible.and.returnValue(false);
    const route = service.firstActiveModuleRoute([]);
    expect(route).not.toBe('/admin/no-access');
  });
});

describe('MenuFilterService fiscal read fallback for received documents', () => {
  let service: MenuFilterService;
  let visibleModules$: BehaviorSubject<string[]>;
  let panelUi$: BehaviorSubject<Record<string, boolean>>;
  let permissions$: BehaviorSubject<string[]>;
  let settings$: BehaviorSubject<Record<string, any>>;
  let activeAreas$: BehaviorSubject<string[]>;
  let organization$: BehaviorSubject<Record<string, string>>;
  let settingsState: WritableSignal<Record<string, any>>;
  let panelUiState: WritableSignal<Record<string, boolean>>;

  const buildTree = (scope: 'STORE' | 'ORGANIZATION' = 'STORE'): MenuItem[] => [{
    label: 'Fiscal', icon: 'landmark', children: [
      { label: 'Operación fiscal', icon: 'clipboard-list', route: '/admin/fiscal', requiredFiscalScope: scope },
      {
        label: 'Facturación', icon: 'file-text', route: '/admin/invoicing',
        requiredFiscalScope: scope, requiresFiscalArea: 'invoicing',
        fiscalReadFallback: {
          permission: scope === 'STORE' ? 'invoicing:received:read' : 'organization:invoicing:received:read',
          route: '/admin/invoicing/received-documents',
        },
      },
      { label: 'Contabilidad', icon: 'book-open', route: '/admin/accounting', requiredFiscalScope: scope, requiresFiscalArea: 'accounting' },
    ],
  }];

  beforeEach(() => {
    visibleModules$ = new BehaviorSubject<string[]>(['fiscal_operations']); // inactive selector removed invoicing but activation remains.
    panelUi$ = new BehaviorSubject<Record<string, boolean>>({ invoicing: true, accounting: true, fiscal_operations: true });
    permissions$ = new BehaviorSubject<string[]>(['invoicing:received:read']);
    settings$ = new BehaviorSubject<Record<string, any>>({});
    activeAreas$ = new BehaviorSubject<string[]>([]);
    organization$ = new BehaviorSubject<Record<string, string>>({ operating_scope: 'STORE', fiscal_scope: 'STORE' });
    settingsState = signal<Record<string, any>>({});
    panelUiState = signal<Record<string, boolean>>({ invoicing: true, accounting: true, fiscal_operations: true });
    const authFacade = {
      getVisibleModules$: () => visibleModules$.asObservable(),
      userStoreType$: of('physical'), userIndustries$: of(['retail']), storeSettings$: settings$.asObservable(),
      userOrganization$: organization$.asObservable(), activeFiscalAreas$: activeAreas$.asObservable(),
      currentAppPanelUi$: panelUi$.asObservable(), userPermissions$: permissions$.asObservable(),
      fiscalScope: signal('STORE'), operatingScope: signal('STORE'), activeFiscalAreas: signal<string[]>([]),
      storeSettings: settingsState, userIndustries: signal(['retail']), userStoreType: signal<string | null>('physical'),
      currentAppPanelUi: panelUiState,
      storeHasPqrs: signal(false),
      hasPermission: (permission: string) => permissions$.value.includes(permission), hasAnyRole: () => true, hasAnyPermission: () => true,
      isOwner: () => true, isAdmin: () => true,
    };
    TestBed.configureTestingModule({ providers: [
      MenuFilterService, { provide: AuthFacade, useValue: authFacade },
      { provide: SubscriptionAccessService, useValue: { canUseAI: () => () => true } },
    ] });
    service = TestBed.inject(MenuFilterService);
  });

  const filteredOnce = async (scope: 'STORE' | 'ORGANIZATION' = 'STORE') => {
    return firstValueFrom(service.filterMenuItems(buildTree(scope)).pipe(take(1)));
  };

  it('shows only a received-documents route when fiscal area is inactive and the exact reader permission is present', async () => {
    const result = await filteredOnce();
    expect(result[0]?.children?.map((child) => child.route)).toEqual(['/admin/fiscal', '/admin/invoicing/received-documents']);
    expect(service.diagnose(buildTree()[0].children![1]).visible).toBe(true);
    expect(service.isMenuItemVisible(buildTree()[0].children![1])).toBe(true);
    expect(result[0].children?.[1]).toMatchObject({ label: 'Facturación', _fiscalReadFallbackActive: true, alwaysVisible: false });
    expect(result[0].children?.[1]?.requiresFiscalArea).toBeUndefined();
    expect(result[0].children?.[1]?.requiredFiscalScope).toBeUndefined();
  });

  it('hides the fallback when permission is absent, even if panel_ui is enabled', async () => {
    permissions$.next([]);
    const result = await filteredOnce();
    expect(result[0]?.children?.map((child) => child.route)).toEqual(['/admin/fiscal']);
    expect(service.diagnose(buildTree()[0].children![1]).blockedBy).toBe('permission');
  });

  it('requires raw per-user panel_ui true and preserves the store-wide ceiling', async () => {
    panelUi$.next({ invoicing: false, accounting: true, fiscal_operations: true });
    panelUiState.set({ invoicing: false, accounting: true, fiscal_operations: true });
    expect((await filteredOnce())[0]?.children?.map((child) => child.route)).toEqual(['/admin/fiscal']);
    expect(service.diagnose(buildTree()[0].children![1]).blockedBy).toBe('user_panel_ui');

    panelUi$.next({ invoicing: true, accounting: true, fiscal_operations: true });
    panelUiState.set({ invoicing: true, accounting: true, fiscal_operations: true });
    settingsState.set({ panel_ui: { STORE_ADMIN: { invoicing: false } } });
    settings$.next({ panel_ui: { STORE_ADMIN: { invoicing: false } } });
    expect((await filteredOnce())[0]?.children?.map((child) => child.route)).toEqual(['/admin/fiscal']);
    expect(service.diagnose(buildTree()[0].children![1]).blockedBy).toBe('store_panel_ui');
  });

  it('leaves the full route unchanged when both fiscal gates pass and uses the inbox route for the wrong scope', async () => {
    visibleModules$.next(['invoicing']);
    activeAreas$.next(['invoicing']);
    expect((await filteredOnce())[0]?.children?.map((child) => child.route)).toContain('/admin/invoicing');

    activeAreas$.next([]);
    organization$.next({ operating_scope: 'ORGANIZATION', fiscal_scope: 'ORGANIZATION' });
    expect((await filteredOnce('STORE'))[0]?.children?.map((child) => child.route)).toEqual(['/admin/invoicing/received-documents']);
    visibleModules$.next(['fiscal_operations']);
    permissions$.next(['organization:invoicing:received:read']);
    expect((await filteredOnce('ORGANIZATION'))[0]?.children?.map((child) => child.route)).toEqual(['/admin/fiscal', '/admin/invoicing/received-documents']);
  });

  it('keeps a fiscal group that has only its read-only received-document child', async () => {
    const tree: MenuItem[] = [{ label: 'Fiscal', icon: 'landmark', children: [buildTree()[0].children![1]] }];
    const result = await firstValueFrom(service.filterMenuItems(tree).pipe(take(1)));
    expect(result).toHaveLength(1);
    expect(result[0].children?.map((child) => child.route)).toEqual(['/admin/invoicing/received-documents']);
  });

  it('reacts when read permission is revoked and never reveals another inactive fiscal module', async () => {
    const observed: string[][] = [];
    const subscription = service.filterMenuItems(buildTree()).subscribe((tree) => observed.push(tree[0]?.children?.map((child) => child.route!) ?? []));
    await firstValueFrom(service.filterMenuItems(buildTree()).pipe(take(1)));
    permissions$.next([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(observed[observed.length - 1]).toEqual(['/admin/fiscal']);
    expect(observed.some((routes) => routes.includes('/admin/accounting'))).toBe(false);
    subscription.unsubscribe();
  });
});
