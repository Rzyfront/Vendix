import { VexUiBlock } from '../../models/vex.models';
import {
  blockToExportTable,
  exportTableToCsv,
  isBlockExportable,
} from './vex-block-export.util';

function block(
  kind: VexUiBlock['kind'],
  spec: Record<string, unknown>,
  data: Record<string, unknown>,
): VexUiBlock {
  return {
    block_id: 'b1',
    kind,
    spec: { kind, ...spec } as VexUiBlock['spec'],
    data,
    version: 1,
  };
}

describe('blockToExportTable (export equals what the block shows)', () => {
  it('exports a table with its column labels and row values in column order', () => {
    const table = blockToExportTable(
      block(
        'table',
        {
          title: 'Ventas del mes',
          columns: [
            { key: 'name', label: 'Producto' },
            { key: 'qty', label: 'Cantidad' },
          ],
        },
        { rows: [{ qty: 3, name: 'Café' }, { name: 'Té' }] },
      ),
    );
    expect(table?.headers).toEqual(['Producto', 'Cantidad']);
    expect(table?.rows).toEqual([
      ['Café', 3],
      ['Té', null],
    ]);
    expect(table?.filename).toBe('vex-ventas-del-mes');
  });

  it('exports a multi-series chart: first column is the label, one column per series', () => {
    const table = blockToExportTable(
      block(
        'chart',
        {
          chart_type: 'combo',
          x_axis_key: 'label',
          series: [
            { key: 's0_Ventas', label: 'Ventas' },
            { key: 's1_Meta', label: 'Meta' },
          ],
        },
        {
          rows: [
            { label: 'Ene', s0_Ventas: 10, s1_Meta: 12 },
            { label: 'Feb', s0_Ventas: 20, s1_Meta: null },
          ],
        },
      ),
    );
    expect(table?.headers).toEqual(['Etiqueta', 'Ventas', 'Meta']);
    expect(table?.rows).toEqual([
      ['Ene', 10, 12],
      ['Feb', 20, null],
    ]);
  });

  it('exports a heatmap with one column per Y row, like any chart', () => {
    const table = blockToExportTable(
      block(
        'chart',
        {
          chart_type: 'heatmap',
          x_axis_key: 'label',
          series: [
            { key: 's0_Lun', label: 'Lun' },
            { key: 's1_Mar', label: 'Mar' },
          ],
        },
        { rows: [{ label: '08h', s0_Lun: 1, s1_Mar: 2 }] },
      ),
    );
    expect(table?.headers).toEqual(['Etiqueta', 'Lun', 'Mar']);
    expect(table?.rows).toEqual([['08h', 1, 2]]);
  });

  it('exports list items with their custom fields as extra columns', () => {
    const table = blockToExportTable(
      block(
        'list',
        { title: 'Pendientes' },
        {
          items: [
            { title: 'A', badge: { label: 'Urgente' }, fields: [{ label: 'Total', value: 5 }] },
            { title: 'B', subtitle: 'sub' },
          ],
        },
      ),
    );
    expect(table?.headers).toEqual([
      'Título',
      'Subtítulo',
      'Descripción',
      'Estado',
      'Total',
    ]);
    expect(table?.rows).toEqual([
      ['A', null, null, 'Urgente', 5],
      ['B', 'sub', null, null, null],
    ]);
  });

  it('exports timeline events in the order received', () => {
    const table = blockToExportTable(
      block('timeline', {}, {
        events: [{ title: 'Creada', timestamp: '2026-01-01T10:00:00Z', status: 'success' }],
      }),
    );
    expect(table?.rows).toEqual([
      ['2026-01-01T10:00:00Z', 'Creada', null, 'success', null],
    ]);
  });

  it('returns null for kinds without tabular content', () => {
    const kpi = block('kpi', { label: 'Ventas' }, { value: 1 });
    expect(blockToExportTable(kpi)).toBeNull();
    expect(isBlockExportable(kpi)).toBe(false);
    const unknown = { ...kpi, kind: 'hologram' } as unknown as VexUiBlock;
    expect(blockToExportTable(unknown)).toBeNull();
  });
});

describe('exportTableToCsv', () => {
  it('starts with a UTF-8 BOM and escapes quotes, commas and line breaks', () => {
    const csv = exportTableToCsv({
      headers: ['Nombre', 'Nota'],
      rows: [
        ['Ana, "la jefa"', 'línea 1\nlínea 2'],
        ['Luis', null],
      ],
      filename: 'x',
    });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe(
      'Nombre,Nota\r\n"Ana, ""la jefa""","línea 1\nlínea 2"\r\nLuis,',
    );
  });

  it('neutralises formula-looking text but leaves numbers untouched', () => {
    const csv = exportTableToCsv({
      headers: ['a', 'b'],
      rows: [['=SUM(A1)', -5]],
      filename: 'x',
    });
    expect(csv.slice(1)).toBe("a,b\r\n'=SUM(A1),-5");
  });

  it('neutralises a leading minus, plus, at or padded formula in text cells', () => {
    const csv = exportTableToCsv({
      headers: ['a'],
      rows: [
        ["-2+3+cmd|' /C calc'!A0"],
        ['+1+1'],
        ['@SUM(A1)'],
        ['  =1+1'],
        ['-'],
      ],
      filename: 'x',
    });
    expect(csv.slice(1)).toBe(
      "a\r\n'-2+3+cmd|' /C calc'!A0\r\n'+1+1\r\n'@SUM(A1)\r\n'  =1+1\r\n'-",
    );
  });

  it('keeps legitimate negative and signed decimals in text cells as they are', () => {
    const csv = exportTableToCsv({
      headers: ['a'],
      rows: [['-12.50'], ['+5'], ['-.5'], ['-3']],
      filename: 'x',
    });
    expect(csv.slice(1)).toBe('a\r\n-12.50\r\n+5\r\n-.5\r\n-3');
  });
});
