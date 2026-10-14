import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { BadRequestException } from '@nestjs/common';
import { DocumentEmailMimeService } from './document-email-mime.service';

const fixture = (name: string): Buffer => readFileSync(join(__dirname, '../__fixtures__/email', name));
const raw = (body: string, headers = ''): Buffer => Buffer.from(`From: outer@example.invalid\r\nTo: target@example.invalid\r\nSubject: Prueba\r\nMessage-ID: <test@example.invalid>\r\n${headers}Content-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`);
function multipart(files: Array<{ bytes: Buffer; type?: string; name?: string; disposition?: string }>, body = 'Mensaje'): Buffer {
  const chunks = [Buffer.from('From: outer@example.invalid\r\nTo: target@example.invalid\r\nSubject: prueba\r\nContent-Type: multipart/mixed; boundary="test-boundary"\r\n\r\n--test-boundary\r\nContent-Type: text/plain\r\n\r\n' + body + '\r\n')];
  for (const file of files) chunks.push(Buffer.from(`--test-boundary\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\nContent-Disposition: ${file.disposition || 'attachment'}; filename="${file.name || 'archivo.bin'}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${file.bytes.toString('base64')}\r\n`));
  chunks.push(Buffer.from('--test-boundary--\r\n'));
  return Buffer.concat(chunks);
}
async function reason(promise: Promise<unknown>, code: string): Promise<void> {
  try { await promise; throw new Error('Expected rejection'); }
  catch (error) { expect(error).toBeInstanceOf(BadRequestException); expect((error as BadRequestException).getResponse()).toMatchObject({ reason_code: code }); }
}
const parse = (bytes: Buffer, service = new DocumentEmailMimeService()) => service.parse(Readable.from([bytes]));

describe('DocumentEmailMimeService', () => {
  it.each(['invoice.eml', 'credit-note.eml', 'debit-note.eml', 'inline-zip.eml', 'generic-mime-xml.eml'])('preserves fiscal attachment bytes from %s', async (name) => {
    const result = await parse(fixture(name));
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].message_index).toBe(0);
    expect(result.parts[0].bytes.length).toBeGreaterThan(100);
    expect(result.rfc_message_id_hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('recognizes Outlook attached RFC822 as one message, not auto-descended parts', async () => {
    const result = await parse(fixture('outlook-forward-as-attachment.eml'));
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].message_index).toBe(1);
    expect(result.parts[0].bytes).toEqual(fixture('invoice.zip'));
    expect(result.subject).toContain('outlook-forward');
  });
  it('keeps Gmail multi-forward message indexes distinct', async () => {
    const result = await parse(fixture('gmail-multi-forward.eml'));
    expect(result.parts).toHaveLength(3);
    expect(result.parts.map((part) => part.message_index)).toEqual([1, 2, 3]);
    expect(result.parts[0].bytes).toEqual(fixture('invoice.zip'));
  });
  it('recognizes a valid RFC822 message with generic MIME and no .eml filename', async () => {
    const result = await parse(multipart([{ bytes: fixture('invoice.eml'), name: 'data.bin' }]));
    expect(result.parts[0].message_index).toBe(1);
    expect(result.parts[0].bytes).toEqual(fixture('invoice.zip'));
  });
  it('does not let an .eml extension alone authorize recursive parsing', async () => {
    const bytes = Buffer.from('Just an ordinary non-email attachment');
    const result = await parse(multipart([{ bytes, name: 'fake.eml' }]));
    expect(result.parts[0].message_index).toBe(0);
    expect(result.parts[0].bytes).toEqual(bytes);
  });
  it('rejects an invalid explicitly declared RFC822 attachment', async () => {
    await reason(parse(multipart([{ bytes: Buffer.from('invalid'), type: 'message/rfc822' }])), 'CORRUPT_OR_ENCRYPTED_FILE');
  });
  it('rejects EML depth 2', async () => { await reason(parse(fixture('eml-depth-2.eml')), 'NESTING_LIMIT_EXCEEDED'); });
  it('rejects an aggregate inner-message count, without a fresh budget per EML', async () => {
    await reason(parse(fixture('gmail-multi-forward.eml'), new DocumentEmailMimeService({ internal_messages: 2 })), 'NESTING_LIMIT_EXCEEDED');
  });
  it('enforces relevant-parts budget across inner EML messages', async () => {
    await reason(parse(fixture('gmail-multi-forward.eml'), new DocumentEmailMimeService({ parts: 2 })), 'LIMIT_EXCEEDED');
  });
  it('charges SES raw bytes once, not again for decoded RFC822 reparsing', async () => {
    const bytes = fixture('outlook-forward-as-attachment.eml');
    expect((await parse(bytes, new DocumentEmailMimeService({ raw_bytes: bytes.length + 10 }))).parts).toHaveLength(1);
  });
  it('does not charge EML wrappers as relevant returned files', async () => {
    const inner = multipart([{ bytes: fixture('invoice.xml') }, { bytes: fixture('invoice.pdf') }]);
    const bytes = multipart([{ bytes: inner }, { bytes: inner }]);
    expect((await parse(bytes, new DocumentEmailMimeService({ parts: 4, internal_messages: 2 }))).parts).toHaveLength(4);
  });
  it('permits declared and actual generic RFC822 up to raw limit rather than fiscal part limit', async () => {
    const inner = raw('x'.repeat(300));
    for (const type of ['message/rfc822', 'application/octet-stream']) {
      const bytes = multipart([{ bytes: inner, type }]);
      expect((await parse(bytes, new DocumentEmailMimeService({ part_bytes: 200, raw_bytes: bytes.length + 10 }))).parts).toHaveLength(0);
    }
  });
  it('retains outer metadata only even when inner From is different', async () => {
    const result = await parse(multipart([{ bytes: fixture('invoice.eml') }]));
    expect(result.sender).toBe('outer@example.invalid');
    expect(result.subject).toBe('prueba');
  });
  it.each(['gmail-forwarding-confirmation.eml', 'gmail-forwarding-spoof.eml', 'gmail-forwarding-link-only.eml'])('never authenticates or extracts a Gmail code itself from %s', async (name) => {
    const result = await parse(fixture(name));
    expect(result.parts).toEqual([]);
    expect(result).not.toHaveProperty('gmail_authenticated');
    expect(result).not.toHaveProperty('code');
  });
  it.each(['winmail.eml', 'unsupported-archive.eml'])('preserves unsupported bytes for adapter classification: %s', async (name) => {
    expect((await parse(fixture(name))).parts).toHaveLength(1);
  });
  it.each(['provider-link.eml', 'non-invoice.eml'])('returns bounded inert plain text without fetching links: %s', async (name) => {
    const result = await parse(fixture(name));
    expect(result.parts).toHaveLength(0);
    expect(Buffer.byteLength(result.text)).toBeLessThan(256 * 1024);
    expect(result).not.toHaveProperty('html');
  });
  it('retains a valid and mismatched fiscal attachment for later preflight', async () => {
    expect((await parse(fixture('partial-batch.eml'))).parts).toHaveLength(2);
  });
  const xmlFixtures = ['bom-utf8.xml', 'latin1.xml', 'conflicting-encoding.xml', 'profile-execution-2.xml', 'pos-20.xml', 'support-05.xml', 'final-consumer.xml', 'receiver-nit-schemeid.xml', 'receiver-nit-appended-dv.xml', 'receiver-nit-hyphen-dv.xml', 'receiver-cc-13.xml', 'receiver-mismatch.xml', 'attached-without-application-response.xml', 'xml-xxe.xml'];
  it.each(xmlFixtures)('does not decode, rewrite, normalize or expand XML attachment %s', async (name) => {
    const bytes = fixture(name);
    const result = await parse(multipart([{ bytes, name }]));
    expect(result.parts[0].bytes).toEqual(bytes);
  });
  it('ignores a logo only by actual image signature, not content type', async () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    const result = await parse(multipart([{ bytes: png, type: 'application/octet-stream' }, { bytes: fixture('invoice.xml'), type: 'image/png' }]));
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].bytes).toEqual(fixture('invoice.xml'));
  });
  it('rejects raw bytes even when they arrive across multiple source chunks', async () => {
    const source = Readable.from([raw('a'), Buffer.alloc(300)]);
    await reason(new DocumentEmailMimeService({ raw_bytes: 200 }).parse(source), 'LIMIT_EXCEEDED');
    expect(source.destroyed).toBe(true);
  });
  it('rejects a single huge outer header before forwarding the source to the parser', async () => {
    await reason(parse(raw('ok', 'X-Test: ' + 'x'.repeat(300) + '\r\n'), new DocumentEmailMimeService({ header_bytes: 200 })), 'LIMIT_EXCEEDED');
  });
  it('rejects aggregate header-field counts', async () => {
    await reason(parse(raw('ok', 'X-A: one\r\nX-B: two\r\n'), new DocumentEmailMimeService({ header_fields: 5 })), 'LIMIT_EXCEEDED');
  });
  it('measures headers of inline text MIME parts, not only attachment metadata', async () => {
    const bytes = Buffer.from('From: a@example.invalid\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\nContent-Type: text/plain\r\nX-Huge: ' + 'a'.repeat(300) + '\r\n\r\nsmall\r\n--b--\r\n');
    await reason(parse(bytes, new DocumentEmailMimeService({ header_bytes: 200 })), 'LIMIT_EXCEEDED');
  });
  it('recognizes folded Content-Type boundaries and rejects body-part header excess', async () => {
    const bytes = Buffer.from('From: a@example.invalid\r\nContent-Type: multipart/mixed;\r\n boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain\r\nX-A: one\r\nX-B: two\r\n\r\nsmall\r\n--b--\r\n');
    await reason(parse(bytes, new DocumentEmailMimeService({ header_fields: 4 })), 'LIMIT_EXCEEDED');
  });
  it('rejects escaped/encoded boundary forms rather than missing their MIME headers', async () => {
    for (const parameter of ['boundary="ab\\"foo"', "boundary*=utf-8''encoded", 'boundary="=?UTF-8?B?Yg==?="', 'boundary=a; boundary=b']) {
      const bytes = Buffer.from('From: a@example.invalid\r\nContent-Type: multipart/mixed; ' + parameter + '\r\n\r\n--b\r\nX-Huge: ' + 'x'.repeat(300) + '\r\n\r\nbody\r\n--b--\r\n');
      await reason(parse(bytes, new DocumentEmailMimeService({ header_bytes: 200 })), 'CORRUPT_OR_ENCRYPTED_FILE');
    }
  });
  it('measures header budgets after a boundary delimiter with legal trailing whitespace', async () => {
    const bytes = Buffer.from('From: a@example.invalid\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n--b' + ' '.repeat(120) + '\r\nContent-Type: text/plain\r\nX-Huge: ' + 'a'.repeat(300) + '\r\n\r\nbody\r\n--b--\r\n');
    await reason(parse(bytes, new DocumentEmailMimeService({ header_bytes: 200 })), 'LIMIT_EXCEEDED');
  });
  it('rejects text at emission rather than returning or storing oversized content', async () => {
    await reason(parse(raw('x'.repeat(300)), new DocumentEmailMimeService({ text_bytes: 100 })), 'LIMIT_EXCEEDED');
  });
  it('never returns HTML and applies the body cap to HTML too', async () => {
    const bytes = Buffer.from('From: a@example.invalid\r\nContent-Type: text/html\r\n\r\n<p>' + 'x'.repeat(300) + '</p>');
    await reason(parse(bytes, new DocumentEmailMimeService({ text_bytes: 100 })), 'LIMIT_EXCEEDED');
    const result = await parse(Buffer.from('From: a@example.invalid\r\nContent-Type: text/html\r\n\r\n<b>not returned</b>'));
    expect(result.text).toBe(''); expect(result).not.toHaveProperty('html');
  });
  it('bounds attachment bytes and cleans source on failure without hanging', async () => {
    const bytes = multipart([{ bytes: Buffer.alloc(300) }, { bytes: fixture('invoice.xml') }]);
    const source = Readable.from([bytes]);
    await reason(new DocumentEmailMimeService({ part_bytes: 200 }).parse(source), 'LIMIT_EXCEEDED');
    expect(source.destroyed).toBe(true);
  });
  it('handles pre-aborted signal without consuming bytes', async () => {
    const controller = new AbortController(); controller.abort(); const source = Readable.from([raw('ok')]);
    await reason(new DocumentEmailMimeService().parse(source, controller.signal), 'TECHNICAL_PROCESSING_ERROR');
    expect(source.destroyed).toBe(true);
  });
  it('cleans a live stream when cancelled before delivery finishes', async () => {
    const controller = new AbortController(); const source = new Readable({ read() { this.push(raw('partial')); controller.abort(); } });
    await reason(new DocumentEmailMimeService().parse(source, controller.signal), 'TECHNICAL_PROCESSING_ERROR');
    expect(source.destroyed).toBe(true);
  });
  it('bounds names and metadata and permits missing RFC Message-ID', async () => {
    const result = await parse(multipart([{ bytes: Buffer.from('content'), name: '../' + 'a'.repeat(180) }]));
    expect(result.parts[0].filename.length).toBeLessThanOrEqual(120);
    expect(result.parts[0].filename).not.toMatch(/\.\.|[\/\\]/);
    expect(result.rfc_message_id_hash).toBeNull();
  });
  it('rejects invalid service limits', () => { expect(() => new DocumentEmailMimeService({ parts: 0 })).toThrow(BadRequestException); });
});
