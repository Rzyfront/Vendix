import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom, of, take } from 'rxjs';
import { MenuFilterService } from '../../../../core/services/menu-filter.service';
import { AccessGateService } from '../../../../core/services/access-gate.service';
import { SubscriptionAccessService } from '../../../../core/services/subscription-access.service';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { MenuItem } from '../../../../shared/components/sidebar/sidebar.component';
import { STORE_ADMIN_MENU_ITEMS } from '../../../layouts/store-admin/store-admin-menu-items';

/**
 * Agenda unificada F4 — «Cierre del día» tras mover los reportes de hotel a
 * Reportes → Hotelería. Es operación diaria de la recepcionista, cuyo preset
 * (`lodging-roles.constant.ts`) no trae la key `reports`: conserva su entrada
 * en Hotelería con `hospitality_reservations` y su URL abre para ese rol.
 */
const NIGHT_AUDIT_URL = '/admin/reports/hospitality/hotel-night-audit';
const RECEPTIONIST_PANEL = ['hospitality', 'hospitality_rooms', 'hospitality_reservations', 'pos', 'orders'];
const MANAGER_PANEL = [...RECEPTIONIST_PANEL, 'reports', 'hospitality_rates'];

describe('Cierre del día para la recepcionista (agenda unificada F4)', () => {
  let service: MenuFilterService;
  let visibleModules$: BehaviorSubject<string[]>;
  let panelUiState: WritableSignal<Record<string, boolean>>;
  let panelUi$: BehaviorSubject<Record<string, boolean>>;
  let settings$: BehaviorSubject<Record<string, any>>;
  let settingsState: WritableSignal<Record<string, any>>;

  const panelOf = (keys: string[]) => Object.fromEntries(keys.map((key) => [key, true]));
  const setPanel = (keys: string[]) => {
    visibleModules$.next(keys);
    panelUi$.next(panelOf(keys));
    panelUiState.set(panelOf(keys));
  };
  const setIndustries = (industries: string[]) => {
    const value = { general: { store_type: 'physical', industries } };
    settings$.next(value);
    settingsState.set(value);
  };

  /** The two real sidebar groups involved: Hotelería and Reportes. */
  const tree = (): MenuItem[] =>
    STORE_ADMIN_MENU_ITEMS.filter((item) => item.label === 'Hotelería' || item.label === 'Reportes').map(
      (item) => ({ ...item, children: item.children?.map((child) => ({ ...child })) }),
    );
  const sidebar = () => firstValueFrom(service.filterMenuItems(tree()).pipe(take(1)));
  const routesOf = (items: MenuItem[], label: string) =>
    items.find((item) => item.label === label)?.children?.map((child) => child.route) ?? [];

  beforeEach(() => {
    visibleModules$ = new BehaviorSubject<string[]>(RECEPTIONIST_PANEL);
    panelUiState = signal<Record<string, boolean>>(panelOf(RECEPTIONIST_PANEL));
    panelUi$ = new BehaviorSubject<Record<string, boolean>>(panelOf(RECEPTIONIST_PANEL));
    const initialSettings = { general: { store_type: 'physical', industries: ['hospitality'] } };
    settings$ = new BehaviorSubject<Record<string, any>>(initialSettings);
    settingsState = signal<Record<string, any>>(initialSettings);
    const authFacade = {
      getVisibleModules$: () => visibleModules$.asObservable(),
      userStoreType$: of('physical'), userIndustries$: of(['hospitality']), storeSettings$: settings$.asObservable(),
      userOrganization$: of({ operating_scope: 'STORE', fiscal_scope: 'STORE' }), activeFiscalAreas$: of([]),
      currentAppPanelUi$: panelUi$.asObservable(), userPermissions$: of([]),
      fiscalScope: signal('STORE'), operatingScope: signal('STORE'), activeFiscalAreas: signal<string[]>([]),
      storeSettings: settingsState, userIndustries: signal(['hospitality']), userStoreType: signal<string | null>('physical'),
      currentAppPanelUi: panelUiState,
      isModuleVisible: (key: string) => panelUiState()[key] === true,
      hasPermission: () => false, hasAnyRole: () => false, hasAnyPermission: () => false,
      isOwner: () => false, isAdmin: () => false,
    };
    TestBed.configureTestingModule({
      providers: [
        MenuFilterService,
        { provide: AuthFacade, useValue: authFacade },
        {
          provide: AccessGateService,
          useValue: {
            mode: signal<'audit' | 'enforce'>('audit'),
            industries: signal<string[] | null>(null),
            orgPanelUi: signal<Record<string, boolean> | null>(null),
            report: jasmine.createSpy('report'),
            currentApp: () => 'STORE_ADMIN' as const,
            planMode: signal<'audit' | 'enforce'>('audit'),
            planBlocked: signal<readonly string[]>([]),
            planOffers: signal<Record<string, any[]>>({}),
            currentPlan: signal<any>(null),
          },
        },
        { provide: SubscriptionAccessService, useValue: { canUseAI: () => () => true } },
      ],
    });
    service = TestBed.inject(MenuFilterService);
  });

  it('Hotelería conserva «Cierre del día» con la key de hotel y ya no tiene «Reportes de hotel»', () => {
    const hotel = STORE_ADMIN_MENU_ITEMS.find((item) => item.label === 'Hotelería')!;
    const entry = hotel.children!.find((child) => child.label === 'Cierre del día');
    expect(entry?.route).toBe(NIGHT_AUDIT_URL);
    expect(entry?.panelUiKey).toBe('hospitality_reservations');
    expect(hotel.children!.some((child) => child.label === 'Reportes de hotel')).toBeFalse();
  });

  it('la recepcionista ve «Cierre del día» en Hotelería aunque no tenga Reportes', async () => {
    const items = await sidebar();
    expect(routesOf(items, 'Hotelería')).toContain(NIGHT_AUDIT_URL);
    expect(items.some((item) => item.label === 'Reportes')).toBeFalse();
  });

  it('un gerente con Reportes ve además Reportes → Hotelería', async () => {
    setPanel(MANAGER_PANEL);
    const items = await sidebar();
    expect(routesOf(items, 'Hotelería')).toContain(NIGHT_AUDIT_URL);
    expect(routesOf(items, 'Reportes')).toContain('/admin/reports/hospitality');
  });

  it('una tienda sin hotelería no ve la entrada', async () => {
    setIndustries(['retail']);
    const items = await sidebar();
    expect(routesOf(items, 'Hotelería')).not.toContain(NIGHT_AUDIT_URL);
  });

  it('la URL abre para la recepcionista: el índice pre-F4 no la bloquea y la compuerta la resuelve a la key de hotel', () => {
    // panelUiGuard: sin keys en el índice vigente no aplica capa de panel.
    expect(service.resolveKeysForRoute(NIGHT_AUDIT_URL)).toEqual([]);
    // Compuerta F4: la key de hotel (que la recepcionista tiene), no `reports`.
    const gateKeys = service.resolveGateKeysForRoute(NIGHT_AUDIT_URL, 'STORE_ADMIN');
    expect(gateKeys).toEqual(['hospitality_reservations']);
    expect(service.applyAccessGate(gateKeys, true, 'url', NIGHT_AUDIT_URL)).toBeTrue();
    expect(service.resolveGateKeysForRoute('/admin/reports/hospitality', 'STORE_ADMIN')).toEqual([
      'hospitality_reservations',
    ]);
  });
});
