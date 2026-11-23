import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { By } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';

import { FiscalIdentityPanelComponent } from './fiscal-identity-panel.component';
import {
  LegalDataFormComponent,
} from '../../../../shared/components/forms/legal-data-form/legal-data-form.component';
import { FiscalOperationsService } from '../services/fiscal-operations.service';
import { FiscalOperationsHeaderActionsService } from '../services/fiscal-operations-header-actions.service';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { CountryService } from '../../../../services/country.service';
import { RutScannerService } from '../../../../shared/components/fiscal-activation-wizard/services/rut-scanner.service';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { CurrencyFormatService } from '../../../../shared/pipes/currency/currency.pipe';
import { computeNitDv } from '../../../../shared/utils/nit.util';
import { FiscalCalendarChangePreview } from '../interfaces/fiscal-operations.interface';

const PREVIEW_WITH_PENDING: FiscalCalendarChangePreview = {
  current_periodicity: 'bimonthly',
  next_periodicity: 'four_monthly',
  changed: true,
  pending_reminders: 6,
  pending_obligations: 3,
};

const CALENDAR_SUMMARY = {
  status: 'generated',
  periodicity: 'four_monthly',
  obligations: 2,
  reminders_created: 4,
  reminders_scheduled: 0,
  pending_confirmation: 0,
  replaced: { obligations_cancelled: 3, reminders_removed: 6 },
  message:
    'Se retiraron 6 recordatorios del calendario anterior. Se agregaron 4 recordatorios a la bitácora con tus próximos vencimientos.',
};

/**
 * Cambio de periodicidad de IVA al guardar los datos legales (F3) y el resumen
 * del calendario tributario que vuelve con el guardado (F1).
 */
describe('FiscalIdentityPanelComponent — periodicidad de IVA y calendario', () => {
  let previewSpy: jasmine.Spy;
  let patchSpy: jasmine.Spy;
  let toastSuccess: jasmine.Spy;
  let previewResponse: FiscalCalendarChangePreview;

  function configure(fiscalPeriodicity: string | null = 'bimonthly') {
    previewSpy = jasmine.createSpy('preview').and.callFake(() => of({
      success: true,
      data: previewResponse,
    }));
    patchSpy = jasmine.createSpy('patch').and.returnValue(
      of({ fiscal_data: {}, fiscal_calendar: CALENDAR_SUMMARY }),
    );
    toastSuccess = jasmine.createSpy('success');

    const service = {
      getResponsibilitiesCatalog: () => of({ success: true, data: { version: 1, responsibilities: [] } }),
      getFiscalDataSettings: () =>
        of({
          fiscal_data: {
            nit: '900123459',
            nit_dv: '1',
            legal_name: 'Comercio de prueba',
            vat_periodicity: fiscalPeriodicity,
          },
        }),
      getFiscalCalendarChangePreview: previewSpy,
      patchFiscalDataSettings: patchSpy,
    };

    TestBed.configureTestingModule({
      imports: [FiscalIdentityPanelComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            pathFromRoot: [
              { snapshot: { data: { fiscalApiScope: 'store' } } },
            ],
          },
        },
        { provide: FiscalOperationsService, useValue: service },
        // El modal de re-escaneo del RUT vive en el template: sin su servicio
        // (que arrastra AuthFacade → NgRx Store) el spec no monta.
        {
          provide: RutScannerService,
          useValue: { scanRut: () => of({ status: 'unsupported' }) },
        },
        {
          provide: FiscalOperationsHeaderActionsService,
          useValue: { register: () => undefined, unregister: () => undefined },
        },
        {
          provide: ToastService,
          useValue: {
            success: toastSuccess,
            error: jasmine.createSpy('error'),
          },
        },
        {
          provide: CountryService,
          useValue: {
            getCountries: () => [{ code: 'CO', name: 'Colombia' }],
            getDepartments: () => Promise.resolve([{ id: 1, name: 'Bogotá D.C.' }]),
            getCitiesByDepartment: () => Promise.resolve([{ id: 1, name: 'Bogotá' }]),
          },
        },
        {
          provide: TenantFacade,
          useValue: {
            tenant: () => null,
            tenant$: { subscribe: () => ({ closed: true }) },
          },
        },
        {
          provide: CurrencyFormatService,
          useValue: {
            currencySymbol: () => '$',
            currencyFormatStyle: () => 'comma_dot',
            currencyDecimals: () => 0,
            loadCurrency: () => undefined,
            format: (v: number) => `$${v}`,
          },
        },
      ],
    });
  }

  async function mount(periodicity: string | null = 'bimonthly') {
    configure(periodicity);
    const fixture = TestBed.createComponent(FiscalIdentityPanelComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const panel = fixture.componentInstance;
    const form = fixture.debugElement.query(By.directive(LegalDataFormComponent))
      .componentInstance as LegalDataFormComponent;
    // Datos legales mínimos para que el formulario esté válido: aquí probamos
    // la decisión de periodicidad, no la validación (que tiene su propio spec).
    form.form.patchValue({
      nit: '900123459',
      nit_dv: computeNitDv('900123459') ?? '',
      legal_name: 'Comercio de prueba',
      fiscal_address: 'Calle 1 # 2-3',
      country: 'CO',
      department: 'Bogotá D.C.',
      city: 'Bogotá',
      municipality_code: '11001',
      tax_responsibilities: ['O-48'],
    });
    fixture.detectChanges();
    await fixture.whenStable();
    // El catálogo de ciudades llega async y deja `city` vacío: se repone y se
    // deja el formulario válido (aquí probamos la decisión, no la validación).
    form.form.controls.city.setValue('Bogotá');
    form.form.controls.department.setValue('Bogotá D.C.');
    fixture.detectChanges();
    panel.legalValid.set(form.form.valid);
    return { fixture, panel, form };
  }

  function choosePeriodicity(form: LegalDataFormComponent, value: string): void {
    form.form.controls.vat_periodicity.setValue(
      value as never,
    );
  }

  afterEach(() => TestBed.resetTestingModule());

  it('al cambiar la periodicidad pregunta antes de guardar cuánto se reemplazaría', async () => {
    previewResponse = PREVIEW_WITH_PENDING;
    const { panel, form } = await mount('bimonthly');

    choosePeriodicity(form, 'four_monthly');
    panel.save();

    expect(previewSpy).toHaveBeenCalledWith('store', 'four_monthly');
    expect(panel.calendarDialogOpen()).toBe(true);
    expect(panel.calendarPreview()).toEqual(PREVIEW_WITH_PENDING);
    // Nada se guardó todavía: la persona decide primero.
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('«reemplazar» guarda la nueva periodicidad con la decisión y cuenta lo que pasó en la bitácora', async () => {
    previewResponse = PREVIEW_WITH_PENDING;
    const { fixture, panel, form } = await mount('bimonthly');

    choosePeriodicity(form, 'four_monthly');
    panel.save();
    fixture.detectChanges();

    panel.onCalendarDecision('replace');
    fixture.detectChanges();

    expect(patchSpy).toHaveBeenCalledTimes(1);
    const body = patchSpy.calls.mostRecent().args[1] as Record<string, unknown>;
    expect(body['vat_calendar_change']).toBe('replace');
    expect(body['vat_periodicity']).toBe('four_monthly');
    expect(toastSuccess).toHaveBeenCalledWith(CALENDAR_SUMMARY.message);
  });

  it('«conservar» guarda la nueva periodicidad conservando los avisos anteriores', async () => {
    previewResponse = PREVIEW_WITH_PENDING;
    const { fixture, panel, form } = await mount('bimonthly');

    choosePeriodicity(form, 'four_monthly');
    panel.save();
    fixture.detectChanges();

    panel.onCalendarDecision('keep');
    fixture.detectChanges();

    const body = patchSpy.calls.mostRecent().args[1] as Record<string, unknown>;
    expect(body['vat_calendar_change']).toBe('keep');
  });

  it('sin avisos pendientes no pregunta: guarda de una vez y sin decisión', async () => {
    previewResponse = { ...PREVIEW_WITH_PENDING, pending_reminders: 0, pending_obligations: 0 };
    const { panel, form } = await mount('bimonthly');

    choosePeriodicity(form, 'four_monthly');
    panel.save();

    expect(panel.calendarDialogOpen()).toBe(false);
    const body = patchSpy.calls.mostRecent().args[1] as Record<string, unknown>;
    expect(body['vat_calendar_change']).toBeUndefined();
  });

  it('sin cambio de periodicidad no consulta el calendario', async () => {
    previewResponse = PREVIEW_WITH_PENDING;
    const { panel } = await mount('bimonthly');

    panel.save();

    expect(previewSpy).not.toHaveBeenCalled();
    expect(patchSpy).toHaveBeenCalledTimes(1);
  });

  it('la primera configuración (sin periodicidad previa) no pregunta nada', async () => {
    previewResponse = PREVIEW_WITH_PENDING;
    const { panel, form } = await mount(null);

    choosePeriodicity(form, 'bimonthly');
    panel.save();

    expect(previewSpy).not.toHaveBeenCalled();
    expect(patchSpy).toHaveBeenCalledTimes(1);
  });
});
