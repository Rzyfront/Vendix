import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Component, input, output, signal } from '@angular/core';
import { of } from 'rxjs';
import { Store } from '@ngrx/store';

import { PosOrderConfirmationComponent } from './pos-order-confirmation.component';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { PosTicketService } from '../services/pos-ticket.service';
import { RepartosService } from '../../../store-delivery/services/repartos.service';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { DispatchTicketPrintService } from '../../dispatch-ticket/services/dispatch-ticket-print.service';
import { PosFiscalStatus } from '../services/pos-fiscal.service';

@Component({ selector: 'app-modal', standalone: true, template: `<ng-content></ng-content><ng-content select="[slot=footer]"></ng-content>` })
class ModalStub {
  readonly isOpen = input(false);
  readonly size = input('md');
  readonly showCloseButton = input(true);
  readonly title = input('');
  readonly subtitle = input('');
  readonly closed = output<void>();
}

@Component({ selector: 'app-button', standalone: true, template: `<button (click)="clicked.emit()"><ng-content></ng-content></button>` })
class ButtonStub {
  readonly variant = input('primary');
  readonly size = input('md');
  readonly fullWidth = input(false);
  readonly disabled = input(false);
  readonly loading = input(false);
  readonly title = input('');
  readonly clicked = output<void>();
}

@Component({ selector: 'app-icon', standalone: true, template: `` })
class IconStub {
  readonly name = input('');
  readonly size = input(16);
}

@Component({ selector: 'app-invoicing-not-configured', standalone: true, template: `` })
class InvoicingNotConfiguredStub {
  readonly isOpen = input(false);
  readonly reason = input('missing');
}

@Component({ selector: 'app-pos-fiscal-status', standalone: true, template: `` })
class PosFiscalStatusStub {
  readonly orderId = input<number | null>(null);
  readonly autoLoad = input(true);
  readonly statusChanged = output<PosFiscalStatus>();
}

describe('PosOrderConfirmationComponent — Auto-print & Fiscal Sync (CP-pos-fe-autoprint-sync)', () => {
  let component: PosOrderConfirmationComponent;
  let fixture: ComponentFixture<PosOrderConfirmationComponent>;

  let mockAuthFacade: any;
  let mockToastService: any;
  let mockTicketService: any;
  let mockRepartosService: any;
  let mockCurrencyService: any;
  let mockStoreSettingsFacade: any;
  let mockStore: any;
  let mockDispatchTicketPrint: any;

  const activeFiscalAreasSignal = signal<string[]>(['invoicing']);
  const storeSettingsSignal = signal<any>({
    invoicing: { pos: { auto_emit: true } },
    receipts: { print_pos_ticket: true },
  });

  beforeEach(async () => {
    mockAuthFacade = {
      getCurrentUser: jasmine.createSpy('getCurrentUser').and.returnValue({ first_name: 'Cajero', last_name: 'Test' }),
      printsVatBreakdown: signal(true),
      activeFiscalAreas: activeFiscalAreasSignal,
      hasPermission: jasmine.createSpy('hasPermission').and.returnValue(true),
      fiscalData: signal(null),
      userOrganization: signal(null),
    };

    mockToastService = {
      success: jasmine.createSpy('success'),
      warning: jasmine.createSpy('warning'),
      error: jasmine.createSpy('error'),
      info: jasmine.createSpy('info'),
    };

    mockTicketService = {
      shouldAutoPrint: jasmine.createSpy('shouldAutoPrint').and.returnValue(true),
      printTicket: jasmine.createSpy('printTicket').and.returnValue(of(true)),
    };

    mockRepartosService = {
      publishToPool: jasmine.createSpy('publishToPool').and.returnValue(of({ success: true })),
    };

    mockCurrencyService = {
      loadCurrency: jasmine.createSpy('loadCurrency'),
      format: jasmine.createSpy('format').and.callFake((val: number) => `$${val}`),
    };

    mockStoreSettingsFacade = {
      settings: storeSettingsSignal,
      receipts: signal({ print_dispatch_ticket_enabled: false }),
      pos: signal({ auto_print_receipt: true }),
    };

    mockStore = {
      select: jasmine.createSpy('select').and.returnValue(of({ configured: true, reason: null })),
      dispatch: jasmine.createSpy('dispatch'),
    };

    mockDispatchTicketPrint = {
      printDispatchTicket: jasmine.createSpy('printDispatchTicket').and.returnValue(Promise.resolve(true)),
    };

    await TestBed.configureTestingModule({
      imports: [
        PosOrderConfirmationComponent,
        ModalStub,
        ButtonStub,
        IconStub,
        InvoicingNotConfiguredStub,
        PosFiscalStatusStub,
      ],
      providers: [
        { provide: AuthFacade, useValue: mockAuthFacade },
        { provide: ToastService, useValue: mockToastService },
        { provide: PosTicketService, useValue: mockTicketService },
        { provide: RepartosService, useValue: mockRepartosService },
        { provide: CurrencyFormatService, useValue: mockCurrencyService },
        { provide: StoreSettingsFacade, useValue: mockStoreSettingsFacade },
        { provide: Store, useValue: mockStore },
        { provide: DispatchTicketPrintService, useValue: mockDispatchTicketPrint },
      ],
    })
      .overrideComponent(PosOrderConfirmationComponent, {
        set: {
          imports: [ModalStub, ButtonStub, IconStub, InvoicingNotConfiguredStub, PosFiscalStatusStub],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(PosOrderConfirmationComponent);
    component = fixture.componentInstance;
  });

  const sampleOrder = {
    id: 1001,
    order_number: 'ORD-1001',
    state: 'completed',
    payment_status: 'paid',
    payment: { method: 'Efectivo', amount: 50000 },
    grand_total: 50000,
    subtotal: 42016,
    tax_amount: 7984,
    items: [
      { id: 1, name: 'Producto Test', quantity: 1, unit_price: 50000, total_price: 50000, tax_amount: 7984 },
    ],
  };

  it('1. Venta sin FE dispara auto-impresion inmediata', () => {
    activeFiscalAreasSignal.set([]); // Tienda sin invoicing
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('orderData', sampleOrder);
    fixture.detectChanges();

    expect(component.awaitingFiscalPrint()).toBe(false);
    expect(mockTicketService.printTicket).toHaveBeenCalled();
  });

  it('2. Venta con FE encola auto-impresion esperando a la DIAN', () => {
    activeFiscalAreasSignal.set(['invoicing']);
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('orderData', sampleOrder);
    fixture.detectChanges();

    expect(component.awaitingFiscalPrint()).toBe(true);
    expect(mockTicketService.printTicket).not.toHaveBeenCalled();
  });

  it('3. Venta con FE que recibe "issued" imprime Factura Electronica y notifica exito', () => {
    activeFiscalAreasSignal.set(['invoicing']);
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('orderData', sampleOrder);
    fixture.detectChanges();

    expect(component.awaitingFiscalPrint()).toBe(true);

    const fiscalIssued: PosFiscalStatus = {
      order_id: 1001,
      state: 'issued',
      message: 'Documento aceptado por la DIAN.',
      invoice_id: 501,
      invoice_number: 'FE-101',
      invoice_status: 'accepted',
      cufe: 'cufe1234567890',
      pdf_url: null,
      blockers: [],
      retry: null,
      contingency_deadline: null,
      invoice_data_token: null,
    };

    component.onFiscalStatus(fiscalIssued);

    expect(component.awaitingFiscalPrint()).toBe(false);
    expect(mockTicketService.printTicket).toHaveBeenCalled();
    expect(mockToastService.success).toHaveBeenCalledWith('Factura FE-101 aceptada por la DIAN');
  });

  it('4. Venta con FE que falla ("failed") emite ticket de contingencia y notifica al cajero', () => {
    activeFiscalAreasSignal.set(['invoicing']);
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('orderData', sampleOrder);
    fixture.detectChanges();

    expect(component.awaitingFiscalPrint()).toBe(true);

    const fiscalFailed: PosFiscalStatus = {
      order_id: 1001,
      state: 'failed',
      message: 'NIT invalido o prevalidacion fallida',
      invoice_id: null,
      invoice_number: null,
      invoice_status: 'rejected',
      cufe: null,
      pdf_url: null,
      blockers: [],
      retry: null,
      contingency_deadline: null,
      invoice_data_token: null,
    };

    component.onFiscalStatus(fiscalFailed);

    expect(component.awaitingFiscalPrint()).toBe(false);
    expect(mockTicketService.printTicket).toHaveBeenCalled();
    expect(component.fiscalFallbackNotice()).toContain('No se pudo emitir la factura electronica');
    expect(mockToastService.warning).toHaveBeenCalled();
  });

  it('5. Venta con FE cuyo timer de 10s expira emite ticket de contingencia por timeout', fakeAsync(() => {
    activeFiscalAreasSignal.set(['invoicing']);
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('orderData', sampleOrder);
    fixture.detectChanges();

    expect(component.awaitingFiscalPrint()).toBe(true);
    expect(mockTicketService.printTicket).not.toHaveBeenCalled();

    tick(10000);

    expect(component.awaitingFiscalPrint()).toBe(false);
    expect(mockTicketService.printTicket).toHaveBeenCalled();
    expect(component.fiscalFallbackNotice()).toContain('La DIAN tardo mas de lo esperado en responder');
    expect(mockToastService.warning).toHaveBeenCalled();
  }));

  it('6. startNewSale() limpia timers y resetea awaitingFiscalPrint', fakeAsync(() => {
    activeFiscalAreasSignal.set(['invoicing']);
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('orderData', sampleOrder);
    fixture.detectChanges();

    expect(component.awaitingFiscalPrint()).toBe(true);

    component.startNewSale();

    expect(component.awaitingFiscalPrint()).toBe(false);
    expect(component.fiscalFallbackNotice()).toBeNull();

    tick(10000);
    // El timeout cancelado no debe disparar printTicket
    expect(mockTicketService.printTicket).not.toHaveBeenCalled();
  }));
});
