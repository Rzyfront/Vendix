import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { LegalDataFormComponent } from './legal-data-form.component';
import { CountryService } from '../../../../services/country.service';
import {
  FiscalResponsibilitiesCatalog,
  FiscalResponsibilityCatalogEntry,
} from '../../../../private/modules/fiscal-operations/interfaces/fiscal-operations.interface';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';

/**
 * Contrato DIAN-extendido del `LegalDataFormComponent`.
 *
 * Cubre los 4 invariantes que el step "Identidad" del wizard de activación
 * necesita cumplir para que el resolver estricto de `resolveTenantFiscalIdentity`
 * acepte el payload:
 *
 *  1. `municipality_code` se reporta como faltante cuando
 *     `requireMunicipalityCode=true` y el campo está vacío.
 *  2. Toggling O-48 hace visible el selector de periodicidad de IVA;
 *     apagarlo lo oculta.
 *  3. Los toggles de `is_withholding_agent` e `is_self_withholder`
 *     viajan ida y vuelta vía `getValue()`.
 *  4. `tax_responsibilities[]` deduplica al activar y persiste al desactivar.
 */
describe('LegalDataFormComponent — DIAN strict resolver contract', () => {
  const buildCountryServiceStub = () =>
    ({
      getCountries: () => [{ code: 'CO', name: 'Colombia' }],
      getDepartments: () =>
        Promise.resolve([{ id: 1, name: 'Bogotá D.C.' }]),
      getCitiesByDepartment: () =>
        Promise.resolve([{ id: 1, name: 'Bogotá' }]),
    }) as unknown as CountryService;

  let fixture: ComponentFixture<LegalDataFormComponent>;
  let component: LegalDataFormComponent;

  const CATALOG: FiscalResponsibilitiesCatalog = {
    version: 1,
    responsibilities: [
      {
        code: 'O-48',
        label: 'Responsable de IVA',
        description: 'Liquidación bimestral/cuatrimestral',
        effects: ['activa declaración de IVA'],
      },
      {
        code: 'O-49',
        label: 'No responsable de IVA',
        description: 'Excluyente con O-48',
        effects: [],
      },
      {
        code: 'R-99-PN',
        label: 'No aplica - Persona natural',
        description: '',
        effects: [],
      },
    ] satisfies FiscalResponsibilityCatalogEntry[],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LegalDataFormComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CountryService, useValue: buildCountryServiceStub() },
        // El árbol de imports del componente arrastra CurrencyFormatService,
        // que a su vez pide TenantFacade. Stub minimal para no requerir
        // NgRx en el spec.
        {
          provide: TenantFacade,
          useValue: {
            tenant: () => null,
            tenant$: { subscribe: () => ({ closed: true }) },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LegalDataFormComponent);
    component = fixture.componentInstance;
  });

  it('monta y emite un form inicial con vat_periodicity="" y toggles en false', () => {
    fixture.detectChanges();
    const value = component.getValue();
    expect(value.vat_periodicity).toBe('');
    expect(value.is_withholding_agent).toBe(false);
    expect(value.is_self_withholder).toBe(false);
    expect(value.tax_responsibilities).toEqual([]);
  });

  it('describeProblems reporta municipality_code cuando requireMunicipalityCode=true', () => {
    fixture.componentRef.setInput('requireMunicipalityCode', true);
    fixture.detectChanges();

    const problems = component.describeProblems();
    expect(problems).toContain('Código DANE del municipio');
  });

  it('describeProblems NO reporta municipality_code cuando requireMunicipalityCode=false', () => {
    fixture.componentRef.setInput('requireMunicipalityCode', false);
    fixture.detectChanges();

    const problems = component.describeProblems();
    expect(problems).not.toContain('Código DANE del municipio');
  });

  it('toggle de O-48 refleja en tax_responsibilities y limpia vat_periodicity al apagar', () => {
    fixture.detectChanges();

    component.onResponsibilityToggle('O-48', true);
    component.onResponsibilityToggle('R-99-PN', true);
    expect(component.getValue().tax_responsibilities).toEqual(['O-48', 'R-99-PN']);

    // Encender O-48 dos veces no duplica (dedup por Set).
    component.onResponsibilityToggle('O-48', true);
    expect(component.getValue().tax_responsibilities).toEqual(['O-48', 'R-99-PN']);

    // Apagar O-48 limpia vat_periodicity si estaba seteado.
    component.form.controls.vat_periodicity.setValue('bimonthly');
    expect(component.getValue().vat_periodicity).toBe('bimonthly');

    component.onResponsibilityToggle('O-48', false);
    expect(component.getValue().tax_responsibilities).toEqual(['R-99-PN']);
    expect(component.getValue().vat_periodicity).toBe('');
  });

  it('toggle de O-49 sincroniza tax_regime a SIMPLIFICADO y remueve O-48', () => {
    fixture.detectChanges();

    component.onResponsibilityToggle('O-48', true);
    expect(component.getValue().tax_regime).toBe('COMUN');
    expect(component.getValue().tax_responsibilities).toContain('O-48');

    component.onResponsibilityToggle('O-49', true);
    expect(component.getValue().tax_regime).toBe('SIMPLIFICADO');
    expect(component.getValue().tax_responsibilities).toContain('O-49');
    expect(component.getValue().tax_responsibilities).not.toContain('O-48');
  });

  it('toggles de is_withholding_agent / is_self_withholder round-trip vía getValue()', () => {
    fixture.detectChanges();

    component.onWithholdingAgentToggle(true);
    expect(component.getValue().is_withholding_agent).toBe(true);
    expect(component.isWithholdingAgentChecked()).toBe(true);

    component.onSelfWithholderToggle(true);
    expect(component.getValue().is_self_withholder).toBe(true);
    expect(component.isSelfWithholderChecked()).toBe(true);

    component.onWithholdingAgentToggle(false);
    expect(component.getValue().is_withholding_agent).toBe(false);
  });

  it('Normaliza vat_periodicity: cualquier valor fuera del set se serializa como ""', () => {
    fixture.detectChanges();
    // Forzamos un valor inválido (algo que el backend nunca debería mandar
    // pero que queremos blindar contra typos).
    (
      component.form.controls.vat_periodicity as unknown as {
        setValue: (v: unknown) => void;
      }
    ).setValue('weekly');
    expect(component.getValue().vat_periodicity).toBe('');

    component.form.controls.vat_periodicity.setValue('four_monthly');
    expect(component.getValue().vat_periodicity).toBe('four_monthly');
  });

  it('responsibilityEntries cae al respaldo cuando catalog es null', () => {
    fixture.detectChanges();
    const codes = component.responsibilityEntries().map((e) => e.code);
    // Respaldo incluye los códigos del RUT canónicos para el wizard.
    expect(codes).toContain('O-48');
    expect(codes).toContain('O-49');
    expect(codes).toContain('R-99-PN');
  });

  it('responsibilityEntries usa el catálogo inyectado cuando se pasa como input', () => {
    fixture.componentRef.setInput('catalog', CATALOG);
    fixture.detectChanges();
    const codes = component.responsibilityEntries().map((e) => e.code);
    expect(codes).toEqual(['O-48', 'O-49', 'R-99-PN']);
    // Y la descripción llega del catálogo, no del respaldo.
    expect(
      component.responsibilityEntries().find((e) => e.code === 'O-48')
        ?.description,
    ).toContain('bimestral');
  });

  it('vatConflict es true cuando O-48 y O-49 están ambos marcados', () => {
    fixture.detectChanges();

    component.form.controls.tax_responsibilities.setValue(['O-48', 'O-49']);
    expect(component.vatConflict()).toBe(true);

    component.onResponsibilityToggle('O-49', false);
    expect(component.vatConflict()).toBe(false);
  });

  describe('tax_responsibilities required post-F4', () => {
    it('el form es inválido cuando tax_responsibilities está vacío', () => {
      fixture.detectChanges();
      expect(component.form.controls.tax_responsibilities.valid).toBe(false);
    });

    it('el form es válido cuando tax_responsibilities tiene al menos un código', () => {
      fixture.detectChanges();
      component.form.controls.tax_responsibilities.setValue(['O-48']);
      expect(component.form.controls.tax_responsibilities.valid).toBe(true);
    });

    it('el form acepta un código O-49 sin O-48 para tenants no responsables', () => {
      fixture.detectChanges();
      component.form.controls.tax_responsibilities.setValue(['O-49']);
      expect(component.form.controls.tax_responsibilities.valid).toBe(true);
    });
  });
});