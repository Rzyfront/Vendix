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
  let toast: { success: jasmine.Spy; warning: jasmine.Spy; error: jasmine.Spy; info: jasmine.Spy };
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
      info: jasmine.createSpy('info'),
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

    it('onSaveAsDraft con línea sin confirmar no crea la OC y avisa', () => {
      component.onSaveAsDraft();
      expect(poService.createPurchaseOrder).not.toHaveBeenCalled();
      expect(toast.warning).toHaveBeenCalledWith('Confirma el impuesto de 1 línea');
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('onSaveAsDraft con has_vat apagado sí crea el borrador', () => {
      cart.currentState = makeState({
        has_vat: false,
        orderDate: new Date('2026-09-20'),
        summary: { subtotal: 10, taxAmount: 0, tax_amount: 0, total: 10, grandTotal: 10 },
        items: [
          {
            id: 'a',
            product: { id: 1 },
            quantity: 1,
            unit_cost: 10,
            tax_rate: null,
            tax_needs_review: true,
          },
        ],
      });
      cart.clearCart = jasmine.createSpy('clearCart').and.returnValue(of(null));
      component.onSaveAsDraft();
      expect(poService.createPurchaseOrder).toHaveBeenCalledTimes(1);
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

  /**
   * QUI-942 — carga masiva con costos en 0: la OC sale con total 0 y el pago
   * inmediato se enviaba con `amount: 0` (400). El fallo dejaba el modal en
   * blanco con «Confirmar» habilitado y el carrito vacío, y el segundo clic
   * creaba una OC sin proveedor/bodega/líneas (otro 400).
   */
  describe('QUI-942 — compra de total 0 y resultado parcial', () => {
    let po: Record<string, jasmine.Spy>;

    function lineState(total: number): any {
      return makeState({
        has_vat: false,
        orderDate: new Date('2026-10-13'),
        summary: { subtotal: total, tax_amount: 0, total },
        items: [{ id: 'a', product: { id: 7 }, quantity: 3, unit_cost: total / 3, tax_rate: 0 }],
      });
    }

    function confirmCreateAndPay(): void {
      component.confirmOrderAction = 'create-receive';
      component.ackReceive.set(false);
      component.paymentPlan.set({
        payment_plan: 'immediate',
        down_payment_amount: 0,
        payment_installments: [],
      });
      component.onOrderConfirmed();
    }

    beforeEach(() => {
      po = poService as unknown as Record<string, jasmine.Spy>;
      cart.clearCart = jasmine.createSpy('clearCart').and.returnValue(of(null));
      po['createPurchaseOrder'].and.returnValue(
        of({ success: true, data: { id: 774, order_number: 'PO-774', total_amount: 0, status: 'draft' } }),
      );
      po['approvePurchaseOrder'] = jasmine
        .createSpy('approvePurchaseOrder')
        .and.callFake((id: number) => of({ success: true, data: { id, order_number: 'PO-774', total_amount: 0, status: 'approved' } }));
      po['registerPurchaseOrderPayment'] = jasmine
        .createSpy('registerPurchaseOrderPayment')
        .and.returnValue(of({ success: true, data: {} }));
      po['getPurchaseOrderById'] = jasmine
        .createSpy('getPurchaseOrderById')
        .and.returnValue(of({ success: true, data: { status: 'approved' } }));
    });

    it('total 0 con pago inmediato: no registra pago, termina con éxito y marca el pago como omitido', () => {
      cart.currentState = lineState(0);
      confirmCreateAndPay();

      expect(po['createPurchaseOrder']).toHaveBeenCalledTimes(1);
      expect(po['registerPurchaseOrderPayment']).not.toHaveBeenCalled();
      const result = component.orderResult();
      expect(result?.id).toBe(774);
      expect(result?.failedStage).toBeUndefined();
      expect(result?.stages?.find((s) => s.name === 'pay')?.status).toBe('skipped');
      expect(toast.error).not.toHaveBeenCalled();
      expect(toast.info).toHaveBeenCalledWith(
        'La orden quedó con total $0: no se registró ningún pago.',
        undefined,
        6000,
      );
      expect(result?.notice).toBe('La orden quedó con total $0: no se registró ningún pago.');
      expect(component.isProcessingOrder()).toBeFalse();
    });

    it('total > 0 con pago inmediato: sigue registrando el pago por el total (comportamiento previo)', () => {
      cart.currentState = lineState(30000);
      po['approvePurchaseOrder'].and.callFake((id: number) =>
        of({ success: true, data: { id, order_number: 'PO-775', total_amount: 30000, status: 'approved' } }),
      );
      confirmCreateAndPay();

      expect(po['registerPurchaseOrderPayment']).toHaveBeenCalledTimes(1);
      expect(po['registerPurchaseOrderPayment'].calls.mostRecent().args[0]).toBe(774);
      expect(po['registerPurchaseOrderPayment'].calls.mostRecent().args[1].amount).toBe(30000);
      expect(component.orderResult()?.stages?.find((s) => s.name === 'pay')?.status).toBe('success');
      expect(component.orderResult()?.notice).toBeUndefined();
    });

    it('carrito vacío: avisa y no envía una OC sin proveedor, bodega ni líneas', () => {
      cart.currentState = makeState({ items: [], supplierId: null, locationId: null });
      confirmCreateAndPay();

      expect(po['createPurchaseOrder']).not.toHaveBeenCalled();
      expect(toast.warning).toHaveBeenCalledWith(
        'El pedido está vacío: agrega productos antes de crear la orden.',
      );
      expect(component.isProcessingOrder()).toBeFalse();
    });

    it('cerrar el checkout tras un resultado parcial lo limpia para la próxima apertura', () => {
      component.orderResult.set({ id: 774, total: 0, orderNumber: 'PO-774', failedStage: 'pay' });
      component.orderError.set('x');
      component.showOrderConfirmModal.set(true);

      component.onCheckoutCancelled();

      expect(component.showOrderConfirmModal()).toBeFalse();
      expect(component.orderResult()).toBeNull();
      expect(component.orderError()).toBeNull();
    });

    it('«Ver orden» tras fallar la recepción vacía el carrito y suelta la OC pendiente (sin segunda OC)', () => {
      const router = TestBed.inject(Router);
      const navigate = spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
      component.pendingReceptionOrder.set({ id: 774 } as any);
      component.orderResult.set({ id: 774, total: 0, orderNumber: 'PO-774', failedStage: 'receive' });

      component.onPartialViewOrder();

      expect(cart.clearCart).toHaveBeenCalledTimes(1);
      expect(component.pendingReceptionOrder()).toBeNull();
      expect(navigate).toHaveBeenCalledWith(['/admin/orders/purchase-orders', 774]);
    });

    it('«Ver orden» tras fallar el pago navega igual que antes (el carrito ya se vació al crear)', () => {
      const router = TestBed.inject(Router);
      const navigate = spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
      component.orderResult.set({ id: 774, total: 0, orderNumber: 'PO-774', failedStage: 'pay' });
      component.onPartialViewOrder();
      expect(navigate).toHaveBeenCalledWith(['/admin/orders/purchase-orders', 774]);
      expect(cart.clearCart).not.toHaveBeenCalled();
    });

    it('cerrar el checkout NO borra un éxito pleno (lo muestra su propio modal)', () => {
      component.orderResult.set({ id: 774, total: 0, orderNumber: 'PO-774' });
      component.onCheckoutCancelled();
      expect(component.orderResult()?.id).toBe(774);
    });
  });
});
