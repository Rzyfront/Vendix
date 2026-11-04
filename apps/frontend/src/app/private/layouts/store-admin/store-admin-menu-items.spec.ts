import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { BehaviorSubject, firstValueFrom, of, take } from 'rxjs';
import { STORE_ADMIN_MENU_ITEMS } from './store-admin-menu-items';
import { MenuFilterService } from '../../../core/services/menu-filter.service';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { AccessGateService } from '../../../core/services/access-gate.service';
import { SubscriptionAccessService } from '../../../core/services/subscription-access.service';
import { MenuItem } from '../../../shared/components/sidebar/sidebar.component';
import type {
  FiscalArea,
  FiscalStatusBlock,
  FiscalStatusState,
  FiscalWizardStepId,
} from '../../../core/models/fiscal-status.model';

/**
 * Finanzas regrouping (menu-min): Gastos and Impuestos move under the former
 * "Fiscal" group, renamed Finanzas; Canales moves into Configuración. Each
 * fiscal child appears only when its stage of the fiscal wizard is complete,
 * in the sidebar and by URL. Runs the real tree through the real filter.
 */

const FINANZAS_ORDER = [
  'Gastos',
  'Impuestos',
  'Operación fiscal',
  'Activar facturación electrónica',
  'Facturación',
  'Contabilidad',
  'Nómina',
];

/** Keys an owner sees (subset relevant to the moved entries). */
const OWNER_KEYS = [
  'expenses',
  'taxes',
  'fiscal_operations',
  'invoicing',
  'accounting',
  'payroll',
  'settings',
  'settings_general',
  'marketing_social_sales',
  'help',
  'help_support',
];

type AreaSeed = { state: FiscalStatusState; completed?: FiscalWizardStepId[] };

function fiscalStatus(seed: Partial<Record<FiscalArea, AreaSeed>>): FiscalStatusBlock {
  const area = (value?: AreaSeed) => ({
    state: value?.state ?? 'INACTIVE',
    wizard: {
      selected_areas: [],
      step_sequence: [],
      current_step: null,
      completed_steps: value?.completed ?? [],
      step_refs: {},
      step_data: {},
      started_at: null,
      updated_at: null,
    },
    detector_signals: {},
    locked_reasons: [],
    activated_at: null,
    locked_at: null,
    updated_at: null,
  });
  return {
    invoicing: area(seed.invoicing),
    accounting: area(seed.accounting),
    payroll: area(seed.payroll),
  } as FiscalStatusBlock;
}

describe('STORE_ADMIN menu — Finanzas por etapa del wizard fiscal', () => {
  let service: MenuFilterService;
  let visibleModules$: BehaviorSubject<string[]>;
  let activeAreas$: BehaviorSubject<FiscalArea[]>;
  let settings$: BehaviorSubject<Record<string, unknown>>;
  let permissions$: BehaviorSubject<string[]>;
  const activeAreas = signal<FiscalArea[]>([]);
  const status = signal<FiscalStatusBlock | null>(null);

  /** Moves the observable (sidebar) and the signals (diagnose, URL) together. */
  const setFiscal = (block: FiscalStatusBlock | null) => {
    const active = block
      ? (Object.keys(block) as FiscalArea[]).filter(
          (area) => block[area].state === 'ACTIVE' || block[area].state === 'LOCKED',
        )
      : [];
    status.set(block);
    activeAreas.set(active);
    activeAreas$.next(active);
    settings$.next({ fiscal_status: block });
  };

  beforeEach(() => {
    visibleModules$ = new BehaviorSubject<string[]>(OWNER_KEYS);
    activeAreas$ = new BehaviorSubject<FiscalArea[]>([]);
    settings$ = new BehaviorSubject<Record<string, unknown>>({});
    permissions$ = new BehaviorSubject<string[]>([]);
    activeAreas.set([]);
    status.set(null);
    const authFacade = {
      getVisibleModules$: () => visibleModules$.asObservable(),
      userStoreType$: of('physical'),
      userIndustries$: of(['retail']),
      storeSettings$: settings$.asObservable(),
      userOrganization$: of({ operating_scope: 'STORE', fiscal_scope: 'STORE' }),
      activeFiscalAreas$: activeAreas$.asObservable(),
      currentAppPanelUi$: of({}),
      userPermissions$: permissions$.asObservable(),
      fiscalScope: signal('STORE'),
      operatingScope: signal('STORE'),
      activeFiscalAreas: activeAreas,
      fiscalStatus: status,
      storeSettings: signal({}),
      userIndustries: signal(['retail']),
      userStoreType: signal<string | null>('physical'),
      currentAppPanelUi: signal({}),
      storeHasPqrs: signal(false),
      hasPermission: (permission: string) => permissions$.value.includes(permission),
      hasAnyRole: () => true,
      hasAnyPermission: () => true,
      isOwner: () => true,
      isAdmin: () => true,
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
          },
        },
        { provide: SubscriptionAccessService, useValue: { canUseAI: () => () => true } },
      ],
    });
    service = TestBed.inject(MenuFilterService);
  });

  const filtered = (): Promise<MenuItem[]> =>
    firstValueFrom(service.filterMenuItems([...STORE_ADMIN_MENU_ITEMS]).pipe(take(1)));

  const childLabels = (tree: MenuItem[], group: string): string[] | undefined =>
    tree.find((item) => item.label === group)?.children?.map((child) => child.label);

  describe('estructura', () => {
    const labels = STORE_ADMIN_MENU_ITEMS.map((item) => item.label);
    const finanzas = STORE_ADMIN_MENU_ITEMS.find((item) => item.label === 'Finanzas');
    const configuracion = STORE_ADMIN_MENU_ITEMS.find((item) => item.label === 'Configuración');

    it('Gastos, Impuestos e Integraciones dejan el primer nivel; Fiscal pasa a llamarse Finanzas', () => {
      expect(labels).not.toContain('Gastos');
      expect(labels).not.toContain('Impuestos');
      expect(labels).not.toContain('Integraciones');
      expect(labels).not.toContain('Fiscal');
      expect(labels).toContain('Finanzas');
      expect(labels).toContain('Ayuda');
    });

    it('Finanzas abre en Gastos y conserva los hijos fiscales en su orden', () => {
      expect(finanzas?.children?.map((child) => child.label)).toEqual(FINANZAS_ORDER);
      // Same key resolution as before: no group key (shown when a child is).
      expect(finanzas?.panelUiKey).toBeUndefined();
    });

    it('Canales vive en Configuración con su key de siempre', () => {
      const canales = configuracion?.children?.find((child) => child.label === 'Canales');
      expect(canales?.route).toBe('/admin/integrations/channels');
      expect(canales?.panelUiKey).toBe('marketing_social_sales');
    });
  });

  describe('sidebar', () => {
    it('sin configuración fiscal: solo Gastos y la entrada para activar facturación', async () => {
      setFiscal(null);
      expect(childLabels(await filtered(), 'Finanzas')).toEqual([
        'Gastos',
        'Activar facturación electrónica',
      ]);
    });

    it('wizard a medias con la etapa Impuestos lista: aparece Impuestos, nada operativo', async () => {
      setFiscal(fiscalStatus({ invoicing: { state: 'WIP', completed: ['area_selection', 'legal_data', 'default_taxes'] } }));
      expect(childLabels(await filtered(), 'Finanzas')).toEqual([
        'Gastos',
        'Impuestos',
        'Activar facturación electrónica',
      ]);
    });

    it('facturación activa: Impuestos, Operación fiscal y Facturación; sin Contabilidad ni Nómina', async () => {
      setFiscal(fiscalStatus({ invoicing: { state: 'ACTIVE' } }));
      expect(childLabels(await filtered(), 'Finanzas')).toEqual([
        'Gastos',
        'Impuestos',
        'Operación fiscal',
        'Facturación',
      ]);
    });

    it('solo nómina activa: Impuestos sigue oculto (nómina no pasa por esa etapa)', async () => {
      setFiscal(fiscalStatus({ payroll: { state: 'ACTIVE' } }));
      expect(childLabels(await filtered(), 'Finanzas')).toEqual([
        'Gastos',
        'Operación fiscal',
        'Activar facturación electrónica',
        'Nómina',
      ]);
    });

    it('todo activo: los siete hijos menos el asistente de activación', async () => {
      setFiscal(fiscalStatus({ invoicing: { state: 'ACTIVE' }, accounting: { state: 'LOCKED' }, payroll: { state: 'ACTIVE' } }));
      expect(childLabels(await filtered(), 'Finanzas')).toEqual(
        FINANZAS_ORDER.filter((label) => label !== 'Activar facturación electrónica'),
      );
    });

    it('Gastos no depende del wizard: un rol con solo expenses ve Finanzas > Gastos', async () => {
      visibleModules$.next(['expenses']);
      setFiscal(null);
      expect(childLabels(await filtered(), 'Finanzas')).toEqual(['Gastos']);
    });

    it('Canales sigue la key marketing_social_sales dentro de Configuración', async () => {
      expect(childLabels(await filtered(), 'Configuración')).toContain('Canales');
      visibleModules$.next(OWNER_KEYS.filter((key) => key !== 'marketing_social_sales'));
      expect(childLabels(await filtered(), 'Configuración')).not.toContain('Canales');
    });

    it('diagnose explica qué etapa falta y manda al wizard', () => {
      setFiscal(null);
      const impuestos = STORE_ADMIN_MENU_ITEMS.find((item) => item.label === 'Finanzas')!
        .children!.find((child) => child.label === 'Impuestos')!;
      const verdict = service.diagnose(impuestos);
      expect(verdict.visible).toBe(false);
      expect(verdict.blockedBy).toBe('fiscal_area');
      expect(verdict.detail).toContain('«Impuestos»');
      expect(verdict.fixPath).toBe('/admin/fiscal/wizard');
    });
  });

  describe('URL directa', () => {
    const blocked = (url: string) => service.fiscalStageBlockForUrl(url) !== null;

    it('sin configuración bloquea las pantallas operativas y deja abiertas las de configuración', () => {
      setFiscal(null);
      expect(blocked('/admin/taxes')).toBe(true);
      expect(blocked('/admin/fiscal')).toBe(true);
      expect(blocked('/admin/fiscal/dashboard')).toBe(true);
      expect(blocked('/admin/invoicing/invoices')).toBe(true);
      expect(blocked('/admin/accounting/journal-entries?page=2')).toBe(true);
      expect(blocked('/admin/payroll')).toBe(true);

      expect(blocked('/admin/fiscal/wizard')).toBe(false);
      expect(blocked('/admin/fiscal/activation')).toBe(false);
      expect(blocked('/admin/invoicing/activation')).toBe(false);
      expect(blocked('/admin/invoicing/dian-config')).toBe(false);
      expect(blocked('/admin/invoicing/resolutions')).toBe(false);
      expect(blocked('/admin/expenses')).toBe(false);
      // A sibling prefix is not the gated module.
      expect(blocked('/admin/taxesx')).toBe(false);
    });

    it('la bandeja de recibidos abre solo con el permiso de lectura', () => {
      setFiscal(null);
      expect(blocked('/admin/invoicing/received-documents')).toBe(true);
      permissions$.next(['invoicing:received:read']);
      expect(blocked('/admin/invoicing/received-documents/12')).toBe(false);
      expect(blocked('/admin/invoicing/invoices')).toBe(true);
    });

    it('cada etapa completada abre su URL', () => {
      setFiscal(fiscalStatus({ invoicing: { state: 'WIP', completed: ['default_taxes'] } }));
      expect(blocked('/admin/taxes')).toBe(false);
      expect(blocked('/admin/fiscal')).toBe(true);

      setFiscal(fiscalStatus({ accounting: { state: 'ACTIVE' } }));
      expect(blocked('/admin/taxes')).toBe(false);
      expect(blocked('/admin/fiscal/dashboard')).toBe(false);
      expect(blocked('/admin/accounting/journal-entries')).toBe(false);
      expect(blocked('/admin/invoicing/invoices')).toBe(true);
      expect(blocked('/admin/payroll')).toBe(true);
    });
  });
});
