import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { provideMockStore } from '@ngrx/store/testing';
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

  let fixture: ComponentFixture<PlanFormComponent>;

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
        provideHttpClient(),
        provideHttpClientTesting(),
        provideMockStore({ initialState: { tenant: { domainConfig: null } } }),
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
    fixture = TestBed.createComponent(PlanFormComponent);
    return fixture.componentInstance;
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

  it('a number typed in the field is saved (the input hands the control text)', async () => {
    const cmp = setup('7', stored());
    cmp.activeTab.set('workflows');
    fixture.detectChanges();
    await fixture.whenStable();
    const input = fixture.nativeElement.querySelector(
      '[data-testid="workflow-limits-section"] input',
    ) as HTMLInputElement;
    input.value = '750';
    input.dispatchEvent(new Event('input'));
    cmp.onSubmit();
    expect(service.updatePlan.calls.mostRecent().args[1].workflow_limits).toEqual({
      monthly_instances: 750,
    });
  });

  it('clearing every line of a stored plan sends null so the defaults apply again', () => {
    const cmp = setup('7', stored({ workflow_limits: { monthly_instances: 500 } }));
    cmp.limitsForm.controls.monthly_instances.setValue({ value: null, unlimited: false });
    cmp.onSubmit();
    expect(service.updatePlan.calls.mostRecent().args[1].workflow_limits).toBeNull();
  });

  it('a negative or out-of-range line is shown instead of saved as the platform value', () => {
    const cmp = setup('7', stored({ workflow_limits: { monthly_instances: 500 } }));
    const toast = TestBed.inject(ToastService) as unknown as { error: jasmine.Spy };
    cmp.limitsForm.controls.monthly_instances.setValue({ value: '-5', unlimited: false });
    cmp.limitsForm.controls.monthly_http_calls.setValue({ value: 3_000_000_000, unlimited: false });
    cmp.onSubmit();
    expect(service.updatePlan).not.toHaveBeenCalled();
    expect(cmp.activeTab()).toBe('workflows');
    expect(toast.error.calls.mostRecent().args[0]).toContain('«Solicitudes por mes», «Llamadas HTTP por mes»');
  });

  it('a small storage cap is saved back with its exact bytes', () => {
    const limits = { storage_bytes: 100 * 1024 ** 2 };
    const cmp = setup('7', stored({ workflow_limits: limits }));
    cmp.onSubmit();
    expect(service.updatePlan.calls.mostRecent().args[1].workflow_limits).toEqual(limits);
  });
});
