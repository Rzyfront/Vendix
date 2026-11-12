import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';
import { ErrorCodes } from '../../../../common/errors';
import { PlatformInvoicingController } from './platform-invoicing.controller';

/**
 * Endpoints nuevos del riel plataforma: RUES super-admin, escáner IA de
 * borrador (kind `invoice_draft` con contexto platform) y el kind `customer`
 * en `customers/:kind/:id`.
 */
describe('PlatformInvoicingController — RUES, scan-draft y kind customer', () => {
  const responseService = {
    success: jest.fn((data: unknown, message?: string) => ({ success: true, data, message })),
  };
  const lookup = { lookup: jest.fn() };
  const scanner = { assertReady: jest.fn().mockResolvedValue(undefined) };
  const aiScanJobs = { enqueue: jest.fn().mockResolvedValue({ job_id: '77' }) };
  const tenants = { getTenantByKindAndId: jest.fn() };
  const subscriptionFiscal = {
    getSettingsForController: jest.fn().mockResolvedValue({
      platform_organization_id: 1,
      accounting_entity_id: 2,
      dian_configuration_id: 3,
    }),
  };

  const controller = new PlatformInvoicingController(
    responseService as any,
    { prisma: {} } as any,
    tenants as any,
    subscriptionFiscal as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    lookup as any,
    scanner as any,
    aiScanJobs as any,
  );

  beforeEach(() => jest.clearAllMocks());

  const proto = PlatformInvoicingController.prototype as any;
  const pathOf = (method: string) => Reflect.getMetadata(PATH_METADATA, proto[method]);
  const permsOf = (method: string) => Reflect.getMetadata(PERMISSIONS_KEY, proto[method]);

  it('lookup/external delega en ExternalIdentityLookupService con la misma respuesta', async () => {
    const result = { found: true, source: 'rues', unavailable: false };
    lookup.lookup.mockResolvedValue(result);
    const res = await controller.lookupExternalCustomer({ document_number: '900.123.456' });
    expect(lookup.lookup).toHaveBeenCalledWith('900.123.456');
    expect(res).toEqual({ success: true, data: result, message: undefined });
    expect(pathOf('lookupExternalCustomer')).toBe('customers/lookup/external');
    expect(Reflect.getMetadata(METHOD_METADATA, proto.lookupExternalCustomer)).toBe(
      RequestMethod.GET,
    );
    expect(permsOf('lookupExternalCustomer')).toEqual(['superadmin:fiscal:invoicing']);
  });

  it('lookup/external se declara ANTES de customers/:kind/:id', () => {
    const order = Object.getOwnPropertyNames(proto);
    expect(order.indexOf('lookupExternalCustomer')).toBeLessThan(
      order.indexOf('getTenantByKindAndId'),
    );
  });

  it('scan-draft/async encola invoice_draft con contexto platform → { job_id }', async () => {
    const files = [
      { mimetype: 'application/pdf', originalname: 'cot.pdf', buffer: Buffer.from('x'), size: 1 },
    ] as Express.Multer.File[];
    const res = await controller.scanSalesInvoiceDraftAsync(files, { note: ' 30 días ' });
    expect(scanner.assertReady).toHaveBeenCalled();
    expect(aiScanJobs.enqueue).toHaveBeenCalledWith('invoice_draft', files, {
      note: '30 días',
      context: 'platform',
    });
    expect(res.data).toEqual({ job_id: '77' });
    expect(pathOf('scanSalesInvoiceDraftAsync')).toBe('sales-invoices/scan-draft/async');
    expect(permsOf('scanSalesInvoiceDraftAsync')).toEqual(['superadmin:fiscal:invoicing']);
  });

  it('scan-draft/async rechaza un lote vacío antes de encolar', async () => {
    await expect(controller.scanSalesInvoiceDraftAsync([], {})).rejects.toMatchObject({
      errorCode: ErrorCodes.INVOICE_DRAFT_SCAN_NO_FILES.code,
    });
    expect(aiScanJobs.enqueue).not.toHaveBeenCalled();
  });

  it('customers/customer/:id resuelve kind customer', async () => {
    tenants.getTenantByKindAndId.mockResolvedValue({
      id: 'customer:9',
      kind: 'customer',
      tax_id: '900123456',
      tax_id_dv: '8',
      document_type: '31',
      person_type: '1',
      address: { line: 'x', city_code: '11001' },
    });
    const res = await controller.getTenantByKindAndId('customer', 9);
    expect(tenants.getTenantByKindAndId).toHaveBeenCalledWith(
      {},
      { organizationId: 1, kind: 'customer', id: 9 },
    );
    expect(res.data).toMatchObject({ id: 'customer:9', municipality_complete: true });
  });

  it('un kind desconocido no cae a organization: 404 de destinatario', async () => {
    await expect(controller.getTenantByKindAndId('bogus' as any, 1)).rejects.toMatchObject({
      errorCode: ErrorCodes.INVOICING_TENANT_NOT_FOUND.code,
    });
    expect(tenants.getTenantByKindAndId).not.toHaveBeenCalled();
  });
});

describe('PlatformInvoicingController — notas crédito/débito', () => {
  const responseService = {
    success: jest.fn((data: unknown, message?: string) => ({ success: true, data, message })),
    created: jest.fn((data: unknown, message?: string) => ({ success: true, data, message })),
  };
  const creditNotes = {
    createCreditNote: jest.fn(),
    createDebitNote: jest.fn(),
    getNotesOverview: jest.fn(),
  };
  const platformInvoicing = { listInvoices: jest.fn() };
  const subscriptionFiscal = {
    getSettingsForController: jest.fn().mockResolvedValue({
      platform_organization_id: 1,
      accounting_entity_id: 2,
      dian_configuration_id: 3,
    }),
  };
  const controller = new PlatformInvoicingController(
    {
      ...responseService,
      paginated: jest.fn((rows: unknown[], total: number) => ({ rows, total })),
    } as any,
    platformInvoicing as any,
    {} as any,
    subscriptionFiscal as any,
    creditNotes as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const proto = PlatformInvoicingController.prototype as any;
  const pathOf = (m: string) => Reflect.getMetadata(PATH_METADATA, proto[m]);
  const methodOf = (m: string) => Reflect.getMetadata(METHOD_METADATA, proto[m]);
  const permsOf = (m: string) => Reflect.getMetadata(PERMISSIONS_KEY, proto[m]);

  beforeEach(() => jest.clearAllMocks());

  it('POST credit-notes delegates with the actor and reports an accepted note', async () => {
    creditNotes.createCreditNote.mockResolvedValue({ dian_status: 'accepted', transmission_id: 9 });
    const dto: any = { related_invoice_id: 5, note_concept_code: '2', reason: 'r' };
    const res: any = await controller.createCreditNote(dto, { user: { id: 7 } } as any);
    expect(creditNotes.createCreditNote).toHaveBeenCalledWith(dto, 7);
    expect(res.message).toMatch(/aceptada por la DIAN/);
    expect(pathOf('createCreditNote')).toBe('credit-notes');
    expect(methodOf('createCreditNote')).toBe(RequestMethod.POST);
    expect(permsOf('createCreditNote')).toEqual(['superadmin:fiscal:invoicing']);
  });

  it('POST debit-notes does not announce success over a DIAN rejection', async () => {
    creditNotes.createDebitNote.mockResolvedValue({ dian_status: 'rejected', error_message: 'FAJ44' });
    const res: any = await controller.createDebitNote({} as any, { user: { id: 7 } } as any);
    expect(res.message).toMatch(/no la aceptó: FAJ44/);
    expect(pathOf('createDebitNote')).toBe('debit-notes');
    expect(permsOf('createDebitNote')).toEqual(['superadmin:fiscal:invoicing']);
  });

  it('GET invoices/:id/notes returns the overview', async () => {
    creditNotes.getNotesOverview.mockResolvedValue({ can_create_notes: false });
    const res: any = await controller.getInvoiceNotes(5);
    expect(creditNotes.getNotesOverview).toHaveBeenCalledWith(5);
    expect(res.data).toEqual({ can_create_notes: false });
    expect(pathOf('getInvoiceNotes')).toBe('invoices/:id/notes');
    expect(methodOf('getInvoiceNotes')).toBe(RequestMethod.GET);
    expect(permsOf('getInvoiceNotes')).toEqual(['superadmin:fiscal:invoicing']);
  });

  it('GET invoices passes the credit_note document_type filter through', async () => {
    platformInvoicing.listInvoices.mockResolvedValue({ rows: [], total: 0, page: 1, limit: 25 });
    await controller.listInvoices({ document_type: 'credit_note' } as any);
    expect(platformInvoicing.listInvoices.mock.calls[0][0].documentType).toBe('credit_note');
  });

  it('the document_type query DTO accepts the note values and rejects unknown ones', async () => {
    const { plainToInstance } = await import('class-transformer');
    const { validate } = await import('class-validator');
    const ListDto = Reflect.getMetadata('design:paramtypes', proto, 'listInvoices')[0];
    for (const ok of ['credit_note', 'debit_note', 'sales_invoice', 'support_document']) {
      expect(await validate(plainToInstance(ListDto, { document_type: ok }))).toHaveLength(0);
    }
    expect(await validate(plainToInstance(ListDto, { document_type: 'bogus' }))).not.toHaveLength(0);
  });
});
