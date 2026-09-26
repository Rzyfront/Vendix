import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';

import { PaymentCollectorComponent } from './payment-collector.component';
import { PaymentModalComponent } from './payment-modal.component';
import { CurrencyFormatService } from '../../pipes/currency';
import { PaymentMethodsCatalogService } from '../../services/payment-methods-catalog.service';
import { PaymentMethodType, type PaymentMethod } from '../../models/payment-method.model';
import type { PaymentSubmit } from './payment-collector.model';

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

/** Mock espejo del bloque QUI-839 + los miembros que tocan el pipe `currency`
 * (loadCurrency), la directiva de inputs (currencyFormatStyle,
 * currencyDecimals) y el propio componente (currencySymbol). */
function buildMultiCurrencyMock() {
  return {
    format: (amount: number | string | null | undefined) => {
      const num = Number(amount) || 0;
      return `$${num.toLocaleString('es-CO')}`;
    },
    loadCurrency: () => Promise.resolve(null),
    currencySymbol: signal('$'),
    currencyDecimals: signal(0),
    currencyFormatStyle: signal('dot_comma'),
    currentCurrency: signal({
      code: 'COP',
      symbol: '$',
      decimal_places: 0,
      position: 'before',
      format_style: 'dot_comma',
    }),
    resolution: signal('resolved'),
  };
}

const multiCatalogMock = {
  getEnabledMethods: () => of([]),
};

const multiCashMethod: PaymentMethod = {
  id: '1',
  type: PaymentMethodType.CASH,
  name: 'Efectivo',
  icon: 'cash',
  enabled: true,
};

const multiCardMethod: PaymentMethod = {
  id: '2',
  type: PaymentMethodType.CARD,
  name: 'Tarjeta',
  icon: 'credit-card',
  enabled: true,
};

const multiTransferMethod: PaymentMethod = {
  id: '3',
  type: PaymentMethodType.BANK_TRANSFER,
  name: 'Transferencia',
  icon: 'bank',
  enabled: true,
  original: {
    custom_config: {
      accounts: [{ bank_account_id: 7, bank_name: 'Bancolombia', account_number: '123456' }],
    },
  },
};

describe('PaymentCollectorComponent — modo multi «Varios métodos» (Paso 5)', () => {
  let fixture: ComponentFixture<PaymentCollectorComponent>;
  let component: PaymentCollectorComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PaymentCollectorComponent],
      providers: [
        { provide: CurrencyFormatService, useValue: buildMultiCurrencyMock() },
        { provide: PaymentMethodsCatalogService, useValue: multiCatalogMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PaymentCollectorComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('amount', 100000);
    fixture.componentRef.setInput('paymentMethods', [
      multiCashMethod,
      multiCardMethod,
      multiTransferMethod,
    ]);
    fixture.componentRef.setInput('allowMultiTender', true);
    fixture.detectChanges();
  });

  it('gate: con Σ ≠ total el cobro queda bloqueado y se muestra «Falta»', () => {
    component.setMultiEnabled(true);
    fixture.detectChanges();
    expect(component.legs().length).toBe(1);

    component.setLegAmount(0, 20000);
    component.addLeg();
    component.setLegAmount(1, 79999);
    fixture.detectChanges();

    expect(component.remaining()).toBe(1);
    expect(component.isMultiValid()).toBe(false);
    // canSubmit() es la señal que deshabilita el botón del modal padre.
    expect(component.canSubmit()).toBe(false);
    const balance = fixture.debugElement.query(By.css('.pc-multi-balance'));
    expect(balance).toBeTruthy();
    expect(balance.nativeElement.textContent).toContain('Falta');
  });

  it('efectivo ya usado no reaparece en el selector de tramos', () => {
    component.setMultiEnabled(true);
    fixture.detectChanges();
    expect(component.legs()[0].methodType).toBe(PaymentMethodType.CASH);

    expect(component.directMethods().some((m) => m.type === PaymentMethodType.CASH)).toBe(false);

    component.addLeg();
    fixture.detectChanges();
    const selects = fixture.debugElement.queryAll(By.css('select.pc-multi-method'));
    expect(selects.length).toBe(2);
    const secondOptions = Array.from(selects[1].nativeElement.querySelectorAll('option')).map(
      (o) => (o as HTMLElement).textContent?.trim(),
    );
    expect(secondOptions).not.toContain('Efectivo');
    // El tramo propio conserva su efectivo seleccionado.
    expect(
      component.directMethodsForLeg(0).some((m) => m.type === PaymentMethodType.CASH),
    ).toBe(true);
  });

  it('20.000 en efectivo con recibido 50.000 muestra vuelto 30.000', () => {
    component.setMultiEnabled(true);
    component.setLegAmount(0, 20000);
    component.setLegReceived(0, 50000);
    fixture.detectChanges();

    const leg = component.legs()[0];
    expect(leg.methodType).toBe(PaymentMethodType.CASH);
    expect(leg.change).toBe(30000);
    expect(component.legChange(leg)).toBe(30000);
    const changeBox = fixture.debugElement.query(By.css('.change-display'));
    expect(changeBox).toBeTruthy();
    expect(changeBox.nativeElement.textContent).toContain('30.000');
  });

  it('1 tramo emite el payload clásico idéntico, sin `legs`', () => {
    const catalogCash = component
      .resolvedMethods()
      .find((m) => m.type === PaymentMethodType.CASH);
    expect(catalogCash).toBeDefined();
    component.selectMethod(catalogCash!);
    component.cashReceivedControl.setValue(100000);
    fixture.detectChanges();
    expect(component.canSubmit()).toBe(true);
    let singlePayload: PaymentSubmit | undefined;
    const sub1 = component.submit.subscribe((p) => {
      singlePayload = p;
    });
    component.triggerSubmit();
    sub1.unsubscribe();
    expect(singlePayload).toBeDefined();

    component.setMultiEnabled(true);
    fixture.detectChanges();
    expect(component.legs().length).toBe(1);
    expect(component.canSubmit()).toBe(true);
    let multiPayload: PaymentSubmit | undefined;
    const sub2 = component.submit.subscribe((p) => {
      multiPayload = p;
    });
    component.triggerSubmit();
    sub2.unsubscribe();

    expect(multiPayload).toBeDefined();
    expect('legs' in multiPayload!).toBe(false);
    expect(multiPayload).toEqual(singlePayload);
  });
});

describe('PaymentCollectorComponent — B15(1) setLegAmount no deja amountReceived obsoleto', () => {
  let fixture: ComponentFixture<PaymentCollectorComponent>;
  let component: PaymentCollectorComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PaymentCollectorComponent],
      providers: [
        { provide: CurrencyFormatService, useValue: buildMultiCurrencyMock() },
        { provide: PaymentMethodsCatalogService, useValue: multiCatalogMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PaymentCollectorComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('amount', 100000);
    fixture.componentRef.setInput('paymentMethods', [
      multiCashMethod,
      multiCardMethod,
      multiTransferMethod,
    ]);
    fixture.componentRef.setInput('allowMultiTender', true);
    fixture.detectChanges();
    component.setMultiEnabled(true);
    fixture.detectChanges();
  });

  it('bajar el monto de un tramo en efectivo sin edición manual arrastra el recibido hacia abajo (sin vuelto fantasma)', () => {
    component.setLegAmount(0, 50000);
    fixture.detectChanges();
    expect(component.legs()[0].amountReceived).toBe(50000);
    expect(component.legChange(component.legs()[0])).toBe(0);

    // Antes del fix: amountReceived se quedaba en 50000 al bajar el monto,
    // mostrando un vuelto de 30.000 que nunca se entregó.
    component.setLegAmount(0, 20000);
    fixture.detectChanges();
    expect(component.legs()[0].amountReceived).toBe(20000);
    expect(component.legChange(component.legs()[0])).toBe(0);
  });

  it('un recibido editado a mano se conserva mientras siga cubriendo el nuevo monto (más bajo)', () => {
    component.setLegAmount(0, 50000);
    component.setLegReceived(0, 80000);
    fixture.detectChanges();
    expect(component.legs()[0].amountReceived).toBe(80000);

    component.setLegAmount(0, 30000);
    fixture.detectChanges();
    expect(component.legs()[0].amountReceived).toBe(80000);
    expect(component.legChange(component.legs()[0])).toBe(50000);
  });

  it('un recibido editado a mano se sube si el nuevo monto lo supera (nunca queda por debajo)', () => {
    component.setLegAmount(0, 20000);
    component.setLegReceived(0, 25000);
    fixture.detectChanges();
    expect(component.legs()[0].amountReceived).toBe(25000);

    component.setLegAmount(0, 60000);
    fixture.detectChanges();
    expect(component.legs()[0].amountReceived).toBe(60000);
    expect(component.legChange(component.legs()[0])).toBe(0);
  });
});

describe('PaymentModalComponent — arbitraje NG8002 allowMultiTender (Paso 5c)', () => {
  let fixture: ComponentFixture<PaymentModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PaymentModalComponent],
      providers: [
        { provide: CurrencyFormatService, useValue: buildMultiCurrencyMock() },
        { provide: PaymentMethodsCatalogService, useValue: multiCatalogMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PaymentModalComponent);
  });

  afterEach(() => fixture.destroy());

  it('compila el binding [allowMultiTender] del modal y lo propaga al collector', () => {
    fixture.componentRef.setInput('amount', 100000);
    fixture.componentRef.setInput('paymentMethods', [multiCashMethod, multiCardMethod]);
    fixture.componentRef.setInput('allowMultiTender', true);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    const collectorEl = fixture.debugElement.query(By.directive(PaymentCollectorComponent));
    expect(collectorEl).toBeTruthy();
    const collector = collectorEl.componentInstance as PaymentCollectorComponent;
    expect(collector.config().allowMultiTender).toBe(true);
  });
});
