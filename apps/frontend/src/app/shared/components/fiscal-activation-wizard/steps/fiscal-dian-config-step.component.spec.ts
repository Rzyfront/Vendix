import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Router } from '@angular/router';

import { FiscalDianConfigStepComponent } from './fiscal-dian-config-step.component';
import { FiscalActivationWizardService } from '../../../../core/services/fiscal-activation-wizard.service';

describe('FiscalDianConfigStepComponent (redirect al asistente)', () => {
  const storeContext = signal<Record<string, number>>({});
  const wizard = {
    userScope: signal<'store' | 'organization'>('store'),
    storeContext,
    commitStep: jasmine.createSpy('commitStep').and.resolveTo(undefined),
  };
  let httpTesting: HttpTestingController;
  let navigate: jasmine.Spy;

  function create() {
    const fixture = TestBed.createComponent(FiscalDianConfigStepComponent);
    return fixture;
  }

  function readinessReq() {
    return httpTesting.expectOne((r) =>
      r.url.endsWith('/store/invoicing/dian-config/fiscal-readiness'),
    );
  }

  beforeEach(() => {
    storeContext.set({});
    wizard.userScope.set('store');
    wizard.commitStep.calls.reset();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: FiscalActivationWizardService, useValue: wizard },
      ],
    });
    httpTesting = TestBed.inject(HttpTestingController);
    navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
  });

  afterEach(() => {
    httpTesting.verify();
    TestBed.resetTestingModule();
  });

  it('lee fiscal-readiness y muestra la etiqueta del eje invoicing', async () => {
    const fixture = create();
    readinessReq().flush({
      data: {
        fiscal_scope: 'STORE',
        axes: [
          { configuration_type: 'payroll', enablement_status: 'enabled', environment: 'production' },
          { configuration_type: 'invoicing', enablement_status: 'testing', environment: 'test' },
        ],
      },
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.statusLabel()).toBe('En habilitación');
    expect(fixture.nativeElement.textContent).toContain('En habilitación');
  });

  it('muestra mensaje cuando la lectura falla', async () => {
    const fixture = create();
    readinessReq().flush('boom', { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'No se pudo leer el estado de la habilitación DIAN.',
    );
  });

  it('openActivation navega con store_id cuando hay tienda', () => {
    storeContext.set({ store_id: 7 });
    const fixture = create();
    readinessReq().flush({ data: { axes: [] } });
    fixture.componentInstance.openActivation();
    expect(navigate).toHaveBeenCalledWith(['/admin/invoicing/activation'], {
      queryParams: { store_id: 7 },
    });
  });

  it('openActivation navega sin queryParams cuando no hay tienda', () => {
    const fixture = create();
    readinessReq().flush({ data: { axes: [] } });
    fixture.componentInstance.openActivation();
    expect(navigate).toHaveBeenCalledWith(['/admin/invoicing/activation'], {
      queryParams: undefined,
    });
  });

  it('submit confirma el paso con redirected_to=activation sin escribir por HTTP', async () => {
    const fixture = create();
    readinessReq().flush({ data: { axes: [] } });
    const result = await fixture.componentInstance.submit();
    expect(wizard.commitStep).toHaveBeenCalledWith('dian_config', {
      redirected_to: 'activation',
    });
    expect(result).toEqual({ ref: { redirected_to: 'activation' } });
    expect(fixture.componentInstance.submitting()).toBeFalse();
    // httpTesting.verify() en afterEach: ningún POST/PATCH/PUT pendiente.
  });
});
