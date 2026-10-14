import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { BadRequestException } from '@nestjs/common';
import { DocumentEmailZipService, type DocumentEmailZipBudget } from './document-email-zip.service';

const fixture = (name: string): Buffer => readFileSync(join(__dirname, '../__fixtures__/email', name));
/** Small ZIP test vectors, no external archive dependency or filesystem extraction. */
function archive(entries: Array<{ name: string; bytes: Buffer }>, compressed = false): Buffer {
  const chunks: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const { name, bytes } of entries) {
    let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } crc = (crc ^ 0xffffffff) >>> 0;
    const filename = Buffer.from(name), content = compressed ? deflateRawSync(bytes) : bytes;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(compressed ? 8 : 0, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(content.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
    chunks.push(local, filename, content);
    const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(compressed ? 8 : 0, 10); record.writeUInt32LE(crc, 16); record.writeUInt32LE(content.length, 20); record.writeUInt32LE(bytes.length, 24); record.writeUInt16LE(filename.length, 28); record.writeUInt32LE(offset, 42); central.push(record, filename);
    offset += local.length + filename.length + content.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}
async function reason(promise: Promise<unknown>, code: string): Promise<void> {
  try { await promise; throw new Error('Expected rejection'); }
  catch (error) { expect(error).toBeInstanceOf(BadRequestException); expect((error as BadRequestException).getResponse()).toMatchObject({ reason_code: code }); }
}

describe('DocumentEmailZipService', () => {
  it('extracts invoice XML/PDF bytes with shared counters and no disk writes', async () => {
    const budget = { entries: 0, inflated_bytes: 0 };
    const result = await new DocumentEmailZipService().extract(fixture('invoice.zip'), budget);
    expect(result.entries.map((entry) => entry.kind)).toEqual(['xml', 'pdf']);
    expect(result.entries[0].bytes).toEqual(fixture('invoice.attached.xml'));
    expect(result.entries[1].bytes).toEqual(fixture('invoice.pdf'));
    expect(budget.entries).toBe(2);
    expect(budget.inflated_bytes).toBe(fixture('invoice.attached.xml').length + fixture('invoice.pdf').length);
  });
  it('keeps PDF-only ZIP for adapter to report missing fiscal XML', async () => {
    const result = await new DocumentEmailZipService().extract(fixture('pdf-only.zip'));
    expect(result.entries).toHaveLength(1); expect(result.entries[0].kind).toBe('pdf');
  });
  it('accepts one principal ZIP-in-ZIP when sole content and counts both levels', async () => {
    const budget = { entries: 0, inflated_bytes: 0 };
    const result = await new DocumentEmailZipService().extract(fixture('principal-double.zip'), budget);
    expect(result.entries).toHaveLength(2); expect(budget.entries).toBe(3);
    expect(budget.inflated_bytes).toBe(fixture('invoice.zip').length + fixture('invoice.attached.xml').length + fixture('invoice.pdf').length);
  });
  it('never opens traversal-containing complementary ZIP when a principal XML exists', async () => {
    const result = await new DocumentEmailZipService().extract(fixture('invoice-with-complement.zip'));
    expect(result.entries).toHaveLength(1); expect(result.entries[0].kind).toBe('xml');
    expect(result.warnings).toEqual(['COMPLEMENT_ARCHIVE_NOT_EXPANDED']);
  });
  it('rejects a third nesting level', async () => {
    await reason(new DocumentEmailZipService().extract(archive([{ name: 'double.zip', bytes: fixture('principal-double.zip') }])), 'NESTING_LIMIT_EXCEEDED');
  });
  it('rejects a nested principal ZIP mixed with unrelated non-XML files', async () => {
    await reason(new DocumentEmailZipService().extract(archive([{ name: 'inner.zip', bytes: fixture('invoice.zip') }, { name: 'note.txt', bytes: Buffer.from('note') }])), 'NESTING_LIMIT_EXCEEDED');
  });
  it.each(['zip-traversal.zip', 'zip-collision.zip', 'zip-crc-invalid.zip', 'zip-encrypted-flag.zip', 'zip-symlink.zip'])('safely rejects %s', async (name) => {
    await reason(new DocumentEmailZipService().extract(fixture(name)), 'CORRUPT_OR_ENCRYPTED_FILE');
  });
  it.each(['/absolute.xml', 'C:/drive.xml', '..\\escape.xml', '\\server\\file.xml', 'nul\0.xml'])('rejects unsafe entry path %s', async (name) => {
    await reason(new DocumentEmailZipService().extract(archive([{ name, bytes: Buffer.from('<Invoice/>') }])), 'CORRUPT_OR_ENCRYPTED_FILE');
  });
  it('rejects canonical collisions without creating filesystem paths', async () => {
    await reason(new DocumentEmailZipService().extract(archive([{ name: 'same.xml', bytes: Buffer.from('a') }, { name: './same.xml', bytes: Buffer.from('b') }])), 'CORRUPT_OR_ENCRYPTED_FILE');
  });
  it('rejects inconsistent encryption in the local header alone', async () => {
    const bytes = archive([{ name: 'a.xml', bytes: Buffer.from('data') }]); bytes.writeUInt16LE(1, 6);
    await reason(new DocumentEmailZipService().extract(bytes), 'CORRUPT_OR_ENCRYPTED_FILE');
  });
  it('checks CRC for deflated data as well as stored entries', async () => {
    const bytes = archive([{ name: 'invoice.xml', bytes: fixture('invoice.xml') }], true);
    const result = await new DocumentEmailZipService().extract(bytes);
    expect(result.entries[0].bytes).toEqual(fixture('invoice.xml'));
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); bytes.writeUInt32LE(123, central + 16);
    await reason(new DocumentEmailZipService().extract(bytes), 'CORRUPT_OR_ENCRYPTED_FILE');
  });
  it('rejects the small highly-compressible ratio fixture based on inflated chunks', async () => {
    await reason(new DocumentEmailZipService().extract(fixture('zip-ratio-limit.zip')), 'LIMIT_EXCEEDED');
  });
  it('counts actual inflated bytes cumulatively instead of trusting metadata sizes', async () => {
    await reason(new DocumentEmailZipService({ inflated_bytes: 200 }).extract(fixture('zip-inflated-budget.zip')), 'LIMIT_EXCEEDED');
  });
  it('enforces small entry count vectors', async () => {
    await reason(new DocumentEmailZipService({ entries: 2 }).extract(fixture('zip-entry-limit.zip')), 'LIMIT_EXCEEDED');
  });
  it('shares inflated budget between two separate MIME archive parts', async () => {
    const service = new DocumentEmailZipService({ inflated_bytes: 400 }); const budget = { inflated_bytes: 0, entries: 0 };
    await service.extract(fixture('zip-inflated-budget.zip'), budget);
    await reason(service.extract(fixture('zip-inflated-budget.zip'), budget), 'LIMIT_EXCEEDED');
  });
  it('shares entry budget between separate archives', async () => {
    const service = new DocumentEmailZipService({ entries: 4 }); const budget = { inflated_bytes: 0, entries: 0 };
    await service.extract(fixture('zip-entry-limit.zip'), budget);
    await reason(service.extract(fixture('zip-entry-limit.zip'), budget), 'LIMIT_EXCEEDED');
  });
  it('rejects oversized compressed bytes before opening an archive', async () => {
    await reason(new DocumentEmailZipService({ compressed_bytes: 100 }).extract(fixture('invoice.zip')), 'LIMIT_EXCEEDED');
  });
  it('rejects individually oversized inflated entries', async () => {
    await reason(new DocumentEmailZipService({ entry_bytes: 100 }).extract(fixture('invoice.zip')), 'LIMIT_EXCEEDED');
  });
  it('rejects truncated archive without raw exception or stack', async () => {
    await reason(new DocumentEmailZipService().extract(fixture('invoice.zip').subarray(0, 100)), 'CORRUPT_OR_ENCRYPTED_FILE');
  });
  it('rejects an empty input and non-ZIP bytes', async () => {
    await reason(new DocumentEmailZipService().extract(Buffer.alloc(0)), 'CORRUPT_OR_ENCRYPTED_FILE');
    await reason(new DocumentEmailZipService().extract(Buffer.from('not a zip')), 'CORRUPT_OR_ENCRYPTED_FILE');
  });
  it('supports empty actual file entries but not invalid budgets or config', async () => {
    const result = await new DocumentEmailZipService().extract(archive([{ name: 'empty.txt', bytes: Buffer.alloc(0) }]));
    expect(result.entries[0].bytes).toEqual(Buffer.alloc(0));
    await reason(new DocumentEmailZipService().extract(fixture('invoice.zip'), { entries: -1, inflated_bytes: 0 } as DocumentEmailZipBudget), 'LIMIT_EXCEEDED');
    expect(() => new DocumentEmailZipService({ ratio: 0 })).toThrow(BadRequestException);
  });
  it('responds safely to an already-aborted signal', async () => {
    const controller = new AbortController(); controller.abort();
    await reason(new DocumentEmailZipService().extract(fixture('invoice.zip'), undefined, controller.signal), 'TECHNICAL_PROCESSING_ERROR');
  });
  it('checks a signal during asynchronous entry reading', async () => {
    const controller = new AbortController(); const promise = new DocumentEmailZipService().extract(fixture('invoice.zip'), undefined, controller.signal);
    controller.abort(); await reason(promise, 'TECHNICAL_PROCESSING_ERROR');
  });
});
