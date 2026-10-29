import { of } from 'rxjs';
import { PriceTierCacheService } from '../../../price-tiers/services';
import { PriceTier } from '../../../price-tiers/interfaces';
import { Component, input, output, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CustomerModalComponent } from './customer-modal.component';
import { CustomersService } from '../../services/customers.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  AddressFormFieldsComponent,
  type AddressPayload,
} from '../../../../../../shared/components';
import type { Customer, CreateCustomerRequest } from '../../models/customer.model';

/**
 * Sustituto del formulario de dirección: el real pide catálogos DANE y
 * geocoding por HTTP. El modal sólo consume sus outputs, que aquí se simulan
 * escribiendo addressValid/addressPayload directamente.
 */
@Component({
  selector: 'app-address-form-fields',
  standalone: true,
  template: '',
})
class AddressFormFieldsStubComponent {
  readonly initialAddress = input<AddressPayload | null>(null);
  readonly compact = input<boolean>(false);
  readonly showPhone = input<boolean>(true);
  readonly showErrors = input<boolean>(false);
  readonly addressChange = output<AddressPayload>();
  readonly validChange = output<boolean>();
}

const ADDRESS: AddressPayload = {
  address_line1: 'Calle 10 # 5-20',
  address_line2: null,
  city: 'Bogotá, D.C.',
  state_province: 'Bogotá, D.C.',
  country_code: 'CO',
  postal_code: null,
  phone_number: null,
  latitude: null,
  longitude: null,
  municipality_code: '11001',
};

const TIERS = [
  { id: 1, name: 'Mayorista', kind: 'customer_tier', is_active: true, discount_percentage: 10 },
  { id: 2, name: 'Bulto', kind: 'sale_unit', is_active: true, discount_percentage: 0 },
] as PriceTier[];

describe('CustomerModalComponent', () => {
  let fixture: ComponentFixture<CustomerModalComponent>;
  let component: CustomerModalComponent;
  let toast: jasmine.SpyObj<ToastService>;

  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const open = async (
    opts: {
      customer?: Customer | null;
      initialValues?: Partial<CreateCustomerRequest> | null;
    } = {},
  ) => {
    fixture = TestBed.createComponent(CustomerModalComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('customer', opts.customer ?? null);
    fixture.componentRef.setInput('initialValues', opts.initialValues ?? null);
    fixture.componentRef.setInput('isOpen', true);
    await settle();
  };

  const fillNaturalBasics = () => {
    component.form.patchValue({
      person_type: 'NATURAL',
      first_name: 'María',
      last_name: 'Rodríguez',
    });
  };

  beforeEach(async () => {
    toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'warning', 'info']);
    await TestBed.configureTestingModule({
      imports: [CustomerModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: CustomersService,
          useValue: jasmine.createSpyObj('CustomersService', [
            'createCustomerAddress',
            'updateCustomerAddress',
          ]),
        },
        { provide: ToastService, useValue: toast },
        {
          provide: PriceTierCacheService,
          useValue: { getActiveTiers: () => of(TIERS) },
        },
        {
          provide: CurrencyFormatService,
          useValue: {
            loadCurrency: () => undefined,
            currencyFormatStyle: () => 'dot_comma',
            currencyDecimals: () => 0,
            format: (v: number) => `$${Math.round(v)}`,
          },
        },
      ],
    })
      .overrideComponent(CustomerModalComponent, {
        remove: { imports: [AddressFormFieldsComponent] },
        add: { imports: [AddressFormFieldsStubComponent] },
      })
      .compileComponents();
  });

  afterEach(() => fixture?.destroy());

  describe('modo rápido', () => {
    it('el correo vacío no invalida (nombre, apellido y teléfono válidos)', async () => {
      await open();
      expect(component.mode()).toBe('quick');
      fillNaturalBasics();
      component.form.patchValue({ email: '', phone: '3001234567' });
      await settle();
      expect(component.form.controls['email'].valid).toBeTrue();
      expect(component.quickFormInvalid()).toBeFalse();
    });
  });

  describe('validadores por modo', () => {
    it('switchToAdvanced: correo requerido, teléfono opcional', async () => {
      await open();
      component.switchToAdvanced();
      component.form.patchValue({ email: '', phone: '' });
      const email = component.form.controls['email'];
      const phone = component.form.controls['phone'];
      expect(email.invalid).toBeTrue();
      expect(email.hasError('required')).toBeTrue();
      expect(phone.valid).toBeTrue();
    });

    it('advanced: tipo y número de documento obligatorios; quick: opcionales', async () => {
      await open();
      component.switchToAdvanced();
      fillNaturalBasics();
      component.form.patchValue({ document_type: 'CC' });
      await settle();
      expect(component.form.controls['document_number'].hasError('required')).toBeTrue();
      component.form.patchValue({ document_type: null });
      await settle();
      expect(component.form.controls['document_type'].hasError('required')).toBeTrue();

      component.switchToQuick();
      await settle();
      expect(component.form.controls['document_type'].valid).toBeTrue();
    });

    it('switchToQuick tras advanced: correo vuelve a opcional y teléfono a requerido', async () => {
      await open();
      component.switchToAdvanced();
      component.switchToQuick();
      component.form.patchValue({ email: '', phone: '' });
      expect(component.form.controls['email'].valid).toBeTrue();
      expect(component.form.controls['phone'].hasError('required')).toBeTrue();
    });
  });

  describe('Más datos', () => {
    it('está plegado por defecto', async () => {
      await open();
      component.switchToAdvanced();
      await settle();
      expect(component.showMoreData()).toBeFalse();
    });

    it('se despliega solo si un campo propio queda inválido y tocado (CIIU)', async () => {
      await open();
      component.switchToAdvanced();
      const ciiu = component.form.controls['ciiu_code'];
      ciiu.setValue('abc');
      expect(component.showMoreData()).toBeFalse();
      ciiu.markAsTouched();
      expect(component.showMoreData()).toBeTrue();
    });

    it('se despliega solo si el teléfono queda inválido y tocado', async () => {
      await open();
      component.switchToAdvanced();
      const phone = component.form.controls['phone'];
      phone.setValue('123');
      phone.markAsTouched();
      expect(component.showMoreData()).toBeTrue();
    });
  });

  describe('prefill', () => {
    it('edición de un cliente sin correo arranca en advanced con el correo en rojo', async () => {
      await open({
        customer: {
          id: 9,
          email: '',
          first_name: 'Ana',
          last_name: 'Pérez',
          phone: '3001234567',
          person_type: 'NATURAL',
          document_type: 'CC',
          document_number: '1020304050',
        } as unknown as Customer,
      });
      expect(component.mode()).toBe('advanced');
      const email = component.form.controls['email'];
      expect(email.touched).toBeTrue();
      expect(email.invalid).toBeTrue();
      expect(component.getFieldError('email')).toBe(
        'El correo es obligatorio para facturar electrónicamente',
      );
    });

    it('initialValues en crear siguen en el formulario', async () => {
      await open({
        initialValues: {
          person_type: 'JURIDICA',
          document_type: 'NIT',
          document_number: '900123456',
          legal_name: 'Acme S.A.S',
        },
      });
      await settle();
      const raw = component.form.getRawValue();
      expect(raw.document_number).toBe('900123456');
      expect(raw.legal_name).toBe('Acme S.A.S');
    });
  });

  describe('onSubmit en modo completo', () => {
    const fillValidAdvanced = async () => {
      component.switchToAdvanced();
      fillNaturalBasics();
      component.form.patchValue({ email: 'maria@ejemplo.com', phone: '' });
      component.form.patchValue({ document_type: 'CC' });
      await settle();
      component.form.patchValue({ document_number: '1020304050' });
      await settle();
      expect(component.form.valid).toBeTrue();
    };

    it('sin dirección válida no emite save', async () => {
      await open();
      await fillValidAdvanced();
      const saveSpy = jasmine.createSpy('save');
      const addressSpy = jasmine.createSpy('addressData');
      component.save.subscribe(saveSpy);
      component.addressData.subscribe(addressSpy);
      component.addressValid.set(false);

      component.onSubmit();

      expect(saveSpy).not.toHaveBeenCalled();
      expect(addressSpy).not.toHaveBeenCalled();
      expect(component.submitAttempted()).toBeTrue();
      expect(toast.error).toHaveBeenCalledWith(
        'Completa la dirección fiscal y el municipio DIAN.',
      );
    });

    it('con dirección válida emite addressData y save con las mismas claves de siempre', async () => {
      await open();
      await fillValidAdvanced();
      const order: string[] = [];
      const saves: CreateCustomerRequest[] = [];
      const addresses: AddressPayload[] = [];
      component.save.subscribe((data) => {
        order.push('save');
        saves.push(data);
      });
      component.addressData.subscribe((data) => {
        order.push('address');
        addresses.push(data);
      });
      component.addressValid.set(true);
      component.addressPayload.set(ADDRESS);

      component.onSubmit();

      expect(order).toEqual(['address', 'save']);
      expect(addresses[0]).toEqual(ADDRESS);
      const saved = saves[0];
      // La tarifa preferencial solo viaja si la ficha de clientes la muestra.
      expect(Object.keys(saved).sort()).toEqual(
        Object.keys(component.form.getRawValue())
          .filter((key) => key !== 'price_tier_id')
          .sort(),
      );
      expect(Object.keys(saved).sort()).toEqual(
        [
          'email',
          'first_name',
          'last_name',
          'legal_name',
          'phone',
          'document_type',
          'document_number',
          'verification_digit',
          'ciiu_code',
          'tax_regime',
          'person_type',
          'is_withholding_agent',
          'fiscal_responsibilities',
        ].sort(),
      );
      expect(saved.email).toBe('maria@ejemplo.com');
    });
  });

  describe('tarifa preferencial', () => {
    const quickSave = () => {
      const saves: CreateCustomerRequest[] = [];
      component.save.subscribe((data) => saves.push(data));
      fillNaturalBasics();
      component.form.patchValue({ phone: '3001234567' });
      component.onSubmit();
      return saves;
    };

    it('fuera de la ficha de clientes no se muestra ni viaja', async () => {
      await open();
      expect(fixture.nativeElement.textContent).not.toContain('Tarifa preferencial');
      expect(quickSave()[0]).not.toEqual(
        jasmine.objectContaining({ price_tier_id: jasmine.anything() }),
      );
    });

    it('en la ficha de clientes se elige una tarifa de cliente y se guarda', async () => {
      fixture = TestBed.createComponent(CustomerModalComponent);
      component = fixture.componentInstance;
      fixture.componentRef.setInput('showPriceTier', true);
      fixture.componentRef.setInput('isOpen', true);
      await settle();

      expect(fixture.nativeElement.textContent).toContain('Tarifa preferencial');
      expect(component.priceTierOptions().map((o) => o.label)).toEqual([
        'Sin tarifa',
        'Mayorista',
      ]);
      component.form.patchValue({ price_tier_id: 1 });
      expect(quickSave()[0].price_tier_id).toBe(1);
    });

    it('editar un cliente con tarifa la precarga y "Sin tarifa" la quita (null)', async () => {
      fixture = TestBed.createComponent(CustomerModalComponent);
      component = fixture.componentInstance;
      fixture.componentRef.setInput('showPriceTier', true);
      fixture.componentRef.setInput('customer', {
        id: 5,
        first_name: 'Ana',
        last_name: 'Díaz',
        price_tier_id: 1,
      } as Customer);
      fixture.componentRef.setInput('isOpen', true);
      await settle();

      expect(component.form.get('price_tier_id')?.value).toBe(1);
      component.form.patchValue({ price_tier_id: '' });
      const raw = component.form.getRawValue();
      expect(raw.price_tier_id).toBe('');
    });
  });

  describe('vexiFillForm', () => {
    it('en modo completo no reporta válido sin dirección', async () => {
      await open();
      component.switchToAdvanced();
      const result = component.vexiFillForm({
        person_type: 'NATURAL',
        first_name: 'María',
        last_name: 'Rodríguez',
        email: 'maria@ejemplo.com',
      });
      expect(result.valid).toBeFalse();
      expect(result.validation_errors.some((e) => e.field === 'address')).toBeTrue();
    });
  });
});
