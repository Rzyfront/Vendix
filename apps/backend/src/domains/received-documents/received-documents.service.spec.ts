import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { NormalizedReceivedDocument, PreparedEmailDocument, PreparedEmailEvidence, ReceivedDocumentTax } from './interfaces/received-document.interface';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from './received-documents.service';
import { ReceivedDocumentStorageService } from './services/received-document-storage.service';
import { ReceivedDocumentParserService } from './services/received-document-parser.service';
import { DocumentReceptionIngestService } from './services/document-reception-ingest.service';
import { ReceivedDocumentScanQueueService } from './services/received-document-scan-queue.service';
import type { S3Service } from '../../common/services/s3.service';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
    $queryRaw: jest.fn().mockResolvedValue([{ id: 50 }]),
    received_documents: {
      findFirst: jest.fn(async ({ where }: any) => where?.idempotency_key
        ? [...createdDocs.entries()].find(([key, row]) =>
          (key === where.idempotency_key || row.idempotency_key === where.idempotency_key) &&
          (row.organization_id == null || row.organization_id === where.organization_id) &&
          (row.accounting_entity_id == null || row.accounting_entity_id === where.accounting_entity_id) &&
          (where.store_id == null || row.store_id === where.store_id))?.[1] ?? null
        : [...createdDocs.values()].find((row) => row.id === where?.id) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: nextId++, ...data };
        createdDocs.set(`${data.accounting_entity_id}:${data.idempotency_key}`, row);
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
    received_document_match_allocations: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    received_document_match_tax_allocations: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    received_document_files: {
      findFirst: jest.fn(async () => fileSha ? { id: 1 } : null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async ({ data }: any) => { fileSha = data.sha256; return { id: 1, ...data }; }),
    },
    received_document_events: {
      findFirst: jest.fn().mockResolvedValue(null),
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
  parser.parseDetailed = jest.fn((xml: string) => {
    const parsed = parser.parse(xml);
    return { normalized: parsed, commercial_xml: xml, application_responses: [], fiscal: {
      root: 'Invoice', profile_execution_id: null, document_type_code: null,
      uuid: { value: parsed.document_key ?? null, scheme_id: null, scheme_name: null },
      receiver_company_id: { value: parsed.receiver_tax_id, scheme_name: null, scheme_id: null },
    } };
  });
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

function emailEvidence(bytes: Buffer, role: PreparedEmailEvidence['role'] = 'commercial', filename = 'invoice.xml', mime_type = 'application/xml'): PreparedEmailEvidence {
  return { bytes, role, filename, mime_type, sha256: require('crypto').createHash('sha256').update(bytes).digest('hex') };
}

function preparedEmail(overrides: Partial<PreparedEmailDocument> = {}): PreparedEmailDocument {
  const commercial = '<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>';
  return {
    parsed: {
      normalized: normalized(), commercial_xml: commercial, application_responses: [],
      fiscal: { root: 'Invoice', profile_execution_id: '1', document_type_code: '01',
        uuid: { value: 'a'.repeat(96), scheme_id: '1', scheme_name: 'CUFE-SHA384' },
        receiver_company_id: { value: '800123456', scheme_name: '31', scheme_id: null } },
    },
    evidence: [emailEvidence(Buffer.from(commercial))], email_message_id: 101,
    warnings: ['DIAN_RECEIPT_MISSING'],
    receipt_evidence: { included: false, reference_matches: false, response_code: null },
    ...overrides,
  };
}

function makeEmailHarness() {
  const h = makeHarness();
  const files = new Map<string, any>();
  const findDocument = ({ where }: any) => [...h.createdDocs.values()].find((row) =>
    (where.id == null || row.id === where.id) && row.organization_id === where.organization_id &&
    row.accounting_entity_id === where.accounting_entity_id && (where.store_id == null || row.store_id === where.store_id) &&
    (where.idempotency_key == null || row.idempotency_key === where.idempotency_key)) ?? null;
  h.tx.received_documents.findFirst.mockImplementation(async (args: any) => findDocument(args));
  h.prisma.received_documents.findFirst.mockImplementation(async (args: any) => {
    const row = findDocument(args);
    return row ? { ...row, files: [...files.values()], items: [], taxes: [], links: [], events: [] } : null;
  });
  const update = async ({ where, data }: any) => {
    const row = findDocument({ where });
    if (!row || (typeof where.processing_status === 'string' && row.processing_status !== where.processing_status) ||
        (where.processing_status?.in && !where.processing_status.in.includes(row.processing_status))) return { count: 0 };
    Object.assign(row, data);
    return { count: 1 };
  };
  h.tx.received_documents.updateMany.mockImplementation(update);
  h.prisma.received_documents.updateMany.mockImplementation(update);
  const findFile = async ({ where }: any) => [...files.values()].find((file) => file.document_id === where.document_id && file.sha256 === where.sha256) ?? null;
  h.prisma.received_document_files.findFirst.mockImplementation(findFile);
  h.tx.received_document_files.findFirst.mockImplementation(findFile);
  h.tx.received_document_files.create.mockImplementation(async ({ data }: any) => {
    const file = { id: files.size + 1, ...data };
    files.set(`${data.document_id}:${data.sha256}`, file);
    return file;
  });
  h.tx.received_document_files.findMany.mockImplementation(async ({ where }: any) => [...files.values()].filter((file) =>
    file.document_id === where.document_id && (!where.sha256?.in || where.sha256.in.includes(file.sha256))));
  const uploadEvidence = jest.fn(async (_ctx: unknown, id: number, original: PreparedEmailEvidence) => ({
    file_key: `organizations/2/fiscal-entities/8/received-documents/${id}/${original.sha256}-${original.filename}`,
    file_name: original.filename, mime_type: original.mime_type, file_size: original.bytes.length, sha256: original.sha256,
  }));
  Object.assign(h.storage, { uploadEvidence });
  return { ...h, files, uploadEvidence };
}

describe('ReceivedDocumentsService tenant-safe persistence', () => {
  it('exposes the existing active fiscal/store scope validation to adjacent configuration services', async () => {
    const h = makeHarness();
    await expect(h.service.assertContext(context)).resolves.toBeUndefined();
    expect(h.baseClient.accounting_entities.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: context.accounting_entity_id, organization_id: context.organization_id },
    }));
    expect(h.baseClient.stores.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: context.store_id, organization_id: context.organization_id },
    }));
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

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

  it('reports XML intake creation outcomes without changing the legacy import return value', async () => {
    const h = makeHarness();
    const first = await h.service.importXmlWithOutcome(context, xmlFile(), 'api');
    expect(first.created).toBe(true);
    if (first.outcome === 'duplicate_other_store') throw new Error('Expected a visible document');
    expect(first.document).toMatchObject({ id: 50 });
    const duplicate = await h.service.importXmlWithOutcome(context, xmlFile(), 'api');
    expect(duplicate.created).toBe(false);
    if (duplicate.outcome === 'duplicate_other_store') throw new Error('Expected a visible duplicate');
    expect(duplicate.document).toMatchObject({ id: 50 });
    expect(h.storage.upload).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('deduplicates fiscal identity across stores without exposing or reading the other store (organization=%s)', async (isOrganization) => {
    const h = makeHarness();
    await h.service.importXmlWithOutcome(context, xmlFile(), 'api');
    h.storage.upload.mockClear();
    h.storage.download.mockClear();
    h.prisma.received_documents.findFirst.mockClear();
    h.prisma.received_document_files.findFirst.mockClear();
    const read = jest.spyOn(h.service, 'findOne');
    const outcome = await h.service.importXmlWithOutcome({ ...context, store_id: 4, is_organization: isOrganization }, xmlFile(), 'api');

    expect(outcome).toEqual({
      outcome: 'duplicate_other_store', created: false,
      message: 'Esta factura ya fue recibida en otra tienda de tu empresa.',
    });
    expect(h.tx.received_documents.findFirst).toHaveBeenLastCalledWith({
      where: { organization_id: 2, accounting_entity_id: 8, idempotency_key: `key:${'a'.repeat(96)}` },
    });
    expect(h.tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(h.tx.received_documents.create).toHaveBeenCalledTimes(1);
    expect(h.storage.upload).not.toHaveBeenCalled();
    expect(h.storage.download).not.toHaveBeenCalled();
    expect(h.prisma.received_documents.findFirst).not.toHaveBeenCalled();
    expect(h.prisma.received_document_files.findFirst).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it('does not merge matching document keys from separate fiscal entities', async () => {
    const h = makeHarness();
    const first = await h.service.importXmlWithOutcome(context, xmlFile(), 'api');
    h.baseClient.accounting_entities.findFirst.mockResolvedValueOnce({
      id: 9, organization_id: 2, store_id: 4, tax_id: '800123456', is_active: true,
    });
    h.baseClient.store_settings.findFirst.mockResolvedValueOnce({ settings: { fiscal_data: { nit: '800123456' } } });
    const second = await h.service.importXmlWithOutcome({ ...context, store_id: 4, accounting_entity_id: 9 }, xmlFile(), 'api');
    expect(first.outcome).toBe('created');
    expect(second.outcome).toBe('created');
    expect(h.tx.received_documents.create).toHaveBeenCalledTimes(2);
    expect([...h.createdDocs.values()]).toMatchObject([
      { id: 50, accounting_entity_id: 8, store_id: 3 },
      { id: 51, accounting_entity_id: 9, store_id: 4 },
    ]);
  });

  it.each([false, true])('returns a safe P2002 winner outcome and still rejects conflicting facts (conflict=%s)', async (conflict) => {
    const h = makeHarness();
    h.tx.received_documents.create.mockRejectedValueOnce({ code: 'P2002', meta: { target: ['accounting_entity_id', 'idempotency_key'] } });
    const winner = {
      id: 77, organization_id: 2, accounting_entity_id: 8, store_id: 3,
      raw_payload: { normalized: normalized(conflict ? { total_amount: '120.00' } : {}) },
      files: [{ id: 123, file_key: 'private-file-key' }],
    };
    h.prisma.received_documents.findFirst.mockResolvedValueOnce(winner);
    const read = jest.spyOn(h.service, 'findOne');
    const result = h.service.importXmlWithOutcome({ ...context, store_id: 4 }, xmlFile(), 'api');
    if (conflict) await expect(result).rejects.toBeInstanceOf(ConflictException);
    else await expect(result).resolves.toEqual({
      outcome: 'duplicate_other_store', created: false,
      message: 'Esta factura ya fue recibida en otra tienda de tu empresa.',
    });
    expect(h.prisma.received_documents.findFirst).toHaveBeenCalledTimes(1);
    expect(h.prisma.received_documents.findFirst).toHaveBeenCalledWith({
      where: { organization_id: 2, accounting_entity_id: 8, idempotency_key: `key:${'a'.repeat(96)}` },
    });
    expect(h.tx.received_documents.updateMany).not.toHaveBeenCalled();
    expect(h.storage.upload).not.toHaveBeenCalled();
    expect(h.storage.download).not.toHaveBeenCalled();
    expect(h.prisma.received_document_files.findFirst).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects conflicting cross-store facts before storage or a scoped document read', async () => {
    const h = makeHarness();
    await h.service.importXml(context, xmlFile());
    h.parser.parse.mockReturnValueOnce(normalized({ total_amount: '120.00' }));
    h.storage.upload.mockClear();
    h.prisma.received_documents.findFirst.mockClear();
    const read = jest.spyOn(h.service, 'findOne');
    await expect(h.service.importXmlWithOutcome({ ...context, store_id: 4 }, xmlFile(), 'api'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(h.tx.received_documents.create).toHaveBeenCalledTimes(1);
    expect(h.storage.upload).not.toHaveBeenCalled();
    expect(h.prisma.received_documents.findFirst).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['processing', 'error'])('preserves the safe manual/XML notice for a hidden legacy duplicate in %s', async (processingStatus) => {
    const h = makeHarness();
    await h.service.importXml(context, xmlFile());
    const dto = manualDto({ invoice_number: 'FV-1', document_key: 'a'.repeat(96), due_date: '2026-10-30' });
    [...h.createdDocs.values()][0].processing_status = processingStatus;
    h.storage.upload.mockClear();
    h.prisma.received_documents.findFirst.mockClear();
    const read = jest.spyOn(h.service, 'findOne');
    const expected = { outcome: 'duplicate_other_store', created: false, message: 'Esta factura ya fue recibida en otra tienda de tu empresa.' };
    await expect(h.service.importXml({ ...context, store_id: 4 }, xmlFile())).resolves.toEqual(expected);
    const manual = makeHarness();
    await manual.service.createManual(context, dto);
    [...manual.createdDocs.values()][0].processing_status = processingStatus;
    manual.prisma.received_documents.findFirst.mockClear();
    const manualRead = jest.spyOn(manual.service, 'findOne');
    await expect(manual.service.createManual({ ...context, store_id: 4 }, dto)).resolves.toEqual(expected);
    expect(manual.tx.received_documents.create).toHaveBeenCalledTimes(1);
    expect(manual.storage.upload).not.toHaveBeenCalled();
    expect(manual.prisma.received_documents.findFirst).not.toHaveBeenCalled();
    expect(manualRead).not.toHaveBeenCalled();
    expect(h.storage.upload).not.toHaveBeenCalled();
    expect(h.prisma.received_documents.findFirst).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['api', 'automated'] as const)('counts the cross-store duplicate safely for %s ingestion without hidden document IDs', async (source) => {
    const h = makeHarness();
    await h.service.importXml(context, xmlFile());
    const scanQueue = { enqueue: jest.fn() };
    const ingest = new DocumentReceptionIngestService(h.service, scanQueue as unknown as ReceivedDocumentScanQueueService);
    h.storage.upload.mockClear();
    h.prisma.received_documents.findFirst.mockClear();
    await expect(ingest.ingest({ ...context, store_id: 4 }, {
      version: 1, next_cursor: 'next', documents: [{
        external_id: 'provider-1', file_name: 'factura.xml', mime_type: 'application/xml', content: xmlFile().buffer,
      }],
    }, source)).resolves.toEqual({
      received_count: 0, duplicate_count: 1, error_count: 0,
      document_ids: [], error_codes: [], next_cursor: 'next',
    });
    expect(scanQueue.enqueue).not.toHaveBeenCalled();
    expect(h.storage.upload).not.toHaveBeenCalled();
    expect(h.prisma.received_documents.findFirst).not.toHaveBeenCalled();
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

  it.each([
    ['cash', 'cash'],
    ['credit', 'credit'],
    ['unknown', 'unknown'],
    ['omitted', 'unknown'],
  ])('persists manual payment condition %s conservatively', async (input, expected) => {
    const h = makeHarness();
    const dto = input === 'omitted' ? manualDto() : manualDto({ payment_condition: input });
    await h.service.createManual(context, dto);
    const data = h.tx.received_documents.create.mock.calls[0][0].data;
    expect(data.payment_condition).toBe(expected);
    expect(data.validation_summary).toMatchObject({
      structural: { status: 'needs_review' },
      signature: { status: 'unsigned' },
      dian: { status: 'not_checked' },
    });
  });

  it('re-evaluates a reviewed historical summary only when its preserved evidence is complete', async () => {
    const complete = makeHarness();
    complete.prisma.received_documents.findFirst.mockResolvedValueOnce({
      id: 50, version: 1, source_channel: 'xml', fiscal_status: 'pending', posting_status: 'pending',
      accepted_at: null, validation_status: 'needs_review',
      validation_summary: {
        errors: [], warnings: [{ code: 'SIGNATURE_NOT_VERIFIED', message: 'not checked' }],
        has_signature: true, document_key_format_valid: true,
      },
      metadata: { source_format: 'ubl_xml' }, files: [],
    });
    await complete.service.updateReview(context, 50, { expected_version: 1 } as any);
    const completeUpdate = complete.tx.received_documents.updateMany.mock.calls[0][0].data;
    expect(completeUpdate.validation_status).toBe('valid');
    expect(completeUpdate.signature_validation_status).toBe('not_verified');
    expect(completeUpdate.validation_summary.structural.status).toBe('valid');
    expect(completeUpdate.validation_summary.warnings[0].code).toBe('SIGNATURE_NOT_VERIFIED');

    const incomplete = makeHarness();
    incomplete.prisma.received_documents.findFirst.mockResolvedValueOnce({
      id: 50, version: 1, source_channel: 'xml', fiscal_status: 'pending', posting_status: 'pending',
      accepted_at: null, validation_status: 'needs_review', validation_summary: { warnings: [] },
      metadata: { source_format: 'ubl_xml' }, files: [],
    });
    await incomplete.service.updateReview(context, 50, { expected_version: 1 } as any);
    const incompleteUpdate = incomplete.tx.received_documents.updateMany.mock.calls[0][0].data;
    expect(incompleteUpdate.validation_status).toBe('needs_review');
    expect(incompleteUpdate.validation_summary).toEqual({ warnings: [] });
    expect(incompleteUpdate.structural_validation_status).toBeUndefined();
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

  it('blocks fact edits when an allocation history exists before version, child, or event writes', async () => {
    const h = makeHarness();
    h.prisma.received_documents.findFirst.mockResolvedValueOnce({
      id: 50, version: 1, source_channel: 'manual', fiscal_status: 'pending', posting_status: 'pending',
      accepted_at: null, metadata: { source_format: 'manual_entry' }, files: [],
    });
    h.tx.received_document_match_allocations.findFirst.mockResolvedValueOnce({ id: 701 });

    await expect(h.service.updateReview(context, 50, {
      expected_version: 1, facts: manualDto(), reviewer_note: 'Corregir proveedor',
    } as any)).rejects.toThrow('existe historial de asignaciones de conciliación');

    expect(h.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(h.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      h.tx.received_document_match_allocations.findFirst.mock.invocationCallOrder[0],
    );
    expect(h.tx.received_documents.updateMany).not.toHaveBeenCalled();
    expect(h.tx.received_document_items.deleteMany).not.toHaveBeenCalled();
    expect(h.tx.received_document_taxes.deleteMany).not.toHaveBeenCalled();
    expect(h.tx.received_document_events.create).not.toHaveBeenCalled();
  });

  it.each(['preparing', 'prepared', 'sending', 'unknown', 'accepted'])(
    'blocks fiscal fact edits when a buyer DIAN event is %s after locking the tenant-scoped document',
    async (status) => {
      const h = makeHarness();
      h.prisma.received_documents.findFirst.mockResolvedValueOnce({
        id: 50, version: 1, source_channel: 'manual', fiscal_status: 'pending', posting_status: 'pending',
        accepted_at: null, metadata: { source_format: 'manual_entry' }, files: [],
      });
      h.tx.received_document_events.findFirst.mockResolvedValueOnce({ id: 901, status });

      await expect(h.service.updateReview(context, 50, {
        expected_version: 1, facts: manualDto(), reviewer_note: 'Correction requested',
      } as any)).rejects.toThrow('existe un evento DIAN del adquiriente');

      expect(h.tx.$queryRaw).toHaveBeenCalledTimes(1);
      const lockQuery = h.tx.$queryRaw.mock.calls[0][0];
      expect(lockQuery.sql).toContain('"organization_id"');
      expect(lockQuery.sql).toContain('"accounting_entity_id"');
      expect(lockQuery.sql).toContain('"store_id"');
      expect(lockQuery.values).toEqual(expect.arrayContaining([50, 2, 8, 3]));
      expect(h.tx.received_document_events.findFirst).toHaveBeenCalledWith({
        where: {
          document_id: 50,
          event_type: 'BUYER_DIAN_EVENT',
          status: { in: ['preparing', 'prepared', 'sending', 'unknown', 'accepted'] },
        },
        select: { id: true },
      });
      expect(h.tx.received_document_events.findFirst.mock.invocationCallOrder[0]).toBeGreaterThan(
        h.tx.$queryRaw.mock.invocationCallOrder[0],
      );
      expect(h.tx.received_documents.updateMany).not.toHaveBeenCalled();
      expect(h.tx.received_document_items.deleteMany).not.toHaveBeenCalled();
      expect(h.tx.received_document_taxes.deleteMany).not.toHaveBeenCalled();
      expect(h.tx.received_document_events.create).not.toHaveBeenCalled();
    },
  );

  it.each(['rejected', 'preparation_failed'])(
    'allows fiscal fact edits after a terminal non-accepted buyer event status %s',
    async (status) => {
      const h = makeHarness();
      h.prisma.received_documents.findFirst.mockResolvedValueOnce({
        id: 50, version: 1, source_channel: 'manual', fiscal_status: 'pending', posting_status: 'pending',
        accepted_at: null, metadata: { source_format: 'manual_entry' }, files: [],
      });
      h.tx.received_document_events.findFirst.mockImplementationOnce(({ where }: any) =>
        Promise.resolve(where.status.in.includes(status) ? { id: 901 } : null),
      );

      await h.service.updateReview(context, 50, { expected_version: 1, facts: manualDto() } as any);

      expect(h.tx.received_document_events.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['preparing', 'prepared', 'sending', 'unknown', 'accepted'] } }),
      }));
      expect(h.tx.received_documents.updateMany).toHaveBeenCalledTimes(1);
      expect(h.tx.received_document_items.deleteMany).toHaveBeenCalledTimes(1);
      expect(h.tx.received_document_taxes.deleteMany).toHaveBeenCalledTimes(1);
    },
  );

  it('also blocks fact edits when only a historical tax allocation exists', async () => {
    const h = makeHarness();
    h.prisma.received_documents.findFirst.mockResolvedValueOnce({
      id: 50, version: 1, source_channel: 'manual', fiscal_status: 'pending', posting_status: 'pending',
      accepted_at: null, metadata: { source_format: 'manual_entry' }, files: [],
    });
    h.tx.received_document_match_tax_allocations.findFirst.mockResolvedValueOnce({ id: 702 });

    await expect(h.service.updateReview(context, 50, {
      expected_version: 1, facts: manualDto(),
    } as any)).rejects.toThrow('existe historial de asignaciones de conciliación');

    expect(h.tx.received_document_match_allocations.findFirst).toHaveBeenCalledWith({
      where: { document_id: 50 }, select: { id: true },
    });
    expect(h.tx.received_document_match_tax_allocations.findFirst).toHaveBeenCalledWith({
      where: { document_tax: { is: { document_id: 50 } } }, select: { id: true },
    });
    expect(h.tx.received_documents.updateMany).not.toHaveBeenCalled();
    expect(h.tx.received_document_events.create).not.toHaveBeenCalled();
  });

  it('still permits a review note without facts when allocations already exist', async () => {
    const h = makeHarness();
    h.prisma.received_documents.findFirst.mockResolvedValueOnce({
      id: 50, version: 1, source_channel: 'manual', fiscal_status: 'pending', posting_status: 'pending',
      accepted_at: null, validation_status: 'valid', metadata: { source_format: 'manual_entry' }, files: [],
    });
    h.tx.received_document_match_allocations.findFirst.mockResolvedValue({ id: 701 });
    h.tx.received_document_match_tax_allocations.findFirst.mockResolvedValue({ id: 702 });
    h.tx.received_document_events.findFirst.mockResolvedValue({ id: 901, status: 'accepted' });

    await h.service.updateReview(context, 50, { expected_version: 1, reviewer_note: 'Nota de revisión sin cambiar hechos' } as any);

    expect(h.tx.received_document_match_allocations.findFirst).not.toHaveBeenCalled();
    expect(h.tx.received_document_match_tax_allocations.findFirst).not.toHaveBeenCalled();
    expect(h.tx.received_document_events.findFirst).not.toHaveBeenCalled();
    expect(h.tx.received_documents.updateMany).toHaveBeenCalledTimes(1);
    expect(h.tx.received_document_items.deleteMany).not.toHaveBeenCalled();
    expect(h.tx.received_document_taxes.deleteMany).not.toHaveBeenCalled();
    expect(h.tx.received_document_events.create).toHaveBeenCalledTimes(1);
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

  it('reports pending-file outcome true once and false on a deduplicated re-delivery', async () => {
    const h = makeHarness();
    const file = {
      buffer: Buffer.from('%PDF-1.4 outcome'), originalname: 'outcome.pdf',
      mimetype: 'application/pdf', size: Buffer.byteLength('%PDF-1.4 outcome'),
    } as Express.Multer.File;
    const first = await h.service.createPendingFileWithOutcome(context, file, 'email');
    const duplicate = await h.service.createPendingFileWithOutcome(context, file, 'email');
    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(first.document.id).toBe(duplicate.document.id);
    expect(h.storage.upload).toHaveBeenCalledTimes(1);
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

describe('ReceivedDocumentsService prepared email evidence', () => {
  it.each(['manual', 'api'])('preserves real POS20 XML classification on legacy %s import without inventing email transport', async (source) => {
    const h = makeEmailHarness();
    const xml = readFileSync(join(__dirname, '__fixtures__/email/pos-20.xml'), 'utf8');
    h.parser.parseDetailed.mockImplementation((text: string) => new ReceivedDocumentParserService().parseDetailed(text));
    h.baseClient.organization_settings.findFirst.mockResolvedValue({ settings: { fiscal_data: { nit: '800765432' } } });
    const bytes = Buffer.from(xml);
    const result = await h.service.importXmlWithOutcome(context, { buffer: bytes, originalname: 'pos.xml', mimetype: 'application/xml', size: bytes.length } as Express.Multer.File, source);
    expect(result.outcome).toBe('created');
    const row = [...h.createdDocs.values()][0];
    expect(row.metadata).toEqual({ source_format: 'ubl_xml', fiscal_document_type_code: '20' });
    expect(row.source_channel).toBe(source);
    expect(row.raw_payload.normalized.document_type).toBe('invoice');
    expect(h.parser.parse).not.toHaveBeenCalled();
    if (result.outcome === 'duplicate_other_store') throw new Error('Expected an imported document');
    expect(result.document).toMatchObject({ fiscal_document_type_code: '20', email_transport_received: false, email_reception: null });
    expect(row.dian_validation_status).toBe('not_checked');
    expect(row.processing_status).toBe('ready');
  });

  it('rejects FEV01 email against a legacy XML POS20 classification before attaching evidence or changing history', async () => {
    const h = makeEmailHarness();
    const xml = readFileSync(join(__dirname, '__fixtures__/email/pos-20.xml'), 'utf8');
    h.parser.parseDetailed.mockImplementation((text: string) => new ReceivedDocumentParserService().parseDetailed(text));
    h.baseClient.organization_settings.findFirst.mockResolvedValue({ settings: { fiscal_data: { nit: '800765432' } } });
    const bytes = Buffer.from(xml);
    await h.service.importXml(context, { buffer: bytes, originalname: 'pos.xml', mimetype: 'application/xml', size: bytes.length } as Express.Multer.File);
    const row = [...h.createdDocs.values()][0];
    const incoming = preparedEmail();
    incoming.parsed.normalized = JSON.parse(JSON.stringify(row.raw_payload.normalized));
    incoming.parsed.fiscal.uuid.value = incoming.parsed.normalized.document_key!;
    const preserved = JSON.stringify(row);
    h.prisma.received_documents.findFirst.mockClear();
    await expect(h.service.ingestPreparedEmail(context, incoming)).rejects.toBeInstanceOf(ConflictException);
    expect(h.uploadEvidence).not.toHaveBeenCalled();
    expect(h.prisma.received_documents.findFirst).not.toHaveBeenCalled();
    expect(JSON.stringify(row)).toBe(preserved);
  });

  it('does not apply strict email environment preflight to legacy XML import', async () => {
    const h = makeEmailHarness();
    const xml = readFileSync(join(__dirname, '__fixtures__/email/pos-20.xml'), 'utf8').replace('<cbc:ProfileExecutionID>1</cbc:ProfileExecutionID>', '<cbc:ProfileExecutionID>2</cbc:ProfileExecutionID>');
    h.parser.parseDetailed.mockImplementation((text: string) => new ReceivedDocumentParserService().parseDetailed(text));
    h.baseClient.organization_settings.findFirst.mockResolvedValue({ settings: { fiscal_data: { nit: '800765432' } } });
    const bytes = Buffer.from(xml);
    await expect(h.service.importXml(context, { buffer: bytes, originalname: 'pos.xml', mimetype: 'application/xml', size: bytes.length } as Express.Multer.File)).resolves.toMatchObject({ fiscal_document_type_code: '20' });
  });

  it('creates processing and only finalizes ready after every exact evidence hash is durable', async () => {
    const h = makeEmailHarness();
    const prepared = preparedEmail();
    const pdf = emailEvidence(Buffer.from('%PDF-1.7\nrepresentation'), 'representation', 'invoice.pdf', 'application/pdf');
    prepared.evidence.push(pdf);
    const guard = jest.fn().mockResolvedValue(undefined);
    const outcome = await h.service.ingestPreparedEmail(context, prepared, guard);
    expect(outcome.outcome).toBe('created');
    expect(h.tx.received_documents.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      source_channel: 'email', processing_status: 'processing', created_by: context.actor_id,
      metadata: expect.objectContaining({ source_format: 'email', email_reception: expect.objectContaining({ message_id: 101, document_type_code: '01' }) }),
    }) }));
    const row = [...h.createdDocs.values()][0];
    expect(row.processing_status).toBe('ready');
    expect(row.metadata.originals_checkpoint).toEqual(prepared.evidence.map(({ sha256 }) => ({ sha256, stored: true })));
    expect([...h.files.values()].map(({ sha256, role }) => ({ sha256, role }))).toEqual(prepared.evidence.map(({ sha256, role }) => ({ sha256, role })));
    expect(h.parser.parse).not.toHaveBeenCalled();
    expect(h.storage.upload).not.toHaveBeenCalled();
    const mutations = [h.tx.received_documents.create, h.tx.received_document_items.create,
      h.tx.received_document_taxes.createMany, h.tx.received_document_events.create,
      h.uploadEvidence, h.tx.received_document_files.create, h.tx.received_document_events.upsert,
      h.tx.received_documents.updateMany].flatMap((mock) => mock.mock.invocationCallOrder).sort((a, b) => a - b);
    expect(guard).toHaveBeenCalledTimes(mutations.length);
    mutations.forEach((order, index) => {
      expect(guard.mock.invocationCallOrder[index]).toBeLessThan(order);
      if (index > 0) expect(guard.mock.invocationCallOrder[index]).toBeGreaterThan(mutations[index - 1]);
    });
  });

  it('retries only missing evidence after a failure following the first upload, with no early ready', async () => {
    const h = makeEmailHarness();
    const prepared = preparedEmail();
    prepared.evidence.push(emailEvidence(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2]), 'zip', 'invoice.zip', 'application/zip'));
    const upload = h.uploadEvidence.getMockImplementation()!;
    h.uploadEvidence.mockImplementationOnce(upload).mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(h.service.ingestPreparedEmail(context, prepared)).rejects.toBeInstanceOf(ServiceUnavailableException);
    const row = [...h.createdDocs.values()][0];
    expect(row.processing_status).toBe('error');
    expect(h.files.size).toBe(1);
    expect(h.tx.received_documents.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ processing_status: 'ready' }) }));
    expect(h.prisma.received_documents.findFirst).not.toHaveBeenCalled();
    const recovered = await h.service.ingestPreparedEmail(context, prepared);
    expect(recovered.outcome).toBe('duplicate');
    expect(h.tx.received_documents.create).toHaveBeenCalledTimes(1);
    expect(h.uploadEvidence).toHaveBeenCalledTimes(3);
    expect(h.uploadEvidence).toHaveBeenNthCalledWith(3, expect.any(Object), row.id, prepared.evidence[1]);
    expect(h.files.size).toBe(2);
    expect(row.processing_status).toBe('ready');
    expect(row.metadata.originals_checkpoint.every(({ stored }: any) => stored)).toBe(true);
  });

  it('does not declare ready merely because the upload returned when a manifest file row is not durable', async () => {
    const h = makeEmailHarness();
    h.tx.received_document_files.create.mockResolvedValueOnce({ id: 1 });
    await expect(h.service.ingestPreparedEmail(context, preparedEmail())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect([...h.createdDocs.values()][0].processing_status).toBe('error');
    expect(h.tx.received_documents.updateMany).not.toHaveBeenCalled();
    expect(h.prisma.received_documents.findFirst).not.toHaveBeenCalled();
  });

  it.each(['processing', 'error'])('rejects email intake of a hidden %s canonical document before storage or detail', async (processingStatus) => {
    const h = makeEmailHarness();
    const hidden = { id: 77, organization_id: 2, accounting_entity_id: 8, store_id: 3,
      processing_status: processingStatus, idempotency_key: `key:${'a'.repeat(96)}`, raw_payload: { normalized: normalized() },
      metadata: { source_format: 'email', originals_checkpoint: [{ stored: false }] },
      files: [{ id: 123, file_key: 'private-original-key', file_name: 'private-original-name' }] };
    h.createdDocs.set(`key:${'a'.repeat(96)}`, hidden);
    const guard = jest.fn();
    const read = jest.spyOn(h.service, 'findOne');
    const before = JSON.stringify(hidden);
    const failure = await h.service.ingestPreparedEmail({ ...context, store_id: 4 }, preparedEmail(), guard).catch((error) => error);
    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    expect(failure.getResponse()).toEqual({ statusCode: 503, error: 'Service Unavailable',
      message: 'La recepción no está disponible temporalmente. Intenta nuevamente más tarde.' });
    expect(JSON.stringify(hidden)).toBe(before);
    expect(guard).not.toHaveBeenCalled();
    expect(h.tx.received_documents.create).not.toHaveBeenCalled();
    expect(h.tx.received_documents.updateMany).not.toHaveBeenCalled();
    expect(h.uploadEvidence).not.toHaveBeenCalled();
    expect(h.storage.upload).not.toHaveBeenCalled();
    expect(h.storage.download).not.toHaveBeenCalled();
    expect(h.tx.received_document_files.findMany).not.toHaveBeenCalled();
    expect(h.prisma.received_document_files.findFirst).not.toHaveBeenCalled();
    expect(h.prisma.received_documents.findFirst).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['processing', 'error', 'ready'])('applies email hidden-ready policy to the P2002 winner in %s', async (processingStatus) => {
    const h = makeEmailHarness();
    h.tx.received_documents.create.mockRejectedValueOnce({ code: 'P2002', meta: { target: ['accounting_entity_id', 'idempotency_key'] } });
    const winner = { id: 77, organization_id: 2, accounting_entity_id: 8, store_id: 3,
      processing_status: processingStatus, idempotency_key: `key:${'a'.repeat(96)}`, raw_payload: { normalized: normalized() },
      metadata: { source_format: 'email' }, files: [{ id: 123, file_key: 'private-original-key' }] };
    h.prisma.received_documents.findFirst.mockResolvedValueOnce(winner);
    const read = jest.spyOn(h.service, 'findOne');
    const outcome = h.service.ingestPreparedEmail({ ...context, store_id: 4 }, preparedEmail());
    if (processingStatus === 'ready') await expect(outcome).resolves.toEqual({
      outcome: 'duplicate_other_store', created: false, message: 'Esta factura ya fue recibida en otra tienda de tu empresa.',
    });
    else {
      const failure = await outcome.catch((error) => error);
      expect(failure).toBeInstanceOf(ServiceUnavailableException);
      expect(failure.getResponse()).toEqual({ statusCode: 503, error: 'Service Unavailable',
        message: 'La recepción no está disponible temporalmente. Intenta nuevamente más tarde.' });
    }
    expect(h.prisma.received_documents.findFirst).toHaveBeenCalledWith({ where: {
      organization_id: 2, accounting_entity_id: 8, idempotency_key: `key:${'a'.repeat(96)}`,
    } });
    expect(h.tx.received_documents.updateMany).not.toHaveBeenCalled();
    expect(h.uploadEvidence).not.toHaveBeenCalled();
    expect(h.storage.upload).not.toHaveBeenCalled();
    expect(h.storage.download).not.toHaveBeenCalled();
    expect(h.tx.received_document_files.findMany).not.toHaveBeenCalled();
    expect(h.prisma.received_document_files.findFirst).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it('returns a hidden cross-store duplicate before storage, document detail, guard mutation or IDs', async () => {
    const h = makeEmailHarness();
    const prepared = preparedEmail();
    await h.service.ingestPreparedEmail(context, prepared);
    expect([...h.createdDocs.values()][0].processing_status).toBe('ready');
    h.uploadEvidence.mockClear(); h.prisma.received_documents.findFirst.mockClear();
    const guard = jest.fn();
    const scanQueue = { enqueue: jest.fn() };
    const ingest = new DocumentReceptionIngestService(h.service, scanQueue as unknown as ReceivedDocumentScanQueueService);
    await expect(ingest.ingestPreparedEmail({ ...context, store_id: 4 }, prepared, guard)).resolves.toEqual({
      received_count: 0, duplicate_count: 1, error_count: 0, document_ids: [], error_codes: [], next_cursor: null,
    });
    expect(guard).not.toHaveBeenCalled();
    expect(scanQueue.enqueue).not.toHaveBeenCalled();
    expect(h.uploadEvidence).not.toHaveBeenCalled();
    expect(h.prisma.received_documents.findFirst).not.toHaveBeenCalled();
  });

  it('rejects known POS20 versus FEV01 fiscal metadata before storage and without overwriting history', async () => {
    const h = makeEmailHarness();
    const pos = preparedEmail();
    pos.parsed.fiscal.document_type_code = '20'; pos.parsed.fiscal.uuid.scheme_name = 'CUDE-SHA384';
    await h.service.ingestPreparedEmail(context, pos);
    const row = [...h.createdDocs.values()][0];
    const preserved = JSON.stringify(row);
    h.uploadEvidence.mockClear(); h.prisma.received_documents.findFirst.mockClear();
    await expect(h.service.ingestPreparedEmail(context, preparedEmail())).rejects.toBeInstanceOf(ConflictException);
    expect(h.uploadEvidence).not.toHaveBeenCalled();
    expect(h.prisma.received_documents.findFirst).not.toHaveBeenCalled();
    expect(JSON.stringify(row)).toBe(preserved);
  });

  it('keeps a historically ready API document ready on supplemental failure and retains its source on success', async () => {
    const h = makeEmailHarness();
    await h.service.importXml(context, xmlFile(), 'api');
    const row = [...h.createdDocs.values()][0];
    const raw = JSON.stringify(row.raw_payload);
    const summary = JSON.stringify(row.validation_summary);
    h.uploadEvidence.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(h.service.ingestPreparedEmail(context, preparedEmail())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(row.processing_status).toBe('ready');
    expect(h.prisma.received_documents.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: { processing_status: 'error' } }));
    const outcome = await h.service.ingestPreparedEmail(context, preparedEmail());
    expect(outcome.outcome).toBe('duplicate');
    expect(row.source_channel).toBe('api');
    expect(row.metadata.source_format).toBe('ubl_xml');
    expect(JSON.stringify(row.raw_payload)).toBe(raw);
    expect(JSON.stringify(row.validation_summary)).toBe(summary);
    if (outcome.outcome === 'duplicate_other_store') throw new Error('Expected a visible duplicate');
    expect(outcome.document).toMatchObject({ email_transport_received: true });
  });

  it('keeps included receipts and signatures unverified and never promotes a legal acceptance', async () => {
    const h = makeEmailHarness();
    const prepared = preparedEmail({ warnings: [], receipt_evidence: { included: true, reference_matches: true, response_code: '00' } });
    prepared.parsed.normalized.validation.has_signature = true;
    prepared.evidence.push(emailEvidence(Buffer.from('<ApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2"/>'), 'dian_receipt', 'response.xml'));
    await h.service.ingestPreparedEmail(context, prepared);
    const row = [...h.createdDocs.values()][0];
    expect(row.dian_validation_status).toBe('not_checked');
    expect(row.signature_validation_status).toBe('not_verified');
    expect(row.validation_summary.dian.status).toBe('not_checked');
    expect(row.validation_summary.receipt_evidence).toEqual(prepared.receipt_evidence);
    expect(row.accepted_at).toBeUndefined();
    expect(row.fiscal_status).toBe('pending');
    expect(row.posting_status).toBe('pending');
    expect(JSON.stringify(row.metadata)).not.toContain('ApplicationResponse');
  });

  it('projects only safe fiscal receipt fields in lists and preserves legacy detail metadata', async () => {
    const h = makeEmailHarness();
    await h.service.ingestPreparedEmail(context, preparedEmail());
    const row = [...h.createdDocs.values()][0];
    row.metadata.private_checkpoint = 'must not appear in list';
    h.prisma.received_documents.findMany.mockResolvedValueOnce([row]);
    const list = await h.service.list(context, { page: 1, limit: 25 });
    expect(list.data[0]).toMatchObject({ email_transport_received: true, email_reception: {
      document_type_code: '01', profile_execution_id: '1', uuid_scheme_name: 'CUFE-SHA384',
      receipt_evidence: { included: false, reference_matches: false, response_code: null },
    } });
    expect(list.data[0]).not.toHaveProperty('metadata');
    expect(JSON.stringify(list)).not.toContain('private_checkpoint');
    expect(JSON.stringify(list)).not.toContain('originals_checkpoint');
    const detail = await h.service.findOne(context, row.id);
    expect(detail.metadata).toMatchObject({ private_checkpoint: 'must not appear in list' });
    expect(detail.email_transport_received).toBe(true);
  });

  it('aborts on a lost beforeWrite guard after upload without inserting files or issuing failure writes', async () => {
    const h = makeEmailHarness();
    const lost = new ConflictException('lease lost');
    const guard = jest.fn(async () => { if (h.uploadEvidence.mock.calls.length > 0) throw lost; });
    await expect(h.service.ingestPreparedEmail(context, preparedEmail(), guard)).rejects.toBe(lost);
    expect(h.tx.received_document_files.create).not.toHaveBeenCalled();
    expect(h.tx.received_documents.updateMany).not.toHaveBeenCalled();
    expect(h.prisma.received_documents.updateMany).not.toHaveBeenCalled();
    expect(h.prisma.received_documents.findFirst).not.toHaveBeenCalled();
  });

  it('propagates incomplete storage through the internal ingest wrapper instead of producing an acknowledgement-shaped success', async () => {
    const h = makeEmailHarness();
    h.uploadEvidence.mockRejectedValueOnce(new Error('storage unavailable'));
    const scanQueue = { enqueue: jest.fn() };
    const ingest = new DocumentReceptionIngestService(h.service, scanQueue as unknown as ReceivedDocumentScanQueueService);
    await expect(ingest.ingestPreparedEmail(context, preparedEmail())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(scanQueue.enqueue).not.toHaveBeenCalled();
  });

  it.each(['overflow', 'issuer_length', 'hash_mismatch', 'receiver_mismatch', 'missing_container'] as const)('rejects prepared %s before any document write', async (kind) => {
    const h = makeEmailHarness();
    const prepared = preparedEmail();
    if (kind === 'overflow') prepared.parsed.normalized.items = Array.from({ length: 501 }, () => prepared.parsed.normalized.items[0]);
    if (kind === 'issuer_length') prepared.parsed.normalized.issuer_name = 'x'.repeat(256);
    if (kind === 'hash_mismatch') prepared.evidence[0].sha256 = '0'.repeat(64);
    if (kind === 'receiver_mismatch') prepared.parsed.normalized.receiver_tax_id = '900111222';
    if (kind === 'missing_container') prepared.parsed.fiscal.container = { profile_execution_id: '1', uuid: prepared.parsed.fiscal.uuid };
    await expect(h.service.ingestPreparedEmail(context, prepared)).rejects.toBeInstanceOf(BadRequestException);
    expect(h.tx.received_documents.create).not.toHaveBeenCalled();
    expect(h.uploadEvidence).not.toHaveBeenCalled();
  });

  it('stores exact Latin1, ZIP and unverified response bytes only through the internal evidence path', async () => {
    const previous = process.env.RECEIVED_DOCUMENT_STORAGE_DRIVER;
    process.env.RECEIVED_DOCUMENT_STORAGE_DRIVER = 's3';
    try {
      const s3 = { uploadFile: jest.fn().mockResolvedValue('ignored') };
      const storage = new ReceivedDocumentStorageService(s3 as unknown as S3Service);
      const latin = emailEvidence(Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><Name>Café Bogotá</Name></Invoice>', 'latin1'));
      latin.encoding = 'iso-8859-1';
      const zip = emailEvidence(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2]), 'zip', 'supplier.zip', 'application/zip');
      const ar = emailEvidence(Buffer.from('<ApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2"/>'), 'dian_receipt', 'response.xml');
      for (const original of [latin, zip, ar]) {
        const before = Buffer.from(original.bytes);
        const stored = await storage.uploadEvidence({ organization_id: 2, accounting_entity_id: 8, store_id: 3 }, 50, original);
        expect(stored.sha256).toBe(original.sha256);
        expect(stored.file_size).toBe(before.length);
        expect(s3.uploadFile).toHaveBeenLastCalledWith(original.bytes, expect.any(String), original.mime_type);
        expect(original.bytes.equals(before)).toBe(true);
        await expect(storage.upload({ organization_id: 2, accounting_entity_id: 8, store_id: 3 }, 50, {
          buffer: original.bytes, originalname: original.filename, mimetype: original.mime_type, size: original.bytes.length,
        })).rejects.toThrow();
      }
      expect(s3.uploadFile).toHaveBeenCalledTimes(3);
    } finally {
      if (previous === undefined) delete process.env.RECEIVED_DOCUMENT_STORAGE_DRIVER;
      else process.env.RECEIVED_DOCUMENT_STORAGE_DRIVER = previous;
    }
  });
});

describe('ReceivedDocumentsService inbox read wiring', () => {
  const readContext = { ...context, fiscal_scope: 'ORGANIZATION' as const };
  it('paginates server-side by arrival/id on request and strips compact events from rows', async () => {
    const h = makeHarness();
    const arrival = new Date('2026-10-13T10:00:00Z');
    h.tx.received_documents.findMany = jest.fn().mockResolvedValue([{
      id: 50, document_type: 'invoice', processing_status: 'ready', validation_status: 'valid',
      structural_validation_status: 'valid', accepted_at: null, created_at: arrival,
      events: [{ event_type: 'BUYER_DIAN_EVENT', event_code: '031', status: 'accepted' }],
    }]);
    h.tx.received_documents.count = jest.fn().mockResolvedValue(55);
    const result = await h.service.listInbox(readContext, { page: 2, limit: 25, sort: 'inbox', inbox_state: 'reclaimed' });
    expect(result).toMatchObject({ total: 55, page: 2, limit: 25 });
    expect(result.data[0]).toMatchObject({ inbox_state: 'reclaimed', legal_status: 'reclaimed', arrived_at: arrival });
    expect(result.data[0]).not.toHaveProperty('events');
    expect(result.data[0]).not.toHaveProperty('raw_payload');
    const args = h.tx.received_documents.findMany.mock.calls[0][0];
    expect(args).toMatchObject({ take: 25, skip: 25, orderBy: [{ created_at: 'desc' }, { id: 'desc' }] });
    expect(args.where.AND[0]).toMatchObject({ organization_id: 2, accounting_entity_id: 8, store_id: 3 });
    expect(args.select.events.select).toEqual({ event_type: true, event_code: true, status: true, confirmed_at: true, event_date: true });
    expect(args.select).not.toHaveProperty('raw_payload');
    expect(h.tx.received_documents.count).toHaveBeenCalledWith({ where: args.where });
    expect(h.tx.received_documents.findMany).toHaveBeenCalledTimes(1);
  });

  it('keeps issue-date ordering unless inbox ordering is explicitly selected', async () => {
    const h = makeHarness();
    h.tx.received_documents.findMany = jest.fn().mockResolvedValue([]);
    h.tx.received_documents.count = jest.fn().mockResolvedValue(0);
    await h.service.listInbox(readContext, { page: 1, limit: 25, legal_status: 'accepted' });
    expect(h.tx.received_documents.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ issue_date: 'desc' }, { created_at: 'desc' }] }));
  });

  it('revalidates entity/store ownership before invoking a health or summary reader', async () => {
    const h = makeHarness();
    const inboxStatus = { summary: jest.fn().mockResolvedValue({ total: 0 }), receptionStatus: jest.fn().mockResolvedValue({ configured: false }) };
    Object.assign(h.service, { inboxStatus });
    await h.service.inboxSummary(readContext, { page: 1, limit: 25 });
    expect(inboxStatus.summary).toHaveBeenCalledWith({ organization_id: 2, accounting_entity_id: 8, store_id: 3 }, { page: 1, limit: 25 });
    h.baseClient.accounting_entities.findFirst.mockResolvedValueOnce(null);
    await expect(h.service.receptionStatus(readContext)).rejects.toThrow(ForbiddenException);
    expect(inboxStatus.receptionStatus).not.toHaveBeenCalled();
  });

  it('returns empty pages without entity creation and rejects forged null-entity store scope', async () => {
    const h = makeHarness();
    h.prisma.organizations = { findFirst: jest.fn().mockResolvedValue({ id: 2 }) };
    h.prisma.stores = { findFirst: jest.fn().mockResolvedValue({ id: 3 }) };
    expect(await h.service.listInbox({ ...readContext, accounting_entity_id: null }, { page: 3, limit: 100, sort: 'inbox' }))
      .toEqual({ data: [], total: 0, page: 3, limit: 100 });
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
    h.prisma.stores.findFirst.mockResolvedValueOnce(null);
    await expect(h.service.listInbox({ ...readContext, accounting_entity_id: null, store_id: 999 }, { page: 1, limit: 25 })).rejects.toThrow(ForbiddenException);
  });

  it('adds inbox fields to detail without removing existing evidence relationships', async () => {
    const h = makeHarness();
    h.prisma.received_documents.findFirst.mockResolvedValueOnce({
      id: 50, document_type: 'invoice', processing_status: 'ready', validation_status: 'valid',
      accepted_at: new Date('2026-10-13T10:00:00Z'), created_at: new Date('2026-10-13T09:00:00Z'),
      files: [{ id: 1 }], items: [{ id: 2 }], taxes: [], links: [],
      events: [{ id: 3, event_type: 'BUYER_DIAN_EVENT', event_code: '030', status: 'unknown' }],
    });
    const result = await h.service.findOneInbox(readContext, 50);
    expect(result).toMatchObject({ inbox_state: 'requires_review', legal_status: 'accepted', legal_flags: { accepted: true, reclaimed: false }, files: [{ id: 1 }], items: [{ id: 2 }], events: [{ id: 3 }] });
  });
});
