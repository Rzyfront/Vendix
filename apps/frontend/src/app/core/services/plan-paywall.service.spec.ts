import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { PlanPaywallService } from './plan-paywall.service';
import { PlanPaywallOutletComponent } from '../components/plan-paywall-outlet.component';
import type { PlanLock } from './menu-filter.service';

const OFFER = {
  code: 'empresarial-pro-monthly',
  name: 'Empresarial Pro',
  price: 89900,
  currency: 'COP',
  cycle: 'monthly',
};
const IA = { code: 'ia-business', name: 'IA Business', price: 190000, currency: 'COP', cycle: 'monthly' };

const lock = (key = 'invoicing'): PlanLock => ({
  key,
  family: {
    id: key === 'flows' ? 'flows' : 'invoicing',
    name: key === 'flows' ? 'Flujos Automatizados impulsados con IA' : 'Facturación electrónica',
    value: 'Factura electrónica DIAN.',
    keys: [key],
  },
  currentPlan: { code: 'vendix-impulsa', name: 'Vendix Impulsa', cycle: 'monthly' },
  offers: [OFFER, IA],
  recommended: OFFER,
  upgradeUrl: '/admin/subscription/plans?plan=empresarial-pro-monthly&cycle=monthly&from=invoicing',
}) as unknown as PlanLock;

describe('PlanPaywallService (paywall de módulo)', () => {
  let service: PlanPaywallService;
  let router: jasmine.SpyObj<Router>;

  beforeEach(() => {
    router = jasmine.createSpyObj('Router', ['navigateByUrl']);
    TestBed.configureTestingModule({ providers: [{ provide: Router, useValue: router }] });
    service = TestBed.inject(PlanPaywallService);
  });

  it('abre una sola vez por módulo y sesión; el segundo intento devuelve false', () => {
    expect(service.show(lock())).toBeTrue();
    expect(service.isOpen()).toBeTrue();
    service.close();
    expect(service.show(lock('invoicing_resolutions'))).toBeFalse();
    expect(service.isOpen()).toBeFalse();
    expect(service.show(lock('flows'))).toBeTrue();
  });

  it('«Ver planes y mejorar» cierra y navega a la URL con plan, ciclo y módulo', () => {
    service.show(lock());
    service.goToPlans();
    expect(service.isOpen()).toBeFalse();
    expect(router.navigateByUrl).toHaveBeenCalledWith(
      '/admin/subscription/plans?plan=empresarial-pro-monthly&cycle=monthly&from=invoicing',
    );
  });

  it('desde el 403 PLAN_MODULE_NOT_INCLUDED arma el candado con el payload del backend', () => {
    expect(
      service.showFromApi({
        module: 'invoicing',
        current_plan: { code: 'vendix-impulsa', name: 'Vendix Impulsa', cycle: 'monthly' },
        required_plans: [OFFER],
        upgrade_url: '/admin/subscription/plans?plan=empresarial-pro-monthly&cycle=monthly&from=invoicing',
      }),
    ).toBeTrue();
    const opened = service.lock()!;
    expect(opened.family?.name).toBe('Facturación electrónica');
    expect(opened.recommended?.code).toBe('empresarial-pro-monthly');
    expect(opened.upgradeUrl).toContain('from=invoicing');
  });

  it('una upgrade_url ajena a la página de planes se reemplaza por la propia', () => {
    service.showFromApi({ module: 'invoicing', upgrade_url: 'https://evil.example/x' });
    expect(service.lock()!.upgradeUrl).toBe('/admin/subscription/plans?from=invoicing');
    expect(service.showFromApi(null)).toBeFalse();
  });

  it('el aviso corto nombra el módulo y los planes que lo incluyen', () => {
    expect(service.notice(lock())).toBe(
      'Facturación electrónica no está incluido en tu plan. Disponible en Empresarial Pro · IA Business.',
    );
  });
});

describe('PlanPaywallOutletComponent', () => {
  let service: PlanPaywallService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PlanPaywallOutletComponent],
      providers: [{ provide: Router, useValue: jasmine.createSpyObj('Router', ['navigateByUrl']) }],
    });
    service = TestBed.inject(PlanPaywallService);
  });

  it('muestra nombre, valor, plan actual, planes con precio y el botón «Ver planes y mejorar»', async () => {
    const fixture = TestBed.createComponent(PlanPaywallOutletComponent);
    service.show(lock());
    fixture.detectChanges();
    await fixture.whenStable();
    const text = (document.body.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('Facturación electrónica no está en tu plan');
    expect(text).toContain('Factura electrónica DIAN.');
    expect(text).toContain('Tu plan actual: Vendix Impulsa');
    expect(text).toContain('Empresarial Pro');
    expect(text).toContain('IA Business');
    expect(text).toContain('Ver planes y mejorar');
    expect(fixture.componentInstance.priceLabel(OFFER)).toMatch(/89\.900\s\/\smes$/);
    service.close();
    fixture.detectChanges();
    fixture.destroy();
  });
});
