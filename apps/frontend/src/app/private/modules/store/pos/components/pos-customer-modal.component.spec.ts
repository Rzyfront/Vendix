import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';

import { PosCustomerModalComponent } from './pos-customer-modal.component';
import { PosCustomerService } from '../services/pos-customer.service';
import { PosQueueService } from '../services/pos-queue.service';
import { CustomersService } from '../../customers/services/customers.service';
import { DialogService, ToastService } from '../../../../../shared/components';
import { DocumentPrintService } from '../../../../../shared/services/print';
import { StoreContextService } from '../../../../../core/services/store-context.service';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { PosCustomer, PosCustomerAddress } from '../models/customer.model';

describe('PosCustomerModalComponent — búsqueda con una línea por establecimiento', () => {
  let fixture: ComponentFixture<PosCustomerModalComponent>;
  let component: PosCustomerModalComponent;
  let service: jasmine.SpyObj<PosCustomerService>;

  const sede = (id: number, label: string, is_primary = false): PosCustomerAddress => ({
    id, label, address_line1: `Calle ${id}`, city: 'Cali', country_code: 'CO', type: 'shipping', is_primary,
  });
  const customer = (id: number, name: string, addresses: PosCustomerAddress[]): PosCustomer => ({
    id, email: `c${id}@test.co`, first_name: name, addresses,
    created_at: new Date(), updated_at: new Date(),
  });
  const acme = customer(1, 'ACME', [sede(10, 'Sede Norte', true), sede(11, 'Sede Sur')]);
  const ana = customer(2, 'Ana', []);

  beforeEach(() => {
    service = jasmine.createSpyObj<PosCustomerService>('PosCustomerService', ['searchCustomers']);
    service.searchCustomers.and.returnValue(
      of({ data: [acme, ana], total: 2, page: 1, limit: 10, totalPages: 1 }),
    );
    TestBed.configureTestingModule({
      imports: [PosCustomerModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideMockStore({ initialState: { tenant: {} } }),
        { provide: PosCustomerService, useValue: service },
        { provide: CustomersService, useValue: {} },
        { provide: PosQueueService, useValue: {} },
        { provide: DocumentPrintService, useValue: {} },
        { provide: StoreContextService, useValue: {} },
        { provide: DialogService, useValue: {} },
        { provide: StoreSettingsFacade, useValue: { settings: signal(null) } },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('ToastService', ['success', 'error', 'info', 'warning']),
        },
      ],
    });
    fixture = TestBed.createComponent(PosCustomerModalComponent);
    component = fixture.componentInstance;
    // La búsqueda va con debounceTime(300): reloj simulado (sin zone.js).
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(2026, 10, 23));
  });

  afterEach(() => jasmine.clock().uninstall());
  const tick = (ms: number) => jasmine.clock().tick(ms);

  it('lista una línea por sede y al elegirla emite el cliente con esa sede', () => {
    component.onSearch('ac');
    tick(300);

    expect(component.searchRows().map((r) => r.key)).toEqual(['1-10', '1-11', '2']);

    // Elegir cierra el modal y limpia el listado: se guardan las filas antes.
    const rows = component.searchRows();
    const emitted: PosCustomer[] = [];
    component.customerSelected.subscribe((c) => emitted.push(c));
    component.selectRow(rows[1]);
    expect(emitted[0].preferred_address_id).toBe(11);

    component.selectRow(rows[2]);
    expect(emitted[1]).toBe(ana);
  });

  it('renderiza la sede en la fila del resultado', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    component.onSearch('ac');
    tick(300);
    fixture.detectChanges();

    const text = (document.body.textContent ?? '') + (fixture.nativeElement.textContent ?? '');
    expect(text).toContain('Sede Sur · Calle 11, Cali');
    expect(text).toContain('Principal');
  });
});
