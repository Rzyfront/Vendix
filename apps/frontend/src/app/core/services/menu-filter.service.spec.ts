import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
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
