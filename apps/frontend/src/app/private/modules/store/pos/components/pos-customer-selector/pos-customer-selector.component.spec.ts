import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';

import { PosCustomerSelectorComponent } from './pos-customer-selector.component';
import { PosCustomerService } from '../../services/pos-customer.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { PosCustomer, PosCustomerAddress } from '../../models/customer.model';

describe('PosCustomerSelectorComponent — una línea por establecimiento', () => {
  let fixture: ComponentFixture<PosCustomerSelectorComponent>;
  let component: PosCustomerSelectorComponent;
  let service: jasmine.SpyObj<PosCustomerService>;

  const sede = (id: number, label: string | null, is_primary = false): PosCustomerAddress => ({
    id,
    label,
    address_line1: `Calle ${id}`,
    city: 'Bogotá',
    country_code: 'CO',
    type: 'shipping',
    is_primary,
  });
  const customer = (id: number, name: string, addresses: PosCustomerAddress[]): PosCustomer => ({
    id,
    email: `c${id}@test.co`,
    first_name: name,
    document_type: 'NIT',
    document_number: `900${id}`,
    addresses,
    created_at: new Date(),
    updated_at: new Date(),
  });
  const acme = customer(1, 'ACME', [sede(10, 'Sede Norte', true), sede(11, 'Sede Sur')]);
  const juan = customer(2, 'Juan', [sede(20, 'Casa', true)]);
  const ana = customer(3, 'Ana', []);
  const luis = customer(4, 'Luis', []);

  const mount = (split: boolean, results: PosCustomer[]) => {
    service.searchCustomers.and.returnValue(
      of({ data: results, total: results.length, page: 1, limit: 10, totalPages: 1 }),
    );
    fixture = TestBed.createComponent(PosCustomerSelectorComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('splitByEstablishment', split);
    fixture.componentRef.setInput('initialView', 'search');
    fixture.detectChanges();
    component.onSearch('ac');
    fixture.detectChanges();
  };
  const rowButtons = (): HTMLButtonElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('button.customer-result'));

  beforeEach(() => {
    service = jasmine.createSpyObj<PosCustomerService>('PosCustomerService', [
      'searchCustomers',
      'topCustomers',
      'resolveCustomer',
    ]);
    service.topCustomers.and.returnValue(of([]));
    TestBed.configureTestingModule({
      imports: [PosCustomerSelectorComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: PosCustomerService, useValue: service },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('ToastService', ['success', 'error', 'info', 'warning']),
        },
      ],
    });
  });

  it('divide al cliente con 2+ sedes en una línea por sede y deja igual al de 0/1', () => {
    mount(true, [acme, juan]);

    expect(component.resultRows().map((r) => r.key)).toEqual(['1-10', '1-11', '2']);
    const rows = rowButtons();
    expect(rows.length).toBe(3);
    expect(rows[0].textContent).toContain('ACME');
    expect(rows[0].textContent).toContain('Sede Norte');
    expect(rows[0].textContent).toContain('Principal');
    expect(rows[1].textContent).toContain('Sede Sur');
    expect(rows[2].querySelector('.result-establishment')).toBeNull();
  });

  it('elegir una línea de sede emite el cliente con preferred_address_id', () => {
    mount(true, [acme, juan]);
    const emitted: PosCustomer[] = [];
    component.customerSelected.subscribe((c) => emitted.push(c));

    rowButtons()[1].click();
    expect(emitted.length).toBe(1);
    expect(emitted[0].id).toBe(1);
    expect(emitted[0].preferred_address_id).toBe(11);
  });

  it('elegir un cliente sin sedes divididas lo emite tal cual (sin preferred_address_id)', () => {
    mount(true, [acme, juan]);
    const emitted: PosCustomer[] = [];
    component.customerSelected.subscribe((c) => emitted.push(c));

    rowButtons()[2].click();
    expect(emitted[0]).toBe(juan);
    expect(emitted[0].preferred_address_id).toBeUndefined();
  });

  it('sin sedes divididas conserva el tope de 3 clientes y el aviso de "más"', () => {
    mount(true, [ana, juan, luis, customer(5, 'Eva', [])]);
    expect(component.resultRows().length).toBe(3);
    expect(component.resultsOverflow()).toBe(1);
  });

  it('con sedes divididas sube el tope a 5 líneas y cuenta las líneas restantes', () => {
    const big = customer(6, 'Big', [1, 2, 3, 4, 5, 6].map((n) => sede(60 + n, `Sede ${n}`)));
    mount(true, [big]);
    expect(component.resultRows().length).toBe(5);
    expect(component.resultsOverflow()).toBe(1);
  });

  it('sin el opt-in (hospitalidad/mesas) sigue siendo una línea por cliente', () => {
    mount(false, [acme, juan]);
    expect(component.resultRows().map((r) => r.key)).toEqual(['1', '2']);
    expect(fixture.nativeElement.querySelector('.result-establishment')).toBeNull();
  });

  it('la tarjeta del cliente elegido muestra la sede elegida', () => {
    mount(true, []);
    fixture.componentRef.setInput('selectedCustomer', { ...acme, preferred_address_id: 11 });
    component.back();
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('.selected-customer') as HTMLElement;
    expect(card.textContent).toContain('Sede Sur · Calle 11, Bogotá');
  });
});
