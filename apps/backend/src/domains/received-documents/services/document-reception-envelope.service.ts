import { BadRequestException, Injectable } from '@nestjs/common';
import { TextDecoder } from 'node:util';
import {
  DocumentReceptionEnvelope,
  DocumentReceptionEnvelopeDocument,
  DocumentReceptionEnvelopeMimeType,
} from '../interfaces/document-reception-envelope.interface';

const MAX_ENVELOPE_BYTES = 5 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MIME_TYPES = new Set<DocumentReceptionEnvelopeMimeType>([
  'application/xml', 'text/xml', 'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
]);
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const CONTROL = /[\x00-\x1f\x7f]/;

@Injectable()
export class DocumentReceptionEnvelopeService {
  decode(input: Buffer): DocumentReceptionEnvelope {
    if (!Buffer.isBuffer(input) || input.length < 1 || input.length > MAX_ENVELOPE_BYTES) {
      throw this.invalid();
    }

    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(input);
    } catch {
      throw this.invalid();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw this.invalid();
    }
    if (!this.isPlainObject(parsed) || !this.hasExactKeys(parsed, ['version', 'documents', 'next_cursor'])) {
      throw this.invalid();
    }
    if (parsed['version'] !== 1 || !Array.isArray(parsed['documents']) || parsed['documents'].length > 10) {
      throw this.invalid();
    }
    const nextCursor = this.cursor(parsed['next_cursor']);
    const seenIds = new Set<string>();
    const documents = parsed['documents'].map((value) => {
      if (!this.isPlainObject(value) || !this.hasExactKeys(value, ['external_id', 'file_name', 'mime_type', 'content_base64'])) {
        throw this.invalid();
      }
      const externalId = this.externalId(value['external_id']);
      if (seenIds.has(externalId)) throw this.invalid();
      seenIds.add(externalId);
      const fileName = this.fileName(value['file_name']);
      const mimeType = this.mimeType(value['mime_type']);
      this.assertExtension(fileName, mimeType);
      const content = this.content(value['content_base64'], mimeType);
      return { external_id: externalId, file_name: fileName, mime_type: mimeType, content };
    });
    return { version: 1, documents, next_cursor: nextCursor };
  }

  private content(value: unknown, mimeType: DocumentReceptionEnvelopeMimeType): Buffer {
    if (typeof value !== 'string' || value.length === 0 || !BASE64.test(value)) throw this.invalid();
    const content = Buffer.from(value, 'base64');
    if (content.length < 1 || content.length > MAX_DOCUMENT_BYTES || content.toString('base64') !== value) throw this.invalid();
    this.assertMagic(content, mimeType);
    return content;
  }

  private assertMagic(content: Buffer, mimeType: DocumentReceptionEnvelopeMimeType): void {
    if (mimeType === 'application/xml' || mimeType === 'text/xml') {
      let xml: string;
      try {
        xml = new TextDecoder('utf-8', { fatal: true }).decode(content).replace(/^\uFEFF/, '').trimStart();
      } catch {
        throw this.invalid();
      }
      if (!xml.startsWith('<') || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw this.invalid();
      return;
    }
    if (mimeType === 'application/pdf' && content.subarray(0, 5).toString('ascii') === '%PDF-') return;
    if (mimeType === 'image/png' && content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return;
    if (mimeType === 'image/jpeg' && content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return;
    if (mimeType === 'image/webp' && content.length >= 12 && content.subarray(0, 4).toString('ascii') === 'RIFF' && content.subarray(8, 12).toString('ascii') === 'WEBP') return;
    throw this.invalid();
  }

  private externalId(value: unknown): string {
    if (typeof value !== 'string') throw this.invalid();
    const normalized = value.trim();
    if (!normalized || normalized.length > 160 || CONTROL.test(normalized)) throw this.invalid();
    return normalized;
  }

  private fileName(value: unknown): string {
    if (typeof value !== 'string' || value.length < 1 || value.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(value)) throw this.invalid();
    if (value.includes('/') || value.includes('\\')) throw this.invalid();
    return value;
  }

  private mimeType(value: unknown): DocumentReceptionEnvelopeMimeType {
    if (typeof value !== 'string' || !MIME_TYPES.has(value as DocumentReceptionEnvelopeMimeType)) throw this.invalid();
    return value as DocumentReceptionEnvelopeMimeType;
  }

  private assertExtension(fileName: string, mimeType: DocumentReceptionEnvelopeMimeType): void {
    const lower = fileName.toLowerCase();
    const matching = mimeType === 'application/xml' || mimeType === 'text/xml' ? lower.endsWith('.xml')
      : mimeType === 'application/pdf' ? lower.endsWith('.pdf')
        : mimeType === 'image/png' ? lower.endsWith('.png')
          : mimeType === 'image/jpeg' ? lower.endsWith('.jpg') || lower.endsWith('.jpeg')
            : lower.endsWith('.webp');
    if (!matching) throw this.invalid();
  }

  private cursor(value: unknown): string | null {
    if (value === null) return null;
    if (typeof value !== 'string' || value.length < 1 || value.length > 1000 || CONTROL.test(value)) throw this.invalid();
    return value;
  }

  private hasExactKeys(value: Record<string, unknown>, allowed: string[]): boolean {
    const keys = Object.keys(value);
    return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  }

  private invalid(): BadRequestException {
    return new BadRequestException('El formato de recepción automática no es válido.');
  }
}
