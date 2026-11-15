import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { FiscalPayrollConfigStepComponent } from './fiscal-payroll-config-step.component';
import { FiscalActivationWizardService } from '../../../../core/services/fiscal-activation-wizard.service';
import { WizardPrefill } from '../../../../core/models/wizard-prefill.model';

/**
 * QUI-414: resuming the payroll step after leaving the wizard must show the
 * values saved by `PUT /payroll/settings` (stored under
 * `settings.payroll.minimal`) and never wedge the step.
 */
describe('FiscalPayrollConfigStepComponent (retomar configuración de nómina)', () => {
  const wizard = {
    userScope: signal<'store' | 'organization'>('store'),
    lastStatus: signal<{ fiscal_scope: 'STORE' | 'ORGANIZATION' } | null>({
      fiscal_scope: 'STORE',
    }),
    fiscalContextKey: signal('store:STORE:none'),
    prefill: signal<WizardPrefill | null>(null),
    storeContext: () => ({}),
    storeQuery: () => '',
    commitStep: jasmine.createSpy('commitStep').and.resolveTo(undefined),
  };

  function prefillWith(config: Record<string, unknown> | null, enabled = false): WizardPrefill {
    return {
      payroll_config: { enabled, config, defaults_year: 2026, has_minimal: !!config },
    } as unknown as WizardPrefill;
  }

  async function create() {
    const fixture = TestBed.createComponent(FiscalPayrollConfigStepComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    wizard.userScope.set('store');
    wizard.lastStatus.set({ fiscal_scope: 'STORE' });
    wizard.prefill.set(null);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: FiscalActivationWizardService, useValue: wizard },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('siembra el formulario con lo guardado en config.minimal', async () => {
    wizard.prefill.set(
      prefillWith({
        minimal: {
          payment_frequency: 'QUINCENAL',
          withholding_enabled: false,
          parafiscales: { sena: false, icbf: true, caja_compensacion: true, eps: true, arl: true, pension: true },
          pila_operator: 'Aportes en Línea',
        },
      }),
    );
    const fixture = await create();
    expect(fixture.componentInstance.initial()).toEqual({
      payment_frequency: 'QUINCENAL',
      withholding_enabled: false,
      parafiscales: { sena: false, icbf: true, caja_compensacion: true, eps: true, arl: true, pension: true },
      pila_operator: 'Aportes en Línea',
    });
  });

  it('siembra cuando el prefill llega después de montar el paso', async () => {
    const fixture = await create();
    expect(fixture.componentInstance.initial()).toBeNull();

    wizard.prefill.set(prefillWith({ minimal: { payment_frequency: 'SEMANAL' } }));
    await fixture.whenStable();
    expect(fixture.componentInstance.initial()).toEqual({ payment_frequency: 'SEMANAL' });
  });

  it('sin configuración guardada deja los valores por defecto', async () => {
    wizard.prefill.set(prefillWith({ rules: {} }));
    const fixture = await create();
    expect(fixture.componentInstance.initial()).toBeNull();
    expect(fixture.componentInstance.valid()).toBeTrue();
  });

  it('descarta frecuencias desconocidas en lugar de romper el formulario', async () => {
    wizard.prefill.set(prefillWith({ minimal: { payment_frequency: 'monthly' } }));
    const fixture = await create();
    expect(fixture.componentInstance.initial()).toBeNull();
  });

  it('en solo lectura (configuración heredada) no bloquea "Continuar"', async () => {
    wizard.lastStatus.set({ fiscal_scope: 'ORGANIZATION' });
    wizard.prefill.set(prefillWith({ minimal: { payment_frequency: 'MENSUAL' } }));
    const fixture = await create();
    expect(fixture.componentInstance.readOnlyForStore()).toBeTrue();
    expect(fixture.componentInstance.valid()).toBeTrue();
  });
});
