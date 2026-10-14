import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MailParser, type AddressObject, type AttachmentStream, type Headers, type MailParserOptions } from 'mailparser';
import type { DocumentEmailInternalPart } from '../interfaces/document-email-reception.interface';

export const DOCUMENT_EMAIL_MIME_LIMITS = Symbol('DOCUMENT_EMAIL_MIME_LIMITS');
export interface DocumentEmailMimeLimits {
  raw_bytes: number;
  header_bytes: number;
  header_fields: number;
  text_bytes: number;
  part_bytes: number;
  parts: number;
  internal_messages: number;
}
export interface DocumentEmailMimeResult {
  sender: string;
  subject: string;
  text: string;
  rfc_message_id_hash: string | null;
  parts: DocumentEmailInternalPart[];
}
interface MimeBudget { raw_bytes: number; header_bytes: number; header_fields: number; text_bytes: number; parts: number; internal_messages: number; next_message_index: number; }
interface ParserText { type: 'text'; text?: string; html?: string | false; }
const DEFAULTS: DocumentEmailMimeLimits = {
  raw_bytes: 20 * 1024 * 1024,
  header_bytes: 64 * 1024,
  header_fields: 200,
  text_bytes: 256 * 1024,
  part_bytes: 10 * 1024 * 1024,
  parts: 40,
  internal_messages: 20,
};
function rejection(reason_code: string, message: string): BadRequestException { return new BadRequestException({ reason_code, message }); }

/** Byte/header guard only, not a second MIME decoder. Body lines retain at most 80 bytes. */
class MimeInputGuard extends Transform {
  private inHeaders = true;
  private line: number[] = [];
  private lineBytes = 0;
  private bodyTailIsWhitespace = true;
  private headerBlock = '';
  private readonly boundaries = new Set<string>();
  constructor(private readonly limits: DocumentEmailMimeLimits, private readonly budget: MimeBudget, private readonly chargeRaw: boolean) { super(); }
  override _transform(chunk: Buffer | string, encoding: BufferEncoding, done: TransformCallback): void {
    try {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      if (this.chargeRaw) this.budget.raw_bytes += bytes.length;
      if (this.budget.raw_bytes > this.limits.raw_bytes) throw rejection('LIMIT_EXCEEDED', 'El correo supera el límite de tamaño.');
      for (const byte of bytes) {
        this.lineBytes += 1;
        if (this.inHeaders) {
          this.budget.header_bytes += 1;
          if (this.budget.header_bytes > this.limits.header_bytes) throw rejection('LIMIT_EXCEEDED', 'Las cabeceras del correo son demasiado grandes.');
        }
        if (this.inHeaders || this.line.length < 80) this.line.push(byte);
        else if (![9, 13, 10, 32].includes(byte)) this.bodyTailIsWhitespace = false;
        if (byte === 10) this.finishLine();
      }
      done(null, bytes);
    } catch (error) { done(error as Error); }
  }
  override _flush(done: TransformCallback): void {
    try {
      if (this.lineBytes) this.finishLine();
      if (this.inHeaders) throw rejection('CORRUPT_OR_ENCRYPTED_FILE', 'Las cabeceras del correo están incompletas.');
      done();
    } catch (error) { done(error as Error); }
  }
  private finishLine(): void {
    const text = Buffer.from(this.line).toString('latin1').replace(/\r?\n$/, '');
    if (this.inHeaders) {
      if (text === '') {
        // Folded Content-Type headers are legal; guard boundaries on the wire, not decoded HTML.
        const unfolded = this.headerBlock.replace(/\r?\n[ \t]+/g, ' ');
        const contentTypes = [...unfolded.matchAll(/^content-type:\s*(.*)$/gim)].map((match) => match[1].trim());
        if (contentTypes.length > 1) throw rejection('CORRUPT_OR_ENCRYPTED_FILE', 'El correo tiene cabeceras de tipo ambiguas.');
        for (const contentType of contentTypes) {
          if (!/^multipart\//i.test(contentType)) continue;
          // Intentionally reject RFC2231/escaped/duplicate boundary variants instead of
          // letting a lenient SDK interpret a separator this byte guard cannot measure.
          if (/boundary\*|\\|=\?/i.test(contentType)) throw rejection('CORRUPT_OR_ENCRYPTED_FILE', 'El separador del correo no está admitido.');
          const matches = [...contentType.matchAll(/;\s*boundary\s*=\s*(?:"([^"\r\n]*)"|([^;\s]+))(?=\s*(?:;|$))/gi)];
          if (matches.length !== 1) throw rejection('CORRUPT_OR_ENCRYPTED_FILE', 'El correo no tiene un separador inequívoco.');
          const boundary = matches[0][1] || matches[0][2];
          if (!matches[0][1] && /[()\/:=?]/.test(boundary)) throw rejection('CORRUPT_OR_ENCRYPTED_FILE', 'El separador del correo requiere comillas.');
          if (!boundary || boundary.length > 70 || !/^[A-Za-z0-9'()+_,.\/:=? -]+$/.test(boundary) || boundary.trim() !== boundary) throw rejection('LIMIT_EXCEEDED', 'El separador del correo no es válido.');
          this.boundaries.add(boundary);
        }
        this.headerBlock = '';
        this.inHeaders = false;
      } else {
        if (!/^[ \t]/.test(text)) {
          this.budget.header_fields += 1;
          if (this.budget.header_fields > this.limits.header_fields) throw rejection('LIMIT_EXCEEDED', 'El correo contiene demasiadas cabeceras.');
          if (!/^[!#$%&'*+.^_`|~\w-]+:/.test(text)) throw rejection('CORRUPT_OR_ENCRYPTED_FILE', 'Las cabeceras del correo no son válidas.');
        }
        this.headerBlock += text + '\r\n';
      }
    } else if (this.bodyTailIsWhitespace) {
      for (const boundary of this.boundaries) {
        if (text.trimEnd() === '--' + boundary) { this.inHeaders = true; break; }
      }
    }
    this.line = [];
    this.lineBytes = 0;
    this.bodyTailIsWhitespace = true;
  }
}

@Injectable()
export class DocumentEmailMimeService {
  private readonly limits: DocumentEmailMimeLimits;
  constructor(@Optional() @Inject(DOCUMENT_EMAIL_MIME_LIMITS) limits: Partial<DocumentEmailMimeLimits> = {}) {
    this.limits = { ...DEFAULTS, ...limits };
    if (Object.values(this.limits).some((value) => !Number.isSafeInteger(value) || value <= 0)) throw rejection('LIMIT_EXCEEDED', 'Los límites del correo no son válidos.');
  }

  async parse(source: Readable, signal?: AbortSignal): Promise<DocumentEmailMimeResult> {
    const budget: MimeBudget = { raw_bytes: 0, header_bytes: 0, header_fields: 0, text_bytes: 0, parts: 0, internal_messages: 0, next_message_index: 1 };
    return this.parseMessage(source, budget, signal, 0, 0);
  }

  private async parseMessage(source: Readable, budget: MimeBudget, signal: AbortSignal | undefined, depth: number, messageIndex: number): Promise<DocumentEmailMimeResult> {
    if (signal?.aborted) { source.destroy(); throw rejection('TECHNICAL_PROCESSING_ERROR', 'Se interrumpió la lectura del correo.'); }
    const options: MailParserOptions & { ignoreEmbedded: boolean } = {
      skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true, skipTextLinks: true,
      maxHtmlLengthToParse: this.limits.text_bytes, checksumAlgo: 'sha256', ignoreEmbedded: true,
    };
    const parser = new MailParser(options);
    const guard = new MimeInputGuard(this.limits, budget, depth === 0);
    const result: DocumentEmailMimeResult = { sender: '', subject: '', text: '', rfc_message_id_hash: null, parts: [] };
    const streams = new Set<Readable>();
    const attachments = new Set<AttachmentStream>();
    const tasks: Promise<void>[] = [];
    let ordinal = 0;
    let failure: BadRequestException | undefined;
    const fail = (error: unknown): void => {
      if (failure) return;
      failure = error instanceof BadRequestException ? error : rejection('CORRUPT_OR_ENCRYPTED_FILE', 'No pudimos leer el correo de forma segura.');
      for (const attachment of attachments) {
        if (typeof attachment.release === 'function') attachment.release();
      }
      attachments.clear();
      for (const stream of streams) stream.destroy(failure);
      source.destroy(failure);
      guard.destroy(failure);
      parser.destroy(failure);
    };
    parser.on('error', fail);
    guard.on('error', fail);
    const abort = (): void => fail(rejection('TECHNICAL_PROCESSING_ERROR', 'Se interrumpió la lectura del correo.'));
    signal?.addEventListener('abort', abort, { once: true });
    parser.on('headers', (headers: Headers) => {
      const from = headers.get('from') as AddressObject | undefined;
      result.sender = this.metadata(from?.value?.[0]?.address || '', 255);
      result.subject = this.metadata(typeof headers.get('subject') === 'string' ? headers.get('subject') as string : '', 255);
      const messageId = headers.get('message-id');
      if (typeof messageId === 'string' && messageId.trim()) result.rfc_message_id_hash = createHash('sha256').update(messageId.trim()).digest('hex');
    });
    parser.on('data', (part: AttachmentStream | ParserText) => {
      if (failure) {
        if (part.type === 'attachment') { if (typeof part.release === 'function') part.release(); (part.content as Readable).destroy(); }
        return;
      }
      if (part.type === 'text') {
        // MailParser buffers text internally. Raw20MiB/concurrency1 bounds it; never return oversize text.
        const text = typeof part.text === 'string' ? part.text : '';
        const htmlBytes = typeof part.html === 'string' ? Buffer.byteLength(part.html, 'utf8') : 0;
        const textBytes = Buffer.byteLength(text, 'utf8');
        budget.text_bytes += textBytes + htmlBytes;
        if (budget.text_bytes > this.limits.text_bytes) { fail(rejection('LIMIT_EXCEEDED', 'El cuerpo del correo es demasiado grande.')); return; }
        result.text = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').replace(/<[^>]*>/g, '').trim();
        return;
      }
      const currentOrdinal = ++ordinal;
      const declaredType = this.declaredType(part);
      const content = part.content as Readable;
      attachments.add(part);
      streams.add(content);
      const task = (async (): Promise<void> => {
        const chunks: Buffer[] = [];
        let size = 0;
        let probe = Buffer.alloc(0);
        let nestedCandidate = declaredType === 'message/rfc822';
        try {
          for await (const chunk of content) {
            if (signal?.aborted) throw rejection('TECHNICAL_PROCESSING_ERROR', 'Se interrumpió la lectura del correo.');
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
            size += bytes.length;
            if (!nestedCandidate && probe.length < this.limits.header_bytes + 4) {
              probe = Buffer.concat([probe, bytes.subarray(0, this.limits.header_bytes + 4 - probe.length)]);
              nestedCandidate = this.isRfc822(probe);
            }
            const partLimit = nestedCandidate ? this.limits.raw_bytes : this.limits.part_bytes;
            if (size > partLimit) throw rejection('LIMIT_EXCEEDED', 'Un archivo adjunto supera el límite permitido.');
            chunks.push(bytes);
          }
          const bytes = Buffer.concat(chunks, size);
          if (this.isImage(bytes)) return;
          const rfc822 = this.isRfc822(bytes);
          if (declaredType === 'message/rfc822' || rfc822) {
            if (!rfc822) throw rejection('CORRUPT_OR_ENCRYPTED_FILE', 'El correo adjunto no contiene cabeceras válidas.');
            if (depth >= 1) throw rejection('NESTING_LIMIT_EXCEEDED', 'Hay demasiados correos dentro de otros correos.');
            budget.internal_messages += 1;
            if (budget.internal_messages > this.limits.internal_messages) throw rejection('NESTING_LIMIT_EXCEEDED', 'El envío contiene demasiados correos adjuntos.');
            const inner = await this.parseMessage(Readable.from([bytes]), budget, signal, depth + 1, budget.next_message_index++);
            result.parts.push(...inner.parts);
            return;
          }
          budget.parts += 1;
          if (budget.parts > this.limits.parts) throw rejection('LIMIT_EXCEEDED', 'El correo contiene demasiados archivos.');
          // Preserve bytes/types even inline or octet-stream; adapter classifies by content, not hints.
          result.parts.push({ message_index: messageIndex, ordinal: currentOrdinal, filename: this.filename(part.filename, currentOrdinal), content_type: declaredType.slice(0, 120), bytes });
        } finally {
          attachments.delete(part);
          streams.delete(content);
          if (typeof part.release === 'function') part.release();
          content.destroy();
        }
      })().catch(fail);
      tasks.push(task);
    });
    try {
      await pipeline(source, guard, parser);
      await Promise.all(tasks);
      if (failure) throw failure;
      return result;
    } catch (error) {
      fail(error);
      await Promise.all(tasks);
      throw failure;
    } finally {
      signal?.removeEventListener('abort', abort);
      for (const part of attachments) if (typeof part.release === 'function') part.release();
      for (const stream of streams) stream.destroy();
      source.destroy(); guard.destroy(); parser.destroy();
    }
  }

  private isRfc822(bytes: Buffer): boolean {
    const prefix = bytes.subarray(0, this.limits.header_bytes + 4).toString('latin1');
    const end = prefix.search(/\r?\n\r?\n/);
    if (end < 0) return false;
    const block = prefix.slice(0, end);
    const lines = block.split(/\r?\n/);
    if (lines.some((line) => !/^[ \t]|^[!#$%&'*+.^_`|~\w-]+:/.test(line))) return false;
    return /^(?:From|Sender):/im.test(block) && /^(?:To|Subject|Date|Message-ID|MIME-Version):/im.test(block);
  }
  private declaredType(part: AttachmentStream): string {
    // MailParser may guess .eml as message/rfc822 from a generic attachment's
    // filename. Only the actual MIME header may require RFC822 validation.
    const header = part.headers.get('content-type');
    if (typeof header === 'string') return header.split(';', 1)[0].trim().toLowerCase();
    if (header && typeof header === 'object' && !Array.isArray(header) && 'value' in header && typeof header.value === 'string') return header.value.toLowerCase();
    return 'application/octet-stream';
  }
  private isImage(bytes: Buffer): boolean {
    return (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
      ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii')) ||
      (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP');
  }
  private metadata(raw: string, max: number): string { return raw.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/<[^>]*>/g, '').replace(/https?:\/\/\S+/gi, '[enlace]').trim().slice(0, max); }
  private filename(raw: string | undefined, ordinal: number): string {
    const name = this.metadata(raw || `adjunto-${ordinal}`, 120).replace(/[\/\\]/g, '_').replace(/\.\./g, '_');
    return name || `adjunto-${ordinal}`;
  }
}
