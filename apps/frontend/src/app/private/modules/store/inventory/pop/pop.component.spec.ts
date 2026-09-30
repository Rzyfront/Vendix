import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';

import { PopComponent } from './pop.component';
import { PopCartService } from './services/pop-cart.service';
import { PurchaseOrdersService } from '../services';
import { ProductsService } from '../../products/services/products.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { DialogService } from '../../../../../shared/components/dialog/dialog.service';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { DispatchNotesService } from '../../dispatch-notes/services/dispatch-notes.service';
import { VexiUiHostRegistry } from '../../../../../core/services/vexi-ui-host.registry';
import type {
  InvoiceMatchResult,
  InvoiceScanResult,
  MatchedLineItem,
} from './interfaces/invoice-scanner.interface';

/**
 * QUI-855 — puntos de entrada reales de `PopComponent`, con el carrito, el
 * backend y el toast sustituidos. Se ejecutan los métodos del componente; el
 * template no se monta.
 */
describe('PopComponent — QUI-855 puntos de entrada', () => {
  let cart: any;
  let poService: { createPurchaseOrder: jasmine.Spy };
  let toast: { success: jasmine.Spy; warning: jasmine.Spy; error: jasmine.Spy };
  let component: PopComponent;

  function makeState(over: Record<string, unknown> = {}): any {
    return {
      items: [{ id: 'a', tax_rate: null, tax_needs_review: true }],
      has_vat: true,
      supplierId: 1,
      locationId: 1,
      ...over,
    };
  }

  beforeEach(() => {
    cart = {
      currentState: makeState(),
      cartState$: of(makeState()),
      setDiscountAmount: jasmine.createSpy('setDiscountAmount'),
      setScanAttachment: jasmine.createSpy('setScanAttachment'),
      setHasVat: jasmine.createSpy('setHasVat'),
      setSupplier: jasmine.createSpy('setSupplier'),
      setOrderDate: jasmine.createSpy('setOrderDate'),
      setNotes: jasmine.createSpy('setNotes'),
      addToCart: jasmine.createSpy('addToCart').and.returnValue(of(null)),
    };
    poService = { createPurchaseOrder: jasmine.createSpy('createPurchaseOrder').and.returnValue(of({})) };
    toast = {
      success: jasmine.createSpy('success'),
      warning: jasmine.createSpy('warning'),
      error: jasmine.createSpy('error'),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: PopCartService, useValue: cart },
        { provide: PurchaseOrdersService, useValue: poService },
        { provide: ProductsService, useValue: {} },
        { provide: ActivatedRoute, useValue: { paramMap: of({ get: () => null }) } },
        { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
        { provide: ToastService, useValue: toast },
        { provide: DialogService, useValue: {} },
        { provide: AuthFacade, useValue: { getUserId: () => 1 } },
        { provide: DispatchNotesService, useValue: {} },
        { provide: VexiUiHostRegistry, useValue: { register: () => undefined, unregister: () => undefined } },
      ],
    });
    TestBed.overrideComponent(PopComponent, { set: { template: '', imports: [] } });
    component = TestBed.createComponent(PopComponent).componentInstance;
  });

  describe('bloqueo por impuesto sin confirmar (has_vat)', () => {
    it('onOrderConfirmed no llama al backend y avisa «Confirma el impuesto de 1 línea»', () => {
      component.onOrderConfirmed();
      expect(poService.createPurchaseOrder).not.toHaveBeenCalled();
      expect(toast.warning).toHaveBeenCalledWith('Confirma el impuesto de 1 línea');
      expect(component.isProcessingOrder()).toBeFalse();
    });

    it('con varias líneas pluraliza', () => {
      cart.currentState = makeState({
        items: [
          { id: 'a', tax_needs_review: true },
          { id: 'b', tax_error: 'combinación inválida' },
          { id: 'c' },
        ],
      });
      component.onOrderConfirmed();
      expect(toast.warning).toHaveBeenCalledWith('Confirma el impuesto de 2 líneas');
    });

    it('«Crear orden» y «Crear + Recibir» no abren el wizard', () => {
      component.onSubmitOrder();
      component.onCreateAndReceive();
      expect(component.showOrderConfirmModal()).toBeFalse();
      expect(toast.warning).toHaveBeenCalledTimes(2);
    });

    it('con has_vat apagado NO bloquea: el wizard abre y el envío procede', () => {
      cart.currentState = makeState({ has_vat: false });
      component.onSubmitOrder();
      expect(component.showOrderConfirmModal()).toBeTrue();
      expect(toast.warning).not.toHaveBeenCalled();
    });

    it('sin líneas pendientes no bloquea aunque has_vat esté encendido', () => {
      cart.currentState = makeState({ items: [{ id: 'a', tax_rate: 19 }] });
      component.onSubmitOrder();
      expect(component.showOrderConfirmModal()).toBeTrue();
    });
  });

  describe('descuento general de la precarga → carrito', () => {
    const scan = (over: Partial<InvoiceScanResult> = {}): InvoiceScanResult =>
      ({
        supplier: { name: 'P' },
        invoice_number: 'F1',
        invoice_date: '2026-09-20',
        prices_include_tax: true,
        line_items: [],
        subtotal: 0,
        tax_amount: 0,
        total: 0,
        confidence: 1,
        discount_amount: 10000,
        discount_amount_printed: 11900,
        ...over,
      }) as InvoiceScanResult;
    const taxedLine = {
      description: 'x',
      quantity: 1,
      unit_price: 100000,
      unit_price_gross: 119000,
      total: 119000,
      tax_rate: 0.19,
      taxes: [{ tax_type: 'iva', tax_rate: 19, calc_mode: 'percent', fixed_amount_per_unit: null, amount_override: null }],
      match_status: 'new',
      candidates: [],
    } as unknown as MatchedLineItem;
    const confirm = (s: InvoiceScanResult) =>
      component.onInvoiceScanConfirmed({
        scanResult: s,
        matchResult: {} as InvoiceMatchResult,
        editedItems: [taxedLine],
      });

    it('línea multi-impuesto: el carrito recibe el impreso (11.900), la misma cifra del modal', () => {
      confirm(scan());
      expect(cart.setDiscountAmount).toHaveBeenCalledOnceWith(11900);
    });

    it('descuento editado a 0: el carrito recibe 0 (no los 10.000 netos)', () => {
      confirm(scan({ discount_amount: 0, discount_amount_printed: 0 }));
      expect(cart.setDiscountAmount).toHaveBeenCalledOnceWith(0);
    });

    it('escaneo sin descuento (cifras null): no pisa el descuento tecleado en el carrito', () => {
      confirm(scan({ discount_amount: null, discount_amount_printed: null }));
      expect(cart.setDiscountAmount).not.toHaveBeenCalled();
    });
  });
});
