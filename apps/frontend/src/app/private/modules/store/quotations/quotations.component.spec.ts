import { Component, input, output, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, NEVER, of, throwError } from 'rxjs';
import { QuotationsComponent } from './quotations.component';
import { QuotationsService } from './services/quotations.service';
import { ContractsService } from '../contracts/services/contracts.service';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { DialogService } from '../../../../shared/components/dialog/dialog.service';
import { Quotation, CreateQuotationDto, QuotationFormSaveDto } from './interfaces/quotation.interface';
import { StatsComponent } from '../../../../shared/components/stats/stats.component';
import { QuotationListComponent } from './components/quotation-list/quotation-list.component';
import { QuotationFormModalComponent } from './components/quotation-form-modal/quotation-form-modal.component';
import { FilterValues } from '../../../../shared/components/options-dropdown/options-dropdown.interfaces';

@Component({ selector: 'app-stats', standalone: true, template: '' })
class StatsStubComponent {
  title = input(''); value = input<string | number>(''); smallText = input('');
  iconName = input(''); iconBgColor = input(''); iconColor = input(''); loading = input(false);
}

@Component({ selector: 'app-quotation-list', standalone: true, template: '' })
class QuotationListStubComponent {
  quotations = input<Quotation[]>([]); loading = input(false); showContractAction = input(false);
  canCreateQuotation = input(false); canReadProfiles = input(false); canCreateFromQuotation = input(false);
  canConvertToOrder = input(false); canMutateQuotation = input(false); canUpdateContractQuotation = input(false);
  canDeleteQuotation = input(false);
  viewDetail = output<Quotation>(); send = output<Quotation>(); accept = output<Quotation>();
  reject = output<Quotation>(); cancel = output<Quotation>(); convert = output<Quotation>();
  duplicate = output<Quotation>(); deleteQuotation = output<Quotation>(); edit = output<Quotation>();
  create = output<void>(); createContract = output<void>(); createFromQuotation = output<Quotation>();
  manageProfiles = output<void>(); search = output<string>(); filterChange = output<FilterValues>();
}

@Component({ selector: 'app-quotation-form-modal', standalone: true, template: '' })
class QuotationFormModalStubComponent {
  quotation = input<Quotation | null>(null); initialDestination = input<'sale' | 'contract' | 'other'>('sale');
  saving = input(false); save = output<QuotationFormSaveDto>(); close = output<void>();
}

describe('QuotationsComponent — contract quotation flow', () => {
  let quotations: jasmine.SpyObj<QuotationsService>;
  let contracts: jasmine.SpyObj<ContractsService>;
  let router: jasmine.SpyObj<Router>;
  let dialog: jasmine.SpyObj<DialogService>;
  let permissions: string[];
  let industries: string[];
  let permissionState: WritableSignal<string[]>;
  let industryState: WritableSignal<string[]>;
  let routeParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  const quotation = (overrides: Partial<Quotation> = {}): Quotation => ({
    id: 7, store_id: 1, quotation_number: 'COT-007', status: 'accepted', destination: 'contract',
    channel: 'admin', subtotal_amount: 100, discount_amount: 0, tax_amount: 0, shipping_cost: 0,
    grand_total: 100, created_at: '', updated_at: '', quotation_items: [], ...overrides,
  });

  function create() {
    const fixture = TestBed.createComponent(QuotationsComponent);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    permissions = ['store:quotations:create', 'store:quotations:update', 'store:quotations:read:one', 'store:quotations:convert', 'store:contracts:create'];
    industries = ['construction'];
    permissionState = signal(permissions);
    industryState = signal(industries);
    quotations = jasmine.createSpyObj<QuotationsService>('QuotationsService', [
      'getQuotationStats', 'getQuotations', 'getQuotationById', 'createQuotation', 'updateQuotation', 'convertToOrder', 'invalidateCache',
    ]);
    quotations.getQuotationStats.and.returnValue(of({ total: 0, pending: 0, conversion_rate: 0, average_value: 0, draft: 0, sent: 0, accepted: 0, converted: 0 }));
    quotations.getQuotations.and.returnValue(of({ data: [], pagination: { total: 0, page: 1, limit: 50, totalPages: 0 } }));
    contracts = jasmine.createSpyObj<ContractsService>('ContractsService', ['createFromQuotation']);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    dialog = jasmine.createSpyObj<DialogService>('DialogService', ['confirm']);
    dialog.confirm.and.resolveTo(true);
    routeParams = new BehaviorSubject(convertToParamMap({}));
    TestBed.configureTestingModule({
      imports: [QuotationsComponent],
      providers: [
        { provide: QuotationsService, useValue: quotations },
        { provide: ContractsService, useValue: contracts },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: { queryParamMap: routeParams.asObservable(), snapshot: { queryParamMap: convertToParamMap({}) } } },
        { provide: AuthFacade, useValue: {
          userPermissions: () => permissionState(),
          userRoles: () => [],
          storeIndustries: () => industryState(),
        } },
        { provide: DialogService, useValue: dialog },
        { provide: ToastService, useValue: jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info', 'warning']) },
      ],
    });
    TestBed.overrideComponent(QuotationsComponent, {
      remove: { imports: [StatsComponent, QuotationListComponent, QuotationFormModalComponent] },
      add: { imports: [StatsStubComponent, QuotationListStubComponent, QuotationFormModalStubComponent] },
    });
  });

  it('consumes the contract destination query once and opens the gated form', () => {
    routeParams.next(convertToParamMap({ destination: 'contract' }));
    const fixture = create();
    expect(fixture.componentInstance.quotationModalOpen()).toBeTrue();
    expect(fixture.componentInstance.initialDestination()).toBe('contract');
    expect(router.navigate).toHaveBeenCalledWith([], jasmine.objectContaining({
      queryParams: { destination: null }, replaceUrl: true,
    }));
    fixture.destroy();
  });

  it('navigates to the saved quotation after create/update', () => {
    const saved = quotation({ id: 55, destination: 'sale' });
    quotations.createQuotation.and.returnValue(of(saved));
    const fixture = create();
    const dto: CreateQuotationDto = { destination: 'sale', items: [{ product_name: 'Item', quantity: 1, unit_price: 100, total_price: 100 }] };
    fixture.componentInstance.saveQuotation(dto);
    expect(quotations.createQuotation).toHaveBeenCalledWith(dto);
    expect(router.navigate).toHaveBeenCalledWith(['/admin/orders/quotations', 55]);
    fixture.destroy();
  });

  it('keeps the existing contract customer and never rewrites destination/profile on draft update', () => {
    const existing = quotation({ id: 21, status: 'draft', destination: 'contract', customer_id: 42, profile_id: 3 });
    quotations.updateQuotation.and.returnValue(of(existing));
    const fixture = create();
    fixture.componentInstance.selectedQuotation.set(existing);
    fixture.componentInstance.saveQuotation({
      destination: 'contract', profile_id: 3,
      items: [{ product_name: 'Trabajo', quantity: 1, unit_price: 100, total_price: 100 }],
    });
    const updateBody = quotations.updateQuotation.calls.mostRecent().args[1];
    expect('destination' in updateBody).toBeFalse();
    expect('profile_id' in updateBody).toBeFalse();
    expect(quotations.updateQuotation).toHaveBeenCalledWith(21, updateBody);
    fixture.destroy();
  });

  it('accepts a notes-only frozen-contract update without sending lines or fiscal inputs', () => {
    const frozen = {
      schema_version: 1 as const, frozen_at: '2026-10-01T00:00:00Z',
      invoice_profile: { profile_id: 8, version: 3, name: 'AIU', config: {} as any },
      contract_object: 'Obra', due_date: null, aiu_value: '0.00', direct_cost: '100.00', contract_value: '100.00',
      invoice_lines: [], calculation: { totals: {
        gross_subtotal: '100.00', discount_amount: '0.00', tax_amount: '0.00', total_amount: '100.00',
      } },
    };
    const existing = quotation({
      id: 31, status: 'draft', customer_id: 42, invoice_profile_id: 8,
      contract_economic_snapshot: frozen,
    });
    quotations.updateQuotation.and.returnValue(of(existing));
    const fixture = create();
    fixture.componentInstance.selectedQuotation.set(existing);
    fixture.componentInstance.saveQuotation({ notes: 'Nota revisada' });
    const updateBody = quotations.updateQuotation.calls.mostRecent().args[1];
    expect(updateBody).toEqual({ notes: 'Nota revisada' });
    fixture.destroy();
  });

  it('keeps the ordinary new-quotation entry routed to POS', () => {
    const fixture = create();
    fixture.componentInstance.navigateToQuotationMode();
    expect(router.navigate).toHaveBeenCalledWith(['/admin/pos'], { queryParams: { mode: 'quotation' } });
    expect(contracts.createFromQuotation).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('never converts a contract quote to an order', async () => {
    const fixture = create();
    await fixture.componentInstance.onConvert(quotation());
    expect(quotations.convertToOrder).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('routes a duplicate-contract conflict to its existing contract and refreshes quotation cache', async () => {
    const conflict = Object.assign(new Error('Already converted'), { code: 'QUOTE_CONTRACT_001', details: { contract_id: 91 } });
    contracts.createFromQuotation.and.returnValue(throwError(() => conflict));
    const fixture = create();
    await fixture.componentInstance.createContractFromAccepted(quotation());
    expect(contracts.createFromQuotation).toHaveBeenCalledOnceWith(7);
    expect(quotations.invalidateCache).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/admin/orders/contracts', 91]);
    fixture.destroy();
  });

  it('locks duplicate contract requests before confirmation resolves', async () => {
    let resolveConfirmation: (value: boolean) => void = () => undefined;
    dialog.confirm.and.returnValue(new Promise<boolean>((resolve) => { resolveConfirmation = resolve; }));
    contracts.createFromQuotation.and.returnValue(NEVER);
    const fixture = create();
    const component = fixture.componentInstance;
    const first = component.createContractFromAccepted(quotation());
    const second = component.createContractFromAccepted(quotation());
    expect(dialog.confirm).toHaveBeenCalledTimes(1);
    resolveConfirmation(true);
    await Promise.all([first, second]);
    expect(contracts.createFromQuotation).toHaveBeenCalledOnceWith(7);
    fixture.destroy();
  });

  it('requires construction and both create permissions before exposing contract quotation entry', () => {
    const fixture = create();
    expect(fixture.componentInstance.canCreateContractQuotation()).toBeTrue();
    permissions = ['store:quotations:create'];
    permissionState.set(permissions);
    expect(fixture.componentInstance.canCreateContractQuotation()).toBeFalse();
    industries = ['retail'];
    industryState.set(industries);
    permissions = ['store:quotations:create', 'store:contracts:create'];
    permissionState.set(permissions);
    expect(fixture.componentInstance.canCreateContractQuotation()).toBeFalse();
    fixture.destroy();
  });
});
