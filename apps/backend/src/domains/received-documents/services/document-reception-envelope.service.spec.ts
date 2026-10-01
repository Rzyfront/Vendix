import { BadRequestException } from '@nestjs/common';
import { DocumentReceptionEnvelopeService } from './document-reception-envelope.service';

const xml = Buffer.from('\uFEFF \n<Invoice/>', 'utf8');

function wireDocument(overrides: Record<string, unknown> = {}) {
  return {
    external_id: ' ext-1 ',
    file_name: 'invoice.xml',
    mime_type: 'application/xml',
    content_base64: xml.toString('base64'),
    ...overrides,
  };
}

function envelope(documents: unknown[] = [wireDocument()], overrides: Record<string, unknown> = {}) {
  return { version: 1, documents, next_cursor: 'provider-cursor', ...overrides };
}

function encode(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

describe('DocumentReceptionEnvelopeService', () => {
  let service: DocumentReceptionEnvelopeService;
  beforeEach(() => { service = new DocumentReceptionEnvelopeService(); });

  it('decodes strict UTF-8 JSON into safe buffered documents and leaves tenant identity out-of-band', () => {
    const result = service.decode(encode(envelope()));
    expect(result).toEqual({
      version: 1,
      documents: [{ external_id: 'ext-1', file_name: 'invoice.xml', mime_type: 'application/xml', content: xml }],
      next_cursor: 'provider-cursor',
    });
    expect(result.documents[0]).not.toHaveProperty('organization_id');
  });

  it('accepts each supported MIME only with the matching extension and content signature', () => {
    const fixtures: Array<{ name: string; mime: string; bytes: Buffer }> = [
      { name: 'f.xml', mime: 'text/xml', bytes: Buffer.from(' <Invoice/>') },
      { name: 'f.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-1.7') },
      { name: 'f.png', mime: 'image/png', bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) },
      { name: 'f.jpg', mime: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
      { name: 'f.webp', mime: 'image/webp', bytes: Buffer.from('RIFF0000WEBP') },
    ];
    for (const fixture of fixtures) {
      const decoded = service.decode(encode(envelope([wireDocument({
        file_name: fixture.name, mime_type: fixture.mime, content_base64: fixture.bytes.toString('base64'),
      })])));
      expect(decoded.documents[0].content).toEqual(fixture.bytes);
    }
  });

  it.each([
    ['invalid UTF-8', Buffer.from([0xc3, 0x28])],
    ['invalid JSON', Buffer.from('{')],
    ['oversized raw envelope', Buffer.alloc(5 * 1024 * 1024 + 1, 0x20)],
  ])('rejects %s with a generic error', (_label, bytes) => {
    expect(() => service.decode(bytes as Buffer)).toThrow(BadRequestException);
  });

  it.each([
    ['extra tenant key', envelope([wireDocument()], { organization_id: 9 })],
    ['wrong version', envelope([wireDocument()], { version: 2 })],
    ['too many documents', envelope(Array.from({ length: 11 }, (_, i) => wireDocument({ external_id: `id-${i}` })))],
    ['duplicate external id', envelope([wireDocument(), wireDocument({ file_name: 'other.xml' })])],
    ['unsafe file path', envelope([wireDocument({ file_name: '../invoice.xml' })])],
    ['extra document key', envelope([wireDocument({ tenant_id: 2 })])],
    ['empty cursor string', envelope([wireDocument()], { next_cursor: '' })],
    ['control cursor', envelope([wireDocument()], { next_cursor: 'bad\u0000cursor' })],
  ])('rejects envelope structure: %s', (_label, value) => {
    expect(() => service.decode(encode(value))).toThrow(BadRequestException);
  });

  it.each([
    ['noncanonical base64', wireDocument({ content_base64: 'PHh4= ' })],
    ['wrong extension', wireDocument({ file_name: 'invoice.pdf' })],
    ['wrong XML prefix', wireDocument({ content_base64: Buffer.from('not xml').toString('base64') })],
    ['DOCTYPE', wireDocument({ content_base64: Buffer.from('<!DOCTYPE x><Invoice/>').toString('base64') })],
    ['ENTITY', wireDocument({ content_base64: Buffer.from('<!ENTITY x "y"><Invoice/>').toString('base64') })],
    ['spoofed PDF magic', wireDocument({ file_name: 'f.pdf', mime_type: 'application/pdf', content_base64: Buffer.from('not pdf').toString('base64') })],
    ['unsupported MIME', wireDocument({ mime_type: 'application/octet-stream' })],
  ])('rejects document content: %s', (_label, doc) => {
    expect(() => service.decode(encode(envelope([doc])))).toThrow(BadRequestException);
  });

  it('rejects noncanonical base64 padding and invalid external identifiers', () => {
    for (const contentBase64 of ['YQ', 'YQ===', 'YQ==\n', 'YQ=']) {
      expect(() => service.decode(encode(envelope([wireDocument({ content_base64: contentBase64 })])))).toThrow(BadRequestException);
    }
    for (const external_id of ['', '   ', 'a'.repeat(161), 'bad\nkey']) {
      expect(() => service.decode(encode(envelope([wireDocument({ external_id })])))).toThrow(BadRequestException);
    }
  });
});
