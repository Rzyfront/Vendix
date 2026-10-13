import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { computeNitDv } from '../../../common/utils/nit.util';
import { DocumentEmailMimeService } from './document-email-mime.service';
import { DocumentEmailZipService, type DocumentEmailZipBudget } from './document-email-zip.service';
import { ReceivedDocumentParserService } from './received-document-parser.service';
import { DocumentReceptionIngestService } from './document-reception-ingest.service';
import { DocumentEmailGmailCodeService } from './document-email-gmail-code.service';
import { decodeEmailXml, type DecodedEmailXml } from './document-email-xml-decoder.util';
import { DOCUMENT_EMAIL_REASON_CODES, type DocumentEmailInternalPart, type DocumentEmailPartResult, type DocumentEmailProcessor, type DocumentEmailProcessorRequest, type DocumentEmailProcessorResult, type DocumentEmailReasonCode, type DocumentEmailWarning } from '../interfaces/document-email-reception.interface';
import type { DetailedReceivedDocument, PreparedEmailDocument, PreparedEmailEvidence } from '../interfaces/received-document.interface';

interface Asset { part: DocumentEmailInternalPart; group: string; zip?: PreparedEmailEvidence; warnings: DocumentEmailWarning[]; }
interface Candidate { asset: Asset; prepared: PreparedEmailDocument; records: DocumentEmailPartResult[]; sources: Asset[]; }
interface ReceiptAsset { asset: Asset; decoded: DecodedEmailXml; parsed: DetailedReceivedDocument; }
const MIB = 1024 * 1024;

/** Transient MIME -> safe fiscal packages. No OCR, remote fetch, DIAN calls or legal events. */
@Injectable()
export class DocumentEmailAttachmentService implements DocumentEmailProcessor {
  constructor(
    private readonly mime: DocumentEmailMimeService,
    private readonly zip: DocumentEmailZipService,
    private readonly parser: ReceivedDocumentParserService,
    private readonly ingest: DocumentReceptionIngestService,
    private readonly gmail: DocumentEmailGmailCodeService,
  ) {}

  async processEmail(request: DocumentEmailProcessorRequest): Promise<DocumentEmailProcessorResult> {
    const facts = request.transport_facts;
    const scanReason = facts.virus_status === 'FAIL' ? 'VIRUS_BLOCKED'
      : facts.virus_status !== 'PASS' ? 'SECURITY_SCAN_UNAVAILABLE'
        : facts.spam_status !== 'PASS' ? 'SUSPICIOUS_EMAIL' : null;
    if (scanReason) { request.raw.destroy(); return this.outcome([], scanReason, false, false); }
    let guardError: unknown;
    const beforeWrite = async (): Promise<void> => {
      try {
        if (request.signal.aborted) throw this.reject('TECHNICAL_PROCESSING_ERROR');
        await request.before_write();
      } catch (error) { guardError = error; throw error; }
    };
    let mail: Awaited<ReturnType<DocumentEmailMimeService['parse']>>;
    try { mail = await this.mime.parse(request.raw, request.signal); }
    catch (error) {
      if (request.signal.aborted) throw error;
      // A source IO error is retryable, never an invalid supplier document.
      if (request.raw.errored && !(request.raw.errored instanceof HttpException)) return this.outcome([], 'TECHNICAL_PROCESSING_ERROR', true, false);
      const code = this.reason(error);
      return this.outcome([], code, code === 'TECHNICAL_PROCESSING_ERROR', false);
    }
    const challenge = await this.gmail.inspect(request.message_id, request.context, { sender: mail.sender, text: mail.text }, facts, beforeWrite);
    if (challenge) return challenge;
    const results: DocumentEmailPartResult[] = [];
    const assets: Asset[] = [];
    const budget: DocumentEmailZipBudget = { inflated_bytes: 0, entries: 0 };
    // Expand and validate every archive before any fiscal write occurs.
    for (const part of mail.parts) {
      if (this.kind(part.bytes) !== 'zip') { assets.push({ part, group: `${part.message_index}:direct`, warnings: [] }); continue; }
      try {
        const extracted = await this.zip.extract(part.bytes, budget, request.signal);
        const original = this.evidence('zip', part.bytes, part.filename, 'application/zip');
        extracted.entries.forEach((entry, index) => assets.push({
          part: { ...part, ordinal: part.ordinal * 100 + index + 1, filename: this.filename(entry.filename), bytes: entry.bytes, content_type: this.mimeType(entry.kind) },
          group: `${part.message_index}:zip:${part.ordinal}`, zip: original, warnings: extracted.warnings,
        }));
      } catch (error) {
        if (request.signal.aborted) throw error;
        results.push(this.result(part, 'not_processed', this.reason(error)));
      }
    }
    if (assets.length + results.length > 40) return this.outcome([], 'LIMIT_EXCEEDED', false, false);
    const candidates: Candidate[] = [];
    const pdfs: Asset[] = [];
    const receipts: ReceiptAsset[] = [];
    const rejectedKeyFacts = new Map<string, Array<{ fingerprint: string; result: DocumentEmailPartResult }>>();
    let businessCount = 0;
    for (const asset of assets) {
      const kind = this.kind(asset.part.bytes);
      if (kind === 'pdf') { pdfs.push(asset); continue; }
      if (kind !== 'xml') {
        results.push(this.result(asset.part, kind === 'other' ? 'ignored' : 'not_processed', kind === 'tnef' ? 'TNEF_UNSUPPORTED' : kind === 'unsupported_archive' ? 'ARCHIVE_FORMAT_UNSUPPORTED' : 'NOT_AN_INVOICE'));
        continue;
      }
      let parsed: DetailedReceivedDocument | undefined;
      try {
        const decoded = decodeEmailXml(asset.part.bytes);
        parsed = this.parser.parseDetailed(decoded.xml);
        if (parsed.fiscal.root === 'ApplicationResponse') { receipts.push({ asset, decoded, parsed }); continue; }
        if (parsed.normalized.document_type !== 'non_electronic') businessCount += 1;
        if (businessCount > 20) return this.outcome([], 'LIMIT_EXCEEDED', false, false);
        const warnings = [...asset.warnings];
        this.preflight(parsed, request, warnings);
        const evidence = [this.evidence(parsed.fiscal.container ? 'container' : 'commercial', asset.part.bytes, asset.part.filename, 'application/xml', decoded.encoding)];
        if (asset.zip) evidence.unshift(asset.zip);
        if (parsed.fiscal.container) evidence.push(this.embedded('commercial', parsed.commercial_xml!, `factura-${asset.part.ordinal}.xml`, decoded.encoding));
        parsed.application_responses.forEach((source, index) => evidence.push(this.embedded('dian_receipt', source, `constancia-${asset.part.ordinal}-${index + 1}.xml`, decoded.encoding)));
        const receipt = this.receipt(parsed);
        candidates.push({ asset, sources: [asset], records: [{ ...this.result(asset.part, 'received'), role: parsed.fiscal.container ? 'container' : 'commercial' }], prepared: {
          parsed, evidence: this.uniqueEvidence(evidence), email_message_id: request.message_id, warnings, receipt_evidence: receipt,
        } });
      } catch (error) {
        const rejected = this.result(asset.part, 'not_processed', this.reason(error, 'INVALID_FISCAL_XML'));
        if (rejected.reason_code === 'RECEIVER_MISMATCH') {
          const receiver = parsed?.fiscal.receiver_company_id.value?.replace(/[.\s]/g, '') || '';
          const expected = request.context.fiscal_identity.nit;
          if (/^[0-9]+(?:-[0-9])?$/.test(receiver) && receiver.length <= 50 && /^[0-9]+$/.test(expected) && expected.length <= 50) {
            rejected.reason_details = { receiver_tax_id: receiver, expected_receiver_tax_id: expected };
          }
        }
        results.push(rejected);
        const key = parsed?.normalized.document_key;
        if (parsed && key && /^[a-f0-9]{96}$/i.test(key)) rejectedKeyFacts.set(key.toLowerCase(), [...(rejectedKeyFacts.get(key.toLowerCase()) || []), { fingerprint: this.fingerprint(parsed), result: rejected }]);
      }
    }
    // Same key/different normalized facts or classification rejects the entire key group before writes.
    const groups = new Map<string, Candidate[]>();
    for (const candidate of candidates) {
      const key = candidate.prepared.parsed.normalized.document_key!.toLowerCase();
      groups.set(key, [...(groups.get(key) || []), candidate]);
    }
    const owners: Candidate[] = [];
    for (const [key, group] of groups) {
      const rejected = rejectedKeyFacts.get(key) || [];
      if (new Set([...group.map((candidate) => this.fingerprint(candidate.prepared.parsed)), ...rejected.map((entry) => entry.fingerprint)]).size !== 1) {
        for (const entry of rejected) entry.result.reason_code = 'DOCUMENT_KEY_CONFLICT';
        for (const candidate of group) results.push(...candidate.records.map((record) => ({ ...record, status: 'not_processed' as const, reason_code: 'DOCUMENT_KEY_CONFLICT' as const })));
        continue;
      }
      const owner = group[0];
      for (const duplicate of group.slice(1)) {
        owner.records.push(...duplicate.records); owner.sources.push(...duplicate.sources);
        owner.prepared.evidence = this.uniqueEvidence([...owner.prepared.evidence, ...duplicate.prepared.evidence]);
        owner.prepared.warnings = [...new Set([...owner.prepared.warnings, ...duplicate.prepared.warnings])];
        this.mergeReceipt(owner.prepared, duplicate.prepared.receipt_evidence);
      }
      owners.push(owner);
    }
    for (const pdf of pdfs) {
      const matches = this.associations(pdf, owners);
      if (matches.length !== 1) {
        results.push(this.result(pdf.part, 'not_processed', matches.length > 1 ? 'PDF_ASSOCIATION_AMBIGUOUS' : 'MISSING_FISCAL_XML'));
      } else {
        matches[0].prepared.evidence.push(this.evidence('representation', pdf.part.bytes, pdf.part.filename, 'application/pdf'));
        matches[0].records.push({ ...this.result(pdf.part, 'received'), role: 'representation' });
      }
    }
    for (const receipt of receipts) {
      const related = this.associations(receipt.asset, owners);
      const facts = receipt.parsed.application_response_evidence || [];
      const matching = related.filter((owner) => facts.length > 0 && facts.every((fact) => fact.document_key?.toLowerCase() === owner.prepared.parsed.normalized.document_key!.toLowerCase()));
      const target = matching.length === 1 ? matching[0] : related.length === 1 ? related[0] : null;
      if (!target) { results.push({ ...this.result(receipt.asset.part, 'ignored', 'NOT_AN_INVOICE'), role: 'dian_receipt' }); continue; }
      target.prepared.evidence.push(this.evidence('dian_receipt', receipt.asset.part.bytes, receipt.asset.part.filename, 'application/xml', receipt.decoded.encoding));
      target.records.push({ ...this.result(receipt.asset.part, 'received'), role: 'dian_receipt' });
      this.mergeReceipt(target.prepared, { included: true, reference_matches: matching.includes(target), response_code: this.responseCode(facts.length === 1 ? facts[0].response_code : null) });
    }
    // Enforce final evidence/result bounds for ALL packages before entering the core.
    for (const owner of owners) {
      owner.prepared.evidence = this.uniqueEvidence(owner.prepared.evidence);
      const receipt = owner.prepared.receipt_evidence;
      if (!receipt.included) owner.prepared.warnings.push('DIAN_RECEIPT_MISSING');
      else if (!receipt.reference_matches) owner.prepared.warnings.push('DIAN_RECEIPT_REFERENCE_MISMATCH');
      owner.prepared.warnings = [...new Set(owner.prepared.warnings)];
      if (owner.prepared.evidence.length > 40 || owner.prepared.evidence.reduce((sum, original) => sum + original.bytes.length, 0) > 100 * MIB) return this.outcome([], 'LIMIT_EXCEEDED', false, false);
    }
    const projected = [...results, ...owners.flatMap((owner) => owner.records.map((record) => ({ ...record, document_id: Number.MAX_SAFE_INTEGER, warnings: owner.prepared.warnings, originals_checkpoint: owner.prepared.evidence.map((original) => ({ sha256: original.sha256, stored: true })) })))];
    if (projected.length > 40 || Buffer.byteLength(JSON.stringify(projected), 'utf8') > 128 * 1024) return this.outcome([], 'LIMIT_EXCEEDED', false, false);
    // All candidates/associations are preflighted. Only now enter the prepared core seam sequentially.
    let valid = false;
    let technical = false;
    for (const owner of owners) {
      await beforeWrite();
      try {
        const ingested = await this.ingest.ingestPreparedEmail({ organization_id: request.context.organization_id, accounting_entity_id: request.context.accounting_entity_id, store_id: request.context.store_id, is_organization: false }, owner.prepared, beforeWrite);
        if (ingested.error_count > 0 || (ingested.received_count + ingested.duplicate_count < 1)) throw this.reject('TECHNICAL_PROCESSING_ERROR');
        const visibleId = ingested.document_ids[0];
        if (!Number.isSafeInteger(visibleId) || visibleId < 1) {
          // Hidden cross-store duplicates never expose IDs or modify that store's originals.
          if (ingested.duplicate_count < 1) throw this.reject('TECHNICAL_PROCESSING_ERROR');
          results.push(...owner.records.map((record) => ({ ...record, status: 'ignored' as const, reason_code: 'DUPLICATE_OTHER_STORE' as const })));
          valid = true;
          continue;
        }
        const checkpoint = owner.prepared.evidence.map((evidence) => ({ sha256: evidence.sha256, stored: true }));
        const duplicate = ingested.received_count === 0;
        results.push(...owner.records.map((record) => ({ ...record, status: duplicate ? 'ignored' as const : 'processed' as const,
          ...(duplicate ? { reason_code: 'DUPLICATE' as const } : {}), document_id: visibleId,
          warnings: owner.prepared.warnings, originals_checkpoint: checkpoint,
        })));
        valid = true;
      } catch (error) {
        if (guardError !== undefined) throw guardError;
        if (request.signal.aborted) throw error;
        const code = this.reason(error, 'TECHNICAL_PROCESSING_ERROR');
        const retryable = code === 'TECHNICAL_PROCESSING_ERROR';
        technical ||= retryable;
        results.push(...owner.records.map((record) => ({ ...record, status: retryable ? 'failed' as const : 'not_processed' as const, reason_code: code })));
      }
    }
    if (!owners.length && !results.length) return this.outcome([], /https?:\/\/\S+/i.test(mail.text) ? 'PROVIDER_SENT_LINK' : 'NOT_AN_INVOICE', false, false);
    if (!owners.length && results.every((part) => part.kind === 'pdf' || part.role === 'dian_receipt')) return this.outcome(results, 'MISSING_FISCAL_XML', false, false);
    return this.outcome(results, null, technical, valid);
  }

  private preflight(parsed: DetailedReceivedDocument, request: DocumentEmailProcessorRequest, warnings: DocumentEmailWarning[]): void {
    const fiscal = parsed.fiscal;
    for (const environment of [fiscal.profile_execution_id, ...(fiscal.container ? [fiscal.container.profile_execution_id] : [])]) {
      if (environment === '2') throw this.reject('TEST_DOCUMENT');
      if (environment !== '1') throw this.reject('INVALID_ENVIRONMENT');
    }
    for (const uuid of [fiscal.uuid, ...(fiscal.container ? [fiscal.container.uuid] : [])]) {
      if (uuid.scheme_id !== '1') throw this.reject('INVALID_ENVIRONMENT');
      if (!uuid.value || !/^[a-f0-9]{96}$/i.test(uuid.value)) throw this.reject('INVALID_FISCAL_XML');
    }
    const code = fiscal.document_type_code;
    if (fiscal.root === 'Invoice' && code === '05') throw this.reject('SUPPORT_DOCUMENT_NOT_RECEIVABLE');
    const admitted = fiscal.root === 'Invoice' ? ['01', '02', '03', '04', '20'].includes(code || '')
      : fiscal.root === 'CreditNote' ? code === '91' : fiscal.root === 'DebitNote' ? code === '92' : false;
    if (!admitted) throw this.reject('UNSUPPORTED_DOCUMENT_TYPE');
    const scheme = fiscal.root === 'Invoice' && code !== '20' ? 'CUFE-SHA384' : 'CUDE-SHA384';
    if (fiscal.uuid.scheme_name !== scheme || (fiscal.container && (fiscal.container.uuid.scheme_name !== scheme || fiscal.container.uuid.value?.toLowerCase() !== fiscal.uuid.value?.toLowerCase()))) throw this.reject('INVALID_FISCAL_XML');
    if (!parsed.commercial_xml || parsed.normalized.validation.errors.length || !parsed.normalized.validation.document_key_format_valid) throw this.reject('INVALID_FISCAL_XML');
    this.receiver(parsed, request, warnings);
  }

  private receiver(parsed: DetailedReceivedDocument, request: DocumentEmailProcessorRequest, warnings: DocumentEmailWarning[]): void {
    const authority = request.context.fiscal_identity;
    const receiver = parsed.fiscal.receiver_company_id;
    const expectedType = authority.nit_type?.toUpperCase();
    const isNit = expectedType === 'NIT' || expectedType === '31';
    const isCc = expectedType === 'CC' || expectedType === '13';
    const raw = receiver.value?.replace(/[.\s]/g, '') || '';
    if (raw === '222222222222') throw this.reject('FINAL_CONSUMER');
    if (!raw || (!isNit && !isCc) || !/^[0-9]+(?:-[0-9])?$/.test(raw)) throw this.reject('RECEIVER_ID_AMBIGUOUS');
    if (receiver.scheme_name === '13') {
      if (!isCc || raw !== authority.nit) throw this.reject('RECEIVER_MISMATCH');
    } else if (receiver.scheme_name === '31' || receiver.scheme_name == null) {
      if (receiver.scheme_name === '31' && !isNit) throw this.reject('RECEIVER_MISMATCH');
      if (!isNit) { if (raw !== authority.nit) throw this.reject('RECEIVER_MISMATCH'); }
      else {
        const digit = computeNitDv(authority.nit);
        if (receiver.scheme_id != null && receiver.scheme_id !== digit) throw this.reject('RECEIVER_ID_AMBIGUOUS');
        if (raw === authority.nit) { /* exact canonical base */ }
        else if (raw === `${authority.nit}-${digit}`) { /* validated separated DV */ }
        else if (raw === authority.nit + digit) warnings.push('RECEIVER_DV_ATTACHED');
        else throw this.reject('RECEIVER_MISMATCH');
      }
    } else throw this.reject('RECEIVER_ID_AMBIGUOUS');
    // Only after verified scheme/DV/identity comparison; original fiscal metadata/bytes remain untouched.
    parsed.normalized = { ...parsed.normalized, receiver_tax_id: authority.nit };
  }

  private associations(asset: Asset, owners: Candidate[]): Candidate[] {
    return owners.filter((candidate) => candidate.sources.some((source) => asset.group.includes(':zip:') ? source.group === asset.group : source.part.message_index === asset.part.message_index));
  }
  private receipt(parsed: DetailedReceivedDocument): PreparedEmailDocument['receipt_evidence'] {
    const facts = parsed.application_response_evidence || [];
    return { included: parsed.application_responses.length > 0, reference_matches: facts.length > 0 && facts.every((fact) => fact.document_key?.toLowerCase() === parsed.normalized.document_key?.toLowerCase()), response_code: this.responseCode(facts.length === 1 ? facts[0].response_code : null) };
  }
  private mergeReceipt(prepared: PreparedEmailDocument, next: PreparedEmailDocument['receipt_evidence']): void {
    if (!next.included) return;
    const prior = prepared.receipt_evidence;
    prepared.receipt_evidence = { included: true, reference_matches: next.reference_matches && (!prior.included || prior.reference_matches), response_code: prior.included && prior.response_code !== next.response_code ? null : next.response_code };
  }
  private responseCode(code: string | null): string | null { return code && /^[A-Za-z0-9_.-]{1,32}$/.test(code) ? code : null; }
  private embedded(role: PreparedEmailEvidence['role'], source: string, filename: string, outerEncoding: DecodedEmailXml['encoding']): PreparedEmailEvidence {
    // Derived DOM evidence, not sender-original bytes: XML normalizes CRLF. The
    // exact AttachedDocument/ZIP originals remain the authoritative raw hashes.
    const declared = source.match(/^<\?xml\b[^?]*\bencoding\s*=\s*['"]([^'"]+)['"]/i)?.[1]?.toLowerCase();
    const latin = declared ? ['iso-8859-1', 'latin1', 'latin-1'].includes(declared) : outerEncoding === 'iso-8859-1';
    if (declared && !latin && !['utf8', 'utf-8'].includes(declared)) throw this.reject('UNSUPPORTED_ENCODING');
    if (latin && [...source].some((character) => character.codePointAt(0)! > 255)) throw this.reject('UNSUPPORTED_ENCODING');
    const bytes = Buffer.from(source, latin ? 'latin1' : 'utf8');
    const decoded = decodeEmailXml(bytes);
    return this.evidence(role, bytes, filename, 'application/xml', decoded.encoding);
  }
  private evidence(role: PreparedEmailEvidence['role'], bytes: Buffer, filename: string, mime_type: string, encoding?: DecodedEmailXml['encoding']): PreparedEmailEvidence {
    if (!bytes.length || bytes.length > 10 * MIB) throw this.reject('LIMIT_EXCEEDED');
    return { role, bytes, filename: this.filename(filename), mime_type, sha256: this.hash(bytes), ...(encoding ? { encoding } : {}) };
  }
  private uniqueEvidence(evidence: PreparedEmailEvidence[]): PreparedEmailEvidence[] { return [...new Map(evidence.map((item) => [item.sha256, item])).values()]; }
  private fingerprint(parsed: DetailedReceivedDocument): string {
    const { validation: _validation, ...facts } = parsed.normalized;
    const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value;
    return JSON.stringify(canonical({ facts, classification: { root: parsed.fiscal.root, code: parsed.fiscal.document_type_code, scheme: parsed.fiscal.uuid.scheme_name } }));
  }
  private result(part: DocumentEmailInternalPart, status: DocumentEmailPartResult['status'], reason_code?: DocumentEmailReasonCode): DocumentEmailPartResult {
    const kind = this.kind(part.bytes);
    return { message_index: part.message_index, ordinal: part.ordinal, filename: this.filename(part.filename), sha256: this.hash(part.bytes), kind: ['xml', 'pdf', 'zip'].includes(kind) ? kind as 'xml' | 'pdf' | 'zip' : 'other', status, ...(reason_code ? { reason_code } : {}) };
  }
  private outcome(parts: DocumentEmailPartResult[], fallback: DocumentEmailReasonCode | null, retryable: boolean, valid_document: boolean): DocumentEmailProcessorResult {
    if (parts.length > 40 || Buffer.byteLength(JSON.stringify(parts), 'utf8') > 128 * 1024) throw this.reject('LIMIT_EXCEEDED');
    const rejected = parts.some((part) => ['not_processed', 'failed'].includes(part.status));
    const code = retryable ? 'TECHNICAL_PROCESSING_ERROR' : fallback || parts.find((part) => ['not_processed', 'failed'].includes(part.status))?.reason_code || (!valid_document ? parts.find((part) => part.reason_code)?.reason_code : null) || null;
    const status = valid_document ? rejected ? 'partial' : 'processed' : retryable ? 'failed' : code === 'NOT_AN_INVOICE' ? 'ignored' : parts.length && parts.every((part) => part.status === 'ignored') ? 'ignored' : 'not_processed';
    return { status, reason_code: code, retryable, parts, valid_document };
  }
  private kind(bytes: Buffer): 'xml' | 'pdf' | 'zip' | 'tnef' | 'unsupported_archive' | 'other' {
    if (bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50) return 'zip';
    if (bytes.subarray(0, 4).toString('ascii') === '%PDF') return 'pdf';
    if (bytes.length >= 4 && bytes.readUInt32LE(0) === 0x223e9f78) return 'tnef';
    if ((bytes.subarray(0, 6).equals(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) && [0, 1].includes(bytes[6])) || bytes.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))) return 'unsupported_archive';
    if (bytes[0] === 0xff && bytes[1] === 0xfe || bytes[0] === 0xfe && bytes[1] === 0xff) return 'xml';
    const prefix = bytes.subarray(0, 1024).toString('latin1').replace(/^ï»¿/, '').trimStart();
    return /^<\?xml\b|^<(?:[\w-]+:)?(?:Invoice|CreditNote|DebitNote|AttachedDocument|ApplicationResponse)\b/.test(prefix) ? 'xml' : 'other';
  }
  private mimeType(kind: string): string { return kind === 'xml' ? 'application/xml' : kind === 'pdf' ? 'application/pdf' : kind === 'zip' ? 'application/zip' : 'application/octet-stream'; }
  private hash(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
  private filename(value: string): string { return value.replace(/[\x00-\x1f\x7f\/\\]/g, '_').replace(/\.\./g, '_').slice(0, 120) || 'archivo'; }
  private reason(error: unknown, fallback: DocumentEmailReasonCode = 'CORRUPT_OR_ENCRYPTED_FILE'): DocumentEmailReasonCode {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (response && typeof response === 'object' && 'reason_code' in response && DOCUMENT_EMAIL_REASON_CODES.includes(response.reason_code as DocumentEmailReasonCode)) return response.reason_code as DocumentEmailReasonCode;
    }
    return fallback;
  }
  private reject(reason_code: DocumentEmailReasonCode): BadRequestException { return new BadRequestException({ reason_code, message: 'El correo o su archivo no supera la validación de recepción.' }); }
}
