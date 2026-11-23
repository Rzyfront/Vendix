import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { MenuFilterService } from '../../../../../core/services/menu-filter.service';
import { industryAllowsKey } from '../../../../../shared/constants/module-industries';
import {
  HomePanelService,
  normalizeHomePanelSettings,
} from './home-panel.service';
import { HOME_PANEL_REGISTRY } from './home-panel.registry';
import { DashboardAccessExtension } from '../../../../../core/services/dashboard-access-extension.service';

/**
 * QUI-967 — resolution of the store "Panel Principal": store eligibility by
 * industry/module/plan, saved config or "Resumen", user permissions and the
 * fallback that never leaves a blank screen.
 */
describe('HomePanelService (QUI-967)', () => {
  const settings = signal<any>(null);
  const industries = signal<string[]>(['retail']);
  let owner = false;
  let permissions: string[] = [];
  let planDenied: string[] = [];
  let userHidden: string[] = [];

  const ids = (service: HomePanelService) =>
    service.visibleTabs().map((panel) => panel.id);

  function setup(): HomePanelService {
    const auth = {
      storeSettings: settings,
      storeIndustries: industries,
      isOwner: () => owner,
      isAdmin: () => false,
      hasAnyRole: () => false,
      hasAnyPermission: (wanted: string[]) =>
        wanted.some((p) => permissions.includes(p)),
    };
    const menuFilter = {
      planDeniesKey: (key: string) => planDenied.includes(key),
      // Mirrors canSeeKey: user panel_ui ∧ industry (store/plan already tested
      // by the store eligibility layer).
      canSeeKey: (key: string) => ({
        allowed:
          !userHidden.includes(key) &&
          industryAllowsKey(key, industries()) &&
          !planDenied.includes(key),
        layer: null,
        industries: industries(),
      }),
    };
    TestBed.configureTestingModule({
      providers: [
        HomePanelService,
        { provide: AuthFacade, useValue: auth },
        { provide: MenuFilterService, useValue: menuFilter },
      ],
    });
    return TestBed.inject(HomePanelService);
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    settings.set({});
    industries.set(['retail']);
    owner = true;
    permissions = [];
    planDenied = [];
    userHidden = [];
  });

  it('a store without home_panel keeps the current "Resumen"', () => {
    industries.set(['hospitality']);
    const service = setup();
    expect(ids(service)).toEqual(['summary']);
  });

  it('a retail store is not offered "Ocupación"; a hotel is', () => {
    const service = setup();
    expect(service.eligiblePanels().map((p) => p.id)).not.toContain('occupancy');
    industries.set(['hospitality']);
    expect(service.eligiblePanels().map((p) => p.id)).toContain('occupancy');
  });

  it('the suggestion follows the industry when eligible', () => {
    const service = setup();
    expect(service.suggestedPanel()).toBe('summary');
    industries.set(['service']);
    expect(service.suggestedPanel()).toBe('reservations_agenda');
    industries.set(['hospitality']);
    expect(service.suggestedSettings()).toEqual({
      default_panel: 'occupancy',
      enabled_panels: ['occupancy', 'summary'],
    });
  });

  it('scheduled orders agenda needs the module switched on', () => {
    industries.set(['restaurant']);
    const service = setup();
    expect(service.suggestedPanel()).toBe('summary');
    settings.set({ scheduled_orders: { enabled: true } });
    expect(service.suggestedPanel()).toBe('scheduled_orders_agenda');
  });

  it('a hotel configured on the rack opens there, Resumen as second tab', () => {
    industries.set(['hospitality']);
    settings.set({
      home_panel: {
        default_panel: 'occupancy',
        enabled_panels: ['summary', 'occupancy'],
      },
    });
    const service = setup();
    expect(ids(service)).toEqual(['occupancy', 'summary']);
  });

  it('every user of the store enters the saved CRM pipeline', () => {
    settings.set({
      home_panel: {
        default_panel: 'crm_pipeline',
        enabled_panels: ['crm_pipeline', 'summary'],
      },
    });
    const service = setup();
    expect(ids(service)[0]).toBe('crm_pipeline');
  });

  it('a cashier without CRM permission sees the next enabled panel', () => {
    owner = false;
    permissions = ['store:scheduled_orders:read'];
    industries.set(['restaurant']);
    settings.set({
      scheduled_orders: { enabled: true },
      home_panel: {
        default_panel: 'crm_pipeline',
        enabled_panels: ['crm_pipeline', 'scheduled_orders_agenda'],
      },
    });
    const service = setup();
    expect(ids(service)).toEqual(['scheduled_orders_agenda']);
  });

  it('falls back to the Resumen, then to empty (guard rule)', () => {
    owner = false;
    permissions = ['store:dashboard:view'];
    settings.set({
      home_panel: { default_panel: 'crm_pipeline', enabled_panels: ['crm_pipeline'] },
    });
    const service = setup();
    expect(ids(service)).toEqual(['summary']);
    expect(service.canEnterDashboard()).toBeTrue();

    permissions = [];
    settings.set({ ...settings() });
    expect(ids(service)).toEqual([]);
    expect(service.canEnterDashboard()).toBeFalse();
  });

  it('a lost industry or a store panel_ui switch-off drops the panel without error', () => {
    industries.set(['hospitality']);
    settings.set({
      home_panel: {
        default_panel: 'occupancy',
        enabled_panels: ['occupancy', 'crm_pipeline'],
      },
    });
    const service = setup();
    expect(ids(service)).toEqual(['occupancy', 'crm_pipeline']);

    industries.set(['retail']);
    expect(ids(service)).toEqual(['crm_pipeline']);

    settings.set({
      ...settings(),
      panel_ui: { STORE_ADMIN: { customers_pipeline: false } },
    });
    expect(ids(service)).toEqual(['summary']);
  });

  it('a panel the plan does not include is not eligible', () => {
    planDenied = ['customers_pipeline'];
    const service = setup();
    expect(service.eligiblePanels().map((p) => p.id)).not.toContain('crm_pipeline');
  });

  it('registers its entry rule for the sidebar and the guards', () => {
    owner = false;
    permissions = ['store:crm_pipeline:read'];
    settings.set({
      home_panel: { default_panel: 'crm_pipeline', enabled_panels: ['crm_pipeline'] },
    });
    setup();
    const access = TestBed.inject(DashboardAccessExtension);
    expect(access.canEnter()).toBeTrue();
    permissions = [];
    settings.set({ ...settings() });
    expect(access.canEnter()).toBeFalse();
  });

  it('every registry entry declares a lazy component and its catalog id', () => {
    for (const [id, panel] of Object.entries(HOME_PANEL_REGISTRY)) {
      expect(panel.id).toBe(id as any);
      expect(typeof panel.loadComponent).toBe('function');
      expect(panel.id === 'summary' || !!panel.route).toBeTrue();
    }
  });
});

describe('normalizeHomePanelSettings (QUI-967)', () => {
  it('drops unknown ids and keeps default first among the enabled', () => {
    expect(
      normalizeHomePanelSettings({
        default_panel: 'occupancy',
        enabled_panels: ['summary', 'widgets' as any, 'summary'],
      }),
    ).toEqual({ default_panel: 'occupancy', enabled_panels: ['occupancy', 'summary'] });
  });

  it('missing or empty → Resumen', () => {
    expect(normalizeHomePanelSettings(undefined)).toEqual({
      default_panel: 'summary',
      enabled_panels: ['summary'],
    });
    expect(
      normalizeHomePanelSettings({ default_panel: 'nope' as any, enabled_panels: [] }),
    ).toEqual({ default_panel: 'summary', enabled_panels: ['summary'] });
  });
});
