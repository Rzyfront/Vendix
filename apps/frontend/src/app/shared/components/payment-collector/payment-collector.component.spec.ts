import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';

import { PaymentCollectorComponent } from './payment-collector.component';
import { CurrencyFormatService } from '../../pipes/currency';
import { PaymentMethodsCatalogService } from '../../services/payment-methods-catalog.service';

describe('PaymentCollectorComponent — QUI-839 Installment Options Formatting', () => {
  let fixture: ComponentFixture<PaymentCollectorComponent>;
  let component: PaymentCollectorComponent;

  const mockCurrencyService = {
    format: (amount: number | string | null | undefined) => {
      const num = Number(amount) || 0;
      return `$${num.toLocaleString('es-CO')}`;
    },
    currentCurrency: signal({
      code: 'COP',
      symbol: '$',
      decimal_places: 0,
      position: 'before',
      format_style: 'dot_comma',
    }),
    resolution: signal('resolved'),
  };

  const mockCatalog = {
    getEnabledMethods: () => of([]),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PaymentCollectorComponent],
      providers: [
        { provide: CurrencyFormatService, useValue: mockCurrencyService },
        { provide: PaymentMethodsCatalogService, useValue: mockCatalog },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PaymentCollectorComponent);
    component = fixture.componentInstance;
  });

  describe('formatInstallmentDate', () => {
    it('formatea fechas UTC en formato dd/MM/yyyy sin desfases de zona horaria', () => {
      expect(component.formatInstallmentDate('2026-10-13T00:00:00.000Z')).toBe('13/10/2026');
      expect(component.formatInstallmentDate('2026-04-05T00:00:00.000Z')).toBe('05/04/2026');
      expect(component.formatInstallmentDate('2026-01-01')).toBe('01/01/2026');
    });

    it('retorna string vacío para fechas nulas o inválidas', () => {
      expect(component.formatInstallmentDate(null)).toBe('');
      expect(component.formatInstallmentDate(undefined)).toBe('');
      expect(component.formatInstallmentDate('invalid-date')).toBe('');
    });
  });

  describe('installmentOptions computed', () => {
    it('formatea cuotas pendientes con Cuota #, fecha dd/MM/yyyy y monto sugerido', () => {
      const mockInstallments = [
        {
          id: 101,
          installment_number: 1,
          due_date: '2026-10-13T00:00:00.000Z',
          amount: 50000,
          remaining_balance: 50000,
          state: 'pending',
        },
        {
          id: 102,
          installment_number: 2,
          due_date: '2026-11-13T00:00:00.000Z',
          amount: 50000,
          remaining_balance: 50000,
          state: 'pending',
        },
      ];

      fixture.componentRef.setInput('installments', mockInstallments);
      fixture.detectChanges();

      const options = component.installmentOptions();
      expect(options.length).toBe(2);
      expect(options[0]).toEqual({
        value: 101,
        label: 'Cuota 1 - 13/10/2026 ($50.000)',
        amount: 50000,
        disabled: false,
      });
      expect(options[1]).toEqual({
        value: 102,
        label: 'Cuota 2 - 13/11/2026 ($50.000)',
        amount: 50000,
        disabled: false,
      });
    });

    it('marca cuotas pagadas como inhabilitadas con sufijo Pagada', () => {
      const mockInstallments = [
        {
          id: 201,
          installment_number: 1,
          due_date: '2026-09-13T00:00:00.000Z',
          amount: 50000,
          remaining_balance: 0,
          amount_paid: 50000,
          state: 'paid',
        },
      ];

      fixture.componentRef.setInput('installments', mockInstallments);
      fixture.detectChanges();

      const options = component.installmentOptions();
      expect(options[0]).toEqual({
        value: 201,
        label: 'Cuota 1 - 13/09/2026 ($50.000 - Pagada)',
        amount: 50000,
        disabled: true,
      });
    });

    it('marca cuotas condonadas como inhabilitadas con sufijo Condonada', () => {
      const mockInstallments = [
        {
          id: 301,
          installment_number: 3,
          due_date: '2026-12-13T00:00:00.000Z',
          amount: 50000,
          remaining_balance: 0,
          state: 'forgiven',
        },
      ];

      fixture.componentRef.setInput('installments', mockInstallments);
      fixture.detectChanges();

      const options = component.installmentOptions();
      expect(options[0]).toEqual({
        value: 301,
        label: 'Cuota 3 - 13/12/2026 ($50.000 - Condonada)',
        amount: 50000,
        disabled: true,
      });
    });

    it('muestra saldo pendiente sugerido en cuotas parciales', () => {
      const mockInstallments = [
        {
          id: 401,
          installment_number: 2,
          due_date: '2026-10-20T00:00:00.000Z',
          amount: 80000,
          remaining_balance: 30000,
          amount_paid: 50000,
          state: 'partial',
        },
      ];

      fixture.componentRef.setInput('installments', mockInstallments);
      fixture.detectChanges();

      const options = component.installmentOptions();
      expect(options[0]).toEqual({
        value: 401,
        label: 'Cuota 2 - 20/10/2026 ($30.000 pendiente)',
        amount: 80000,
        disabled: false,
      });
    });

    it('respeta label explícito si el objeto ya lo provee', () => {
      const mockInstallments = [
        {
          id: 501,
          label: 'Etiqueta Personalizada',
          amount: 25000,
        },
      ];

      fixture.componentRef.setInput('installments', mockInstallments);
      fixture.detectChanges();

      const options = component.installmentOptions();
      expect(options[0].label).toBe('Etiqueta Personalizada');
      expect(options[0].disabled).toBe(false);
    });
  });

  describe('interacción y selección de cuotas', () => {
    it('actualiza el monto de abono al seleccionar una cuota cuando allowAmountOverride es true', () => {
      const mockInstallments = [
        {
          id: 101,
          installment_number: 1,
          due_date: '2026-10-13T00:00:00.000Z',
          amount: 50000,
          remaining_balance: 35000,
          state: 'partial',
        },
      ];

      fixture.componentRef.setInput('context', 'order');
      fixture.componentRef.setInput('allowAmountOverride', true);
      fixture.componentRef.setInput('installments', mockInstallments);
      fixture.detectChanges();

      component.onInstallmentChange('101');
      expect(component.selectedInstallmentId()).toBe(101);
      expect(component.amountOverrideControl.value).toBe(35000);
    });

    it('restablece el monto sugerido a null cuando se selecciona la opción "0" (Selecciona una cuota…)', () => {
      const mockInstallments = [
        {
          id: 101,
          installment_number: 1,
          due_date: '2026-10-13T00:00:00.000Z',
          amount: 50000,
          remaining_balance: 50000,
          state: 'pending',
        },
      ];

      fixture.componentRef.setInput('context', 'order');
      fixture.componentRef.setInput('allowAmountOverride', true);
      fixture.componentRef.setInput('installments', mockInstallments);
      fixture.detectChanges();

      // Selecciona cuota
      component.onInstallmentChange('101');
      expect(component.selectedInstallmentId()).toBe(101);
      expect(component.amountOverrideControl.value).toBe(50000);

      // Deselecciona cuota
      component.onInstallmentChange('0');
      expect(component.selectedInstallmentId()).toBeNull();
      expect(component.amountOverrideControl.value).toBeNull();
    });

    it('renderiza las opciones estructuradas en el <select> del template con atributos disabled', () => {
      const mockInstallments = [
        {
          id: 10,
          installment_number: 1,
          due_date: '2026-10-13T00:00:00.000Z',
          amount: 50000,
          remaining_balance: 0,
          state: 'paid',
        },
        {
          id: 20,
          installment_number: 2,
          due_date: '2026-11-13T00:00:00.000Z',
          amount: 50000,
          remaining_balance: 50000,
          state: 'pending',
        },
      ];

      fixture.componentRef.setInput('installments', mockInstallments);
      fixture.detectChanges();

      const selectEl = fixture.debugElement.query(By.css('select[aria-label="Cuota a pagar"]'));
      expect(selectEl).toBeTruthy();

      const optionEls = selectEl.nativeElement.querySelectorAll('option');
      expect(optionEls.length).toBe(3);
      expect(optionEls[0].textContent.trim()).toBe('Selecciona una cuota…');
      expect(optionEls[1].textContent.trim()).toBe('Cuota 1 - 13/10/2026 ($50.000 - Pagada)');
      expect(optionEls[1].disabled).toBe(true);
      expect(optionEls[2].textContent.trim()).toBe('Cuota 2 - 13/11/2026 ($50.000)');
      expect(optionEls[2].disabled).toBe(false);
    });
  });
});
