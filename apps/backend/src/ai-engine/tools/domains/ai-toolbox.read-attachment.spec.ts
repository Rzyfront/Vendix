import { createAiToolboxTools } from './ai-toolbox.tools';
import type { AttachmentContent } from '../../../domains/store/vexi/attachment-content.types';
import { RegisteredTool } from '../interfaces/tool.interface';

const rowsOf = (n: number): string[][] =>
  Array.from({ length: n }, (_, i) => [`P${i}`, String(i * 10)]);

const TABLE: AttachmentContent = {
  kind: 'table',
  original_name: 'inventario.xlsx',
  mime_type:
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  sheets: [
    { name: 'Productos', columns: ['nombre', 'precio'], rows: rowsOf(2000) },
    { name: 'Resumen', columns: ['k', 'v'], rows: [['total', '2000']] },
  ],
};

describe('read_attachment', () => {
  let readContent: jest.Mock;
  let tool: RegisteredTool;

  const call = async (args: Record<string, unknown>) =>
    JSON.parse(await tool.handler!({ attachment_id: 'att_41', ...args }, {}));

  beforeEach(() => {
    readContent = jest.fn().mockResolvedValue(TABLE);
    tool = createAiToolboxTools({
      toolbox: {} as never,
      attachments: { readContent } as never,
      s3: {} as never,
    }).find((t) => t.name === 'read_attachment') as RegisteredTool;
  });

  it('declares read-only public access with a reason (T13 gate)', () => {
    expect(tool.readOnly).toBe(true);
    expect(tool.access).toBe('public');
    expect(tool.accessReason).toEqual(expect.any(String));
    expect(tool.parameters.required).toEqual(['attachment_id']);
  });

  it('returns the first 50 rows of a 2000-row sheet with next_offset', async () => {
    const out = await call({});
    expect(readContent).toHaveBeenCalledWith('att_41');
    expect(out.rows).toHaveLength(50);
    expect(out.total_rows).toBe(2000);
    expect(out.next_offset).toBe(50);
    expect(out.sheets.map((s: any) => s.name)).toEqual([
      'Productos',
      'Resumen',
    ]);
    expect(out.sheets[0].total_rows).toBe(2000);
  });

  it('emits the first page as a vex_render_table block shape', async () => {
    const out = await call({});
    expect(out.table_block.render_with).toBe('vex_render_table');
    expect(out.table_block.columns).toEqual([
      { key: 'c0', label: 'nombre' },
      { key: 'c1', label: 'precio' },
    ]);
    expect(out.table_block.rows).toHaveLength(50);
    expect(out.table_block.rows[1]).toEqual({ c0: 'P1', c1: '10' });
    expect((await call({ offset: 50 })).table_block).toBeUndefined();
  });

  it('pages with offset until next_offset is null', async () => {
    const page = await call({ offset: 1950 });
    expect(page.rows[0][0]).toBe('P1950');
    expect(page.rows).toHaveLength(50);
    expect(page.next_offset).toBeNull();
  });

  it('clamps limit to 200', async () => {
    const out = await call({ limit: 5000 });
    expect(out.rows).toHaveLength(200);
    expect(out.next_offset).toBe(200);
  });

  it('selects a sheet by name and by index', async () => {
    expect((await call({ sheet: 'Resumen' })).rows).toEqual([['total', '2000']]);
    const byIndex = await call({ sheet: '1' });
    expect(byIndex.sheet).toBe('Resumen');
    expect(byIndex.total_rows).toBe(1);
  });

  it('reports an unknown sheet with the sheet list', async () => {
    const out = await call({ sheet: 'Nada' });
    expect(out.error).toContain('Nada');
    expect(out.sheets).toHaveLength(2);
  });

  it('filters columns by name', async () => {
    const out = await call({ columns: ['precio'], limit: 2 });
    expect(out.columns).toEqual(['precio']);
    expect(out.rows).toEqual([['0'], ['10']]);
  });

  it('paginates text', async () => {
    readContent.mockResolvedValue({
      kind: 'text',
      original_name: 'a.txt',
      mime_type: 'text/plain',
      text: 'x'.repeat(20500),
    });
    const first = await call({});
    expect(first.text).toHaveLength(8000);
    expect(first.total_chars).toBe(20500);
    expect(first.next_offset).toBe(8000);
    const clamped = await call({ limit: 99999 });
    expect(clamped.text).toHaveLength(20000);
    const last = await call({ offset: 20000 });
    expect(last.text).toHaveLength(500);
    expect(last.next_offset).toBeNull();
  });

  it('points images and scanned PDFs to ai_extract_document', async () => {
    readContent.mockResolvedValue({
      kind: 'image',
      original_name: 'f.jpg',
      mime_type: 'image/jpeg',
    });
    expect((await call({})).note).toContain('ai_extract_document');
    readContent.mockResolvedValue({
      kind: 'text',
      original_name: 's.pdf',
      mime_type: 'application/pdf',
      text: '',
      pages: 3,
    });
    const scanned = await call({});
    expect(scanned.note).toContain('ai_extract_document');
    expect(scanned.pages).toBe(3);
  });

  it('propagates the not-found error for unknown handles', async () => {
    readContent.mockRejectedValue(new Error('not found'));
    await expect(call({ attachment_id: 'att_999' })).rejects.toThrow(
      'not found',
    );
  });
});
