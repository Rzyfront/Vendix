import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { QuotationFormModalComponent } from './quotation-form-modal.component';
import { QuotationsService } from '../../services/quotations.service';
import { QuotationProfilesService } from '../../services/quotation-profiles.service';
import { QuotationProfile } from '../../interfaces/quotation-profile.interface';
import { PosProductService } from '../../../pos/services/pos-product.service';
import { PriceTierCacheService } from '../../../price-tiers/services/price-tier-cache.service';
import { PriceResolverService } from '../../../../../../shared/services/pricing';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';

describe('QuotationFormModalComponent', () => {
  let quotations: jasmine.SpyObj<QuotationsService>;
  let profiles: jasmine.SpyObj<QuotationProfilesService>;

  function createComponent(destination: 'sale' | 'contract' = 'sale', quotation?: unknown) {
    const fixture = TestBed.createComponent(QuotationFormModalComponent);
    fixture.componentRef.setInput('initialDestination', destination);
    if (quotation !== undefined) fixture.componentRef.setInput('quotation', quotation);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    quotations = jasmine.createSpyObj<QuotationsService>('QuotationsService', [
      'getQuotationProfileCatalog', 'getQuotationProfileDetail',
    ]);
    quotations.getQuotationProfileCatalog.and.returnValue(of([]));
    quotations.getQuotationProfileDetail.and.returnValue(of({ current_config: {} }));
    profiles = jasmine.createSpyObj<QuotationProfilesService>('QuotationProfilesService', ['getCatalog', 'getProfile']);
    profiles.getCatalog.and.returnValue(of([]));
    profiles.getProfile.and.returnValue(of({
      id: 1, name: 'Base', state: 'active', is_default: false, current_version: 1,
      current_config: {}, created_at: '', updated_at: '',
    } satisfies QuotationProfile));
    TestBed.configureTestingModule({
      imports: [QuotationFormModalComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: QuotationsService, useValue: quotations },
        { provide: QuotationProfilesService, useValue: profiles },
        { provide: PosProductService, useValue: { searchProducts: () => of({ products: [] }) } },
        { provide: PriceTierCacheService, useValue: { getActiveTiers: () => of([]), getProductOverrides: () => of([]) } },
        { provide: PriceResolverService, useValue: {} },
        { provide: AuthFacade, useValue: { userPermissions: () => [], userRoles: () => [] } },
        { provide: CurrencyFormatService, useValue: { loadCurrency: () => undefined, format: (value: number) => String(value) } },
      ],
    });
  });

  it('requires a customer for contract quotes, includes a free line, blocks duplicate saves, and allows retry after failure', async () => {
    const fixture = createComponent('contract');
    const component = fixture.componentInstance;
    const emitted: unknown[] = [];
    component.save.subscribe((dto) => {
      emitted.push(dto);
      fixture.componentRef.setInput('saving', true);
      fixture.detectChanges();
      const request = emitted.length === 1
        ? throwError(() => new Error('temporary save failure'))
        : of(undefined);
      request.subscribe({
        error: () => {
          fixture.componentRef.setInput('saving', false);
          fixture.detectChanges();
        },
        complete: () => {
          fixture.componentRef.setInput('saving', false);
          fixture.detectChanges();
        },
      });
    });
    component.addCustomLine();
    const line = component.itemsArray.at(0);
    line.patchValue({ product_name: 'Mano de obra', unit_price: 120000, quantity: 1 });
    component.recalculateItem(0);

    component.onSave();
    expect(emitted).toHaveSize(0);
    expect(component.customerRequiredError()).toBeTrue();

    component.selectCustomer({ id: 42, first_name: 'Ada', last_name: 'Lovelace' });
    component.onSave();
    component.onSave();
    expect(emitted).toHaveSize(1);
    expect(emitted[0]).toEqual(jasmine.objectContaining({
      destination: 'contract',
      customer_id: 42,
      items: [jasmine.objectContaining({ product_name: 'Mano de obra', unit_price: 120000, total_price: 120000 })],
    }));
    await fixture.whenStable();
    component.onSave();
    expect(emitted).toHaveSize(2);
    await fixture.whenStable();
    fixture.destroy();
  });

  it('hydrates an edit from the complete quotation input and preserves existing customer and lines', () => {
    const quotation = {
      id: 9,
      destination: 'contract',
      profile_id: 3,
      notes: 'Saved note',
      terms_and_conditions: 'Saved terms',
      valid_until: '2026-12-31',
      customer_id: 42,
      customer: { id: 42, first_name: 'Ada', last_name: 'Lovelace' },
      quotation_items: [{ product_name: 'Cimentación', quantity: 2, unit_price: 500, total_price: 1000 }],
    };
    const fixture = createComponent('contract', quotation);
    const component = fixture.componentInstance;
    expect(component.form.getRawValue().destination).toBe('contract');
    expect(component.form.getRawValue().profile_id).toBe('3');
    expect(component.selectedCustomer()?.id).toBe(42);
    expect(component.itemsArray.length).toBe(1);
    expect(component.itemsArray.at(0).get('product_name')?.value).toBe('Cimentación');
    const profileSelect = fixture.nativeElement.querySelector('#quotation-profile') as HTMLSelectElement;
    const destinationSelect = fixture.nativeElement.querySelector('#quotation-destination') as HTMLSelectElement;
    expect(profileSelect.textContent).toContain('Perfil #3 (guardado)');
    expect(profileSelect.value).toBe('3');
    expect(profileSelect.disabled).toBeTrue();
    expect(destinationSelect.value).toBe('contract');
    expect(destinationSelect.disabled).toBeTrue();
    expect(profiles.getProfile).not.toHaveBeenCalled();
    expect(component.form.get('notes')?.value).toBe('Saved note');
    expect(component.form.get('terms_and_conditions')?.value).toBe('Saved terms');
    expect(component.form.get('valid_until')?.value).toBe('2026-12-31');
    fixture.destroy();
  });

  it('precarga only untouched profile terms and validity, without adding A/I/U to totals', () => {
    profiles.getProfile.and.returnValue(of({
      id: 4, name: 'Obra', state: 'active', is_default: false, current_version: 8,
      current_config: { notes: 'Nota perfil', payment_terms: 'Anticipo 30%', validity_days: 0, admin_percent: 10, contingency_percent: 5, profit_percent: 7 },
      created_at: '', updated_at: '',
    } satisfies QuotationProfile));
    const fixture = createComponent('contract');
    const component = fixture.componentInstance;
    component.quotationProfiles.set([{ id: 4, name: 'Obra' }]);
    component.form.get('notes')?.setValue('Nota manual');
    component.form.get('notes')?.markAsDirty();
    component.onProfileSelect({ target: { value: '4' } } as unknown as Event);
    expect(component.form.get('notes')?.value).toBe('Nota manual');
    expect(component.form.get('terms_and_conditions')?.value).toBe('Anticipo 30%');
    expect(component.form.get('valid_until')?.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(component.grandTotal()).toBe(0);
    expect(component.selectedProfileDetail()?.current_version).toBe(8);
    fixture.destroy();
  });
});
