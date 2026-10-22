import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';

import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { FiscalActivationWizardService } from '../../../../../../core/services/fiscal-activation-wizard.service';
import { DianConfigApiService } from '../../../../../../shared/services/dian';
import { nextActivationStep } from './activation-step.util';
import { ActivationWizardComponent } from './activation-wizard.component';
import type { ActivationSnapshot } from './activation-wizard.model';

const FAR = '2099-01-01';

const resolution = (over: Record<string, unknown> = {}) => ({
  id: 1,
  document_type: 'sales_invoice',
  prefix: 'FE',
  range_from: 1,
  range_to: 5000,
  current_number: 1,
  valid_from: '2026-01-01',
  valid_to: FAR,
  is_active: true,
  technical_key_set: true,
  resolution_number: '18764000000001',
  ...over,
});

const axis = (over: Record<string, unknown> = {}) => ({
  configuration_type: 'invoicing',
  label: 'Factura',
  config_id: 1,
  environment: 'test',
  enablement_status: 'testing',
  readiness: null,
  resolutions: [],
  ...over,
});

const config = (over: Record<string, unknown> = {}) => ({
  id: 1,
  software_id: 'sw-1',
  software_pin_encrypted: '****',
  test_set_id: 'ts-1',
  certificate_s3_key: 'k.p12',
  certificate_expiry: '2099-01-01T00:00:00Z',
  environment: 'test',
  enablement_status: 'testing',
  ...over,
});

interface Scenario {
  legal: boolean;
  axes: unknown[];
  config?: unknown;
}

const NOTHING: Scenario = { legal: false, axes: [] };
const COMPANY_SOFTWARE: Scenario = { legal: true, axes: [axis()], config: config() }; // -> certificate? no: cert present -> testing
const ALL_DONE: Scenario = {
  legal: true,
  axes: [axis({ environment: 'production', enablement_status: 'enabled', resolutions: [resolution()] })],
  config: config(),
};
const READY_TO_PROMOTE: Scenario = {
  legal: true,
  axes: [axis({ enablement_status: 'test_set_passed', resolutions: [resolution()] })],
  config: config(),
};

describe('ActivationWizardComponent', () => {
  let api: { getFiscalReadiness: jasmine.Spy; getDianConfigById: jasmine.Spy };
  let wizard: { userScope: () => string; loadStatus: jasmine.Spy; loadPrefill: jasmine.Spy };
  let router: { navigate: jasmine.Spy };

  function setup(scenario: Scenario) {
    api.getFiscalReadiness.and.returnValue(of({ data: { fiscal_scope: 'STORE', axes: scenario.axes } }));
    api.getDianConfigById.and.returnValue(of({ data: scenario.config ?? null }));
    wizard.loadPrefill.and.resolveTo({ satisfied_steps: scenario.legal ? ['legal_data'] : [] });
  }

  async function create(scenario: Scenario) {
    setup(scenario);
    const fixture = TestBed.createComponent(ActivationWizardComponent);
    const cmp = fixture.componentInstance;
    await cmp.reload();
    return cmp;
  }

  beforeEach(() => {
    api = {
      getFiscalReadiness: jasmine.createSpy('getFiscalReadiness'),
      getDianConfigById: jasmine.createSpy('getDianConfigById'),
    };
    wizard = {
      userScope: () => 'store',
      loadStatus: jasmine.createSpy('loadStatus').and.resolveTo({}),
      loadPrefill: jasmine.createSpy('loadPrefill'),
    };
    router = { navigate: jasmine.createSpy('navigate').and.resolveTo(true) };

    TestBed.configureTestingModule({
      providers: [
        { provide: DianConfigApiService, useValue: api },
        { provide: FiscalActivationWizardService, useValue: wizard },
        {
          provide: AuthFacade,
          useValue: {
            fiscalScope: () => 'STORE',
            fiscalStatus: () => null,
            hasPermission: () => true,
          },
        },
        { provide: Router, useValue: router },
      ],
    });
    TestBed.overrideComponent(ActivationWizardComponent, { set: { template: '', imports: [] } });
  });

  function snapshotOf(s: Scenario): ActivationSnapshot {
    const a = s.axes[0] as ActivationSnapshot['axis'];
    return { legalDataComplete: s.legal, axis: a ?? null, config: (s.config ?? null) as ActivationSnapshot['config'] };
  }

  describe('reload() initial step', () => {
    it('nothing done -> company', async () => {
      const cmp = await create(NOTHING);
      expect(cmp.currentStep()).toBe('company');
      expect(cmp.currentStep()).toBe(nextActivationStep(snapshotOf(NOTHING)));
      expect(cmp.loading()).toBeFalse();
      expect(cmp.completed()).toBeFalse();
    });

    it('company + software + certificate done, test set pending -> testing', async () => {
      const cmp = await create(COMPANY_SOFTWARE);
      expect(cmp.currentStep()).toBe('testing');
      expect(cmp.currentStep()).toBe(nextActivationStep(snapshotOf(COMPANY_SOFTWARE)));
    });

    it('company done, no config -> software', async () => {
      const s: Scenario = { legal: true, axes: [axis({ config_id: null })] };
      const cmp = await create(s);
      expect(cmp.currentStep()).toBe('software');
      expect(api.getDianConfigById).not.toHaveBeenCalled();
    });

    it('everything but promotion -> promote, not completed', async () => {
      const cmp = await create(READY_TO_PROMOTE);
      expect(cmp.currentStep()).toBe('promote');
      expect(cmp.completed()).toBeFalse();
    });

    it('everything done -> promote and completed', async () => {
      const cmp = await create(ALL_DONE);
      expect(cmp.currentStep()).toBe('promote');
      expect(cmp.completed()).toBeTrue();
    });
  });

  describe('navigation', () => {
    it('next() advances only when the current step is complete', async () => {
      const cmp = await create(NOTHING);
      expect(cmp.canGoNext()).toBeFalse();
      cmp.next();
      expect(cmp.currentStep()).toBe('company');

      const done = await create(COMPANY_SOFTWARE);
      done.goToStep('software');
      expect(done.canGoNext()).toBeTrue();
      done.next();
      expect(done.currentStep()).toBe('certificate');
    });

    it('previous() goes back and never below index 0', async () => {
      const cmp = await create(COMPANY_SOFTWARE);
      expect(cmp.currentStep()).toBe('testing');
      cmp.previous();
      expect(cmp.currentStep()).toBe('certificate');
      cmp.goToStep('company');
      expect(cmp.hasPrevious()).toBeFalse();
      cmp.previous();
      expect(cmp.currentStep()).toBe('company');
      expect(cmp.currentIndex()).toBe(0);
    });

    it('goToStep() moves to an enterable step', async () => {
      const cmp = await create(COMPANY_SOFTWARE);
      cmp.goToStep('software');
      expect(cmp.currentStep()).toBe('software');
    });

    it('goToStep() ignores a blocked (future) step', async () => {
      const cmp = await create(COMPANY_SOFTWARE);
      cmp.goToStep('promote');
      expect(cmp.currentStep()).toBe('testing');
      cmp.goToStep('production_ranges');
      expect(cmp.currentStep()).toBe('testing');
    });

    it('onStepClicked() respects canEnterStep', async () => {
      const cmp = await create(NOTHING);
      cmp.onStepClicked(3);
      expect(cmp.currentStep()).toBe('company');
    });
  });

  describe('errors', () => {
    it('sets loadError and clears loading when the load fails', async () => {
      setup(NOTHING);
      api.getFiscalReadiness.and.returnValue(throwError(() => new Error('boom')));
      const cmp = TestBed.createComponent(ActivationWizardComponent).componentInstance;
      await cmp.reload();
      expect(cmp.loadError()).toEqual(jasmine.any(String));
      expect(cmp.loadError()).toBeTruthy();
      expect(cmp.loading()).toBeFalse();
    });

    it('a successful reload clears a previous loadError', async () => {
      setup(NOTHING);
      api.getFiscalReadiness.and.returnValue(throwError(() => new Error('boom')));
      const cmp = TestBed.createComponent(ActivationWizardComponent).componentInstance;
      await cmp.reload();
      expect(cmp.loadError()).toBeTruthy();
      api.getFiscalReadiness.and.returnValue(of({ data: { fiscal_scope: 'STORE', axes: [] } }));
      await cmp.reload();
      expect(cmp.loadError()).toBeNull();
    });
  });

  it('goToInvoices() navigates to /admin/invoicing/invoices', async () => {
    const cmp = await create(ALL_DONE);
    cmp.goToInvoices();
    expect(router.navigate).toHaveBeenCalledWith(['/admin/invoicing/invoices']);
  });
});
