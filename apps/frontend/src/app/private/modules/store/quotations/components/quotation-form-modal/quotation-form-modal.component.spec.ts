import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { Subject } from 'rxjs';
import { QuotationFormModalComponent } from './quotation-form-modal.component';
import { QuotationsService } from '../../services/quotations.service';
import { QuotationProfilesService } from '../../services/quotation-profiles.service';
import { InvoiceProfileService } from '../../../invoicing/services/invoice-profile.service';
import { QuotationProfile } from '../../interfaces/quotation-profile.interface';
import { PosProductService } from '../../../pos/services/pos-product.service';
import { PriceTierCacheService } from '../../../price-tiers/services/price-tier-cache.service';
import { PriceResolverService } from '../../../../../../shared/services/pricing';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';

describe('QuotationFormModalComponent', () => {
  let quotations: jasmine.SpyObj<QuotationsService>;
  let profiles: jasmine.SpyObj<QuotationProfilesService>;
  let invoiceProfiles: jasmine.SpyObj<InvoiceProfileService>;

  function createComponent(destination: 'sale' | 'contract' = 'sale', quotation?: unknown) {
    const fixture = TestBed.createComponent(QuotationFormModalComponent);
    fixture.componentRef.setInput('initialDestination', destination);
    if (quotation !== undefined) fixture.componentRef.setInput('quotation', quotation);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    quotations = jasmine.createSpyObj<QuotationsService>('QuotationsService', [
      'getQuotationProfileCatalog', 'getQuotationProfileDetail', 'previewContractEconomics',
    ]);
    quotations.getQuotationProfileCatalog.and.returnValue(of([]));
    quotations.getQuotationProfileDetail.and.returnValue(of({ current_config: {} }));
    quotations.previewContractEconomics.and.returnValue(of({
      schema_version: 1, frozen_at: '2026-10-10T00:00:00Z',
      invoice_profile: { profile_id: 8, version: 1, name: 'AIU', config: { aiu: { components_basis: 'aiu' } } },
      contract_object: 'Obra', aiu_value: '0.00', direct_cost: '100.00', contract_value: '100.00',
      invoice_lines: [], calculation: { totals: { gross_subtotal: '100.00', tax_amount: '0.00', total_amount: '100.00' } },
    } as any));
    profiles = jasmine.createSpyObj<QuotationProfilesService>('QuotationProfilesService', ['getCatalog', 'getProfile']);
    profiles.getCatalog.and.returnValue(of([]));
    profiles.getProfile.and.returnValue(of({
      id: 1, name: 'Base', state: 'active', is_default: false, current_version: 1,
      current_config: {}, created_at: '', updated_at: '',
    } satisfies QuotationProfile));
    invoiceProfiles = jasmine.createSpyObj<InvoiceProfileService>('InvoiceProfileService', ['catalog', 'getById']);
    invoiceProfiles.catalog.and.returnValue(of({ success: true, data: [] } as any));
    invoiceProfiles.getById.and.returnValue(of({ success: true, data: {
      id: 8, name: 'AIU', state: 'active', operation_type: '09', current_version: 1,
      current_config: { aiu: { components_basis: 'aiu' } },
    } as any } as any));
    TestBed.configureTestingModule({
      imports: [QuotationFormModalComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: QuotationsService, useValue: quotations },
        { provide: QuotationProfilesService, useValue: profiles },
        { provide: InvoiceProfileService, useValue: invoiceProfiles },
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
    component.invoiceProfileId.set(8);
    component.liveInvoiceProfile.set({
      state: 'active', operation_type: '09', current_config: { aiu: { components_basis: 'aiu' } },
    });
    component.form.get('aiu_value')?.setValue(0);
    component.contractPreview.set({
      schema_version: 1, frozen_at: '2026-10-10T00:00:00Z',
      invoice_profile: { profile_id: 8, version: 1, name: 'AIU', config: { aiu: { components_basis: 'aiu' } } } as any,
      contract_object: 'Obra', aiu_value: '0.00', direct_cost: '120000.00', contract_value: '120000.00',
      invoice_lines: [], calculation: { totals: { gross_subtotal: '120000.00', tax_amount: '0.00', total_amount: '120000.00' } },
    } as any);
    // This test supplies a settled server preview directly; the debounce path
    // itself is covered below with jasmine's clock, not Zone fakeAsync.
    component.previewPending.set(false);
    component.onSave();
    component.onSave();
    expect(emitted).toHaveSize(1);
    expect(emitted[0]).toEqual(jasmine.objectContaining({
      destination: 'contract',
      customer_id: 42,
      aiu_value: 0,
      items: [jasmine.objectContaining({ product_name: 'Mano de obra', unit_price: 120000, total_price: 120000 })],
    }));
    await fixture.whenStable();
    component.onSave();
    expect(emitted).toHaveSize(2);
    await fixture.whenStable();
    fixture.destroy();
  });

  it('does not infer a fiscal profile from catalog ordering when no default is marked', () => {
    invoiceProfiles.catalog.and.returnValue(of({ success: true, data: [
      { id: 12, name: 'Perfil primero', operation_type: '09', is_default: false, current_version: 2 },
      { id: 13, name: 'Perfil segundo', operation_type: '09', is_default: false, current_version: 1 },
    ] } as any));
    const fixture = createComponent('contract');
    const component = fixture.componentInstance;
    expect(component.invoiceProfileId()).toBeNull();
    expect(component.previewPending()).toBeFalse();
    expect(quotations.previewContractEconomics).not.toHaveBeenCalled();
    expect(invoiceProfiles.getById).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('blocks a contract save while its server preview is pending, then preserves an explicit zero AIU', () => {
    jasmine.clock().install();
    const fixture = createComponent('contract');
    const component = fixture.componentInstance;
    const emitted: any[] = [];
    component.save.subscribe((dto) => emitted.push(dto));
    component.selectCustomer({ id: 42, first_name: 'Ada', last_name: 'Lovelace' });
    component.invoiceProfileId.set(8);
    component.liveInvoiceProfile.set({
      state: 'active', operation_type: '09', current_config: { aiu: { components_basis: 'aiu' } },
    });
    component.form.patchValue({ contract_object: 'Obra acordada', aiu_value: 0 });
    component.addCustomLine();
    component.itemsArray.at(0).patchValue({ product_name: 'Costo', unit_price: 100 });
    component.recalculateItem(0);
    component.requestContractPreview();
    expect(component.previewPending()).toBeTrue();
    component.onSave();
    expect(emitted).toHaveSize(0);
    jasmine.clock().tick(300);
    expect(component.contractPreview()).toBeTruthy();
    component.onSave();
    expect(emitted).toHaveSize(1);
    expect(emitted[0].aiu_value).toBe(0);
    fixture.destroy();
    jasmine.clock().uninstall();
  });

  it('keeps sales out of invoice-profile APIs and never sends contract fiscal fields', () => {
    const fixture = createComponent('sale');
    const component = fixture.componentInstance;
    const emitted: any[] = [];
    component.save.subscribe((dto) => emitted.push(dto));
    component.addCustomLine();
    component.itemsArray.at(0).patchValue({ product_name: 'Venta', unit_price: 25 });
    component.recalculateItem(0);
    component.onSave();
    expect(invoiceProfiles.catalog).not.toHaveBeenCalled();
    expect(invoiceProfiles.getById).not.toHaveBeenCalled();
    expect(emitted[0]).not.toEqual(jasmine.objectContaining({
      invoice_profile_id: jasmine.anything(), contract_object: jasmine.anything(), aiu_value: jasmine.anything(), due_date: jasmine.anything(),
    }));
    fixture.destroy();
  });

  it('keeps a frozen contract profile without a live fetch unless the user explicitly refreshes it', () => {
    const frozen = {
      schema_version: 1, frozen_at: '2026-10-01T00:00:00Z',
      invoice_profile: { profile_id: 8, version: 3, name: 'AIU', config: { aiu: { components_basis: 'aiu' } } },
      contract_object: 'Obra', due_date: null, aiu_value: '0.00', direct_cost: '100.00', contract_value: '100.00',
      invoice_lines: [], calculation: { totals: {} },
    };
    const fixture = createComponent('contract', {
      id: 10, destination: 'contract', invoice_profile_id: 8, contract_economic_snapshot: frozen,
      quotation_items: [{ product_name: 'Costo', quantity: 1, unit_price: 100, discount_amount: 0, total_price: 100 }],
    });
    const component = fixture.componentInstance;
    expect(invoiceProfiles.getById).not.toHaveBeenCalled();
    expect(component.selectedInvoiceProfileConfig()).toEqual(frozen.invoice_profile.config);
    const currentConfig = { aiu: { components_basis: 'contract', accounting_model: 'no_sumada' } };
    invoiceProfiles.getById.and.returnValue(of({ success: true, data: {
      id: 8, name: 'AIU', state: 'active', operation_type: '09', current_version: 4,
      current_config: currentConfig,
    } as any } as any));
    component.useCurrentInvoiceProfile();
    expect(invoiceProfiles.getById).toHaveBeenCalledOnceWith(8);
    expect(component.selectedInvoiceProfileConfig()).toEqual(currentConfig);
    fixture.destroy();
  });

  it('omits frozen economics on a notes-only edit so the backend preserves the exact snapshot', () => {
    const frozen = {
      schema_version: 1, frozen_at: '2026-10-01T00:00:00Z',
      invoice_profile: { profile_id: 8, version: 3, name: 'AIU', config: { aiu: { components_basis: 'aiu' } } },
      contract_object: 'Obra', due_date: null, aiu_value: '0.00', direct_cost: '100.00', contract_value: '100.00',
      invoice_lines: [], calculation: { totals: {} },
    };
    const fixture = createComponent('contract', {
      id: 10, destination: 'contract', invoice_profile_id: 8, contract_economic_snapshot: frozen,
      notes: 'Antes', customer_id: 42, customer: { id: 42, first_name: 'Ada', last_name: 'Lovelace' },
      quotation_items: [{ product_name: 'Costo', quantity: 1, unit_price: 100, discount_amount: 0, total_price: 100 }],
    });
    const emitted: any[] = [];
    fixture.componentInstance.save.subscribe((dto) => emitted.push(dto));
    fixture.componentInstance.form.get('notes')?.setValue('Después');
    fixture.componentInstance.onSave();
    expect(emitted[0]).toEqual(jasmine.objectContaining({ notes: 'Después' }));
    for (const key of ['items', 'invoice_profile_id', 'contract_object', 'aiu_value', 'due_date']) {
      expect(Object.prototype.hasOwnProperty.call(emitted[0], key)).withContext(key).toBeFalse();
    }
    fixture.destroy();
  });

  it('cancels stale contract-preview responses when newer cost input is requested', () => {
    jasmine.clock().install();
    const fixture = createComponent('contract');
    const component = fixture.componentInstance;
    const stale = new Subject<any>();
    const latest = {
      schema_version: 1, frozen_at: '2026-10-10T00:00:00Z',
      invoice_profile: { profile_id: 8, version: 1, name: 'AIU', config: { aiu: { components_basis: 'contract' } } },
      contract_object: 'Obra', aiu_value: '12.00', direct_cost: '100.00', contract_value: '112.00',
      invoice_lines: [], calculation: { totals: { total_amount: '112.00' } },
    };
    quotations.previewContractEconomics.and.returnValues(stale.asObservable(), of(latest as any));
    component.invoiceProfileId.set(8);
    component.liveInvoiceProfile.set({ state: 'active', operation_type: '09', current_config: { aiu: { components_basis: 'contract' } } });
    component.addCustomLine();
    component.itemsArray.at(0).patchValue({ product_name: 'Costo', unit_price: 100 });
    component.requestContractPreview();
    jasmine.clock().tick(250);
    expect(quotations.previewContractEconomics).toHaveBeenCalledTimes(1);
    component.form.get('contract_object')?.setValue('Objeto nuevo');
    jasmine.clock().tick(250);
    expect(quotations.previewContractEconomics).toHaveBeenCalledTimes(2);
    stale.next({ ...latest, contract_value: '999.00' });
    expect(component.contractPreview()?.contract_value).toBe('112.00');
    fixture.destroy();
    jasmine.clock().uninstall();
  });

  it('ignores a late profile lookup after a newer billing profile was selected', () => {
    const fixture = createComponent('contract');
    const component = fixture.componentInstance;
    const stale = new Subject<any>();
    invoiceProfiles.getById.and.returnValues(
      stale.asObservable(),
      of({ success: true, data: { id: 9, name: 'Vigente', state: 'active', operation_type: '09', current_version: 2, current_config: { aiu: { components_basis: 'contract' } } } as any } as any),
    );
    component.onInvoiceProfileSelect({ target: { value: '8' } } as unknown as Event);
    component.onInvoiceProfileSelect({ target: { value: '9' } } as unknown as Event);
    stale.next({ success: true, data: { id: 8, name: 'Anterior', state: 'active', operation_type: '09', current_version: 1, current_config: { aiu: { components_basis: 'aiu' } } } });
    expect(component.invoiceProfileId()).toBe(9);
    expect(component.selectedInvoiceProfileConfig()).toEqual({ aiu: { components_basis: 'contract' } });
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
