import { RequestContextService } from '../../../../common/context/request-context.service';
import { ErrorCodes } from '../../../../common/errors';
import { InvoicingService } from '../invoicing.service';
import { PurchaseOrderSupportDocumentService } from './purchase-order-support-document.service';

const STORE_ID = 7;
const ACTIVE_INDEX = 'invoices_po_active_support_document_key';

const supplier = (over: Record<string, unknown> = {}) => ({
  id: 5,
  name: 'Proveedor SAS',
  document_type: 'NIT',
  tax_id: '900123456',
  verification_digit: '7',
  // `suppliers.addresses` es relación única (suppliers.address_id), no lista.
  addresses: {
    address_line1: 'Cra 1 # 2-3',
    city: 'Bogotá',
    municipality_code: '11001',
  },
  ...over,
});

const line = (over: Record<string, unknown> = {}) => ({
  product_id: 11,
  product_variant_id: null,
  quantity_ordered: 2,
  unit_cost: 1000,
  unit_price_net: 1000,
  tax_rate: 19,
  tax_type: 'iva',
  tax_amount: 380,
  products: { name: 'Cuaderno' },
  product_variants: null,
  purchase_order_item_taxes: [
    {
      tax_name: 'IVA 19%',
      tax_rate: 19,
      tax_type: 'iva',
      taxable_amount: 2000,
      tax_amount: 380,
    },
  ],
  ...over,
});

const purchaseOrder = (over: Record<string, unknown> = {}) => ({
  id: 40,
  order_number: 'PO-0040',
  status: 'received',
  supplier_id: 5,
  total_amount: 2380,
  shipping_cost: 0,
  shipping_cost_allocation: null,
  payment_plan: 'immediate',
  payment_status: 'paid',
  payment_due_date: null,
  supplier_invoice_number: null,
  supplier_invoice_date: null,
  purchase_order_items: [line()],
  suppliers: supplier(),
  attachments: [],
  payment_schedules: [],
  ...over,
});

const body = (over: Record<string, unknown> = {}) => ({
  issue_date: '2026-11-17',
  payment_form: '1',
  notes: 'Orden de compra PO-0040',
  items: [
    {
      description: 'Cuaderno',
      quantity: 2,
      unit_price: 1000,
      discount_amount: 0,
      tax_amount: 380,
    },
  ],
  ...over,
});

describe('PurchaseOrderSupportDocumentService (QUI-684)', () => {
  let service: PurchaseOrderSupportDocumentService;
  let poFindFirst: jest.Mock;
  let invoicesFindFirst: jest.Mock;
  let invoicesFindMany: jest.Mock;
  let invoicingCreate: jest.Mock;
  let invoicingCreateIdem: jest.Mock;
  let getConfigs: jest.Mock;

  beforeEach(() => {
    poFindFirst = jest.fn().mockResolvedValue(purchaseOrder());
    invoicesFindFirst = jest.fn().mockResolvedValue(null);
    invoicesFindMany = jest.fn().mockResolvedValue([]);
    invoicingCreate = jest.fn().mockResolvedValue({ id: 900, status: 'draft' });
    invoicingCreateIdem = jest
      .fn()
      .mockResolvedValue({ invoice: { id: 901 }, replayed: false });
    getConfigs = jest
      .fn()
      .mockResolvedValue([{ is_default: true, enablement_status: 'enabled' }]);
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: STORE_ID, organization_id: 3 } as any);
    service = new PurchaseOrderSupportDocumentService(
      {
        purchase_orders: { findFirst: poFindFirst },
        invoices: { findFirst: invoicesFindFirst, findMany: invoicesFindMany },
        store_settings: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      } as any,
      { create: invoicingCreate, createIdempotently: invoicingCreateIdem } as any,
      { getConfigs } as any,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  const missingCodes = async (po: Record<string, unknown>) => {
    poFindFirst.mockResolvedValue(po);
    const draft = await service.getDraft(40);
    return draft.missing.map((m) => m.code);
  };

  describe('datos faltantes (GET support-document-draft)', () => {
    it('OC completa: sin faltantes y can_emit', async () => {
      const result = await service.getDraft(40);
      expect(result.missing).toEqual([]);
      expect(result.can_emit).toBe(true);
      expect(result.active_document).toBeNull();
    });

    it('OC cancelada -> PO_CANCELLED con target purchase_order', async () => {
      poFindFirst.mockResolvedValue(purchaseOrder({ status: 'cancelled' }));
      const { missing, can_emit } = await service.getDraft(40);
      expect(missing).toEqual([
        {
          code: 'PO_CANCELLED',
          field: 'status',
          label: expect.any(String),
          target: 'purchase_order',
        },
      ]);
      expect(can_emit).toBe(false);
    });

    it('proveedor sin tipo, número, nombre, dirección y municipio', async () => {
      const codes = await missingCodes(
        purchaseOrder({
          suppliers: supplier({
            document_type: null,
            tax_id: ' ',
            name: '',
            addresses: null,
          }),
        }),
      );
      expect(codes).toEqual([
        'SUPPLIER_DOCUMENT_TYPE_REQUIRED',
        'SUPPLIER_TAX_ID_REQUIRED',
        'SUPPLIER_NAME_REQUIRED',
        'SUPPLIER_ADDRESS_REQUIRED',
        'SUPPLIER_MUNICIPALITY_REQUIRED',
      ]);
    });

    it('todos los faltantes del proveedor apuntan a target supplier y traen label en español', async () => {
      poFindFirst.mockResolvedValue(
        purchaseOrder({ suppliers: supplier({ document_type: null }) }),
      );
      const { missing } = await service.getDraft(40);
      expect(missing[0]).toEqual({
        code: 'SUPPLIER_DOCUMENT_TYPE_REQUIRED',
        field: 'supplier.document_type',
        label: 'El proveedor no tiene tipo de documento',
        target: 'supplier',
      });
    });

    it('dígito de verificación solo se exige con NIT (alias NIT o código 31)', async () => {
      expect(
        await missingCodes(
          purchaseOrder({ suppliers: supplier({ verification_digit: null }) }),
        ),
      ).toEqual(['SUPPLIER_VERIFICATION_DIGIT_REQUIRED']);
      expect(
        await missingCodes(
          purchaseOrder({
            suppliers: supplier({
              document_type: '31',
              verification_digit: null,
            }),
          }),
        ),
      ).toEqual(['SUPPLIER_VERIFICATION_DIGIT_REQUIRED']);
      expect(
        await missingCodes(
          purchaseOrder({
            suppliers: supplier({
              document_type: 'CC',
              verification_digit: null,
            }),
          }),
        ),
      ).toEqual([]);
    });

    it('OC sin ítems -> ITEMS_REQUIRED (target review)', async () => {
      poFindFirst.mockResolvedValue(
        purchaseOrder({ purchase_order_items: [], shipping_cost: 0 }),
      );
      const { missing } = await service.getDraft(40);
      expect(missing).toEqual([
        {
          code: 'ITEMS_REQUIRED',
          field: 'items',
          label: expect.any(String),
          target: 'review',
        },
      ]);
    });

    it('línea sin descripción, cantidad o valor unitario -> códigos con field items[i].*', async () => {
      poFindFirst.mockResolvedValue(
        purchaseOrder({
          purchase_order_items: [
            line(),
            line({
              products: { name: '' },
              quantity_ordered: 0,
              unit_price_net: 0,
              unit_cost: 0,
              purchase_order_item_taxes: [],
              tax_amount: 0,
            }),
          ],
        }),
      );
      const { missing } = await service.getDraft(40);
      expect(missing.map((m) => [m.code, m.field, m.target])).toEqual([
        ['ITEM_DESCRIPTION_REQUIRED', 'items[1].description', 'review'],
        ['ITEM_QUANTITY_REQUIRED', 'items[1].quantity', 'review'],
        ['ITEM_UNIT_PRICE_REQUIRED', 'items[1].unit_price', 'review'],
      ]);
    });

    it('forma de pago no derivable -> PAYMENT_FORM_REQUIRED', async () => {
      poFindFirst.mockResolvedValue(
        purchaseOrder({
          payment_plan: null,
          payment_status: 'unpaid',
          payment_due_date: null,
        }),
      );
      const { missing, draft } = await service.getDraft(40);
      expect(draft.payment_form).toBeNull();
      expect(missing.map((m) => [m.code, m.field, m.target])).toEqual([
        ['PAYMENT_FORM_REQUIRED', 'payment_form', 'review'],
      ]);
    });

    it('crédito sin vencimiento ni cuotas -> DUE_DATE_REQUIRED (target review)', async () => {
      const codes = await missingCodes(
        purchaseOrder({
          payment_plan: 'partial',
          payment_status: 'unpaid',
          payment_due_date: null,
          payment_schedules: [],
        }),
      );
      expect(codes).toEqual(['DUE_DATE_REQUIRED']);
    });

    it('vencimiento de la OC ya pasado -> DUE_DATE_BEFORE_ISSUE', async () => {
      const codes = await missingCodes(
        purchaseOrder({
          payment_plan: 'deferred',
          payment_status: 'unpaid',
          payment_due_date: new Date('2020-01-01T12:00:00Z'),
        }),
      );
      expect(codes).toEqual(['DUE_DATE_BEFORE_ISSUE']);
    });

    it('con documento vigente: can_emit false y active_document informado', async () => {
      invoicesFindFirst.mockResolvedValue({
        id: 77,
        invoice_number: 'DS-1',
        status: 'accepted',
      });
      const result = await service.getDraft(40);
      expect(result.missing).toEqual([]);
      expect(result.can_emit).toBe(false);
      expect(result.active_document).toEqual({
        id: 77,
        invoice_number: 'DS-1',
        status: 'accepted',
      });
      expect(invoicesFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            purchase_order_id: 40,
            invoice_type: 'support_document',
            status: { notIn: ['cancelled', 'voided'] },
          }),
        }),
      );
    });
  });

  describe('precarga (GET support-document-draft)', () => {
    it.each([
      ['immediate', 'unpaid', null, '1'],
      ['partial', 'partial', new Date('2026-12-05T12:00:00Z'), '2'],
      ['deferred', 'unpaid', new Date('2026-12-05T12:00:00Z'), '2'],
      ['installments', 'unpaid', new Date('2026-12-05T12:00:00Z'), '2'],
      [null, 'paid', null, '1'],
      [null, 'unpaid', new Date('2026-12-05T12:00:00Z'), '2'],
    ])(
      'payment_plan=%s payment_status=%s (due %s) -> payment_form %s',
      async (plan, status, due, expected) => {
        poFindFirst.mockResolvedValue(
          purchaseOrder({
            payment_plan: plan,
            payment_status: status,
            payment_due_date: due,
          }),
        );
        const { draft } = await service.getDraft(40);
        expect(draft.payment_form).toBe(expected);
        expect(draft.due_date).toBe(expected === '2' ? '2026-12-05' : null);
      },
    );

    it('crédito sin payment_due_date usa la última cuota del calendario', async () => {
      poFindFirst.mockResolvedValue(
        purchaseOrder({
          payment_plan: 'installments',
          payment_status: 'unpaid',
          payment_schedules: [
            { scheduled_date: new Date('2026-12-30T00:00:00Z') },
            { scheduled_date: new Date('2026-12-01T00:00:00Z') },
          ],
        }),
      );
      const { draft } = await service.getDraft(40);
      expect(draft.payment_form).toBe('2');
      expect(draft.due_date).toBe('2026-12-30');
    });

    it('líneas: descripción producto + variante, cantidad, precio neto e impuestos de las filas hijas', async () => {
      poFindFirst.mockResolvedValue(
        purchaseOrder({
          purchase_order_items: [
            line({
              product_variants: { name: 'Rojo' },
              product_variant_id: 3,
              quantity_ordered: 3,
              unit_price_net: 840.3361,
              unit_cost: 1000,
              purchase_order_item_taxes: [
                {
                  tax_name: 'IVA 19%',
                  tax_rate: 19,
                  tax_type: 'iva',
                  taxable_amount: 2521.01,
                  tax_amount: 478.99,
                },
                {
                  tax_name: 'INC 8%',
                  tax_rate: 8,
                  tax_type: 'inc',
                  taxable_amount: 2521.01,
                  tax_amount: 201.68,
                },
              ],
            }),
          ],
        }),
      );
      const { draft } = await service.getDraft(40);
      expect(draft.items).toHaveLength(1);
      expect(draft.items[0]).toMatchObject({
        description: 'Cuaderno - Rojo',
        quantity: 3,
        unit_price: 840.3361,
        discount_amount: 0,
        tax_amount: 680.67,
        product_id: 11,
        product_variant_id: 3,
      });
      expect((draft.items[0] as any).taxes).toHaveLength(2);
    });

    it('línea legacy sin filas de impuesto usa la columna tax_amount', async () => {
      poFindFirst.mockResolvedValue(
        purchaseOrder({
          purchase_order_items: [line({ purchase_order_item_taxes: [] })],
        }),
      );
      const { draft } = await service.getDraft(40);
      expect(draft.items[0].tax_amount).toBe(380);
      expect((draft.items[0] as any).taxes).toEqual([
        expect.objectContaining({ tax_type: 'iva', tax_rate: 19, tax_amount: 380 }),
      ]);
    });

    // El flete prorrateado NO está en `unit_cost`/`unit_price_net`: vive en
    // `allocated_shipping_amount` y solo se capitaliza al recibir. El proveedor
    // lo cobró igual, así que el documento lo lleva en ambos casos.
    it('agrega la línea «Flete» con el flete de la cabecera, se prorratee o no', async () => {
      poFindFirst.mockResolvedValue(
        purchaseOrder({ shipping_cost: 50000, shipping_cost_allocation: 'expense' }),
      );
      let { draft } = await service.getDraft(40);
      expect(draft.items).toHaveLength(2);
      expect(draft.items[1]).toMatchObject({
        description: 'Flete',
        quantity: 1,
        unit_price: 50000,
        tax_amount: 0,
      });

      poFindFirst.mockResolvedValue(
        purchaseOrder({ shipping_cost: 50000, shipping_cost_allocation: 'prorate' }),
      );
      ({ draft } = await service.getDraft(40));
      expect(draft.items).toHaveLength(2);
      expect(draft.items[1]).toMatchObject({
        description: 'Flete',
        unit_price: 50000,
      });
    });

    it('issue_date = hoy en la zona de la tienda y withholding_amount 0', async () => {
      const { draft } = await service.getDraft(40);
      expect(draft.issue_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(draft.withholding_amount).toBe(0);
      expect(draft.supplier_id).toBe(5);
    });
  });

  describe('factura de compra adjunta (informativa, nunca bloquea)', () => {
    it('true con supplier_invoice_number en la OC', async () => {
      poFindFirst.mockResolvedValue(
        purchaseOrder({
          supplier_invoice_number: 'FAC-9',
          supplier_invoice_date: new Date('2026-11-01T00:00:00Z'),
        }),
      );
      const ctx = await service.getContextForPurchaseOrder(40);
      expect(ctx.purchase_order).toMatchObject({
        has_supplier_invoice: true,
        supplier_invoice_number: 'FAC-9',
        supplier_invoice_date: '2026-11-01',
        invoice_attachments_count: 0,
      });
      expect((await service.getDraft(40)).can_emit).toBe(true);
    });

    it('true con un adjunto que trae número de factura', async () => {
      poFindFirst.mockResolvedValue(
        purchaseOrder({
          attachments: [
            { supplier_invoice_number: null, supplier_invoice_date: null },
            { supplier_invoice_number: 'ADJ-3', supplier_invoice_date: null },
          ],
        }),
      );
      const ctx = await service.getContextForPurchaseOrder(40);
      expect(ctx.purchase_order).toMatchObject({
        has_supplier_invoice: true,
        supplier_invoice_number: 'ADJ-3',
        invoice_attachments_count: 1,
      });
      expect((await service.getDraft(40)).can_emit).toBe(true);
    });

    it('false sin número en la OC ni en adjuntos', async () => {
      poFindFirst.mockResolvedValue(
        purchaseOrder({
          attachments: [{ supplier_invoice_number: null, supplier_invoice_date: null }],
        }),
      );
      const ctx = await service.getContextForPurchaseOrder(40);
      expect(ctx.purchase_order).toMatchObject({
        has_supplier_invoice: false,
        supplier_invoice_number: null,
        invoice_attachments_count: 0,
      });
    });
  });

  describe('contexto (GET support-documents)', () => {
    it('enabled según la configuración DIAN por defecto y active_document_id', async () => {
      invoicesFindMany.mockResolvedValue([
        { id: 3, status: 'voided', total_amount: '100' },
        { id: 2, status: 'accepted', total_amount: '2380.00' },
      ]);
      const ctx = await service.getContextForPurchaseOrder(40);
      expect(ctx.enabled).toBe(true);
      expect(ctx.active_document_id).toBe(2);
      expect(ctx.documents.map((d) => d.total_amount)).toEqual([100, 2380]);
      expect(ctx.purchase_order.total_amount).toBe(2380);
    });

    it('enabled false sin habilitación o con certificado vencido', async () => {
      getConfigs.mockResolvedValue([]);
      expect((await service.getContextForPurchaseOrder(40)).enabled).toBe(false);
      getConfigs.mockResolvedValue([
        { is_default: true, enablement_status: 'not_started' },
      ]);
      expect((await service.getContextForPurchaseOrder(40)).enabled).toBe(false);
      getConfigs.mockResolvedValue([
        {
          is_default: true,
          enablement_status: 'enabled',
          certificate_expiry: new Date('2020-01-01'),
        },
      ]);
      expect((await service.getContextForPurchaseOrder(40)).enabled).toBe(false);
    });
  });

  describe('aislamiento por tienda', () => {
    it('la consulta de la OC lleva location.store_id y otra tienda responde 404 PO_FIND_001', async () => {
      poFindFirst.mockResolvedValue(null);
      for (const call of [
        () => service.getContextForPurchaseOrder(40),
        () => service.getDraft(40),
        () => service.createFromPurchaseOrder(40, body() as any),
      ]) {
        await expect(call()).rejects.toMatchObject({
          errorCode: ErrorCodes.PO_FIND_001.code,
          status: 404,
        });
      }
      expect(poFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 40, location: { store_id: STORE_ID } },
        }),
      );
      expect(invoicingCreate).not.toHaveBeenCalled();
    });
  });

  describe('POST support-document', () => {
    it('crea con proveedor de la OC, purchase_order_id por opciones y tipo support_document', async () => {
      const result = await service.createFromPurchaseOrder(40, body() as any);
      expect(result).toEqual({
        invoice: { id: 900, status: 'draft' },
        replayed: false,
      });
      expect(invoicingCreate).toHaveBeenCalledTimes(1);
      const [dto, options] = invoicingCreate.mock.calls[0];
      expect(dto).toMatchObject({
        invoice_type: 'support_document',
        supplier_id: 5,
        issue_date: '2026-11-17',
        payment_form: '1',
        notes: 'Orden de compra PO-0040',
      });
      expect(dto).not.toHaveProperty('purchase_order_id');
      expect(options).toEqual({ purchase_order_id: 40 });
      expect(invoicingCreateIdem).not.toHaveBeenCalled();
    });

    it('con client_request_id usa createIdempotently y propaga purchase_order_id', async () => {
      const key = '3dd5fe96-659c-4ef7-b489-753007e411ca';
      const result = await service.createFromPurchaseOrder(
        40,
        body({ client_request_id: key }) as any,
      );
      expect(result).toEqual({ invoice: { id: 901 }, replayed: false });
      expect(invoicingCreateIdem).toHaveBeenCalledWith(
        expect.objectContaining({ client_request_id: key }),
        { purchase_order_id: 40 },
      );
      expect(invoicingCreate).not.toHaveBeenCalled();
    });

    it('con faltantes: 422 INVOICING_SUPPORT_PO_001 con details.missing y nada se crea', async () => {
      poFindFirst.mockResolvedValue(
        purchaseOrder({ suppliers: supplier({ tax_id: null, addresses: null }) }),
      );
      const error: any = await service
        .createFromPurchaseOrder(
          40,
          body({
            items: [{ description: '', quantity: 1, unit_price: 0 }],
          }) as any,
        )
        .catch((e) => e);
      expect(error.errorCode).toBe('INVOICING_SUPPORT_PO_001');
      expect(error.status).toBe(422);
      const codes = error.getResponse().details.missing.map((m: any) => m.code);
      expect(codes).toEqual([
        'SUPPLIER_TAX_ID_REQUIRED',
        'SUPPLIER_ADDRESS_REQUIRED',
        'SUPPLIER_MUNICIPALITY_REQUIRED',
        'ITEM_DESCRIPTION_REQUIRED',
        'ITEM_UNIT_PRICE_REQUIRED',
      ]);
      expect(invoicingCreate).not.toHaveBeenCalled();
      expect(invoicingCreateIdem).not.toHaveBeenCalled();
    });

    it('OC cancelada: 422 PO_CANCELLED aunque el cuerpo esté completo', async () => {
      poFindFirst.mockResolvedValue(purchaseOrder({ status: 'cancelled' }));
      const error: any = await service
        .createFromPurchaseOrder(40, body() as any)
        .catch((e) => e);
      expect(error.errorCode).toBe('INVOICING_SUPPORT_PO_001');
      expect(error.getResponse().details.missing[0].code).toBe('PO_CANCELLED');
      expect(invoicingCreate).not.toHaveBeenCalled();
    });

    it('lista vacía de ítems responde 422 ITEMS_REQUIRED', async () => {
      const error: any = await service
        .createFromPurchaseOrder(40, body({ items: [] }) as any)
        .catch((e) => e);
      expect(error.errorCode).toBe('INVOICING_SUPPORT_PO_001');
      expect(error.getResponse().details.missing.map((m: any) => m.code)).toEqual([
        'ITEMS_REQUIRED',
      ]);
    });

    // El vencimiento se valida en el borrador: `resolveDueDate` corre después
    // de numerar, así que un crédito sin fecha gastaba un consecutivo DS.
    it('crédito sin vencimiento: 422 DUE_DATE_REQUIRED y nada se crea', async () => {
      const error: any = await service
        .createFromPurchaseOrder(40, body({ payment_form: '2', due_date: undefined }) as any)
        .catch((e) => e);
      expect(error.errorCode).toBe('INVOICING_SUPPORT_PO_001');
      expect(error.getResponse().details.missing).toEqual([
        expect.objectContaining({ code: 'DUE_DATE_REQUIRED', field: 'due_date', target: 'review' }),
      ]);
      expect(invoicingCreate).not.toHaveBeenCalled();
      expect(invoicingCreateIdem).not.toHaveBeenCalled();
    });

    it('vencimiento anterior a la emisión: 422 DUE_DATE_BEFORE_ISSUE y nada se crea', async () => {
      const error: any = await service
        .createFromPurchaseOrder(
          40,
          body({ payment_form: '2', due_date: '2026-11-16' }) as any,
        )
        .catch((e) => e);
      expect(error.errorCode).toBe('INVOICING_SUPPORT_PO_001');
      expect(error.getResponse().details.missing.map((m: any) => m.code)).toEqual([
        'DUE_DATE_BEFORE_ISSUE',
      ]);
      expect(invoicingCreate).not.toHaveBeenCalled();
    });

    it('crédito con vencimiento el mismo día de la emisión se crea', async () => {
      await service.createFromPurchaseOrder(
        40,
        body({ payment_form: '2', due_date: '2026-11-17' }) as any,
      );
      expect(invoicingCreate).toHaveBeenCalledTimes(1);
    });

    it('reintento con el client_request_id del documento vigente: replay de createIdempotently, no 409', async () => {
      const key = '3dd5fe96-659c-4ef7-b489-753007e411ca';
      invoicesFindFirst.mockResolvedValue({
        id: 77,
        invoice_number: 'DS-1',
        status: 'sent',
        client_request_id: key,
      });
      invoicingCreateIdem.mockResolvedValue({ invoice: { id: 77 }, replayed: true });
      const result = await service.createFromPurchaseOrder(
        40,
        body({ client_request_id: key }) as any,
      );
      expect(result).toEqual({ invoice: { id: 77 }, replayed: true });
      expect(invoicingCreateIdem).toHaveBeenCalledTimes(1);
    });

    it('otro client_request_id frente a un documento vigente sigue siendo 409', async () => {
      invoicesFindFirst.mockResolvedValue({
        id: 77,
        invoice_number: 'DS-1',
        status: 'sent',
        client_request_id: 'otra-pestana',
      });
      const error: any = await service
        .createFromPurchaseOrder(40, body({ client_request_id: 'esta-pestana' }) as any)
        .catch((e) => e);
      expect(error.errorCode).toBe('INVOICING_SUPPORT_PO_002');
      expect(invoicingCreateIdem).not.toHaveBeenCalled();
    });

    it('con documento vigente: 409 INVOICING_SUPPORT_PO_002 con details.active_document', async () => {
      invoicesFindFirst.mockResolvedValue({
        id: 77,
        invoice_number: 'DS-1',
        status: 'sent',
      });
      const error: any = await service
        .createFromPurchaseOrder(40, body() as any)
        .catch((e) => e);
      expect(error.errorCode).toBe('INVOICING_SUPPORT_PO_002');
      expect(error.status).toBe(409);
      expect(error.getResponse().details).toEqual({
        active_document: { id: 77, invoice_number: 'DS-1', status: 'sent' },
      });
      expect(invoicingCreate).not.toHaveBeenCalled();
    });

    it('documento anterior anulado/cancelado no bloquea: el filtro de vigente los excluye y se crea', async () => {
      invoicesFindFirst.mockResolvedValue(null);
      await service.createFromPurchaseOrder(40, body() as any);
      expect(invoicesFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { notIn: ['cancelled', 'voided'] },
          }),
        }),
      );
      expect(invoicingCreate).toHaveBeenCalledTimes(1);
    });

    it('carrera/doble clic: P2002 del índice parcial se mapea al mismo 409', async () => {
      invoicesFindFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 78, invoice_number: 'DS-2', status: 'draft' });
      invoicingCreate.mockRejectedValue({
        code: 'P2002',
        meta: { target: 'invoices_po_active_support_document_key' },
      });
      const error: any = await service
        .createFromPurchaseOrder(40, body() as any)
        .catch((e) => e);
      expect(error.errorCode).toBe('INVOICING_SUPPORT_PO_002');
      expect(error.getResponse().details.active_document).toEqual({
        id: 78,
        invoice_number: 'DS-2',
        status: 'draft',
      });
    });

    it('P2002 con la forma del adaptador de Prisma 7 (sin meta.target) también es 409', async () => {
      invoicesFindFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 79, invoice_number: 'DS-3', status: 'sent' });
      invoicingCreate.mockRejectedValue({
        code: 'P2002',
        meta: {
          modelName: 'invoices',
          driverAdapterError: {
            cause: { kind: 'UniqueConstraintViolation', constraint: { index: ACTIVE_INDEX } },
          },
        },
      });
      const error: any = await service
        .createFromPurchaseOrder(40, body() as any)
        .catch((e) => e);
      expect(error.errorCode).toBe('INVOICING_SUPPORT_PO_002');
      expect(error.getResponse().details.active_document).toMatchObject({ id: 79 });
    });

    it('otro P2002 o un fallo de DB no se disfrazan de 409', async () => {
      const other = { code: 'P2002', meta: { target: ['store_id', 'invoice_number'] } };
      invoicingCreate.mockRejectedValue(other);
      await expect(
        service.createFromPurchaseOrder(40, body() as any),
      ).rejects.toBe(other);
    });
  });
});

describe('InvoicingService.findAll (QUI-684)', () => {
  let service: InvoicingService;
  let findMany: jest.Mock;
  let count: jest.Mock;

  beforeEach(() => {
    service = Object.create(InvoicingService.prototype);
    findMany = jest.fn().mockResolvedValue([]);
    count = jest.fn().mockResolvedValue(0);
    Object.assign(service, {
      prisma: { invoices: { findMany, count } },
      retry_queue: {
        getRetryStatusByInvoiceIds: jest.fn().mockResolvedValue(new Map()),
      },
    });
  });

  const whereOf = () => findMany.mock.calls[0][0].where;

  it('date_to sin date_from aplica lte solo', async () => {
    await service.findAll({ date_to: '2026-11-30' } as any);
    expect(whereOf().issue_date).toEqual({ lte: new Date('2026-11-30') });
  });

  it('date_from solo y ambos rangos conservan su comportamiento', async () => {
    await service.findAll({ date_from: '2026-11-01' } as any);
    expect(whereOf().issue_date).toEqual({ gte: new Date('2026-11-01') });
    findMany.mockClear();
    await service.findAll({
      date_from: '2026-11-01',
      date_to: '2026-11-30',
    } as any);
    expect(whereOf().issue_date).toEqual({
      gte: new Date('2026-11-01'),
      lte: new Date('2026-11-30'),
    });
  });

  it('sin fechas no agrega issue_date', async () => {
    await service.findAll({} as any);
    expect(whereOf()).not.toHaveProperty('issue_date');
  });

  it('filtra por purchase_order_id y trae la OC de origen en cada fila', async () => {
    await service.findAll({ purchase_order_id: 40 } as any);
    expect(whereOf().purchase_order_id).toBe(40);
    expect(findMany.mock.calls[0][0].include.purchase_order).toEqual({
      select: { id: true, order_number: true },
    });
  });

  it('sin purchase_order_id no filtra por OC', async () => {
    await service.findAll({} as any);
    expect(whereOf()).not.toHaveProperty('purchase_order_id');
  });
});
