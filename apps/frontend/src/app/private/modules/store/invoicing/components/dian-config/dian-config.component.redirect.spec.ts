import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';

import { DianConfigComponent } from './dian-config.component';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { DianConfigApiService } from '../../../../../../shared/services/dian';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

describe('DianConfigComponent redirect al asistente de activación', () => {
  const axis = (over: any = {}) => ({
    configuration_type: 'invoicing',
    label: 'Factura de venta',
    config_id: null,
    environment: null,
    enablement_status: 'not_started',
    readiness: null,
    resolutions: [],
    ...over,
  });
  let api: { getFiscalReadiness: jasmine.Spy; getDianConfigById: jasmine.Spy };
  let navigate: jasmine.Spy;

  async function create(axisDetailRoute: boolean, axes: any[] = [axis()]) {
    api.getFiscalReadiness.and.returnValue(
      of({ data: { fiscal_scope: 'STORE', axes } }),
    );
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: DianConfigApiService, useValue: api },
        {
          provide: AuthFacade,
          useValue: { userRoles: () => [], hasPermission: () => true },
        },
        { provide: ToastService, useValue: { error: jasmine.createSpy() } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { data: { axisDetailRoute } } },
        },
        { provide: Router, useValue: { navigate: (navigate = jasmine.createSpy('navigate').and.resolveTo(true)) } },
      ],
    });
    TestBed.overrideComponent(DianConfigComponent, {
      set: { template: '', imports: [] },
    });
    const fixture = TestBed.createComponent(DianConfigComponent);
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    api = {
      getFiscalReadiness: jasmine.createSpy('getFiscalReadiness'),
      getDianConfigById: jasmine.createSpy('getDianConfigById').and.returnValue(of({ data: {} })),
    };
  });

  afterEach(() => TestBed.resetTestingModule());

  it('con axisDetailRoute navega al asistente y no abre el modal', async () => {
    const cmp = await create(true);
    cmp.onConfigure(cmp.axes()[0]);
    expect(navigate).toHaveBeenCalledWith(['/admin/invoicing/activation']);
    expect(cmp.isWizardOpen()).toBeFalse();
  });

  it('sin axisDetailRoute (super admin) no navega y abre el modal', async () => {
    const cmp = await create(false);
    cmp.onConfigure(cmp.axes()[0]);
    expect(navigate).not.toHaveBeenCalled();
    expect(cmp.isWizardOpen()).toBeTrue();
    expect(cmp.wizardConfigurationType()).toBe('invoicing');
  });

  it('showActivationCta es false con invoicing en producción habilitado', async () => {
    const cmp = await create(true, [
      axis({ config_id: 1, environment: 'production', enablement_status: 'enabled' }),
    ]);
    expect(cmp.showActivationCta()).toBeFalse();
  });

  it('showActivationCta es true si invoicing no está habilitado en producción', async () => {
    const cmp = await create(true, [
      axis({ config_id: 1, environment: 'test', enablement_status: 'testing' }),
    ]);
    expect(cmp.showActivationCta()).toBeTrue();
  });

  it('showActivationCta es false sin axisDetailRoute', async () => {
    const cmp = await create(false);
    expect(cmp.showActivationCta()).toBeFalse();
  });
});
