import { TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import {
  MenuFilterService,
  DEFAULT_ON_PANEL_KEYS,
  ADMINISTRATION_PERMISSION_ROUTES,
} from './menu-filter.service';
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
import { AccessGateService } from './access-gate.service';
import { STORE_ADMIN_MENU_ITEMS } from '../../private/layouts/store-admin/store-admin-menu-items';
import { MODULE_INDUSTRIES, isIndustryAlwaysEnforced } from '../../shared/constants/module-industries';

/** Access gate stub (apps-f4): audit mode, industries from the session. */
function accessGateStub() {
  return {
    mode: signal<'audit' | 'enforce'>('audit'),
    industries: signal<string[] | null>(null),
    orgPanelUi: signal<Record<string, boolean> | null>(null),
    report: jasmine.createSpy('report'),
    currentApp: () => 'STORE_ADMIN' as const,
    planMode: signal<'audit' | 'enforce'>('audit'),
    planBlocked: signal<readonly string[]>([]),
    planOffers: signal<Record<string, any[]>>({}),
    currentPlan: signal<any>(null),
  };
}

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
    currentAppPanelUi: ReturnType<typeof signal<Record<string, boolean> | null>>;
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
      currentAppPanelUi: signal<Record<string, boolean> | null>(null),
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
        { provide: AccessGateService, useValue: accessGateStub() },
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

describe('gating de hotelería por industria (H0.1)', () => {
  const HOSPITALITY_KEYS = [
    'hospitality',
    'hospitality_rooms',
    'hospitality_reservations',
    'hospitality_rates',
  ];

  it('hospitality sola ve Hotelería y no la agenda de citas', () => {
    const hidden = getModulesHiddenByIndustries(['hospitality']);
    for (const key of HOSPITALITY_KEYS) {
      expect(hidden).withContext(key).not.toContain(key);
    }
    expect(hidden).toContain('orders_reservations');
    expect(hidden).toContain('restaurant_ops');
  });

  it('hospitality + restaurant ve Hotelería y Mesas', () => {
    const hidden = getModulesHiddenByIndustries(['hospitality', 'restaurant']);
    for (const key of [...HOSPITALITY_KEYS, 'restaurant_ops', 'restaurant_ops_tables']) {
      expect(hidden).withContext(key).not.toContain(key);
    }
  });

  it('toda industria sin hospitality oculta Hotelería', () => {
    for (const industries of [
      ['retail'],
      ['restaurant'],
      ['manufacturing'],
      ['service'],
      ['gym'],
      ['construction'],
    ]) {
      const hidden = getModulesHiddenByIndustries(industries);
      for (const key of HOSPITALITY_KEYS) {
        expect(hidden)
          .withContext(`industrias [${industries.join(',')}] → ${key}`)
          .toContain(key);
      }
    }
  });

  it('las keys de hotelería existen en APP_MODULES y MODULE_ROUTES', () => {
    const keys = allStoreAdminKeys();
    for (const key of HOSPITALITY_KEYS) {
      expect(keys).withContext(key).toContain(key);
      expect(MODULE_ROUTES[key]).withContext(key).toMatch(/^\/admin\/hospitality\//);
    }
  });
});

describe('gating de manufactura por industria', () => {
  const MANUFACTURING_KEYS = [
    'manufacturing',
    'manufacturing_formulas',
    'manufacturing_orders',
    'manufacturing_settings',
  ];

  it('manufacturing sola ve Manufactura y sigue ocultando restaurant_ops', () => {
    const hidden = getModulesHiddenByIndustries(['manufacturing']);
    for (const key of MANUFACTURING_KEYS) {
      expect(hidden).withContext(key).not.toContain(key);
    }
    expect(hidden).toContain('restaurant_ops');
  });

  it('toda industria sin manufacturing oculta Manufactura', () => {
    for (const industries of [
      ['retail'],
      ['restaurant'],
      ['service'],
      ['gym'],
      ['construction'],
      ['hospitality'],
    ]) {
      const hidden = getModulesHiddenByIndustries(industries);
      for (const key of MANUFACTURING_KEYS) {
        expect(hidden)
          .withContext(`industrias [${industries.join(',')}] → ${key}`)
          .toContain(key);
      }
    }
  });

  it('las keys de manufactura existen en APP_MODULES y MODULE_ROUTES', () => {
    const keys = allStoreAdminKeys();
    for (const key of MANUFACTURING_KEYS) {
      expect(keys).withContext(key).toContain(key);
      expect(MODULE_ROUTES[key]).withContext(key).toMatch(/^\/admin\/manufacturing\//);
    }
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
    currentAppPanelUi: ReturnType<typeof signal<Record<string, boolean> | null>>;
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
      currentAppPanelUi: signal<Record<string, boolean> | null>(null),
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
        { provide: AccessGateService, useValue: accessGateStub() },
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
        { provide: AccessGateService, useValue: accessGateStub() },
      { provide: SubscriptionAccessService, useValue: { canUseAI: () => () => true } },
    ] });
    service = TestBed.inject(MenuFilterService);
  });

  const filteredOnce = async (scope: 'STORE' | 'ORGANIZATION' = 'STORE') => {
    return firstValueFrom(service.filterMenuItems(buildTree(scope)).pipe(take(1)));
  };

  it('shows only a received-documents route when fiscal area is inactive and the exact reader permission is present', async () => {
    const result = await filteredOnce();
    // Operación fiscal needs an active area (Finanzas stage gate), so only the inbox remains.
    expect(result[0]?.children?.map((child) => child.route)).toEqual(['/admin/invoicing/received-documents']);
    expect(service.diagnose(buildTree()[0].children![1]).visible).toBe(true);
    expect(service.isMenuItemVisible(buildTree()[0].children![1])).toBe(true);
    expect(result[0].children?.[0]).toEqual(jasmine.objectContaining({ label: 'Facturación', _fiscalReadFallbackActive: true, accessAuditOnly: false }) as any);
    expect(result[0].children?.[0]?.requiresFiscalArea).toBeUndefined();
    expect(result[0].children?.[0]?.requiredFiscalScope).toBeUndefined();
  });

  it('hides the fallback when permission is absent, even if panel_ui is enabled', async () => {
    permissions$.next([]);
    const result = await filteredOnce();
    expect(result[0]?.children?.map((child) => child.route)).toBeUndefined();
    expect(service.diagnose(buildTree()[0].children![1]).blockedBy).toBe('permission');
  });

  it('requires raw per-user panel_ui true and preserves the store-wide ceiling', async () => {
    panelUi$.next({ invoicing: false, accounting: true, fiscal_operations: true });
    panelUiState.set({ invoicing: false, accounting: true, fiscal_operations: true });
    expect((await filteredOnce())[0]?.children?.map((child) => child.route)).toBeUndefined();
    expect(service.diagnose(buildTree()[0].children![1]).blockedBy).toBe('user_panel_ui');

    panelUi$.next({ invoicing: true, accounting: true, fiscal_operations: true });
    panelUiState.set({ invoicing: true, accounting: true, fiscal_operations: true });
    settingsState.set({ panel_ui: { STORE_ADMIN: { invoicing: false } } });
    settings$.next({ panel_ui: { STORE_ADMIN: { invoicing: false } } });
    expect((await filteredOnce())[0]?.children?.map((child) => child.route)).toBeUndefined();
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
    expect(result.length).toBe(1);
    expect(result[0].children?.map((child) => child.route)).toEqual(['/admin/invoicing/received-documents']);
  });

  it('reacts when read permission is revoked and never reveals another inactive fiscal module', async () => {
    const observed: string[][] = [];
    const subscription = service.filterMenuItems(buildTree()).subscribe((tree) => observed.push(tree[0]?.children?.map((child) => child.route!) ?? []));
    await firstValueFrom(service.filterMenuItems(buildTree()).pipe(take(1)));
    permissions$.next([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(observed[observed.length - 1]).toEqual([]);
    expect(observed.some((routes) => routes.includes('/admin/accounting'))).toBe(false);
    subscription.unsubscribe();
  });

  it('hiddenWhenFiscalAreaActive: shows the activation entry while the area is WIP and hides it once ACTIVE', async () => {
    const activation: MenuItem = {
      label: 'Activar facturación electrónica', icon: 'zap', route: '/admin/invoicing/activation',
      accessAuditOnly: true, requiredFiscalScope: 'STORE', hiddenWhenFiscalAreaActive: 'invoicing',
    };
    const tree: MenuItem[] = [{ label: 'Fiscal', icon: 'landmark', children: [activation] }];
    const routes = async () => (await firstValueFrom(service.filterMenuItems(tree).pipe(take(1))))[0]?.children?.map((c) => c.route);
    // `diagnose` lee la señal y el filtro el observable: ambos deben moverse juntos.
    const facade = TestBed.inject(AuthFacade) as unknown as { activeFiscalAreas: { set(v: string[]): void } };
    const setAreas = (areas: string[]) => { activeAreas$.next(areas); facade.activeFiscalAreas.set(areas); };

    setAreas([]);
    expect(await routes()).toEqual(['/admin/invoicing/activation']);
    expect(service.diagnose(activation).visible).toBe(true);

    setAreas(['invoicing']);
    expect(await routes()).toBeUndefined();
    expect(service.diagnose(activation).visible).toBe(false);

    setAreas(['payroll']);
    expect(await routes()).toEqual(['/admin/invoicing/activation']);
  });

  it('H0.5: an accessAuditOnly group with every child hidden is not rendered', async () => {
    const tree: MenuItem[] = [{
      label: 'Configuración', icon: 'settings', accessAuditOnly: true,
      children: [{ label: 'General', icon: 'circle', route: '/admin/settings/general' }],
    }];
    const labels = async () => (await firstValueFrom(service.filterMenuItems(tree).pipe(take(1)))).map((i) => i.label);

    // Receptionist preset: settings_general is off → no empty "Configuración".
    expect(await labels()).toEqual([]);

    // Control: with the child visible the group still shows.
    visibleModules$.next(['fiscal_operations', 'settings', 'settings_general']);
    expect(await labels()).toEqual(['Configuración']);
  });
});

/**
 * apps-module T0/T7/T9. Bandeja, Pipeline, Tareas y Segmentos dejan
 * `alwaysVisible` y pasan a tener key opt-out; la entrada «Todas las apps»
 * existe solo con `store_settings.apps.enabled` y el permiso de lectura.
 */
describe('MenuFilterService — apps-module (keys opt-out y catálogo Apps)', () => {
  let service: MenuFilterService;
  let visibleModules$: BehaviorSubject<string[]>;
  let panelUi$: BehaviorSubject<Record<string, boolean>>;
  let settings$: BehaviorSubject<Record<string, any>>;
  let settingsState: WritableSignal<Record<string, any>>;
  let panelUiState: WritableSignal<Record<string, boolean>>;
  let permissions: string[];
  let owner: boolean;

  const clientes = (): MenuItem[] => [{
    label: 'Clientes', icon: 'users', children: [
      { label: 'Todos los Clientes', icon: 'circle', route: '/admin/customers/all' },
      { label: 'Bandeja', icon: 'inbox', route: '/admin/customers/inbox', panelUiKey: 'customers_inbox' },
      { label: 'Pipeline', icon: 'trending-up', route: '/admin/customers/pipeline', panelUiKey: 'customers_pipeline' },
      { label: 'Tareas', icon: 'check-square', route: '/admin/customers/tasks', panelUiKey: 'customers_tasks' },
      { label: 'Segmentos', icon: 'users', route: '/admin/customers/segments', panelUiKey: 'customers_segments' },
    ],
  }];
  const appsGroup = (): MenuItem[] => [{
    label: 'Apps', icon: 'app-window', children: [
      { label: 'Todas las apps', icon: 'layout-grid', route: '/admin/apps', panelUiKey: 'apps' },
      { label: 'Tienda en línea', icon: 'shopping-bag', route: '/admin/ecommerce' },
    ],
  }];
  const routes = async (tree: MenuItem[]) =>
    (await firstValueFrom(service.filterMenuItems(tree).pipe(take(1))))
      .flatMap((i) => (i.children ?? [i]).map((c) => c.route));
  const setSettings = (value: Record<string, any>) => {
    settings$.next(value);
    settingsState.set(value);
  };
  const setUserPanel = (value: Record<string, boolean>) => {
    panelUi$.next(value);
    panelUiState.set(value);
  };

  beforeEach(() => {
    // Usuario cuyo panel_ui guardado es anterior a las keys nuevas.
    visibleModules$ = new BehaviorSubject<string[]>(['customers', 'customers_all', 'ecommerce']);
    panelUi$ = new BehaviorSubject<Record<string, boolean>>({ customers: true, customers_all: true, ecommerce: true });
    settings$ = new BehaviorSubject<Record<string, any>>({ general: { store_type: 'hybrid' } });
    settingsState = signal<Record<string, any>>({ general: { store_type: 'hybrid' } });
    panelUiState = signal<Record<string, boolean>>({ customers: true, customers_all: true, ecommerce: true });
    permissions = [
      'store:crm_inbox:read', 'store:crm_pipeline:read', 'store:crm_tasks:manage', 'store:customers:read',
    ];
    owner = false;
    const authFacade = {
      getVisibleModules$: () => visibleModules$.asObservable(),
      userStoreType$: of('hybrid'), userIndustries$: of(['retail']), storeSettings$: settings$.asObservable(),
      userOrganization$: of({ operating_scope: 'STORE', fiscal_scope: 'STORE' }), activeFiscalAreas$: of([]),
      currentAppPanelUi$: panelUi$.asObservable(), userPermissions$: of([]),
      fiscalScope: signal('STORE'), operatingScope: signal('STORE'), activeFiscalAreas: signal<string[]>([]),
      storeSettings: settingsState, userIndustries: signal(['retail']), userStoreType: signal<string | null>('hybrid'),
      currentAppPanelUi: panelUiState,
      isModuleVisible: (key: string) => panelUiState()[key] === true,
      hasPermission: (permission: string) => permissions.includes(permission),
      hasAnyRole: () => false, hasAnyPermission: () => false,
      isOwner: () => owner, isAdmin: () => false,
    };
    TestBed.configureTestingModule({ providers: [
      MenuFilterService, { provide: AuthFacade, useValue: authFacade },
        { provide: AccessGateService, useValue: accessGateStub() },
      { provide: SubscriptionAccessService, useValue: { canUseAI: () => () => true } },
    ] });
    service = TestBed.inject(MenuFilterService);
  });

  it('las cuatro entradas del CRM tienen key registrada en APP_MODULES y MODULE_ROUTES', () => {
    const known = new Set(allStoreAdminKeys());
    for (const key of ['customers_inbox', 'customers_pipeline', 'customers_tasks', 'customers_segments', 'apps']) {
      expect(known.has(key)).withContext(key).toBe(true);
      expect(MODULE_ROUTES[key]).withContext(key).toBeDefined();
      expect(DEFAULT_ON_PANEL_KEYS).toContain(key);
    }
  });

  it('apps-f2 S1: /admin/apps/ecommerce lo gobierna `ecommerce`; el resto de /admin/apps/:kind, `apps`', () => {
    expect(service.resolveKeysForRoute('/admin/apps/ecommerce')).toEqual(['ecommerce']);
    expect(service.resolveKeysForRoute('/admin/apps/booking')).toEqual(['apps']);
    expect(service.resolveKeysForRoute('/admin/apps/landing')).toEqual(['customers_crm']);
    expect(service.resolveKeysForRoute('/admin/apps')).toEqual(['apps']);
    // /admin/ecommerce intacta, y Vexi/el catálogo siguen con la ruta canónica.
    expect(service.resolveKeysForRoute('/admin/ecommerce')).toEqual(['ecommerce']);
    expect(MODULE_ROUTES['ecommerce']).toBe('/admin/ecommerce');
  });

  it('T0: un panel_ui guardado sin las keys nuevas sigue viendo Bandeja, Pipeline, Tareas y Segmentos', async () => {
    expect(await routes(clientes())).toEqual([
      '/admin/customers/all', '/admin/customers/inbox', '/admin/customers/pipeline',
      '/admin/customers/tasks', '/admin/customers/segments',
    ]);
    expect(service.diagnose(clientes()[0].children![1]).visible).toBe(true);
  });

  it('T0: la compuerta de permisos sigue mandando', async () => {
    permissions = ['store:customers:read'];
    expect(await routes(clientes())).toEqual(['/admin/customers/all', '/admin/customers/segments']);
    expect(service.diagnose(clientes()[0].children![1]).blockedBy).toBe('permission');
  });

  it('diagnose no culpa a un permiso en módulos fuera del CRM (pedidos programados apagados)', () => {
    setUserPanel({ customers: true, orders_scheduled: true });
    const scheduled: MenuItem = {
      label: 'Pedidos programados', icon: 'calendar', route: '/admin/scheduled-orders', panelUiKey: 'orders_scheduled',
    };
    expect(service.diagnose(scheduled).blockedBy).not.toBe('permission');
  });

  it('T0: ahora se pueden ocultar por usuario y por tienda', async () => {
    setUserPanel({ customers: true, customers_all: true, customers_inbox: false });
    expect(await routes(clientes())).not.toContain('/admin/customers/inbox');
    expect(service.diagnose(clientes()[0].children![1]).blockedBy).toBe('user_panel_ui');

    setUserPanel({ customers: true, customers_all: true });
    setSettings({ general: { store_type: 'hybrid' }, panel_ui: { STORE_ADMIN: { customers_pipeline: false } } });
    expect(await routes(clientes())).not.toContain('/admin/customers/pipeline');
    expect(await routes(clientes())).toContain('/admin/customers/inbox');
  });

  it('T7: sin el flag, «Todas las apps» no aparece ni es destino de redirección', async () => {
    owner = true;
    expect(await routes(appsGroup())).toEqual(['/admin/ecommerce']);
    expect(service.diagnose(appsGroup()[0].children![0]).visible).toBe(false);
  });

  it('T7: con el flag, el owner ve el catálogo; sin store:apps:read, no', async () => {
    setSettings({ general: { store_type: 'hybrid' }, apps: { enabled: true } });
    expect(await routes(appsGroup())).toEqual(['/admin/ecommerce']);

    owner = true;
    expect(await routes(appsGroup())).toEqual(['/admin/apps', '/admin/ecommerce']);

    owner = false;
    permissions = ['store:apps:read'];
    expect(await routes(appsGroup())).toEqual(['/admin/apps', '/admin/ecommerce']);
  });

  it('T7: Tienda en línea dentro de Apps conserva el filtro por tipo de tienda', async () => {
    owner = true;
    setSettings({ general: { store_type: 'physical' }, apps: { enabled: true } });
    expect(await routes(appsGroup())).toEqual(['/admin/apps']);
  });

  it('no cambia ninguna etiqueta existente del mapa por texto', () => {
    expect(service.getModuleKey('Tienda en línea')).toBe('ecommerce');
    expect(service.getModuleKey('Landing de captación')).toBe('customers_crm');
    expect(service.getModuleKey('CRM')).toBe('customers_crm');
  });
});

/**
 * apps-f4 S4: `canSeeKey = user ∧ store ∧ industry` and `applyAccessGate`.
 * Audit mode never changes the pre-F4 verdict; it only reports. The flag
 * (`enforce`) blocks on the industry layer, owner included.
 */
describe('MenuFilterService.canSeeKey / applyAccessGate (apps-f4 S4)', () => {
  let service: MenuFilterService;
  let gate: ReturnType<typeof accessGateStub>;
  let owner: boolean;
  let userKeys: string[];
  let storeSettings: WritableSignal<any>;
  let industries: WritableSignal<string[]>;

  beforeEach(() => {
    owner = false;
    userKeys = ['restaurant_ops_recipes', 'pos', 'inventory'];
    storeSettings = signal<any>(null);
    industries = signal<string[]>(['retail']);
    gate = accessGateStub();
    const authFacade = {
      isOwner: () => owner,
      isModuleVisible: (key: string) => userKeys.includes(key),
      currentAppPanelUi: signal<Record<string, boolean> | null>(null),
      storeSettings,
      userIndustries: industries,
      fiscalScope: signal('STORE'),
      operatingScope: signal('STORE'),
      activeFiscalAreas: signal<string[]>([]),
      userStoreType: signal<string | null>('physical'),
    };
    TestBed.configureTestingModule({
      providers: [
        MenuFilterService,
        { provide: AuthFacade, useValue: authFacade },
        { provide: AccessGateService, useValue: gate },
        { provide: SubscriptionAccessService, useValue: { canUseAI: () => () => true } },
      ],
    });
    service = TestBed.inject(MenuFilterService);
  });

  it('capa industria: recetas en una tienda retail queda negada por industria', () => {
    expect(service.canSeeKey('restaurant_ops_recipes')).toEqual(
      jasmine.objectContaining({ allowed: false, layer: 'industry' }),
    );
    industries.set(['retail', 'restaurant']);
    expect(service.canSeeKey('restaurant_ops_recipes').allowed).toBeTrue();
  });

  it('capa usuario: un no-owner sin la key en su panel queda negado por usuario', () => {
    userKeys = [];
    expect(service.canSeeKey('pos').layer).toBe('user');
  });

  it('capa tienda: store_panel_ui en false niega aunque el usuario la tenga', () => {
    storeSettings.set({ panel_ui: { STORE_ADMIN: { pos: false } } });
    expect(service.canSeeKey('pos').layer).toBe('store');
  });

  it('owner: pasa usuario y tienda en la URL, pero ya no salta la industria', () => {
    owner = true;
    userKeys = [];
    storeSettings.set({ panel_ui: { STORE_ADMIN: { pos: false } } });
    expect(service.canSeeKey('pos', 'url').allowed).toBeTrue();
    expect(service.canSeeKey('restaurant_ops_recipes', 'url').layer).toBe('industry');
  });

  it('usa las industrias del backend cuando ya cargaron', () => {
    gate.industries.set(['restaurant']);
    expect(service.canSeeKey('restaurant_ops_recipes').allowed).toBeTrue();
  });

  it('auditoría: deja pasar y registra would_block con la key y la capa', () => {
    const allowed = service.applyAccessGate(
      ['restaurant_ops_recipes'], true, 'url', '/admin/restaurant-ops/recipes',
    );
    expect(allowed).toBeTrue();
    expect(gate.report).toHaveBeenCalledOnceWith({
      key: 'restaurant_ops_recipes',
      decision: 'would_block',
      layer: 'industry',
      surface: 'url',
      route: '/admin/restaurant-ops/recipes',
    });
  });

  it('auditoría en sidebar registra would_hide; una capa no-industria nunca bloquea', () => {
    gate.mode.set('enforce');
    userKeys = [];
    expect(service.applyAccessGate(['pos'], true, 'sidebar')).toBeTrue();
    expect(gate.report).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({ key: 'pos', decision: 'would_hide', layer: 'user' }),
    );
  });

  it('flag encendido: bloquea por industria (owner incluido) y registra blocked', () => {
    gate.mode.set('enforce');
    owner = true;
    expect(service.applyAccessGate(['restaurant_ops_recipes'], true, 'url')).toBeFalse();
    expect(gate.report).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({ decision: 'blocked', layer: 'industry' }),
    );
  });

  it('nunca amplía: un veredicto pre-F4 negado sigue negado y no registra', () => {
    expect(service.applyAccessGate(['pos'], false, 'url')).toBeFalse();
    expect(gate.report).not.toHaveBeenCalled();
  });

  it('aviso de industria nombra la industria real', () => {
    expect(service.industryBlockMessage(['restaurant_ops_recipes'])).toBe(
      'No disponible en tu industria. Este módulo aplica solo a tiendas de restaurante.',
    );
    expect(service.industryBlockMessage(['orders_service_stations'])).toBe(
      'No disponible en tu industria. Este módulo aplica solo a tiendas de servicios u hotelería.',
    );
  });

  it('B1: un ítem accessAuditOnly sigue resolviéndose por su label en los caminos pre-F4', () => {
    // Pre-F4 «Contabilidad» de Reportes (sin key) mapeaba a `accounting` y,
    // por ir antes que Fiscal, era el ítem que el guard diagnosticaba.
    const tree: MenuItem[] = [
      {
        label: 'Reportes', icon: '',
        children: [{
          label: 'Contabilidad', icon: '', route: '/admin/reports/accounting',
          panelUiKey: 'reports_accounting', accessAuditOnly: true,
        }],
      },
      {
        label: 'Fiscal', icon: '',
        children: [{
          label: 'Contabilidad', icon: '', route: '/admin/accounting',
          panelUiKey: 'accounting', requiredFiscalScope: 'STORE',
        }],
      },
    ];
    const found = service.findItemByModuleKey(tree, 'accounting');
    expect(found?.route).toBe('/admin/reports/accounting');
    userKeys = [];
    expect(service.diagnose(found!).blockedBy).toBe('user_panel_ui');
  });

  it('applyRouteGate resuelve la key de una ruta nueva solo-auditoría', () => {
    expect(service.resolveGateKeysForRoute('/admin/restaurant-ops/recipes')).toContain(
      'restaurant_ops_recipes',
    );
    expect(service.applyRouteGate('/admin/restaurant-ops/recipes', true, 'vexi')).toBeTrue();
    expect(gate.report).toHaveBeenCalledWith(
      jasmine.objectContaining({ decision: 'would_block', surface: 'vexi' }),
    );
  });
});

/**
 * flujos-documental S6: `flows` and `documents` enforce their industry rule
 * whatever the gate mode. The sidebar keeps them visible with a lock; the URL
 * is blocked. Every other key keeps following the audit/enforce mode.
 */
describe('MenuFilterService — industria siempre aplicada (flujos-documental S6)', () => {
  let service: MenuFilterService;
  let gate: ReturnType<typeof accessGateStub>;
  let industries: WritableSignal<string[]>;

  beforeEach(() => {
    industries = signal<string[]>(['retail']);
    gate = accessGateStub();
    const authFacade = {
      isOwner: () => true,
      isModuleVisible: () => true,
      currentAppPanelUi: signal<Record<string, boolean> | null>(null),
      storeSettings: signal<any>(null),
      userIndustries: industries,
      fiscalScope: signal('STORE'),
      operatingScope: signal('STORE'),
      activeFiscalAreas: signal<string[]>([]),
      userStoreType: signal<string | null>('physical'),
    };
    TestBed.configureTestingModule({
      providers: [
        MenuFilterService,
        { provide: AuthFacade, useValue: authFacade },
        { provide: AccessGateService, useValue: gate },
        { provide: SubscriptionAccessService, useValue: { canUseAI: () => () => true } },
      ],
    });
    service = TestBed.inject(MenuFilterService);
  });

  it('sin la industria administration, la URL se bloquea aunque el gate esté en auditoría', () => {
    expect(gate.mode()).toBe('audit');
    for (const key of ['flows', 'documents']) {
      gate.report.calls.reset();
      expect(service.applyAccessGate([key], true, 'url', `/admin/${key}`)).toBeFalse();
      expect(gate.report).toHaveBeenCalledOnceWith(
        jasmine.objectContaining({ key, decision: 'blocked', layer: 'industry', surface: 'url' }),
      );
    }
  });

  it('sin la industria administration, sidebar y Apps conservan el módulo y lo marcan con candado', () => {
    gate.report.calls.reset();
    expect(service.applyAccessGate(['flows'], true, 'sidebar')).toBeTrue();
    // Visible with a lock: logged as would_hide, never as hidden.
    expect(gate.report).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({ key: 'flows', decision: 'would_hide', surface: 'sidebar' }),
    );
    expect(service.applyAccessGate(['documents'], true, 'apps_card')).toBeTrue();
    expect(service.isIndustryLocked(['flows'])).toBeTrue();
    expect(service.isIndustryLocked(['documents'])).toBeTrue();
  });

  it('con la industria administration (sola o combinada) no hay bloqueo ni candado', () => {
    for (const set of [['administration'], ['retail', 'administration']]) {
      industries.set(set);
      expect(service.applyAccessGate(['flows'], true, 'url')).toBeTrue();
      expect(service.isIndustryLocked(['flows', 'documents'])).toBeFalse();
    }
  });

  it('usa las industrias del backend cuando ya cargaron', () => {
    gate.industries.set(['administration']);
    expect(service.isIndustryLocked(['flows'])).toBeFalse();
    gate.industries.set(['restaurant']);
    expect(service.isIndustryLocked(['flows'])).toBeTrue();
  });

  it('las demás keys conservan su comportamiento: auditoría deja pasar y no hay candado', () => {
    expect(service.applyAccessGate(['restaurant_ops_recipes'], true, 'url')).toBeTrue();
    expect(service.isIndustryLocked(['restaurant_ops_recipes'])).toBeFalse();
    expect(service.isIndustryLocked([])).toBeFalse();
  });

  it('las demás keys con el flag encendido siguen ocultándose en el sidebar', () => {
    gate.mode.set('enforce');
    expect(service.applyAccessGate(['restaurant_ops_recipes'], true, 'sidebar')).toBeFalse();
  });

  it('las rutas de Flujos y Documentos resuelven su key', () => {
    expect(service.resolveGateKeysForRoute('/admin/workflows')).toContain('flows');
    expect(service.resolveGateKeysForRoute('/admin/workflows/instances/12')).toContain('flows');
    expect(service.resolveGateKeysForRoute('/admin/documents')).toContain('documents');
  });
});

/**
 * planes-matriz-accesos: 4th layer `plan` in `canSeeKey` and its effect on the
 * four surfaces (sidebar, url, apps_card, vexi). The plan never hides: sidebar
 * and Apps keep the module with a lock; URL and Vexi refuse only with the plan
 * flag on. Audit (default) lets everything through and records would_block.
 */
describe('MenuFilterService — capa plan (planes-matriz-accesos)', () => {
  let service: MenuFilterService;
  let gate: ReturnType<typeof accessGateStub>;
  const EMPRESARIAL = {
    code: 'empresarial-pro-monthly', name: 'Empresarial Pro', price: 89900, currency: 'COP', cycle: 'monthly',
  };
  const EMPRESARIAL_ANNUAL = { ...EMPRESARIAL, code: 'empresarial-pro-annual', price: 899000, cycle: 'annual' };

  beforeEach(() => {
    gate = accessGateStub();
    gate.planBlocked.set(['invoicing', 'flows']);
    gate.planOffers.set({ invoicing: [EMPRESARIAL, EMPRESARIAL_ANNUAL] });
    gate.currentPlan.set({ code: 'vendix-impulsa', name: 'Vendix Impulsa', cycle: 'annual' });
    const authFacade = {
      isOwner: () => true,
      isModuleVisible: () => true,
      currentAppPanelUi: signal<Record<string, boolean> | null>(null),
      storeSettings: signal<any>(null),
      userIndustries: signal<string[]>(['retail']),
      fiscalScope: signal('STORE'),
      operatingScope: signal('STORE'),
      activeFiscalAreas: signal<string[]>([]),
      userStoreType: signal<string | null>('physical'),
    };
    TestBed.configureTestingModule({
      providers: [
        MenuFilterService,
        { provide: AuthFacade, useValue: authFacade },
        { provide: AccessGateService, useValue: gate },
        { provide: SubscriptionAccessService, useValue: { canUseAI: () => () => true } },
      ],
    });
    service = TestBed.inject(MenuFilterService);
  });

  it('canSeeKey niega por la capa plan solo las keys que el plan no incluye', () => {
    expect(service.canSeeKey('invoicing')).toEqual(
      jasmine.objectContaining({ allowed: false, layer: 'plan' }),
    );
    expect(service.canSeeKey('pos').allowed).toBeTrue();
  });

  it('auditoría (por defecto): las 4 superficies dejan pasar y registran would_block en la capa plan', () => {
    for (const surface of ['sidebar', 'url', 'apps_card', 'vexi'] as const) {
      gate.report.calls.reset();
      expect(service.applyAccessGate(['invoicing'], true, surface)).toBeTrue();
      expect(gate.report).toHaveBeenCalledOnceWith(
        jasmine.objectContaining({ key: 'invoicing', layer: 'plan', decision: 'would_block', surface }),
      );
    }
    expect(service.isPlanLocked(['invoicing'])).toBeFalse();
  });

  it('flag del plan encendido: sidebar y Apps siguen mostrando con candado; URL y Vexi bloquean', () => {
    gate.planMode.set('enforce');
    expect(service.applyAccessGate(['invoicing'], true, 'sidebar')).toBeTrue();
    expect(service.applyAccessGate(['invoicing'], true, 'apps_card')).toBeTrue();
    expect(service.applyAccessGate(['invoicing'], true, 'url')).toBeFalse();
    expect(service.applyAccessGate(['invoicing'], true, 'vexi')).toBeFalse();
    expect(gate.report).toHaveBeenCalledWith(
      jasmine.objectContaining({ layer: 'plan', decision: 'blocked', surface: 'url' }),
    );
    expect(service.isPlanLocked(['invoicing'])).toBeTrue();
    expect(service.isPlanLocked(['pos'])).toBeFalse();
  });

  it('el flag de industria no enciende la capa plan', () => {
    gate.mode.set('enforce');
    expect(service.applyAccessGate(['invoicing'], true, 'url')).toBeTrue();
  });

  it('un ítem con alguna key incluida en el plan no queda bloqueado', () => {
    gate.planMode.set('enforce');
    expect(service.applyAccessGate(['invoicing', 'pos'], true, 'url')).toBeTrue();
    expect(service.planLockForKeys(['invoicing', 'pos'])).toBeNull();
  });

  it('el candado lleva familia, plan actual, ofertas y la URL de mejora en el mismo ciclo', () => {
    const lock = service.planLockForKeys(['invoicing'])!;
    expect(lock.family?.name).toBe('Facturación electrónica');
    expect(lock.currentPlan?.name).toBe('Vendix Impulsa');
    expect(lock.recommended?.code).toBe('empresarial-pro-annual');
    expect(lock.upgradeUrl).toBe(
      '/admin/subscription/plans?plan=empresarial-pro-annual&cycle=annual&from=invoicing',
    );
  });

  it('dashboard y suscripción nunca quedan bajo la capa plan', () => {
    gate.planMode.set('enforce');
    expect(service.canSeeKey('dashboard').allowed).toBeTrue();
    expect(service.planLockForKeys(['dashboard'])).toBeNull();
  });
});

/**
 * P5.7: Flujos and Documentos are sidebar parents; every screen is a child
 * with its own panel_ui key (opt-out), permission prefilter and the
 * always-enforced `administration` industry. Runs the real sidebar tree.
 */
describe('MenuFilterService — hijos de Flujos y Documentos (P5.7)', () => {
  let service: MenuFilterService;
  let panelUiState: WritableSignal<Record<string, boolean>>;
  let panelUi$: BehaviorSubject<Record<string, boolean>>;
  let settingsState: WritableSignal<Record<string, any>>;
  let settings$: BehaviorSubject<Record<string, any>>;
  let industries: WritableSignal<string[]>;
  let permissions: string[];
  let owner: boolean;

  const EXPECTED: Record<string, { label: string; route: string; key: string }[]> = {
    Flujos: [
      { label: 'Todos los flujos', route: '/admin/workflows', key: 'flows_list' },
      { label: 'Mis tareas', route: '/admin/workflows/inbox', key: 'flows_inbox' },
      { label: 'Tablero general', route: '/admin/workflows/board', key: 'flows_board' },
      { label: 'Analítica IA', route: '/admin/workflows/insights', key: 'flows_insights' },
      { label: 'Galería de plantillas', route: '/admin/workflows/templates', key: 'flows_templates' },
      { label: 'Registros', route: '/admin/workflows/records', key: 'flows_records' },
      { label: 'Conectores', route: '/admin/workflows/connectors', key: 'flows_connectors' },
      { label: 'Integraciones', route: '/admin/workflows/integrations', key: 'flows_integrations' },
      { label: 'Uso del plan', route: '/admin/workflows/usage', key: 'flows_usage' },
      { label: 'Auditoría', route: '/admin/workflows/audit', key: 'flows_audit' },
      { label: 'Exportación', route: '/admin/workflows/exports', key: 'flows_exports' },
      { label: 'Ayuda', route: '/admin/workflows/help', key: 'flows_help' },
    ],
    Documentos: [
      { label: 'Expedientes', route: '/admin/documents', key: 'documents_dossiers' },
      { label: 'Búsqueda', route: '/admin/documents/search', key: 'documents_search' },
      { label: 'Carpetas', route: '/admin/documents/folders', key: 'documents_folders' },
      { label: 'Por vencer', route: '/admin/documents/expiring', key: 'documents_expiring' },
      { label: 'Retención', route: '/admin/documents/retention', key: 'documents_retention' },
      { label: 'Plantillas', route: '/admin/documents/templates', key: 'documents_templates' },
    ],
  };
  const ALL_CHILDREN = [...EXPECTED['Flujos'], ...EXPECTED['Documentos']];

  /** The two real groups of the STORE_ADMIN sidebar. */
  const adminTree = (): MenuItem[] =>
    STORE_ADMIN_MENU_ITEMS.filter((item) => item.label === 'Flujos' || item.label === 'Documentos').map(
      (item) => ({ ...item, children: item.children?.map((child) => ({ ...child })) }),
    );
  const childItem = (route: string): MenuItem =>
    adminTree().flatMap((group) => group.children ?? []).find((child) => child.route === route)!;
  const filtered = async () => firstValueFrom(service.filterMenuItems(adminTree()).pipe(take(1)));
  const childRoutes = async () => (await filtered()).flatMap((group) => (group.children ?? []).map((c) => c.route));
  const setUserPanel = (value: Record<string, boolean>) => {
    panelUi$.next(value);
    panelUiState.set(value);
  };
  const setSettings = (value: Record<string, any>) => {
    settings$.next(value);
    settingsState.set(value);
  };

  beforeEach(() => {
    // A user whose stored panel_ui predates the child keys.
    panelUiState = signal<Record<string, boolean>>({ flows: true, documents: true });
    panelUi$ = new BehaviorSubject<Record<string, boolean>>({ flows: true, documents: true });
    settingsState = signal<Record<string, any>>({ general: { store_type: 'hybrid' } });
    settings$ = new BehaviorSubject<Record<string, any>>({ general: { store_type: 'hybrid' } });
    industries = signal<string[]>(['administration']);
    permissions = [];
    owner = true;
    const visibleModules$ = new BehaviorSubject<string[]>(['flows', 'documents']);
    const authFacade = {
      getVisibleModules$: () => visibleModules$.asObservable(),
      userStoreType$: of('hybrid'), userIndustries$: of(['administration']), storeSettings$: settings$.asObservable(),
      userOrganization$: of({ operating_scope: 'STORE', fiscal_scope: 'STORE' }), activeFiscalAreas$: of([]),
      currentAppPanelUi$: panelUi$.asObservable(), userPermissions$: of([]),
      fiscalScope: signal('STORE'), operatingScope: signal('STORE'), activeFiscalAreas: signal<string[]>([]),
      storeSettings: settingsState, userIndustries: industries, userStoreType: signal<string | null>('hybrid'),
      currentAppPanelUi: panelUiState,
      isModuleVisible: (key: string) => panelUiState()[key] === true,
      hasPermission: (permission: string) => permissions.includes(permission),
      hasAnyRole: () => false, hasAnyPermission: () => false,
      isOwner: () => owner, isAdmin: () => false,
    };
    TestBed.configureTestingModule({ providers: [
      MenuFilterService,
      { provide: AuthFacade, useValue: authFacade },
      { provide: AccessGateService, useValue: accessGateStub() },
      { provide: SubscriptionAccessService, useValue: { canUseAI: () => () => true } },
    ] });
    service = TestBed.inject(MenuFilterService);
  });

  it('el Sidebar real tiene Flujos y Documentos como padres con todos sus hijos, en orden', () => {
    for (const [label, children] of Object.entries(EXPECTED)) {
      const group = STORE_ADMIN_MENU_ITEMS.find((item) => item.label === label)!;
      expect(group.route).withContext(label).toBeUndefined();
      expect(group.children?.map((c) => ({ label: c.label, route: c.route, key: c.panelUiKey })))
        .withContext(label)
        .toEqual(children);
    }
  });

  it('cada hijo tiene key en APP_MODULES, ruta, industria siempre aplicada, default opt-out y permiso', () => {
    const known = new Set(allStoreAdminKeys());
    for (const child of ALL_CHILDREN) {
      expect(known.has(child.key)).withContext(child.key).toBe(true);
      expect(MODULE_ROUTES[child.key]).withContext(child.key).toBe(child.route);
      expect(MODULE_INDUSTRIES[child.key]).withContext(child.key).toEqual(['administration']);
      expect(isIndustryAlwaysEnforced(child.key)).withContext(child.key).toBe(true);
      expect(DEFAULT_ON_PANEL_KEYS).withContext(child.key).toContain(child.key);
      expect(ADMINISTRATION_PERMISSION_ROUTES[child.route]?.length).withContext(child.route).toBeGreaterThan(0);
    }
  });

  it('el owner de una tienda Administración ve todos los hijos, sin candado, con un panel_ui previo a las keys', async () => {
    const groups = await filtered();
    expect(groups.map((g) => g.label)).toEqual(['Flujos', 'Documentos']);
    expect(await childRoutes()).toEqual(ALL_CHILDREN.map((c) => c.route));
    expect(groups.flatMap((g) => [g, ...(g.children ?? [])]).some((i) => i._planLocked)).toBe(false);
  });

  for (const child of ALL_CHILDREN) {
    it(`${child.label} (${child.route}): un rol sin su permiso no lo ve; con el permiso, sí`, async () => {
      owner = false;
      permissions = [];
      expect(await childRoutes()).not.toContain(child.route);
      expect(service.diagnose(childItem(child.route)).blockedBy).toBe('permission');
      expect(service.administrationPermissionBlockForUrl(child.route)?.blockedBy).toBe('permission');

      permissions = [ADMINISTRATION_PERMISSION_ROUTES[child.route][0]];
      expect(await childRoutes()).toContain(child.route);
      expect(service.diagnose(childItem(child.route)).visible).toBe(true);
      expect(service.administrationPermissionBlockForUrl(`${child.route}?tab=1`)).toBeNull();
    });
  }

  it('un rol con solo tareas ve «Mis tareas» y «Ayuda» (P7.7) y abre por URL la solicitud de una tarea', async () => {
    owner = false;
    permissions = ['store:workflows:task'];
    expect(await childRoutes()).toEqual(['/admin/workflows/inbox', '/admin/workflows/help']);
    expect(service.administrationPermissionBlockForUrl('/admin/workflows/instances/12')).toBeNull();
    expect(service.administrationPermissionBlockForUrl('/admin/workflows/connectors')).not.toBeNull();
  });

  it('P7: lectura ve «Uso del plan» y «Ayuda»; «Auditoría» y «Exportación» exigen administrar', async () => {
    owner = false;
    permissions = ['store:workflows:read'];
    let routes = await childRoutes();
    expect(routes).toContain('/admin/workflows/usage');
    expect(routes).toContain('/admin/workflows/help');
    expect(routes).not.toContain('/admin/workflows/audit');
    expect(routes).not.toContain('/admin/workflows/exports');
    expect(service.administrationPermissionBlockForUrl('/admin/workflows/audit')).not.toBeNull();

    permissions = ['store:workflows:read', 'store:workflows:manage'];
    routes = await childRoutes();
    expect(routes).toContain('/admin/workflows/audit');
    expect(routes).toContain('/admin/workflows/exports');
    expect(service.administrationPermissionBlockForUrl('/admin/workflows/exports')).toBeNull();
  });

  it('una tienda sin la industria conserva ambos grupos con candado en el padre y en cada hijo', async () => {
    industries.set(['retail']);
    const groups = await filtered();
    expect(groups.map((g) => g.label)).toEqual(['Flujos', 'Documentos']);
    for (const item of groups.flatMap((g) => [g, ...(g.children ?? [])])) {
      expect(item._planLocked).withContext(item.label).toBe(true);
    }
    expect(service.isIndustryLocked(service.resolveGateKeysForRoute('/admin/workflows/board'))).toBe(true);
  });

  it('apagar un hijo en el panel del usuario oculta solo ese hijo', async () => {
    owner = false;
    permissions = ['store:workflows:read', 'store:workflows:task', 'store:documents:read'];
    setUserPanel({ flows: true, documents: true, flows_board: false });
    const routes = await childRoutes();
    expect(routes).not.toContain('/admin/workflows/board');
    expect(routes).toContain('/admin/workflows/inbox');
    expect(service.diagnose(childItem('/admin/workflows/board')).blockedBy).toBe('user_panel_ui');
  });

  it('apagar el padre en la tienda cierra el grupo entero, también por URL', async () => {
    setSettings({ general: { store_type: 'hybrid' }, panel_ui: { STORE_ADMIN: { documents: false } } });
    expect((await filtered()).map((g) => g.label)).toEqual(['Flujos']);
    expect(service.resolveKeysForRoute('/admin/documents/search')).toContain('documents');
  });
});
