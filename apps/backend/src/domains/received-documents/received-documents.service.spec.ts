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
  return {
    service: new ReceivedDocumentsService(prisma, parser as ReceivedDocumentParserService, storage as ReceivedDocumentStorageService),
    prisma, baseClient, tx, parser, storage, createdDocs,
    setFileSha: (sha: string | null) => { fileSha = sha; },
  };
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

  it('allows reviewed OCR corrections while preserving original payload, extraction snapshot and evidence', async () => {
    const h = makeHarness();
    const extracted = normalized({ invoice_number: 'OCR-ORIGINAL' });
    h.prisma.received_documents.findFirst.mockResolvedValueOnce({
      id: 50, version: 1, source_channel: 'manual', source_hash: 'a'.repeat(64),
      processing_status: 'ready', validation_status: 'needs_review', fiscal_status: 'pending',
      posting_status: 'pending', accepted_at: null,
      raw_payload: { source_format: 'pending_file', source_hash: 'a'.repeat(64), original_file_name: 'scan.pdf' },
      metadata: { source_format: 'pending_file', extraction_snapshot: extracted },
      files: [{ id: 9, file_name: 'scan.pdf', sha256: 'a'.repeat(64), role: 'original' }],
    });
    await h.service.updateReview(context, 50, {
      expected_version: 1, facts: manualDto({ invoice_number: 'OCR-CORRECTED' }), reviewer_note: 'OCR corregido',
    } as any);

    const update = h.tx.received_documents.updateMany.mock.calls[0][0].data;
    expect(update.invoice_number).toBe('OCR-CORRECTED');
    expect(update).not.toHaveProperty('raw_payload');
    expect(update).not.toHaveProperty('fiscal_status');
    expect(update).not.toHaveProperty('posting_status');
    expect(update.metadata).toMatchObject({
      source_format: 'pending_file',
      extraction_snapshot: extracted,
      reviewed_snapshot: expect.objectContaining({ invoice_number: 'OCR-CORRECTED' }),
    });
    expect(h.tx.received_document_taxes.createMany.mock.calls.flatMap((call: any[]) => call[0].data)
      .every((tax: any) => tax.eligible_amount.toString() === '0')).toBe(true);
    const event = h.tx.received_document_events.create.mock.calls[0][0].data;
    expect(event.result).toMatchObject({
      source_format: 'pending_file', source_hash: 'a'.repeat(64),
      extraction_snapshot_preserved: true,
      original_evidence: [{ id: 9, file_name: 'scan.pdf', sha256: 'a'.repeat(64), role: 'original' }],
    });
    expect(h.storage.upload).not.toHaveBeenCalled();
  });

  it.each([
    ['still pending OCR', { source_format: 'pending_file' }, 'pending_ocr'],
    ['OCR failed', { source_format: 'pending_file' }, 'error'],
    ['XML original', { source_format: 'ubl_xml' }, 'ready'],
  ])('rejects fiscal fact editing for %s', async (_label, metadata, processing_status) => {
    const h = makeHarness();
    h.prisma.received_documents.findFirst.mockResolvedValueOnce({
      id: 50, version: 1, processing_status, validation_status: 'pending',
      fiscal_status: 'pending', posting_status: 'pending', accepted_at: null,
      metadata, raw_payload: { source_format: metadata.source_format },
    });
    await expect(h.service.updateReview(context, 50, {
      expected_version: 1, facts: manualDto(),
    } as any)).rejects.toBeInstanceOf(ConflictException);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('normalizes incomplete or invalid OCR facts into blocking errors without throwing', () => {
    const h = makeHarness();
    const facts = h.service.normalizeExtractionFacts({} as any);
    const codes = facts.validation.errors.map((error) => error.code);
    expect(codes).toContain('MISSING_DOCUMENT_NUMBER');
    expect(codes).toContain('MISSING_ISSUER_TAX_ID');
    expect(codes).toContain('MISSING_RECEIVER_TAX_ID');
    expect(codes).toContain('INVALID_CURRENCY');
    expect(codes).toContain('MISSING_OR_INVALID_ISSUE_DATE');
    expect(codes).toContain('MISSING_DOCUMENT_LINES');
    expect(facts.currency).toBe('UNKNOWN');
    const invalid = h.service.normalizeExtractionFacts(manualDto({
      items: [{ description: '', quantity: '-1', unit_price: 'not-money', discount_amount: '0.00',
        net_amount: '0.00', total_amount: '0.00' }],
    }));
    expect(invalid.validation.errors.map((error) => error.code)).toContain('NEGATIVE_SOURCE_LINE_1_QUANTITY');
    expect(invalid.validation.errors.map((error) => error.code)).toContain('INVALID_SOURCE_LINE_1_PRICE');
    expect(invalid.validation.errors.map((error) => error.code)).toContain('MISSING_LINE_DESCRIPTION');
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('bounds OCR line and tax arrays before normalization and returns blocking issues', () => {
    const h = makeHarness();
    const tax = { tax_type: 'iva', scheme_code: '01', tax_name: 'IVA', rate: '0', base_amount: '0.00', amount: '0.00' };
    const line = { description: 'Línea', quantity: '1', unit_price: '1', discount_amount: '0.00',
      net_amount: '1.00', total_amount: '1.00', taxes: Array.from({ length: 21 }, () => tax) };
    const result = h.service.normalizeExtractionFacts(manualDto({
      items: Array.from({ length: 501 }, () => line),
      taxes: Array.from({ length: 101 }, () => tax),
    }));
    expect(result.items).toHaveLength(500);
    expect(result.items[0].taxes).toHaveLength(20);
    expect(result.taxes).toHaveLength(100);
    const codes = result.validation.errors.map((error) => error.code);
    expect(codes).toContain('TOO_MANY_DOCUMENT_LINES');
    expect(codes).toContain('TOO_MANY_HEADER_TAX_ROWS');
    expect(codes).toContain('TOO_MANY_LINE_TAX_ROWS');
  });

  it('does not demote a ready extracted document when the original PDF is re-uploaded', async () => {
    const h = makeHarness();
    const file = {
      buffer: Buffer.from('%PDF-1.4 scan'), originalname: 'scan.pdf',
      mimetype: 'application/pdf', size: Buffer.byteLength('%PDF-1.4 scan'),
    } as Express.Multer.File;
    const sha = require('crypto').createHash('sha256').update(file.buffer).digest('hex');
    const extracted = normalized();
    h.createdDocs.set('key:canonical', {
      id: 77, idempotency_key: 'key:canonical', processing_status: 'ready',
      validation_status: 'needs_review', source_hash: sha,
      metadata: { source_format: 'pending_file', extraction_snapshot: extracted },
    });
    h.tx.received_document_files.findMany.mockResolvedValueOnce([{ document_id: 77 }]);
    h.setFileSha(sha);

    await h.service.createPendingFile(context, file);

    expect(h.storage.upload).not.toHaveBeenCalled();
    expect(h.prisma.received_documents.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: { processing_status: 'pending_ocr' },
    }));
  });

  it('scopes duplicate file-hash lookup to the current fiscal tenant before resolving its canonical alias', async () => {
    const h = makeHarness();
    const file = {
      buffer: Buffer.from('%PDF-1.4 alias'), originalname: 'alias.pdf',
      mimetype: 'application/pdf', size: Buffer.byteLength('%PDF-1.4 alias'),
    } as Express.Multer.File;
    const sha = require('crypto').createHash('sha256').update(file.buffer).digest('hex');
    const alias = { id: 50, idempotency_key: 'merged:50', metadata: {
      source_format: 'pending_file', merged_into_document_id: 77,
    }, processing_status: 'duplicate' };
    const canonical = { id: 77, idempotency_key: 'key:canonical', metadata: {
      source_format: 'pending_file', extraction_snapshot: normalized(),
    }, processing_status: 'ready' };
    h.createdDocs.set('merged:50', alias);
    h.createdDocs.set('key:canonical', canonical);
    h.tx.received_document_files.findMany.mockResolvedValueOnce([{ document_id: 50 }]);
    h.setFileSha(sha);

    await h.service.createPendingFile(context, file);

    expect(h.tx.received_document_files.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        sha256: sha,
        document: { organization_id: 2, accounting_entity_id: 8, store_id: 3 },
      },
    }));
    expect(h.prisma.received_documents.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 77, organization_id: 2, accounting_entity_id: 8, store_id: 3 }),
    }));
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

  it('stores nominal IBUA metadata and preserves an optional monetary taxable amount', async () => {
    const h = makeHarness();
    const unitIbua: ReceivedDocumentTax = {
      tax_type: 'ibua', scheme_code: '34', tax_name: 'IBUA', rate: '0', base_amount: '100.00', amount: '1.00',
      tax_basis_type: 'unit', base_quantity: '1000.00', base_unit_code: 'ML', per_unit_amount: '0.10',
    };
    h.parser.parse.mockReturnValue(normalized({ taxes: [unitIbua], items: [{
      line_number: 1, description: 'Producto', quantity: '2', unit_price: '50', discount_amount: '0.00',
      net_amount: '100.00', total_amount: '101.00', taxes: [],
    }] }));
    await h.service.importXml(context, xmlFile());
    const tax = h.tx.received_document_taxes.createMany.mock.calls[0][0].data[0];
    expect(tax.item_id).toBeNull();
    expect(tax.base_amount.toString()).toBe('100');
    expect(tax.metadata).toEqual({
      tax_basis_type: 'unit', base_quantity: '1000.00', base_unit_code: 'ML', per_unit_amount: '0.10',
    });
    expect(tax.eligible_amount.toString()).toBe('0');
  });

  it('accepts complete nominal IBUA facts on manual header and item taxes and persists explicit metadata', async () => {
    const h = makeHarness();
    const unitIbua = {
      tax_type: 'ibua', scheme_code: '34', tax_name: 'IBUA', tax_basis_type: 'unit',
      base_quantity: '1000.00', base_unit_code: 'ML', per_unit_amount: '0.10', amount: '1.00',
    };
    await h.service.createManual(context, manualDto({
      tax_amount: '1.00', tax_inclusive_amount: '101.00', total_amount: '101.00',
      taxes: [unitIbua],
      items: [{ description: 'Bebida', quantity: '1', unit_price: '100.00', discount_amount: '0.00',
        net_amount: '100.00', total_amount: '101.00', taxes: [unitIbua] }],
    }));
    const rows = h.tx.received_document_taxes.createMany.mock.calls.map((call: any[]) => call[0].data[0]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ item_id: null, tax_type: 'ibua', rate: expect.anything(), base_amount: expect.anything() });
    expect(rows[0].rate.toString()).toBe('0');
    expect(rows[0].base_amount.toString()).toBe('0');
    expect(rows[0].metadata).toEqual({ tax_basis_type: 'unit', base_quantity: '1000.00', base_unit_code: 'ML', per_unit_amount: '0.10' });
    expect(rows[1].item_id).toBe(900);
    expect(rows[1].metadata).toEqual(rows[0].metadata);
    expect(rows.every((tax: any) => tax.eligible_amount.toString() === '0' && tax.treatment === 'pending')).toBe(true);
  });

  it.each([
    ['mismatched nominal arithmetic', { amount: '1.02' }, 'UNIT_TAX_AMOUNT_MISMATCH'],
    ['HALF_EVEN intermediate product .5049', { base_quantity: '50.49', per_unit_amount: '0.01', amount: '0.02' }, 'UNIT_TAX_AMOUNT_MISMATCH'],
    ['nonzero nominal percentage', { rate: '19' }, 'UNIT_TAX_RATE_MUST_BE_ZERO'],
    ['incomplete unit facts', { base_quantity: null, base_unit_code: null, per_unit_amount: null }, 'INCOMPLETE_UNIT_TAX_BASIS'],
    ['unsupported unit scheme', { tax_type: 'icui', scheme_code: '35' }, 'UNSUPPORTED_UNIT_TAX'],
    ['excess source precision', { base_quantity: '1000.001' }, 'DECIMAL_OVERFLOW_TAX_BASE_QUANTITY'],
  ])('blocks %s as a manual basis error and as nonthrowing OCR review validation', async (_label, taxOverride, expectedCode) => {
    const h = makeHarness();
    const tax = {
      tax_type: 'ibua', scheme_code: '34', tax_name: 'IBUA', tax_basis_type: 'unit',
      base_quantity: '1000.00', base_unit_code: 'ML', per_unit_amount: '0.10', amount: '1.00',
      ...taxOverride,
    };
    const input = manualDto({
      tax_amount: '1.00', tax_inclusive_amount: '101.00', total_amount: '101.00', taxes: [tax],
      items: [{ description: 'Bebida', quantity: '1', unit_price: '100.00', discount_amount: '0.00', net_amount: '100.00', total_amount: '101.00', taxes: [tax] }],
    });
    await expect(h.service.createManual(context, input)).rejects.toBeInstanceOf(BadRequestException);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
    const extracted = h.service.normalizeExtractionFacts(input);
    expect(extracted.validation.errors.map((error) => error.code)).toContain(expectedCode);
  });

  it('requires explicit unit basis for nominal fields and defaults absent/null fields to monetary', async () => {
    const h = makeHarness();
    const nominalWithoutBasis = h.service.normalizeExtractionFacts(manualDto({
      taxes: [{ tax_type: 'ibua', scheme_code: '34', tax_name: 'IBUA', base_quantity: '1000.00', base_unit_code: 'ML', per_unit_amount: '0.10', rate: '0', amount: '1.00', base_amount: '0.00' }],
    }));
    expect(nominalWithoutBasis.validation.errors.map((error) => error.code)).toContain('TAX_BASIS_REQUIRED');
    const monetary = h.service.normalizeExtractionFacts(manualDto({
      taxes: [{ tax_type: 'iva', scheme_code: '01', tax_name: 'IVA', rate: '19', base_amount: '100.00', amount: '19.00',
        tax_basis_type: 'monetary', base_quantity: null, base_unit_code: null, per_unit_amount: null }],
    }));
    expect(monetary.validation.errors.map((error) => error.code)).not.toContain('CONTRADICTORY_TAX_BASIS');
    expect(monetary.taxes[0].tax_basis_type).toBe('monetary');
  });

  it('keeps malformed OCR monetary base blocked in extraction snapshot without persisting fabricated zero', async () => {
    const h = makeHarness();
    h.prisma.received_documents.findFirst.mockResolvedValueOnce({
      id: 50, version: 1, validation_status: 'pending', processing_status: 'processing',
      metadata: { source_format: 'pending_file' }, raw_payload: { source_format: 'pending_file' },
    });
    const facts = h.service.normalizeExtractionFacts(manualDto({
      taxes: [{ tax_type: 'iva', scheme_code: '01', tax_name: 'IVA', rate: '19', base_amount: null, amount: '19.00' }],
      items: [{ description: 'Producto', quantity: '2', unit_price: '50', discount_amount: '0.00', net_amount: '100.00', total_amount: '119.00',
        taxes: [{ tax_type: 'iva', scheme_code: '01', tax_name: 'IVA', rate: '19', base_amount: '100.00', amount: '19.00' }] }],
    }));
    expect(facts.validation.errors.map((error) => error.code)).toContain('MISSING_MONETARY_TAX_BASE');
    expect(facts.taxes[0].base_amount).toBe('');
    await h.service.replaceFromExtraction(context, 50, facts);
    const update = h.tx.received_documents.updateMany.mock.calls[0][0].data;
    expect(update.validation_status).toBe('invalid');
    expect(update.metadata.extraction_snapshot.taxes[0].base_amount).toBe('');
    expect(h.tx.received_document_taxes.createMany).toHaveBeenCalledTimes(1); // only the valid line-tax row
    expect(h.tx.received_document_taxes.createMany.mock.calls[0][0].data[0]).toMatchObject({ item_id: 900, base_amount: expect.anything() });
  });

  it('keeps supported nominal facts in the reviewed snapshot while preserving OCR extraction evidence', async () => {
    const h = makeHarness();
    const extraction = normalized({ taxes: [] });
    h.prisma.received_documents.findFirst.mockResolvedValueOnce({
      id: 50, version: 1, source_channel: 'manual', source_hash: 'b'.repeat(64),
      processing_status: 'ready', validation_status: 'needs_review', fiscal_status: 'pending', posting_status: 'pending', accepted_at: null,
      raw_payload: { source_format: 'pending_file', source_hash: 'b'.repeat(64), facts: 'raw-original' },
      metadata: { source_format: 'pending_file', extraction_snapshot: extraction },
      files: [{ id: 9, file_name: 'scan.pdf', sha256: 'b'.repeat(64), role: 'original' }],
    });
    const unit = { tax_type: 'ibua', scheme_code: '34', tax_name: 'IBUA', tax_basis_type: 'unit', base_quantity: '1000.00', base_unit_code: 'ML', per_unit_amount: '0.10', amount: '1.00' };
    await h.service.updateReview(context, 50, { expected_version: 1, facts: manualDto({
      tax_amount: '1.00', tax_inclusive_amount: '101.00', total_amount: '101.00', taxes: [unit],
      items: [{ description: 'Bebida', quantity: '1', unit_price: '100.00', discount_amount: '0.00', net_amount: '100.00', total_amount: '101.00', taxes: [unit] }],
    }) } as any);
    const update = h.tx.received_documents.updateMany.mock.calls[0][0].data;
    expect(update.metadata.extraction_snapshot).toEqual(extraction);
    expect(update.metadata.reviewed_snapshot.taxes[0]).toMatchObject({ tax_basis_type: 'unit', base_quantity: '1000.00', per_unit_amount: '0.10' });
    expect(update).not.toHaveProperty('raw_payload');
    const row = h.tx.received_document_taxes.createMany.mock.calls[0][0].data[0];
    expect(row.metadata).toMatchObject({ tax_basis_type: 'unit', base_quantity: '1000.00', per_unit_amount: '0.10' });
    expect(row.eligible_amount.toString()).toBe('0');
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

  it.each([
    ['0.01', '119.01'],
    ['-0.01', '118.99'],
  ])('includes signed PayableRoundingAmount %s in manual payable validation; prepaid remains informational', async (rounding, payable) => {
    const h = makeHarness();
    await h.service.createManual(context, manualDto({
      total_amount: payable, tax_inclusive_amount: '119.00', payable_rounding_amount: rounding, prepaid_amount: '10.00',
    }));
    const created = h.tx.received_documents.create.mock.calls[0][0].data;
    expect(created.validation_status).toBe('needs_review');
    expect(created.total_amount.toString()).toBe(payable);
    const errors = created.validation_summary.errors.map((error: any) => error.code);
    expect(errors).not.toContain('PAYABLE_TOTAL_MISMATCH');
    expect(created.validation_summary.warnings.map((warning: any) => warning.code)).toContain('MISSING_DOCUMENT_KEY');
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('uses DIAN half-to-even for deterministic manual line computation', async () => {
    const h = makeHarness();
    await expect(h.service.createManual(context, manualDto({
      subtotal_amount: '1.04', tax_amount: '0.00', total_amount: '1.04', tax_inclusive_amount: '1.04',
      taxes: [],
      items: [{ description: 'Tie', quantity: '1', unit_price: '1.025', discount_amount: '0.00',
        net_amount: '1.04', total_amount: '1.04', taxes: [] }],
    }))).rejects.toBeInstanceOf(BadRequestException);
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
    h.prisma.received_documents.findFirst.mockResolvedValueOnce({
      id: 50, processing_status: 'processing', metadata: { source_format: 'ubl_xml' },
    });
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
    const canonicalFacts = normalized();
    // Older manual payloads omit the default monetary basis; XML may state it.
    canonicalFacts.taxes[0] = { ...canonicalFacts.taxes[0], tax_basis_type: 'monetary' };
    canonicalFacts.items[0].taxes[0] = { ...canonicalFacts.items[0].taxes[0], tax_basis_type: 'monetary' };
    const canonical = { id: 77, raw_payload: { normalized: canonicalFacts }, metadata: { source_format: 'ubl_xml' } };
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

  it.each<[string, (facts: NormalizedReceivedDocument) => void]>([
    ['nominal tax basis', (facts: NormalizedReceivedDocument) => {
      facts.taxes[0] = { ...facts.taxes[0], tax_basis_type: 'unit', base_quantity: '2', base_unit_code: 'ML', per_unit_amount: '3.00' };
    }],
    ['rounding amount', (facts: NormalizedReceivedDocument) => { facts.payable_rounding_amount = '0.01'; }],
    ['header charge', (facts: NormalizedReceivedDocument) => { facts.charge_amount = '5.00'; }],
    ['prepaid amount', (facts: NormalizedReceivedDocument) => { facts.prepaid_amount = '10.00'; }],
  ])('does not merge same-key documents with different %s', async (_field, changeCanonicalFacts) => {
    const h = makeHarness();
    const pending = {
      id: 50, version: 1, validation_status: 'pending', processing_status: 'pending_ocr',
      metadata: { source_format: 'pending_file' }, raw_payload: { source_format: 'pending_file' },
    };
    const canonicalFacts = normalized();
    changeCanonicalFacts(canonicalFacts);
    h.createdDocs.set(`key:${'a'.repeat(96)}`, {
      id: 77, raw_payload: { normalized: canonicalFacts },
    });
    h.prisma.received_documents.findFirst.mockResolvedValueOnce(pending);

    await expect(h.service.replaceFromExtraction(context, 50, normalized())).rejects.toBeInstanceOf(ConflictException);
    expect(h.tx.received_documents.updateMany).not.toHaveBeenCalled();
    expect(h.storage.upload).not.toHaveBeenCalled();
  });
});
