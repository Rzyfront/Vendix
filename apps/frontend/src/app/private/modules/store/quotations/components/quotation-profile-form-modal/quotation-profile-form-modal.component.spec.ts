import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { QuotationProfile } from '../../interfaces/quotation-profile.interface';
import { QuotationProfilesService } from '../../services/quotation-profiles.service';
import { QuotationProfileFormModalComponent } from './quotation-profile-form-modal.component';

const profile: QuotationProfile = {
  id: 12, name: 'Obra norte', state: 'active', is_default: true, current_version: 3,
  current_config: { admin_percent: 4, contingency_percent: 0, payment_terms: 'Anticipo' },
  created_at: '2026-01-01', updated_at: '2026-01-01',
};

describe('QuotationProfileFormModalComponent', () => {
  let fixture: ComponentFixture<QuotationProfileFormModalComponent>;
  let service: jasmine.SpyObj<QuotationProfilesService>;
  let auth: { hasPermission: jasmine.Spy };

  beforeEach(async () => {
    service = jasmine.createSpyObj<QuotationProfilesService>('QuotationProfilesService', ['create', 'update']);
    service.create.and.returnValue(of(profile));
    service.update.and.returnValue(of(profile));
    auth = { hasPermission: jasmine.createSpy().and.returnValue(true) };
    await TestBed.configureTestingModule({
      imports: [QuotationProfileFormModalComponent],
      providers: [
        { provide: QuotationProfilesService, useValue: service },
        { provide: AuthFacade, useValue: auth },
        { provide: CurrencyFormatService, useValue: { currencyFormatStyle: () => 'dot_comma', currencyDecimals: () => 2, format: (value: number) => String(value), loadCurrency: () => undefined } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(QuotationProfileFormModalComponent);
    fixture.detectChanges();
  });

  it('normalizes whitespace and omits blank optional values while retaining explicit zeroes', () => {
    const component = fixture.componentInstance;
    component.open();
    component.form.patchValue({
      name: '  Obra   norte  ', admin_percent: '0', contingency_percent: null,
      profit_percent: '', validity_days: '0', payment_terms: '   ', notes: '',
    });
    component.save();
    expect(service.create).toHaveBeenCalledWith({ name: 'Obra norte', config: { admin_percent: 0, validity_days: 0 } });
    expect(component.isOpen()).toBeFalse();
  });

  it('renders labeled form sections in the standard order with only cancel and save in the footer', () => {
    const component = fixture.componentInstance;
    component.open();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const content = root.textContent ?? '';
    expect(content.indexOf('Datos generales')).toBeLessThan(content.indexOf('Porcentajes comerciales'));
    expect(content.indexOf('Porcentajes comerciales')).toBeLessThan(content.indexOf('Condiciones y notas'));
    expect(content.indexOf('Condiciones y notas')).toBeLessThan(content.indexOf('Cancelar'));
    expect(root.querySelectorAll('app-input').length).toBe(5);
    expect(content).toContain('Nombre');
    expect(content).toContain('Vigencia (días)');
    expect(content).toContain('Condiciones de pago');
    expect(content).toContain('Notas');
    const footer = root.querySelector('[slot="footer"]');
    expect(footer?.textContent).toContain('Cancelar');
    expect(footer?.textContent).toContain('Guardar');
    expect(footer?.textContent).not.toContain('Crear perfil');
  });

  it('rejects out-of-range percentages and fractional validity days', () => {
    const component = fixture.componentInstance;
    component.open();
    component.form.patchValue({ name: 'Obra', admin_percent: '101', validity_days: '1.5' });
    component.save();
    expect(component.form.controls.admin_percent.invalid).toBeTrue();
    expect(component.form.controls.validity_days.invalid).toBeTrue();
    expect(service.create).not.toHaveBeenCalled();
  });

  it('rechecks exact permissions inside the submit handler instead of relying on visible UI', () => {
    const component = fixture.componentInstance;
    component.open();
    component.form.controls.name.setValue('No autorizado');
    auth.hasPermission.and.returnValue(false);
    component.save();
    expect(service.create).not.toHaveBeenCalled();
    expect(component.errorMessage()).toContain('permiso');

    auth.hasPermission.and.callFake((permission: string) => permission !== 'store:quotations:update');
    component.open(profile);
    component.save();
    expect(service.update).not.toHaveBeenCalled();
  });

  it('updates with a full name/config payload and never sends state or default state', () => {
    const component = fixture.componentInstance;
    component.open(profile);
    component.form.controls.name.setValue('Obra actualizada');
    component.form.controls.admin_percent.setValue('0');
    component.save();
    expect(service.update).toHaveBeenCalledWith(12, {
      name: 'Obra actualizada', config: { admin_percent: 0, contingency_percent: 0, payment_terms: 'Anticipo' },
    });
    const body = service.update.calls.mostRecent().args[1];
    expect('state' in body).toBeFalse();
    expect('is_default' in body).toBeFalse();
  });

  it('blocks duplicate submission and close while busy, then permits retry after an error', () => {
    const component = fixture.componentInstance;
    component.open();
    component.form.controls.name.setValue('Perfil temporal');
    const request = new Subject<QuotationProfile>();
    service.create.and.returnValue(request as Observable<QuotationProfile>);
    component.save();
    component.save();
    expect(service.create).toHaveBeenCalledTimes(1);
    expect(component.isSaving()).toBeTrue();
    component.close();
    expect(component.isOpen()).toBeTrue();
    request.next(profile);
    request.complete();
    expect(component.isSaving()).toBeFalse();
    expect(component.isOpen()).toBeFalse();

    component.open();
    component.form.controls.name.setValue('Perfil reintentado');
    service.create.and.returnValues(throwError(() => new Error('fallo de red')), of(profile));
    component.save();
    expect(component.errorMessage()).toContain('fallo de red');
    expect(component.isOpen()).toBeTrue();
    component.save();
    expect(service.create).toHaveBeenCalledTimes(3);
    expect(component.isOpen()).toBeFalse();
  });
});
