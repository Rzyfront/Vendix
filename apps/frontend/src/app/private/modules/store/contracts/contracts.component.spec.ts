import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { ContractsComponent } from './contracts.component';
import { ContractsService } from './services/contracts.service';
import { CurrencyFormatService } from '../../../../shared/pipes/currency/currency.pipe';

describe('ContractsComponent — listado remoto', () => {
  let service: jasmine.SpyObj<ContractsService>;
  let fixture: ComponentFixture<ContractsComponent>;
  const authStub = {
    storeIndustries: signal(['construction']),
    userPermissions: signal(['store:quotations:create', 'store:contracts:create']),
    userRoles: signal([] as string[]),
  };
  const page = (data: any[], total = data.length, current = 1, limit = 10) => ({
    data,
    pagination: { total, page: current, limit, totalPages: Math.ceil(total / limit) },
  });

  beforeEach(async () => {
    authStub.storeIndustries.set(['construction']);
    authStub.userPermissions.set(['store:quotations:create', 'store:contracts:create']);
    authStub.userRoles.set([]);
    service = jasmine.createSpyObj<ContractsService>('ContractsService', ['getContracts']);
    service.getContracts.and.returnValue(of(page([])));
    await TestBed.configureTestingModule({
      imports: [ContractsComponent],
      providers: [
        provideZonelessChangeDetection(), provideRouter([]),
        { provide: ContractsService, useValue: service },
        { provide: CurrencyFormatService, useValue: { loadCurrency: () => undefined, format: (value: number) => String(value) } },
        { provide: AuthFacade, useValue: authStub },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ContractsComponent);
    fixture.detectChanges();
  });

  it('consulta página 1 del servidor, conserva total global y no deriva total del slice', () => {
    service.getContracts.and.returnValue(of(page([
      { id: 1, contract_number: 'CT-1', status: 'active', grand_total: null },
    ], 51)));
    fixture.componentInstance.reload();
    fixture.detectChanges();
    expect(service.getContracts).toHaveBeenCalledWith({ page: 1, limit: 10 });
    expect(fixture.componentInstance.totalItems()).toBe(51);
    expect(fixture.nativeElement.textContent).toContain('En esta página');
    expect(fixture.nativeElement.textContent).toContain('Total global');
    expect(fixture.nativeElement.querySelector('app-responsive-data-view')).toBeTruthy();
    service.getContracts.and.returnValue(of(page([
      { id: 51, contract_number: 'CT-51', status: 'active', grand_total: 100 },
    ], 51, 6)));
    fixture.componentInstance.onPageChange(6);
    fixture.detectChanges();
    expect(service.getContracts).toHaveBeenCalledWith({ page: 6, limit: 10 });
    expect(fixture.componentInstance.contracts()[0].contract_number).toBe('CT-51');
  });

  it('al buscar solicita al servidor y separa el estado sin resultados del vacío real', () => {
    service.getContracts.and.returnValue(of(page([])));
    fixture.componentInstance.onSearch('inexistente');
    fixture.detectChanges();
    expect(service.getContracts).toHaveBeenCalledWith({ page: 1, limit: 10, search: 'inexistente' });
    expect(fixture.nativeElement.textContent).toContain('Sin resultados');
    expect(fixture.nativeElement.textContent).not.toContain('Sin contratos');
  });

  it('cancela la respuesta anterior cuando cambia la búsqueda', () => {
    const stale = new Subject<any>();
    service.getContracts.and.returnValue(stale.asObservable());
    fixture.componentInstance.reload();
    service.getContracts.and.returnValue(of(page([
      { id: 2, contract_number: 'CT-nuevo', status: 'active' },
    ])));
    fixture.componentInstance.onSearch('nuevo');
    stale.next(page([{ id: 1, contract_number: 'CT-obsoleto', status: 'draft' }]));
    fixture.detectChanges();
    expect(fixture.componentInstance.contracts()[0].contract_number).toBe('CT-nuevo');
  });

  it('muestra el error HTTP y reintento en lugar de declarar vacío', () => {
    service.getContracts.and.returnValue(throwError(() => new Error('API no disponible')));
    fixture.componentInstance.reload();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No se pudieron cargar los contratos');
    expect(fixture.nativeElement.textContent).toContain('Reintentar');
    expect(fixture.nativeElement.textContent).not.toContain('Sin contratos');
  });

  it('distingue una respuesta vacía real y muestra la CTA permitida', () => {
    service.getContracts.and.returnValue(of(page([])));
    fixture.componentInstance.reload();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sin contratos');
    expect(fixture.nativeElement.textContent).not.toContain('No se pudieron cargar');
    expect(fixture.nativeElement.textContent).toContain('Cotizar contrato');
  });

  it('renderiza los valores congelados ausentes como No configurado en tarjetas móviles sin mutar el DTO y conserva cero', () => {
    const source = [
      { id: 1, contract_number: 'CT-NULL', status: 'active', contract_object: null, quotation_id: null, grand_total: null },
      { id: 2, contract_number: 'CT-ZERO', status: 'draft', contract_object: '', quotation_id: 0, grand_total: 0 },
    ];
    service.getContracts.and.returnValue(of(page(source)));
    fixture.componentInstance.reload();
    fixture.detectChanges();

    const cards = Array.from(fixture.nativeElement.querySelectorAll('.item-card')) as HTMLElement[];
    expect(cards.length).toBe(2);
    expect(cards[0].textContent).toContain('No configurado');
    expect(Array.from(cards[0].querySelectorAll('.detail-value')).map((node) => node.textContent?.trim()))
      .toContain('No configurado');
    expect(cards[0].querySelector('.footer-value')?.textContent?.trim()).toBe('No configurado');
    expect(cards[1].textContent).toContain('#0');
    expect(cards[1].textContent).toContain('0');
    expect(source[0].contract_object).toBeNull();
    expect(source[0].quotation_id).toBeNull();
    expect(source[0].grand_total).toBeNull();
  });

  it('expone el estado de carga y habilita limpiar filtros en resultados filtrados vacíos', () => {
    const pending = new Subject<any>();
    service.getContracts.and.returnValue(pending.asObservable());
    fixture.componentInstance.reload();
    fixture.detectChanges();
    const status = fixture.nativeElement.querySelector('[role="status"][aria-live="polite"]');
    expect(status).toBeTruthy();
    expect(status.textContent).toContain('Cargando contratos');

    service.getContracts.and.returnValue(of(page([])));
    fixture.componentInstance.onSearch('sin coincidencias');
    fixture.detectChanges();
    const clearButton = Array.from(fixture.nativeElement.querySelectorAll('button'))
      .find((button: any) => button.textContent.includes('Limpiar Filtros')) as HTMLButtonElement;
    expect(clearButton).toBeTruthy();
  });

  it('renderiza el dropdown estándar y ofrece Cotizar contrato sólo con industria y permisos vigentes', async () => {
    service.getContracts.and.returnValue(of(page([
      { id: 1, contract_number: 'CT-1', status: 'active', grand_total: 100 },
    ])));
    fixture.componentInstance.reload();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('app-options-dropdown').length).toBe(1);

    const actionsTrigger = fixture.nativeElement.querySelector('button[aria-label="Acciones"]') as HTMLButtonElement;
    expect(actionsTrigger).toBeTruthy();
    actionsTrigger.click();
    fixture.detectChanges();
    const action = Array.from(fixture.nativeElement.querySelectorAll('button'))
      .find((node: any) => node.textContent.includes('Cotizar contrato')) as HTMLButtonElement;
    expect(action).toBeTruthy();
    const router = TestBed.inject(Router);
    const navigateSpy = spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
    action.click();
    fixture.detectChanges();
    expect(navigateSpy).toHaveBeenCalledWith(['/admin/orders/quotations'], { queryParams: { destination: 'contract' } });

    authStub.userPermissions.set([]);
    authStub.userRoles.set([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Cotizar contrato');
    authStub.userRoles.set(['super_admin']);
    fixture.detectChanges();
    expect(fixture.componentInstance.dropdownActions().length).toBe(1);
    authStub.storeIndustries.set([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Cotizar contrato');
  });

  it('resetea a página 1 al filtrar desde OptionsDropdown y sincroniza clear con búsqueda', () => {
    fixture.componentInstance.page.set(4);
    service.getContracts.and.returnValue(of(page([])));
    fixture.componentInstance.onSearch('obra');
    fixture.componentInstance.onFilterChange({ status: 'active' });
    expect(service.getContracts).toHaveBeenCalledWith({ page: 1, limit: 10, search: 'obra', status: 'active' });
    fixture.componentInstance.clearFilters();
    expect(fixture.componentInstance.search()).toBe('');
    expect(fixture.componentInstance.statusFilter()).toBe('');
    expect(fixture.componentInstance.filterValues()).toEqual({ status: null });
    expect(service.getContracts).toHaveBeenCalledWith({ page: 1, limit: 10 });
  });
});
