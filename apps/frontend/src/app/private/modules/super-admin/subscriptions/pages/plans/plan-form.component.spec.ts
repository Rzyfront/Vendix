import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { AIEngineService } from '../../../ai-engine/services/ai-engine.service';
import { SubscriptionAdminService } from '../../services/subscription-admin.service';
import { PlanFormComponent } from './plan-form.component';

const GIB = 1024 ** 3;

describe('PlanFormComponent: Límites de Flujos (P7.1)', () => {
  const service = {
    getPlanById: jasmine.createSpy('getPlanById'),
    updatePlan: jasmine.createSpy('updatePlan'),
    createPlan: jasmine.createSpy('createPlan'),
  };

  function setup(planId: string | null, plan?: Record<string, unknown>) {
    service.getPlanById.calls.reset();
    service.updatePlan.calls.reset();
    service.createPlan.calls.reset();
    service.getPlanById.and.returnValue(of({ success: true, data: plan }));
    service.updatePlan.and.returnValue(of({ success: true }));
    service.createPlan.and.returnValue(of({ success: true }));
    TestBed.configureTestingModule({
      imports: [PlanFormComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: SubscriptionAdminService, useValue: service },
        {
          provide: AIEngineService,
          useValue: {
            getConfigs: () => of({ data: [] }),
            getApps: () => of({ data: [] }),
            getAgents: () => of({ data: [] }),
            getTools: () => of([]),
          },
        },
        { provide: ToastService, useValue: { warning: jasmine.createSpy(), error: jasmine.createSpy() } },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap(planId ? { id: planId } : {}) } },
        },
      ],
    });
    return TestBed.createComponent(PlanFormComponent).componentInstance;
  }

  const stored = (over: Record<string, unknown> = {}) => ({
    code: 'pro',
    name: 'Pro',
    plan_type: 'base',
    state: 'active',
    setup_fee: null,
    is_free: false,
    ai_feature_flags: {},
    feature_matrix: [],
    pricings: [{ id: 1, billing_cycle: 'monthly', price: 10, currency_code: 'COP', is_default: true }],
    ...over,
  });

  it('has the "Límites de Flujos" tab', () => {
    const cmp = setup(null);
    expect(cmp.tabs.some((t) => t.id === 'workflows' && t.label === 'Límites de Flujos')).toBeTrue();
  });

  it('a new plan with an empty section sends workflow_limits: null', () => {
    const cmp = setup(null);
    cmp.form.patchValue({ code: 'nuevo', name: 'Nuevo' });
    cmp.onSubmit();
    expect(service.createPlan).toHaveBeenCalledTimes(1);
    expect(service.createPlan.calls.mostRecent().args[0].workflow_limits).toBeNull();
  });

  it('loads the stored limits (null key = Sin límite, bytes = GB) and saves them back unchanged', () => {
    const limits = { monthly_instances: 500, monthly_http_calls: null, storage_bytes: 5 * GIB };
    const cmp = setup('7', stored({ workflow_limits: limits }));
    expect(cmp.limitsForm.getRawValue().monthly_instances).toEqual({ value: 500, unlimited: false });
    expect(cmp.limitsForm.getRawValue().monthly_http_calls.unlimited).toBeTrue();
    expect(cmp.limitsForm.getRawValue().storage_bytes.value).toBe(5);
    cmp.onSubmit();
    expect(service.updatePlan.calls.mostRecent().args[1].workflow_limits).toEqual(limits);
  });

  it('clearing every line of a stored plan sends null so the defaults apply again', () => {
    const cmp = setup('7', stored({ workflow_limits: { monthly_instances: 500 } }));
    cmp.limitsForm.controls.monthly_instances.setValue({ value: null, unlimited: false });
    cmp.onSubmit();
    expect(service.updatePlan.calls.mostRecent().args[1].workflow_limits).toBeNull();
  });
});
