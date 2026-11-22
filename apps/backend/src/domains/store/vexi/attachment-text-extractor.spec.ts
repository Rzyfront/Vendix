import * as AdmZip from 'adm-zip';
import * as XLSX from 'xlsx';
import {
  extractAttachmentContent,
  parseXlsxInWorker,
  spreadsheetLimitProblem,
} from './attachment-text-extractor';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('extractAttachmentContent', () => {
  it('parses CSV with BOM, quoted fields and a ; delimiter', async () => {
    const csv = '﻿nombre;nota\r\n"Ana; María";"dijo ""hola"""\r\nLuis;ok\r\n';
    const out = await extractAttachmentContent(
      Buffer.from(csv),
      'text/csv',
      'a.csv',
    );
    expect(out).toMatchObject({ kind: 'table' });
    if (out.kind !== 'table') throw new Error('table expected');
    expect(out.sheets).toHaveLength(1);
    expect(out.sheets[0].columns).toEqual(['nombre', 'nota']);
    expect(out.sheets[0].rows).toEqual([
      ['Ana; María', 'dijo "hola"'],
      ['Luis', 'ok'],
    ]);
  });

  it('resolves CSV by extension when the browser sends an Excel MIME', async () => {
    const out = await extractAttachmentContent(
      Buffer.from('a,b\n1,2\n'),
      'application/vnd.ms-excel',
      'a.csv',
    );
    expect(out.kind).toBe('table');
  });

  it('reads one table per XLSX sheet', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['sku', 'qty'], ['A1', 3]]),
      'Stock',
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['x'], ['y']]),
      'Otra',
    );
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const out = await extractAttachmentContent(buffer, XLSX_MIME, 'a.xlsx');
    if (out.kind !== 'table') throw new Error('table expected');
    expect(out.sheets.map((s) => s.name)).toEqual(['Stock', 'Otra']);
    expect(out.sheets[0].columns).toEqual(['sku', 'qty']);
    expect(out.sheets[0].rows).toEqual([['A1', '3']]);
  });

  it('extracts DOCX paragraphs and decodes XML entities', async () => {
    const zip = new AdmZip();
    zip.addFile(
      'word/document.xml',
      Buffer.from(
        '<w:document><w:body><w:p><w:r><w:t>Hola &amp; adiós</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t xml:space="preserve">Línea </w:t></w:r><w:r><w:t>dos</w:t></w:r></w:p></w:body></w:document>',
      ),
    );
    const out = await extractAttachmentContent(
      zip.toBuffer(),
      DOCX_MIME,
      'a.docx',
    );
    expect(out).toMatchObject({ kind: 'text', text: 'Hola & adiós\nLínea dos' });
  });

  it('returns TXT as text and images as kind image', async () => {
    expect(
      await extractAttachmentContent(Buffer.from('hola'), 'text/plain', 'a.txt'),
    ).toMatchObject({ kind: 'text', text: 'hola' });
    expect(
      await extractAttachmentContent(Buffer.from([1]), 'image/png', 'a.png'),
    ).toEqual({ kind: 'image', original_name: 'a.png', mime_type: 'image/png' });
  });

  it('never throws on a malformed file: empty content instead', async () => {
    const xlsx = await extractAttachmentContent(
      Buffer.from('not a zip'),
      XLSX_MIME,
      'a.xlsx',
    );
    expect(xlsx.kind).toBe('table');
    const docx = await extractAttachmentContent(
      Buffer.from('not a zip'),
      DOCX_MIME,
      'a.docx',
    );
    expect(docx).toMatchObject({ kind: 'text', text: '' });
    const pdf = await extractAttachmentContent(
      Buffer.from('%PDF-broken'),
      'application/pdf',
      'a.pdf',
    );
    expect(pdf).toMatchObject({ kind: 'text', text: '' });
  });
});

describe('XLSX limits (B3)', () => {
  const workbook = (sheets: number) => {
    const wb = XLSX.utils.book_new();
    for (let i = 0; i < sheets; i++) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a'], [String(i)]]), `S${i}`);
    }
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  };

  it('a workbook declaring 60 MB is refused from its ZIP directory, without parsing', async () => {
    const zip = new AdmZip(workbook(1));
    zip.addFile('xl/worksheets/sheet9.xml', Buffer.alloc(60 * 1024 * 1024, 0x61));
    const bomb = zip.toBuffer();

    const started = Date.now();
    expect(spreadsheetLimitProblem(bomb)).toMatch(
      /^El Excel ocupa \d+ MB al abrirlo y el máximo son 50 MB/,
    );
    const out = await extractAttachmentContent(bomb, XLSX_MIME, 'bomba.xlsx');
    expect(Date.now() - started).toBeLessThan(1500);
    expect(out).toEqual({
      kind: 'table',
      original_name: 'bomba.xlsx',
      mime_type: XLSX_MIME,
      sheets: [],
    });
  });

  it('more than 20 sheets is refused with the count', () => {
    expect(spreadsheetLimitProblem(workbook(21))).toBe(
      'El Excel tiene 21 hojas y el máximo son 20. Guarda solo las hojas que necesitas e inténtalo otra vez.',
    );
    expect(spreadsheetLimitProblem(workbook(20))).toBeNull();
  });

  it('the worker parse is killed past its time limit', async () => {
    await expect(parseXlsxInWorker(workbook(1), 1)).rejects.toThrow(
      /XLSX parse exceeded 1 ms/,
    );
  });

  it('a normal workbook still parses through the worker', async () => {
    await expect(parseXlsxInWorker(workbook(2))).resolves.toEqual([
      { name: 'S0', matrix: [['a'], ['0']] },
      { name: 'S1', matrix: [['a'], ['1']] },
    ]);
  });
});
