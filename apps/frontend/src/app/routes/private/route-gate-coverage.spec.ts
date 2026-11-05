import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Route, Routes } from '@angular/router';
import { MenuFilterService } from '../../core/services/menu-filter.service';
import { AccessGateService } from '../../core/services/access-gate.service';
import { SubscriptionAccessService } from '../../core/services/subscription-access.service';
import { AuthFacade } from '../../core/store/auth/auth.facade';
import { MODULE_INDUSTRIES } from '../../shared/constants/module-industries';
import { storeAdminRoutes } from './store_admin.routes';
import { orgAdminRoutes } from './org_admin.routes';

/**
 * apps-f4 S3: every admin route resolves at least one panel_ui key, so the
 * access gate (`canSeeKey`) has a rule for it. Fails when a route is added
 * without a key in `MODULE_ROUTES` / `MODULE_GATE_ROUTES` (STORE) or
 * `ORG_MODULE_ROUTES` (ORG).
 *
 * Exempt on purpose: the shell itself (`''`, the redirect entry) and the
 * escape routes the guards must always let through (`no-access`,
 * `onboarding`). Redirects and pure grouping nodes are skipped (their
 * targets and children are covered), `:param`
 * segments are filled, and a `loadChildren` route is covered by its prefix.
 */
const EXEMPT_SEGMENTS = new Set(['', '**', 'no-access', 'onboarding']);

function collectUrls(routes: Routes, prefix: string, out: string[]): string[] {
  for (const route of routes as Route[]) {
    if (route.redirectTo !== undefined) continue;
    const path = route.path ?? '';
    const filled = path
      .split('/')
      .map((segment) => (segment.startsWith(':') ? 'x' : segment))
      .join('/');
    const url = filled ? `${prefix}/${filled}` : prefix;
    const lastSegment = path.split('/').pop() ?? '';
    // A pure grouping node (only `children`, no component) is not navigable
    // by itself: its children are checked instead.
    const navigable = Boolean(
      route.component || route.loadComponent || route.loadChildren,
    );
    if (navigable && !EXEMPT_SEGMENTS.has(path) && !EXEMPT_SEGMENTS.has(lastSegment)) {
      out.push(url);
    }
    if (route.children?.length) collectUrls(route.children, url, out);
  }
  return out;
}

function adminUrls(routes: Routes): string[] {
  const urls: string[] = [];
  for (const route of routes as Route[]) {
    if (!route.path?.startsWith('admin')) continue;
    if (route.path !== 'admin') urls.push(`/${route.path}`);
    if (route.children?.length) collectUrls(route.children, `/${route.path}`, urls);
  }
  return [...new Set(urls)];
}

describe('apps-f4 S3: cobertura de rutas del panel con key', () => {
  let service: MenuFilterService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        MenuFilterService,
        {
          provide: AuthFacade,
          useValue: {
            isOwner: () => false,
            isModuleVisible: () => true,
            currentAppPanelUi: signal(null),
            storeSettings: signal(null),
            userIndustries: signal(['retail']),
          },
        },
        {
          provide: AccessGateService,
          useValue: {
            mode: signal('audit'),
            industries: signal(null),
            orgPanelUi: signal(null),
            planMode: signal('audit'),
            planBlocked: signal<string[]>([]),
            planOffers: signal({}),
            currentPlan: signal(null),
            report: () => undefined,
            currentApp: () => 'STORE_ADMIN',
          },
        },
        { provide: SubscriptionAccessService, useValue: { canUseAI: () => () => true } },
      ],
    });
    service = TestBed.inject(MenuFilterService);
  });

  it('toda ruta de store_admin.routes.ts resuelve al menos una key con regla de industria', () => {
    const urls = adminUrls(storeAdminRoutes);
    expect(urls.length).toBeGreaterThan(50);
    const missing = urls.filter(
      (url) => service.resolveGateKeysForRoute(url, 'STORE_ADMIN').length === 0,
    );
    expect(missing).withContext(`Rutas STORE sin key: ${missing.join(', ')}`).toEqual([]);

    const unmapped = urls
      .flatMap((url) => service.resolveGateKeysForRoute(url, 'STORE_ADMIN'))
      .filter((key) => MODULE_INDUSTRIES[key] === undefined);
    expect([...new Set(unmapped)])
      .withContext('Keys sin entrada en MODULE_INDUSTRIES')
      .toEqual([]);
  });

  it('toda ruta de org_admin.routes.ts resuelve al menos una key con regla de industria', () => {
    const urls = adminUrls(orgAdminRoutes);
    expect(urls.length).toBeGreaterThan(10);
    const missing = urls.filter(
      (url) => service.resolveGateKeysForRoute(url, 'ORG_ADMIN').length === 0,
    );
    expect(missing).withContext(`Rutas ORG sin key: ${missing.join(', ')}`).toEqual([]);

    const unmapped = urls
      .flatMap((url) => service.resolveGateKeysForRoute(url, 'ORG_ADMIN'))
      .filter((key) => MODULE_INDUSTRIES[key] === undefined);
    expect([...new Set(unmapped)])
      .withContext('Keys sin entrada en MODULE_INDUSTRIES')
      .toEqual([]);
  });

  it('flujos-documental S6: las rutas de Flujos y Documentos están registradas y resuelven su key', () => {
    const urls = adminUrls(storeAdminRoutes);
    expect(urls).toContain('/admin/workflows');
    expect(urls).toContain('/admin/documents');
    expect(service.resolveGateKeysForRoute('/admin/workflows/instances/12', 'STORE_ADMIN')).toContain('flows');
    expect(service.resolveGateKeysForRoute('/admin/documents', 'STORE_ADMIN')).toContain('documents');
  });

  it('una ruta inventada no resuelve key (el test detecta huecos)', () => {
    expect(service.resolveGateKeysForRoute('/admin/zz-no-existe', 'STORE_ADMIN')).toEqual([]);
  });
});
