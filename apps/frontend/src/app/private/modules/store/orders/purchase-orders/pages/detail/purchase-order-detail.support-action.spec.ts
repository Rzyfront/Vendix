import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';

import { StorePurchaseOrderDetailComponent } from './purchase-order-detail.component';
import { PurchaseOrdersService } from '../../../../inventory/services/purchase-orders.service';
import { DispatchNotesService } from '../../../../dispatch-notes/services/dispatch-notes.service';
import { PurchaseOrderPrintService } from '../../services/purchase-order-print.service';
import { SupportDocumentService } from '../../../../invoicing/services/support-document.service';
import { ToastService, DialogService } from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import type { PurchaseOrderSupportContext } from '../../../../invoicing/interfaces/support-document.interface';

/**
 * QUI-684 S1/S6.1 — «Generar documento soporte» aparece en TODA orden de
 * compra cuando la tienda tiene habilitado el documento soporte, tenga o no
 * factura de compra adjunta y sin importar su estado. Se instancia la clase en
 * contexto de inyección: lo que se prueba es `headerActions`, no la plantilla.
 */
describe('StorePurchaseOrderDetailComponent — acción «Generar documento soporte» (QUI-684)', () => {
  const PO_ID = 40;

  /** Cualquier método no declarado responde `{ data: [] }`, como un servicio vacío. */
  const emptyService = <T extends object>(overrides: Partial<Record<keyof T, unknown>> = {}) =>
    new Proxy(overrides as T, {
      get: (target, key) =>
        key in target ? (target as Record<PropertyKey, unknown>)[key] : () => of({ data: [] }),
    });

  const context = (
    over: Partial<PurchaseOrderSupportContext['purchase_order']> = {},
    enabled = true,
  ): PurchaseOrderSupportContext => ({
    enabled,
    purchase_order: {
      id: PO_ID,
      order_number: 'OC-40',
      status: 'received',
      supplier_id: 5,
      total_amount: 119000,
      has_supplier_invoice: false,
      supplier_invoice_number: null,
      supplier_invoice_date: null,
      invoice_attachments_count: 0,
      ...over,
    },
    active_document_id: null,
    documents: [],
  });

  const build = (support: () => unknown) => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: String(PO_ID) }) } },
        },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
        {
          provide: PurchaseOrdersService,
          useValue: emptyService<PurchaseOrdersService>({
            getPurchaseOrderById: () =>
              of({ data: { id: PO_ID, status: 'received', purchase_order_items: [] } }),
          }),
        },
        { provide: DispatchNotesService, useValue: emptyService<DispatchNotesService>() },
        { provide: PurchaseOrderPrintService, useValue: emptyService<PurchaseOrderPrintService>() },
        { provide: ToastService, useValue: emptyService<ToastService>() },
        { provide: DialogService, useValue: emptyService<DialogService>() },
        {
          provide: CurrencyFormatService,
          useValue: emptyService<CurrencyFormatService>({ format: (v: number) => `$${v}` }),
        },
        {
          provide: SupportDocumentService,
          useValue: { getPurchaseOrderContext: jasmine.createSpy('ctx').and.callFake(support) },
        },
      ],
    });
    return TestBed.runInInjectionContext(() => new StorePurchaseOrderDetailComponent());
  };

  const hasSupportAction = (c: StorePurchaseOrderDetailComponent) =>
    c.headerActions().some((a) => a.id === 'support-doc' && a.label === 'Generar documento soporte');

  it('aparece en una OC recibida SIN factura de compra adjunta', () => {
    const c = build(() => of({ success: true, data: context() }));
    expect(TestBed.inject(SupportDocumentService).getPurchaseOrderContext).toHaveBeenCalledWith(PO_ID);
    expect(hasSupportAction(c)).toBeTrue();
  });

  it('aparece también CON factura de compra adjunta (el aviso es informativo)', () => {
    const c = build(() =>
      of({
        success: true,
        data: context({ has_supplier_invoice: true, supplier_invoice_number: 'FC-77' }),
      }),
    );
    expect(hasSupportAction(c)).toBeTrue();
  });

  it('no aparece si la tienda no tiene habilitado el documento soporte o la consulta falla', () => {
    expect(hasSupportAction(build(() => of({ success: true, data: context({}, false) })))).toBeFalse();
    TestBed.resetTestingModule();
    expect(hasSupportAction(build(() => throwError(() => ({ status: 403 }))))).toBeFalse();
  });
});
