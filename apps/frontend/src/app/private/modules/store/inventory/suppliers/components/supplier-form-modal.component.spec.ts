import { Component, input, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { SupplierFormModalComponent } from './supplier-form-modal.component';
import {
  AddressFormFieldsComponent,
  AddressPayload,
} from '../../../../../../shared/components/address-form-fields/address-form-fields.component';
import { CurrencyService } from '../../../../../../services/currency.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { Supplier } from '../../interfaces';

/** Stand-in: the real one needs HTTP/geocoding and is covered by its own spec. */
@Component({ selector: 'app-address-form-fields', standalone: true, template: '' })
class AddressFormFieldsStub {
  readonly initialAddress = input<AddressPayload | null>(null);
  readonly showPhone = input<boolean>(true);
  readonly addressChange = output<AddressPayload>();
}

describe('SupplierFormModalComponent — datos fiscales', () => {
  let fixture: ComponentFixture<SupplierFormModalComponent>;
  let component: SupplierFormModalComponent;

  const supplier = {
    id: 9,
    code: 'P-9',
    name: 'Proveedor Nueve',
    state: 'active',
    tax_id: '900123456',
    document_type: '31',
    verification_digit: '7',
    addresses: {
      id: 4,
      address_line1: 'Calle 10 # 5-20',
      city: 'Medellín',
      state_province: 'Antioquia',
      country_code: 'CO',
      municipality_code: '05001',
    },
  } as Supplier;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SupplierFormModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: CurrencyService,
          useValue: { getActiveCurrencies: () => Promise.resolve([]) },
        },
        { provide: CurrencyFormatService, useValue: { currencyCode: () => 'COP' } },
      ],
    })
      .overrideComponent(SupplierFormModalComponent, {
        remove: { imports: [AddressFormFieldsComponent] },
        add: { imports: [AddressFormFieldsStub] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(SupplierFormModalComponent);
    component = fixture.componentInstance;
  });

  async function open(sup: Supplier | null) {
    fixture.componentRef.setInput('supplier', sup);
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('prefills document type, DV and the address when editing', async () => {
    await open(supplier);

    expect(component.form.get('document_type')?.value).toBe('31');
    expect(component.form.get('verification_digit')?.value).toBe('7');
    expect(component.form.get('verification_digit')?.enabled).toBeTrue();
    expect(component.initialAddress()).toEqual(
      jasmine.objectContaining({
        address_line1: 'Calle 10 # 5-20',
        city: 'Medellín',
        municipality_code: '05001',
      }),
    );
  });

  it('save emits document_type, DV and address (municipality_code included)', async () => {
    await open(supplier);
    const emitted: any[] = [];
    component.save.subscribe((v) => emitted.push(v));

    component.onAddressChange({
      address_line1: 'Carrera 7 # 1-1',
      address_line2: null,
      city: 'Bogotá D.C.',
      state_province: 'Bogotá D.C.',
      country_code: 'CO',
      postal_code: null,
      phone_number: null,
      latitude: null,
      longitude: null,
      municipality_code: '11001',
    });
    component.onSubmit();

    expect(emitted.length).toBe(1);
    expect(emitted[0].document_type).toBe('31');
    expect(emitted[0].verification_digit).toBe('7');
    expect(emitted[0].address).toEqual({
      address_line1: 'Carrera 7 # 1-1',
      address_line2: undefined,
      city: 'Bogotá D.C.',
      state_province: 'Bogotá D.C.',
      country_code: 'CO',
      postal_code: undefined,
      municipality_code: '11001',
    });
  });

  it('DV is only enabled for NIT and is not sent for other document types', async () => {
    await open(supplier);
    const emitted: any[] = [];
    component.save.subscribe((v) => emitted.push(v));

    component.form.get('document_type')!.setValue('13');
    expect(component.form.get('verification_digit')?.disabled).toBeTrue();
    component.onSubmit();

    expect(emitted[0].document_type).toBe('13');
    expect('verification_digit' in emitted[0]).toBeFalse();
  });

  it('a supplier without fiscal data sends none of the new fields', async () => {
    await open({ id: 1, code: 'P-1', name: 'Sin datos', state: 'active' } as Supplier);
    const emitted: any[] = [];
    component.save.subscribe((v) => emitted.push(v));

    component.onSubmit();

    expect('document_type' in emitted[0]).toBeFalse();
    expect('verification_digit' in emitted[0]).toBeFalse();
    expect('address' in emitted[0]).toBeFalse();
  });
});
