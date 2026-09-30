import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { NormalizedReceivedDocument, ReceivedDocumentTax } from './interfaces/received-document.interface';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from './received-documents.service';
import { ReceivedDocumentStorageService } from './services/received-document-storage.service';
import { ReceivedDocumentParserService } from './services/received-document-parser.service';

const context: ReceivedDocumentsContext = {
  organization_id: 2,
  accounting_entity_id: 8,
  store_id: 3,
  actor_id: 11,
  is_organization: false,
};

const headerTax: ReceivedDocumentTax = {
  tax_type: 'iva', scheme_code: '01', tax_name: 'IVA', rate: '19',
  base_amount: '100.00', amount: '19.00',
};
const lineTax: ReceivedDocumentTax = { ...headerTax, line_number: 1 };

function normalized(overrides: Partial<NormalizedReceivedDocument> = {}): NormalizedReceivedDocument {
  return {
    document_type: 'invoice', invoice_number: 'FV-1', issuer_tax_id: '900123456',
    issuer_name: 'Proveedor', receiver_tax_id: '800123456', receiver_name: 'Comprador',
    document_key: 'a'.repeat(96), issue_date: '2026-09-30', due_date: '2026-10-30',
    currency: 'COP', subtotal_amount: '100.00', discount_amount: '0.00',
    tax_amount: '19.00', total_amount: '119.00', taxes: [headerTax],
    items: [{ line_number: 1, description: 'Producto', quantity: '2', unit_price: '50',
      discount_amount: '0.00', net_amount: '100.00', total_amount: '119.00', taxes: [lineTax] }],
    validation: { errors: [], warnings: [], has_signature: false, document_key_format_valid: true },
    ...overrides,
  };
}

function manualDto(overrides: Record<string, unknown> = {}): any {
  return {
    document_type: 'invoice', invoice_number: 'FV-MAN-1', issuer_tax_id: '900123456',
    issuer_name: 'Proveedor', receiver_tax_id: '800123456', receiver_name: 'Comprador',
    issue_date: '2026-09-30', currency: 'COP', subtotal_amount: '100.00',
    discount_amount: '0.00', tax_amount: '19.00', total_amount: '119.00',
    taxes: [{ tax_type: 'iva', scheme_code: '01', tax_name: 'IVA', rate: '19', base_amount: '100.00', amount: '19.00' }],
    items: [{ description: 'Producto', quantity: '2', unit_price: '50', discount_amount: '0.00',
      net_amount: '100.00', total_amount: '119.00', taxes: [{ tax_type: 'iva', scheme_code: '01',
        tax_name: 'IVA', rate: '19', base_amount: '100.00', amount: '19.00' }] }],
    ...overrides,
  };
}

function makeHarness() {
  const createdDocs = new Map<string, any>();
  let nextId = 50;
  let fileSha: string | null = null;
  const tx: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    received_documents: {
      findFirst: jest.fn(async ({ where }: any) => where?.idempotency_key
        ? createdDocs.get(where.idempotency_key) ?? null
        : [...createdDocs.values()].find((row) => row.id === where?.id) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: nextId++, ...data };
        createdDocs.set(data.idempotency_key, row);
        return row;
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    received_document_items: {
      create: jest.fn().mockResolvedValue({ id: 900 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    received_document_taxes: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    received_document_files: {
      findFirst: jest.fn(async () => fileSha ? { id: 1 } : null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async ({ data }: any) => { fileSha = data.sha256; return { id: 1, ...data }; }),
    },
    received_document_events: {
      create: jest.fn().mockResolvedValue({ id: 1 }),
      upsert: jest.fn().mockResolvedValue({ id: 1 }),
    },
  };
  const baseClient: any = {
    accounting_entities: { findFirst: jest.fn().mockResolvedValue({ id: 8, organization_id: 2, store_id: null, tax_id: '900000001', is_active: true }) },
    stores: { findFirst: jest.fn().mockResolvedValue({ id: 3, is_active: true }) },
    organization_settings: {
      findFirst: jest.fn().mockResolvedValue({ settings: { fiscal_data: { nit: '800123456' } } }),
    },
    store_settings: {
      findFirst: jest.fn().mockResolvedValue({ settings: { fiscal_data: { nit: '700111222' } } }),
    },
  };
  const prisma: any = {
    withoutScope: jest.fn(() => baseClient),
    $transaction: jest.fn(async (callback: (client: any) => Promise<any>) => callback(tx)),
    received_documents: {
      findFirst: jest.fn(async ({ where, select }: any) => {
        if (select?.metadata) return { metadata: { source_format: 'ubl_xml' } };
        if (where?.id) return { id: where.id, version: 1, source_channel: 'xml',
          fiscal_status: 'pending', posting_status: 'pending', accepted_at: null,
          processing_status: 'ready', validation_status: 'valid', review_status: 'pending',
          raw_payload: { source_format: 'ubl_xml', normalized: normalized() }, metadata: { source_format: 'ubl_xml' },
          items: [], taxes: [], files: [], links: [], events: [] };
        return null;
      }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    received_document_files: {
      findFirst: jest.fn(async () => fileSha ? { id: 1 } : null),
    },
  };
  const parser: any = { parse: jest.fn(() => normalized()) };
  const storage: any = {
    upload: jest.fn(async (_ctx: any, _id: number, file: any) => ({
      file_key: 'organizations/2/fiscal-entities/8/received-documents/50/key',
      file_name: file.originalname, mime_type: file.mimetype, file_size: file.size,
      sha256: require('crypto').createHash('sha256').update(file.buffer).digest('hex'),
    })),
    download: jest.fn().mockResolvedValue(Buffer.from('test file')),
  };
  return { service: new ReceivedDocumentsService(prisma, parser as ReceivedDocumentParserService, storage as ReceivedDocumentStorageService), prisma, baseClient, tx, parser, storage, createdDocs };
}

const xmlFile = () => ({
  buffer: Buffer.from('<Invoice/>'), originalname: 'factura.xml', mimetype: 'application/xml', size: 10,
}) as Express.Multer.File;

describe('ReceivedDocumentsService tenant-safe persistence', () => {
  it('scopes every store list query by organization, accounting entity and current store', async () => {
    const h = makeHarness();
    await h.service.list(context, { page: 1, limit: 25 } as any);
    expect(h.prisma.received_documents.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organization_id: 2, accounting_entity_id: 8, store_id: 3 }),
      skip: 0, take: 25,
    }));
  });

  it('rejects a store caller selecting another store', async () => {
    const h = makeHarness();
    await expect(h.service.list(context, { page: 1, limit: 25, store_id: 4 } as any))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(h.prisma.received_documents.findMany).not.toHaveBeenCalled();
  });

  it('rejects an inactive fiscal entity even when tenant ownership matches', async () => {
    const h = makeHarness();
    h.baseClient.accounting_entities.findFirst.mockResolvedValueOnce({
      id: 8, organization_id: 2, store_id: null, is_active: false,
    });
    await expect(h.service.list(context, { page: 1, limit: 25 } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.prisma.received_documents.findMany).not.toHaveBeenCalled();
  });

  it('keeps organization reads within the explicitly selected active store', async () => {
    const h = makeHarness();
    const organizationContext = { ...context, is_organization: true };
    await h.service.list(organizationContext, { page: 1, limit: 25 } as any);
    expect(h.prisma.received_documents.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organization_id: 2, accounting_entity_id: 8, store_id: 3 }),
    }));
  });

  it('returns not-found for a foreign document id without unscoped fallback', async () => {
    const h = makeHarness();
    h.prisma.received_documents.findFirst.mockResolvedValueOnce(null);
    await expect(h.service.findOne(context, 999)).rejects.toBeInstanceOf(NotFoundException);
    expect(h.prisma.received_documents.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 999, organization_id: 2, accounting_entity_id: 8, store_id: 3 }),
    }));
    expect(h.prisma.withoutScope).toHaveBeenCalledTimes(1);
  });

  it('returns header taxes separately while retaining per-item taxes under items', async () => {
    const h = makeHarness();
    await h.service.findOne(context, 50);
    expect(h.prisma.received_documents.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 50, organization_id: 2, accounting_entity_id: 8, store_id: 3 }),
      include: expect.objectContaining({
        taxes: { where: { item_id: null } },
        items: expect.objectContaining({ include: { taxes: true } }),
      }),
    }));
  });

  it('reuses the same idempotent document and attaches the original file only once', async () => {
    const h = makeHarness();
    await h.service.importXml(context, xmlFile());
    await h.service.importXml(context, xmlFile());
    expect(h.tx.received_documents.create).toHaveBeenCalledTimes(1);
    expect(h.tx.received_document_items.create).toHaveBeenCalledTimes(1);
    expect(h.storage.upload).toHaveBeenCalledTimes(1);
  });

  it('uses canonical RUT NIT rather than a different accounting entity projection', async () => {
    const h = makeHarness();
    await h.service.importXml(context, xmlFile());
    expect(h.baseClient.organization_settings.findFirst).toHaveBeenCalledWith({
      where: { organization_id: 2 }, select: { settings: true },
    });
    expect(h.tx.received_documents.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ validation_status: 'valid' }),
    }));
  });

  it('reads the store fiscal settings for a STORE accounting entity', async () => {
    const h = makeHarness();
    h.baseClient.accounting_entities.findFirst.mockResolvedValue({
      id: 8, organization_id: 2, store_id: 3, tax_id: '800123456', is_active: true,
    });
    h.parser.parse.mockReturnValue(normalized({ receiver_tax_id: '700.111.222-0' }));
    await h.service.importXml(context, xmlFile());
    expect(h.baseClient.store_settings.findFirst).toHaveBeenCalledWith({
      where: { store_id: 3 }, select: { settings: true },
    });
    expect(h.baseClient.organization_settings.findFirst).not.toHaveBeenCalled();
    expect(h.tx.received_documents.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ validation_status: 'valid' }),
    }));
  });

  it('accepts dotted NIT plus supplied DV when its normalized base matches the canonical NIT', async () => {
    const h = makeHarness();
    h.parser.parse.mockReturnValue(normalized({ receiver_tax_id: '800.123.456-0' }));
    await h.service.importXml(context, xmlFile());
    expect(h.tx.received_documents.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ validation_status: 'valid' }),
    }));
  });

  it('blocks a wrong receiver NIT but persists the imported record and original XML', async () => {
    const h = makeHarness();
    h.parser.parse.mockReturnValue(normalized({ receiver_tax_id: '700111222' }));
    await h.service.importXml(context, xmlFile());
    expect(h.tx.received_documents.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ validation_status: 'invalid', fiscal_status: 'pending' }),
    }));
    expect(h.storage.upload).toHaveBeenCalledTimes(1);
    const validation = h.tx.received_documents.create.mock.calls[0][0].data.validation_summary;
    expect(validation.errors.map((error: any) => error.code)).toContain('RECEIVER_TAX_ID_MISMATCH');
    expect(h.tx.received_document_taxes.createMany.mock.calls.flatMap((call: any[]) => call[0].data)
      .every((tax: any) => tax.eligible_amount.toString() === '0')).toBe(true);
  });

  it('blocks a wrong receiver NIT on manual intake without inventing a fiscal match', async () => {
    const h = makeHarness();
    await h.service.createManual(context, manualDto({ receiver_tax_id: '700111222' }));
    const data = h.tx.received_documents.create.mock.calls[0][0].data;
    expect(data.validation_status).toBe('invalid');
    expect(data.fiscal_status).toBe('pending');
    expect(data.validation_summary.errors.map((error: any) => error.code)).toContain('RECEIVER_TAX_ID_MISMATCH');
    expect(h.storage.upload).not.toHaveBeenCalled();
  });

  it('revalidates edited manual facts against canonical NIT while preserving reviewed error details', async () => {
    const h = makeHarness();
    h.prisma.received_documents.findFirst.mockResolvedValueOnce({
      id: 50, version: 1, source_channel: 'manual', fiscal_status: 'pending', posting_status: 'pending',
      accepted_at: null, metadata: { source_format: 'manual_entry' },
    });
    await h.service.updateReview(context, 50, {
      expected_version: 1, facts: manualDto({ receiver_tax_id: '700111222' }),
    } as any);
    expect(h.tx.received_documents.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ validation_status: 'invalid' }),
    }));
    const updateData = h.tx.received_documents.updateMany.mock.calls[0][0].data;
    expect(updateData.validation_summary.errors.map((error: any) => error.code)).toContain('RECEIVER_TAX_ID_MISMATCH');
    expect(h.storage.upload).not.toHaveBeenCalled();
  });

  it('validates OCR extraction identity before canonicalization and persistence', async () => {
    const h = makeHarness();
    h.prisma.received_documents.findFirst
      .mockResolvedValueOnce({
        id: 50, version: 1, validation_status: 'pending', processing_status: 'pending_ocr',
        metadata: { source_format: 'pending_file' }, raw_payload: { source_format: 'pending_file' },
      })
      .mockResolvedValueOnce({ id: 50, files: [], items: [], taxes: [], links: [], events: [] });
    await h.service.replaceFromExtraction(context, 50, normalized({ receiver_tax_id: '700111222' }));
    expect(h.tx.received_documents.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ validation_status: 'invalid' }),
    }));
    const data = h.tx.received_documents.updateMany.mock.calls[0][0].data;
    expect(data.validation_summary.errors.map((error: any) => error.code)).toContain('RECEIVER_TAX_ID_MISMATCH');
  });

  it('stores nominal IBUA unit basis metadata without placing units in monetary columns', async () => {
    const h = makeHarness();
    const unitIbua: ReceivedDocumentTax = {
      tax_type: 'ibua', scheme_code: '34', tax_name: 'IBUA', rate: '0', base_amount: '0.00', amount: '1.00',
      tax_basis_type: 'unit', base_quantity: '1000.00', base_unit_code: 'ML', per_unit_amount: '0.10',
    };
    h.parser.parse.mockReturnValue(normalized({ taxes: [unitIbua], items: [{
      line_number: 1, description: 'Producto', quantity: '2', unit_price: '50', discount_amount: '0.00',
      net_amount: '100.00', total_amount: '101.00', taxes: [],
    }] }));
    await h.service.importXml(context, xmlFile());
    const tax = h.tx.received_document_taxes.createMany.mock.calls[0][0].data[0];
    expect(tax.item_id).toBeNull();
    expect(tax.base_amount.toString()).toBe('0');
    expect(tax.metadata).toEqual({
      tax_basis_type: 'unit', base_quantity: '1000.00', base_unit_code: 'ML', per_unit_amount: '0.10',
    });
    expect(tax.eligible_amount.toString()).toBe('0');
  });

  it('blocks documents when canonical NIT is unconfigured instead of assuming a match', async () => {
    const h = makeHarness();
    h.baseClient.accounting_entities.findFirst.mockResolvedValue({
      id: 8, organization_id: 2, store_id: null, tax_id: null, is_active: true,
    });
    h.baseClient.organization_settings.findFirst.mockResolvedValue({ settings: {} });
    await h.service.importXml(context, xmlFile());
    const data = h.tx.received_documents.create.mock.calls[0][0].data;
    expect(data.validation_status).toBe('invalid');
    expect(data.validation_summary.errors.map((error: any) => error.code)).toContain('RECEIVER_FISCAL_IDENTITY_UNCONFIGURED');
    expect(h.storage.upload).toHaveBeenCalledTimes(1);
  });

  it('surfaces identity-settings read failure as retryable without persisting with an invented NIT', async () => {
    const h = makeHarness();
    h.baseClient.organization_settings.findFirst.mockRejectedValueOnce(new Error('db unavailable'));
    await expect(h.service.importXml(context, xmlFile())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(h.tx.received_documents.create).not.toHaveBeenCalled();
    expect(h.storage.upload).not.toHaveBeenCalled();
  });

  it('retains invalid extracted quantities as evidence without writing a DB-incompatible line', async () => {
    const h = makeHarness();
    h.parser.parse.mockReturnValueOnce(normalized({
      items: [{ line_number: 1, description: 'Cantidad inválida', quantity: '0', unit_price: '50',
        discount_amount: '0.00', net_amount: '0.00', total_amount: '0.00', taxes: [] }],
      validation: { errors: [{ code: 'INVALID_LINE_QUANTITY', message: 'bad quantity' }], warnings: [],
        has_signature: false, document_key_format_valid: true },
    }));

    await h.service.importXml(context, xmlFile());

    expect(h.tx.received_document_items.create).not.toHaveBeenCalled();
    expect(h.tx.received_documents.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ validation_status: 'invalid', currency: 'COP' }),
    }));
    expect(h.tx.received_documents.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ metadata: expect.objectContaining({ skipped_invalid_line_numbers: [1] }) }),
    }));
  });

  it('rejects a duplicate document key carrying conflicting fiscal facts', async () => {
    const h = makeHarness();
    h.createdDocs.set(`key:${'a'.repeat(96)}`, {
      id: 77, raw_payload: { normalized: normalized({ total_amount: '120.00' }) },
    });
    await expect(h.service.importXml(context, xmlFile())).rejects.toBeInstanceOf(ConflictException);
    expect(h.tx.received_documents.create).not.toHaveBeenCalled();
    expect(h.storage.upload).not.toHaveBeenCalled();
  });

  it('uses optimistic versions and refuses a stale review write', async () => {
    const h = makeHarness();
    h.tx.received_documents.updateMany.mockResolvedValue({ count: 0 });
    await expect(h.service.updateReview(context, 50, { expected_version: 1, reviewer_note: 'Revisar' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(h.tx.received_documents.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 50, organization_id: 2, accounting_entity_id: 8, store_id: 3, version: 1 }),
    }));
  });

  it.each([
    ['negative amount', { subtotal_amount: '-1.00' }],
    ['overflow amount', { subtotal_amount: '10000000000000.00' }],
  ])('rejects %s in manual entry before any write', async (_label, input) => {
    const h = makeHarness();
    await expect(h.service.createManual(context, manualDto(input))).rejects.toBeInstanceOf(BadRequestException);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('persists header taxes separately from line taxes and never calculates eligibility at intake', async () => {
    const h = makeHarness();
    await h.service.createManual(context, manualDto());
    const rows = h.tx.received_document_taxes.createMany.mock.calls.map((call: any[]) => call[0].data[0]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ item_id: null, tax_type: 'iva', treatment: 'pending' });
    expect(rows[0].eligible_amount.toString()).toBe('0');
    expect(rows[1]).toMatchObject({ item_id: 900, tax_type: 'iva', treatment: 'pending' });
    expect(rows[1].eligible_amount.toString()).toBe('0');
    expect(h.storage.upload).not.toHaveBeenCalled();
  });

  it('keeps an S3 failure visible and retryable instead of returning success without an original', async () => {
    const h = makeHarness();
    h.storage.upload.mockRejectedValueOnce(new Error('private S3 detail'));
    await expect(h.service.importXml(context, xmlFile())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(h.tx.received_documents.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 50, organization_id: 2, accounting_entity_id: 8, store_id: 3 }),
      data: { processing_status: 'error' },
    }));
    expect(h.tx.received_document_events.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ status: 'retryable', result: { reason: 'original_storage_unavailable' } }),
    }));
  });

  it('checks document/file ownership before calling storage download', async () => {
    const h = makeHarness();
    h.prisma.received_documents.findFirst.mockResolvedValueOnce(null);
    await expect(h.service.getFile(context, 999, 1)).rejects.toBeInstanceOf(NotFoundException);
    expect(h.storage.download).not.toHaveBeenCalled();
  });

  it('rekeys an extracted pending PDF to the canonical fiscal key under the entity lock', async () => {
    const h = makeHarness();
    const pending = {
      id: 50, version: 1, validation_status: 'pending', processing_status: 'pending_ocr',
      metadata: { source_format: 'pending_file' }, raw_payload: { source_format: 'pending_file' },
    };
    h.prisma.received_documents.findFirst
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ id: 50, files: [], items: [], taxes: [], links: [], events: [] });

    await h.service.replaceFromExtraction(context, 50, normalized());

    expect(h.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(h.tx.received_documents.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ idempotency_key: `key:${'a'.repeat(96)}`, processing_status: 'ready' }),
    }));
    expect(h.tx.received_document_events.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ event_type: 'EXTRACTED' }),
    }));
  });

  it('merges identical OCR facts into the canonical document and preserves original evidence', async () => {
    const h = makeHarness();
    const pending = {
      id: 50, version: 1, validation_status: 'pending', processing_status: 'pending_ocr',
      metadata: { source_format: 'pending_file' }, raw_payload: { source_format: 'pending_file' },
    };
    const canonical = { id: 77, raw_payload: { normalized: normalized() }, metadata: { source_format: 'ubl_xml' } };
    h.createdDocs.set(`key:${'a'.repeat(96)}`, canonical);
    h.prisma.received_documents.findFirst
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ id: 77, files: [], items: [], taxes: [], links: [], events: [] });
    const bytes = Buffer.from('test file');
    const sha256 = require('crypto').createHash('sha256').update(bytes).digest('hex');
    h.tx.received_document_files.findMany.mockResolvedValueOnce([{
      id: 5, document_id: 50, file_key: 'pending-key', file_name: 'scan.pdf',
      mime_type: 'application/pdf', file_size: bytes.length, sha256, role: 'original',
    }]);
    h.storage.download.mockResolvedValueOnce(bytes);

    await h.service.replaceFromExtraction(context, 50, normalized());

    expect(h.storage.download).toHaveBeenCalledWith(expect.any(Object), 50, 'pending-key');
    expect(h.storage.upload).toHaveBeenCalledWith(expect.any(Object), 77, expect.objectContaining({ buffer: bytes }));
    expect(h.tx.received_document_files.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ document_id: 77, sha256 }),
    }));
    expect(h.tx.received_documents.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ processing_status: 'duplicate', idempotency_key: 'merged:50' }),
    }));
    expect(h.tx.received_document_events.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ event_type: 'MERGED_DUPLICATE' }),
    }));
  });

  it('leaves a pending OCR record recoverable when the canonical key has conflicting facts', async () => {
    const h = makeHarness();
    const pending = {
      id: 50, version: 1, validation_status: 'pending', processing_status: 'pending_ocr',
      metadata: { source_format: 'pending_file' }, raw_payload: { source_format: 'pending_file' },
    };
    h.createdDocs.set(`key:${'a'.repeat(96)}`, {
      id: 77, raw_payload: { normalized: normalized({ total_amount: '120.00' }) },
    });
    h.prisma.received_documents.findFirst.mockResolvedValueOnce(pending);

    await expect(h.service.replaceFromExtraction(context, 50, normalized())).rejects.toBeInstanceOf(ConflictException);
    expect(h.tx.received_documents.updateMany).not.toHaveBeenCalled();
    expect(h.storage.upload).not.toHaveBeenCalled();
  });
});
