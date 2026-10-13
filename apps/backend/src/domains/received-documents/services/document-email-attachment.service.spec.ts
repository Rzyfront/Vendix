import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { DocumentEmailAttachmentService } from './document-email-attachment.service';
import { DocumentEmailMimeService } from './document-email-mime.service';
import { DocumentEmailZipService } from './document-email-zip.service';
import { ReceivedDocumentParserService } from './received-document-parser.service';
import { DocumentReceptionIngestService, type DocumentReceptionIngestResult } from './document-reception-ingest.service';
import { DocumentEmailGmailCodeService } from './document-email-gmail-code.service';
import type { DocumentEmailInternalPart, DocumentEmailProcessorRequest, DocumentEmailProcessorResult } from '../interfaces/document-email-reception.interface';
import type { PreparedEmailDocument } from '../interfaces/received-document.interface';

const fixture = (name: string): Buffer => readFileSync(join(__dirname, '../__fixtures__/email', name));
const part = (name: string, ordinal = 1, message_index = 0): DocumentEmailInternalPart => ({ filename: name, bytes: fixture(name), ordinal, message_index, content_type: 'application/octet-stream' });
const created = (id = 101): DocumentReceptionIngestResult => ({ received_count: 1, duplicate_count: 0, error_count: 0, document_ids: [id], error_codes: [], next_cursor: null });
function request(): DocumentEmailProcessorRequest {
  return { raw: Readable.from([Buffer.from('fixture')]), context: {
    organization_id: 1, store_id: 2, accounting_entity_id: 3, inbox_id: 4, local_part: 'facturas-00112233445566778899aabbccddeeff', domain: 'recepcion.vendix.online', recipient_alias: 'facturas-00112233445566778899aabbccddeeff@recepcion.vendix.online', environment: 'production', fiscal_scope: 'STORE',
    fiscal_identity: { nit: '800765432', nit_dv: '3', nit_type: 'NIT', legal_name: 'Comprador Sintético Bogotá SAS', fiscal_address: 'Dirección sintética', municipality_code: '11001', city: 'Bogotá', department: 'Bogotá', country: 'CO', email: 'comprador@example.invalid', tax_responsibilities: [] },
  }, message_id: 5, checkpoint_parts: [], transport_facts: { virus_status: 'PASS', spam_status: 'PASS', gmail_authenticated: false }, before_write: jest.fn().mockResolvedValue(undefined), signal: new AbortController().signal };
}
function setup(parts: DocumentEmailInternalPart[] = [part('invoice.xml')], options: { realMime?: boolean; text?: string; sender?: string } = {}) {
  const mime = options.realMime ? new DocumentEmailMimeService() : { parse: jest.fn().mockResolvedValue({ sender: options.sender || 'proveedor@example.invalid', subject: 'Sintético', text: options.text || '', rfc_message_id_hash: null, parts }) } as unknown as DocumentEmailMimeService;
  const ingest = { ingestPreparedEmail: jest.fn<ReturnType<DocumentReceptionIngestService['ingestPreparedEmail']>, Parameters<DocumentReceptionIngestService['ingestPreparedEmail']>>().mockResolvedValue(created()) };
  const gmail = { inspect: jest.fn<ReturnType<DocumentEmailGmailCodeService['inspect']>, Parameters<DocumentEmailGmailCodeService['inspect']>>().mockResolvedValue(null) };
  const service = new DocumentEmailAttachmentService(mime, new DocumentEmailZipService(), new ReceivedDocumentParserService(), ingest as unknown as DocumentReceptionIngestService, gmail as unknown as DocumentEmailGmailCodeService);
  return { service, mime, ingest, gmail, req: request(), prepared: (): PreparedEmailDocument => ingest.ingestPreparedEmail.mock.calls[0][1] as PreparedEmailDocument };
}
function changed(name: string, transform: (xml: string) => string, ordinal = 1): DocumentEmailInternalPart { return { ...part(name, ordinal), bytes: Buffer.from(transform(fixture(name).toString('utf8'))) }; }

describe('DocumentEmailAttachmentService', () => {
  it('uses the prepared seam, canonical context, gate and immutable evidence only', async () => {
    const env = setup(); const result = await env.service.processEmail(env.req);
    expect(result.status).toBe('processed'); expect(result.valid_document).toBe(true);
    expect(env.ingest.ingestPreparedEmail).toHaveBeenCalledTimes(1);
    expect(env.ingest.ingestPreparedEmail.mock.calls[0][0]).toEqual({ organization_id: 1, store_id: 2, accounting_entity_id: 3, is_organization: false });
    expect(env.prepared().evidence[0].bytes).toEqual(fixture('invoice.xml'));
    expect(result.parts[0].originals_checkpoint).toEqual([{ sha256: env.prepared().evidence[0].sha256, stored: true }]);
    expect(result.parts[0].document_id).toBe(101); expect(env.req.before_write).toHaveBeenCalled();
    expect(env.prepared().receipt_evidence.included).toBe(false); expect(env.prepared().warnings).toContain('DIAN_RECEIPT_MISSING');
    expect(env.prepared().parsed.normalized.validation.errors).toEqual([]);
  });
  it.each(['invoice.eml', 'credit-note.eml', 'debit-note.eml', 'inline-zip.eml', 'generic-mime-xml.eml', 'outlook-forward-as-attachment.eml'])('handles real corpus MIME %s without OCR or public ingress', async (name) => {
    const env = setup([], { realMime: true }); env.req.raw = Readable.from([fixture(name)]);
    expect((await env.service.processEmail(env.req)).valid_document).toBe(true);
    expect(env.ingest.ingestPreparedEmail).toHaveBeenCalledTimes(1);
    expect(env.prepared().parsed.normalized.document_type).not.toBe('non_electronic');
  });
  it('preflights Gmail historical multi-forward independently for each internal message', async () => {
    const env = setup([], { realMime: true }); env.req.raw = Readable.from([fixture('gmail-multi-forward.eml')]);
    const result = await env.service.processEmail(env.req);
    expect(env.ingest.ingestPreparedEmail).toHaveBeenCalledTimes(3); expect(result.status).toBe('processed');
    expect(result.parts.map((record) => record.message_index)).toEqual([1, 1, 2, 3]);
  });
  it.each([['credit-note.attached.xml', 'credit_note'], ['debit-note.attached.xml', 'debit_note'], ['pos-20.xml', 'invoice']])('accepts production note/POS %s with preserved classification', async (name, type) => {
    const env = setup([part(name)]); expect((await env.service.processEmail(env.req)).valid_document).toBe(true);
    expect(env.prepared().parsed.normalized.document_type).toBe(type);
    if (name === 'pos-20.xml') { expect(env.prepared().parsed.fiscal.document_type_code).toBe('20'); expect(env.prepared().parsed.fiscal.uuid.scheme_name).toBe('CUDE-SHA384'); }
    if (name === 'debit-note.attached.xml') expect(env.prepared().parsed.fiscal.document_type_code).toBe('92');
  });
  it.each(['invoice-type-01.xml', 'invoice-type-02.xml', 'invoice-type-03.xml', 'invoice-type-04.xml'])('admits supported invoice type %s', async (name) => {
    const env = setup([part(name)]); expect((await env.service.processEmail(env.req)).valid_document).toBe(true);
  });
  it.each([['profile-execution-2.xml', 'TEST_DOCUMENT'], ['support-05.xml', 'SUPPORT_DOCUMENT_NOT_RECEIVABLE'], ['final-consumer.xml', 'FINAL_CONSUMER'], ['receiver-mismatch.xml', 'RECEIVER_MISMATCH'], ['conflicting-encoding.xml', 'UNSUPPORTED_ENCODING'], ['xml-xxe.xml', 'INVALID_FISCAL_XML']])('rejects %s before any fiscal writes', async (name, code) => {
    const env = setup([part(name)]); const result = await env.service.processEmail(env.req);
    expect(result.reason_code).toBe(code); expect(result.valid_document).toBe(false); expect(result.retryable).toBe(false);
    expect(env.ingest.ingestPreparedEmail).not.toHaveBeenCalled(); expect(env.req.before_write).not.toHaveBeenCalled();
  });
  it.each(['receiver-nit-schemeid.xml', 'receiver-nit-appended-dv.xml', 'receiver-nit-hyphen-dv.xml'])('checks receiver DV and canonicalizes only the trusted normalized receiver: %s', async (name) => {
    const env = setup([part(name)]); const result = await env.service.processEmail(env.req);
    expect(result.valid_document).toBe(true); expect(env.prepared().parsed.normalized.receiver_tax_id).toBe('800765432');
    expect(env.prepared().evidence[0].bytes).toEqual(fixture(name));
    if (name.includes('appended')) expect(env.prepared().warnings).toContain('RECEIVER_DV_ATTACHED');
    expect(env.prepared().parsed.fiscal.receiver_company_id.value).toBe(name.includes('appended') ? '8007654323' : name.includes('hyphen') ? '800765432-3' : '800765432');
  });
  it('keeps a complete CC13 identity and never strips the last digit', async () => {
    const env = setup([part('receiver-cc-13.xml')]); env.req.context.fiscal_identity.nit = '1118860776'; env.req.context.fiscal_identity.nit_type = 'CC';
    expect((await env.service.processEmail(env.req)).valid_document).toBe(true); expect(env.prepared().parsed.normalized.receiver_tax_id).toBe('1118860776');
    const mismatch = setup([part('receiver-cc-13.xml')]); expect((await mismatch.service.processEmail(mismatch.req)).reason_code).toBe('RECEIVER_MISMATCH');
  });
  it('accepts missing receiver scheme only for exact identity or expected-NIT validated DV', async () => {
    const env = setup([changed('receiver-nit-appended-dv.xml', (xml) => xml.replace(/ schemeName="31"/g, ''))]);
    expect((await env.service.processEmail(env.req)).valid_document).toBe(true);
    const cc = setup([changed('receiver-cc-13.xml', (xml) => xml.replace(/ schemeName="13"/g, ''))]); cc.req.context.fiscal_identity.nit = '1118860776'; cc.req.context.fiscal_identity.nit_type = 'CC';
    expect((await cc.service.processEmail(cc.req)).valid_document).toBe(true);
  });
  it('rejects invalid DV and unknown receiver schemes without guessing an identity', async () => {
    const env = setup([changed('receiver-nit-schemeid.xml', (xml) => xml.replace(/schemeID="3"/g, 'schemeID="9"'))]);
    expect((await env.service.processEmail(env.req)).reason_code).toBe('RECEIVER_ID_AMBIGUOUS');
    const scheme = setup([changed('receiver-nit-schemeid.xml', (xml) => xml.replace(/schemeName="31"/g, 'schemeName="99"'))]);
    expect((await scheme.service.processEmail(scheme.req)).reason_code).toBe('RECEIVER_ID_AMBIGUOUS');
  });
  it.each(['bom-utf8.xml', 'latin1.xml'])('preserves exact original bytes and SHA for encoding %s', async (name) => {
    const env = setup([part(name)]); expect((await env.service.processEmail(env.req)).valid_document).toBe(true);
    expect(env.prepared().evidence[0].bytes).toEqual(fixture(name)); expect(env.prepared().parsed.normalized.issuer_name).toContain('Café');
    expect(env.prepared().evidence[0].encoding).toBe(name === 'latin1.xml' ? 'iso-8859-1' : 'utf-8');
  });
  it('stores embedded Latin1 commercial XML according to its declaration, not blindly UTF8', async () => {
    let text = fixture('invoice.attached.xml').toString('utf8');
    const original = fixture('invoice.xml').toString('utf8'); const latin = original.replace('encoding="UTF-8"', 'encoding="ISO-8859-1"');
    text = text.replace(original, latin);
    const env = setup([{ ...part('invoice.attached.xml'), bytes: Buffer.from(text) }]);
    expect((await env.service.processEmail(env.req)).valid_document).toBe(true);
    const commercial = env.prepared().evidence.find((evidence) => evidence.role === 'commercial')!;
    expect(commercial.bytes).toEqual(Buffer.from(latin, 'latin1')); expect(commercial.encoding).toBe('iso-8859-1');
  });
  it('preserves AttachedDocument CRLF bytes exactly while clearly retaining extracted commercial XML as DOM-derived evidence', async () => {
    const bytes = Buffer.from(fixture('invoice.attached.xml').toString('utf8').replace(/\n/g, '\r\n'));
    const env = setup([{ ...part('invoice.attached.xml'), bytes }]);
    expect((await env.service.processEmail(env.req)).valid_document).toBe(true);
    expect(env.prepared().evidence.find((evidence) => evidence.role === 'container')!.bytes).toEqual(bytes);
    expect(env.prepared().evidence.find((evidence) => evidence.role === 'commercial')!.bytes.toString('utf8')).not.toContain('\r\n');
  });
  it('keeps ZIP, AttachedDocument, commercial XML, AR and PDF evidence with all hashes checkpointed', async () => {
    const env = setup([part('invoice.zip')]); const result = await env.service.processEmail(env.req);
    expect(env.prepared().evidence.map((evidence) => evidence.role)).toEqual(['zip', 'container', 'commercial', 'dian_receipt', 'representation']);
    expect(env.prepared().evidence[0].bytes).toEqual(fixture('invoice.zip'));
    expect(env.prepared().receipt_evidence).toEqual({ included: true, reference_matches: true, response_code: '00' });
    expect(result.parts[0].originals_checkpoint).toHaveLength(5); expect(JSON.stringify(result.parts)).not.toContain('base64');
    expect(env.prepared().parsed).not.toHaveProperty('dian_verified');
  });
  it('admits an AttachedDocument without AR only with the missing-evidence warning', async () => {
    const env = setup([part('attached-without-application-response.xml')]);
    expect((await env.service.processEmail(env.req)).valid_document).toBe(true); expect(env.prepared().warnings).toContain('DIAN_RECEIPT_MISSING');
  });
  it('keeps mismatched standalone AR as unverified evidence with a warning', async () => {
    const env = setup([part('invoice.xml'), part('application-response-mismatched.xml', 2)]);
    expect((await env.service.processEmail(env.req)).valid_document).toBe(true);
    expect(env.prepared().receipt_evidence).toEqual({ included: true, reference_matches: false, response_code: '00' });
    expect(env.prepared().warnings).toContain('DIAN_RECEIPT_REFERENCE_MISMATCH');
  });
  it('associates standalone AR by actual reference only and does not claim authentication', async () => {
    const env = setup([part('invoice.xml'), part('invoice.application-response.xml', 2)]);
    expect((await env.service.processEmail(env.req)).valid_document).toBe(true);
    expect(env.prepared().receipt_evidence.reference_matches).toBe(true); expect(env.prepared().warnings).not.toContain('DIAN_RECEIPT_MISSING');
  });
  it('rejects PDF-only inputs without invoking scanQueue or creating another invoice', async () => {
    for (const name of ['invoice.pdf', 'pdf-only.zip']) {
      const env = setup([part(name)]); expect((await env.service.processEmail(env.req)).reason_code).toBe('MISSING_FISCAL_XML');
      expect(env.ingest.ingestPreparedEmail).not.toHaveBeenCalled();
    }
  });
  it('keeps a direct ambiguous PDF unassigned while ingesting two distinct fiscal documents', async () => {
    const env = setup([part('invoice.xml'), part('credit-note.xml', 2), part('invoice.pdf', 3)]); const result = await env.service.processEmail(env.req);
    expect(result.status).toBe('partial'); expect(result.retryable).toBe(false); expect(result.reason_code).toBe('PDF_ASSOCIATION_AMBIGUOUS');
    expect(env.ingest.ingestPreparedEmail).toHaveBeenCalledTimes(2);
    for (const [, prepared] of env.ingest.ingestPreparedEmail.mock.calls) expect(prepared.evidence.some((evidence: { role: string }) => evidence.role === 'representation')).toBe(false);
  });
  it('never assigns a PDF from another internal EML by subject or message order', async () => {
    const env = setup([part('invoice.xml', 1, 1), part('invoice.pdf', 1, 2)]); const result = await env.service.processEmail(env.req);
    expect(result.status).toBe('partial'); expect(env.prepared().evidence.some((evidence) => evidence.role === 'representation')).toBe(false);
  });
  it('supports one principal nested ZIP and preserves the original outer ZIP', async () => {
    const env = setup([part('principal-double.zip')]); expect((await env.service.processEmail(env.req)).valid_document).toBe(true);
    expect(env.prepared().evidence.find((evidence) => evidence.role === 'zip')!.bytes).toEqual(fixture('principal-double.zip'));
  });
  it('keeps complementary ZIP opaque and propagates the approved warning', async () => {
    const env = setup([part('invoice-with-complement.zip')]); expect((await env.service.processEmail(env.req)).valid_document).toBe(true);
    expect(env.prepared().warnings).toContain('COMPLEMENT_ARCHIVE_NOT_EXPANDED'); expect(env.prepared().evidence.find((evidence) => evidence.role === 'zip')!.bytes).toEqual(fixture('invoice-with-complement.zip'));
  });
  it.each(['zip-traversal.zip', 'zip-crc-invalid.zip', 'zip-encrypted-flag.zip', 'zip-symlink.zip'])('rejects unsafe archive %s before fiscal writes', async (name) => {
    const env = setup([part(name)]); expect((await env.service.processEmail(env.req)).reason_code).toBe('CORRUPT_OR_ENCRYPTED_FILE'); expect(env.ingest.ingestPreparedEmail).not.toHaveBeenCalled();
  });
  it('merges coherent XML and ZIP presentations of the same key into one prepared package', async () => {
    const env = setup([part('invoice.xml'), part('invoice.zip', 2)]); const result = await env.service.processEmail(env.req);
    expect(result.valid_document).toBe(true); expect(env.ingest.ingestPreparedEmail).toHaveBeenCalledTimes(1);
    expect(new Set(env.prepared().evidence.map((evidence) => evidence.sha256)).size).toBe(env.prepared().evidence.length);
  });
  it('rejects same-key different normalized facts before even the first write', async () => {
    const second = changed('invoice.xml', (xml) => xml.replace(/100000\.00/g, '200000.00').replace(/50000\.00/g, '100000.00').replace(/19000\.00/g, '38000.00').replace(/119000\.00/g, '238000.00'), 2);
    const env = setup([part('invoice.xml'), second]); const result = await env.service.processEmail(env.req);
    expect(result.reason_code).toBe('DOCUMENT_KEY_CONFLICT'); expect(env.ingest.ingestPreparedEmail).not.toHaveBeenCalled();
  });
  it('rejects same-key changed classification even when an unsupported second code fails preflight', async () => {
    const env = setup([part('invoice.xml'), changed('invoice.xml', (xml) => xml.replace('<cbc:InvoiceTypeCode>01', '<cbc:InvoiceTypeCode>93'), 2)]);
    expect((await env.service.processEmail(env.req)).reason_code).toBe('DOCUMENT_KEY_CONFLICT'); expect(env.ingest.ingestPreparedEmail).not.toHaveBeenCalled();
  });
  it('returns safe hidden duplicate outcome without storing a foreign ID/checkpoint', async () => {
    const env = setup(); env.ingest.ingestPreparedEmail.mockResolvedValue({ ...created(), received_count: 0, duplicate_count: 1, document_ids: [] });
    const result = await env.service.processEmail(env.req); expect(result.valid_document).toBe(true);
    expect(result.parts[0].reason_code).toBe('DUPLICATE_OTHER_STORE'); expect(result.parts[0]).not.toHaveProperty('document_id'); expect(result.parts[0]).not.toHaveProperty('originals_checkpoint');
  });
  it('counts a visible fiscal duplicate as working only after core originals readiness succeeds', async () => {
    const env = setup(); env.ingest.ingestPreparedEmail.mockResolvedValue({ ...created(), received_count: 0, duplicate_count: 1 });
    const result = await env.service.processEmail(env.req); expect(result.valid_document).toBe(true); expect(result.parts[0].reason_code).toBe('DUPLICATE'); expect(result.parts[0].originals_checkpoint?.every((entry) => entry.stored)).toBe(true);
  });
  it('returns partial/nonretryable for a valid invoice and wrong receiver', async () => {
    const env = setup([part('invoice.xml'), part('receiver-mismatch.xml', 2)]); const result = await env.service.processEmail(env.req);
    expect(result).toMatchObject({ status: 'partial', retryable: false, valid_document: true, reason_code: 'RECEIVER_MISMATCH' }); expect(env.ingest.ingestPreparedEmail).toHaveBeenCalledTimes(1);
    expect(result.parts.find((record) => record.reason_code === 'RECEIVER_MISMATCH')?.reason_details).toEqual({ receiver_tax_id: '901999001', expected_receiver_tax_id: '800765432' });
  });
  it('returns partial/retryable for a ready document and technical storage failure on another', async () => {
    const env = setup([part('invoice.xml'), part('credit-note.xml', 2)]); env.ingest.ingestPreparedEmail.mockResolvedValueOnce(created()).mockRejectedValueOnce(new ServiceUnavailableException('S3 unavailable'));
    const result = await env.service.processEmail(env.req); expect(result).toMatchObject({ status: 'partial', retryable: true, valid_document: true });
    expect(result.parts.filter((record) => record.status === 'failed')[0]).not.toHaveProperty('originals_checkpoint');
  });
  it('keeps technical top-level reason when a prior business rejection also exists, preserving retry eligibility', async () => {
    const env = setup([part('invoice.xml'), part('receiver-mismatch.xml', 2), part('credit-note.xml', 3)]);
    env.ingest.ingestPreparedEmail.mockResolvedValueOnce(created()).mockRejectedValueOnce(new ServiceUnavailableException('S3 unavailable'));
    const result = await env.service.processEmail(env.req);
    expect(result).toMatchObject({ status: 'partial', retryable: true, reason_code: 'TECHNICAL_PROCESSING_ERROR', valid_document: true });
    expect(result.parts.some((record) => record.reason_code === 'RECEIVER_MISMATCH')).toBe(true);
  });
  it('classifies persisted same-key facts conflict as a nonretryable business outcome', async () => {
    const env = setup(); env.ingest.ingestPreparedEmail.mockRejectedValue(new ConflictException({ reason_code: 'DOCUMENT_KEY_CONFLICT', message: 'La misma clave de documento ya existe con datos fiscales diferentes.' }));
    expect(await env.service.processEmail(env.req)).toMatchObject({ status: 'not_processed', retryable: false, reason_code: 'DOCUMENT_KEY_CONFLICT', valid_document: false });
  });
  it('leaves all-technical failures retryable and recovers via the same prepared package on retry', async () => {
    const env = setup(); env.ingest.ingestPreparedEmail.mockRejectedValueOnce(new ServiceUnavailableException('S3 unavailable'));
    const failed = await env.service.processEmail(env.req); expect(failed).toMatchObject({ status: 'failed', retryable: true, valid_document: false });
    expect(failed.parts[0]).not.toHaveProperty('originals_checkpoint');
    const ready = await env.service.processEmail(request()); expect(ready.valid_document).toBe(true); expect(env.prepared().evidence[0].bytes).toEqual(fixture('invoice.xml'));
  });
  it('propagates before_write gate failures verbatim, including failures thrown from inside the core', async () => {
    const env = setup(); const failure = new BadRequestException({ reason_code: 'FISCAL_GATE_BLOCKED' }); env.req.before_write = jest.fn().mockRejectedValue(failure);
    await expect(env.service.processEmail(env.req)).rejects.toBe(failure); expect(env.ingest.ingestPreparedEmail).not.toHaveBeenCalled();
    const inner = setup(); let calls = 0; inner.req.before_write = jest.fn().mockImplementation(async () => { if (++calls > 1) throw failure; });
    inner.ingest.ingestPreparedEmail.mockImplementation(async (_ctx, _prepared, beforeWrite) => { await beforeWrite!(); return created(); });
    await expect(inner.service.processEmail(inner.req)).rejects.toBe(failure);
  });
  it.each(['FAIL', 'GRAY', 'PROCESSING_FAILED', 'UNKNOWN'] as const)('blocks unclean/unavailable scan %s before MIME and all fiscal writes', async (virus_status) => {
    const env = setup(); env.req.transport_facts.virus_status = virus_status;
    const result = await env.service.processEmail(env.req); expect(result.valid_document).toBe(false); expect(env.mime.parse).not.toHaveBeenCalled(); expect(env.ingest.ingestPreparedEmail).not.toHaveBeenCalled(); expect(env.req.raw.destroyed).toBe(true);
  });
  it('blocks spam before MIME parsing and never treats missing security as clean', async () => {
    const env = setup(); env.req.transport_facts.spam_status = 'GRAY'; expect((await env.service.processEmail(env.req)).reason_code).toBe('SUSPICIOUS_EMAIL'); expect(env.ingest.ingestPreparedEmail).not.toHaveBeenCalled();
  });
  it('delegates authenticated Gmail challenge handling and never fiscal-ingests it', async () => {
    const env = setup([], { text: 'Forwarding confirmation code', sender: 'forwarding-noreply@google.com' });
    const gmailResult: DocumentEmailProcessorResult = { status: 'ignored', reason_code: 'GMAIL_VERIFICATION_CODE', retryable: false, parts: [], valid_document: false }; env.gmail.inspect.mockResolvedValue(gmailResult);
    expect(await env.service.processEmail(env.req)).toBe(gmailResult); expect(env.ingest.ingestPreparedEmail).not.toHaveBeenCalled();
    expect(env.gmail.inspect.mock.calls[0][3]).toBe(env.req.transport_facts);
  });
  it.each([['winmail.eml', 'TNEF_UNSUPPORTED'], ['unsupported-archive.eml', 'ARCHIVE_FORMAT_UNSUPPORTED'], ['provider-link.eml', 'PROVIDER_SENT_LINK'], ['non-invoice.eml', 'NOT_AN_INVOICE']])('classifies corpus %s without fetch/OCR/events', async (name, code) => {
    const env = setup([], { realMime: true }); env.req.raw = Readable.from([fixture(name)]);
    expect((await env.service.processEmail(env.req)).reason_code).toBe(code); expect(env.ingest.ingestPreparedEmail).not.toHaveBeenCalled();
  });
  it('recognizes both RAR5 and 7z by signature without opening the archives', async () => {
    for (const bytes of [Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 1, 0]), Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 0])]) {
      const env = setup([{ ...part('invoice.xml'), bytes }]);
      expect((await env.service.processEmail(env.req)).reason_code).toBe('ARCHIVE_FORMAT_UNSUPPORTED'); expect(env.ingest.ingestPreparedEmail).not.toHaveBeenCalled();
    }
  });
  it('rejects malformed normalized arithmetic and environment/UUID inconsistencies before any writes', async () => {
    for (const transform of [(xml: string) => xml.replace('<cbc:ProfileExecutionID>1', '<cbc:ProfileExecutionID>9'), (xml: string) => xml.replace('schemeID="1"', 'schemeID="2"'), (xml: string) => xml.replace('CUFE-SHA384', 'CUDE-SHA384'), (xml: string) => xml.replace('119000.00', '119001.00')]) {
      const env = setup([changed('invoice.xml', transform)]); expect((await env.service.processEmail(env.req)).valid_document).toBe(false); expect(env.ingest.ingestPreparedEmail).not.toHaveBeenCalled();
    }
  });
  it('rejects container environment2 even with a production commercial XML', async () => {
    const env = setup([changed('invoice.attached.xml', (xml) => xml.replace('<cbc:ProfileExecutionID>1', '<cbc:ProfileExecutionID>2'))]);
    expect((await env.service.processEmail(env.req)).reason_code).toBe('TEST_DOCUMENT'); expect(env.ingest.ingestPreparedEmail).not.toHaveBeenCalled();
  });
  it('rejects more than20 business documents before any first write', async () => {
    const env = setup(Array.from({ length: 21 }, (_, index) => part('invoice.xml', index + 1)));
    expect((await env.service.processEmail(env.req)).reason_code).toBe('LIMIT_EXCEEDED'); expect(env.ingest.ingestPreparedEmail).not.toHaveBeenCalled();
  });
  it('never exposes transient bytes, HTML or a code through metadata parts JSON', async () => {
    const env = setup([part('invoice.zip')]); const result = await env.service.processEmail(env.req);
    for (const record of result.parts) { expect(record).not.toHaveProperty('bytes'); expect(record).not.toHaveProperty('html'); expect(record).not.toHaveProperty('text'); expect(record).not.toHaveProperty('code'); }
    expect(env.service).not.toHaveProperty('scanQueue'); expect(env.service).not.toHaveProperty('buyerEvents'); expect(env.service).not.toHaveProperty('accounting');
  });
});
