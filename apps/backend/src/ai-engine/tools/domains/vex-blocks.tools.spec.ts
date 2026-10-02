import { createVexBlockTools } from './vex-blocks.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Paso 7 remediación Vex — contrato `vex-blocks.tools`.
 *
 * Patrón canónico T4: (a) validación happy/sad — el sad no toca el servicio;
 * (b) snapshot exacto de la salida happy (literales con `toEqual`);
 * (c) forma `{tool, version, error, next_step}` en español en los fallos;
 * (d) schema declarado por tool (requeridos + enums); (e) circuito de
 * lectura: las 7 son `readOnly`, sin preview ni confirmación.
 *
 * El servicio se mockea (`VexBlockService` tiene su propia spec): esta spec
 * pinnea el cableado tool→servicio y la validación que vive en la tool —
 * en particular que `group_by` sin `aggregate` falla explícito en vez de
 * devolver las filas intactas (no-op silencioso en el servicio).
 */
describe('vex-blocks.tools · render + read/transform', () => {
  const CONTEXT = { store_id: 7, organization_id: 3, user_id: 11, roles: [] };

  function buildTools() {
    const blocks = {
      create: jest.fn().mockImplementation(async (input: any) => ({
        id: 'blk_1',
        version: 1,
        kind: input.kind,
        spec: input.spec,
        data: input.data,
      })),
      readPaged: jest.fn().mockResolvedValue({
        block_id: 'blk_1',
        page: 1,
        page_size: 50,
        total_rows: 2,
        rows: [
          { categoria: 'A', total: 10 },
          { categoria: 'B', total: 20 },
        ],
      }),
      transform: jest.fn().mockImplementation(async () => ({
        id: 'blk_1',
        version: 2,
        kind: 'table',
        data: {
          columns: [
            { key: 'categoria', label: 'Categoría' },
            { key: 'total', label: 'Total' },
          ],
          rows: [
            { categoria: 'A', total: 10 },
            { categoria: 'B', total: 20 },
          ],
        },
      })),
      toUiBlock: jest.fn().mockImplementation(async (block: any) => ({
        block_id: block.id,
        kind: block.kind ?? 'table',
        version: block.version,
        spec: block.spec ?? {},
        data: block.data ?? {},
      })),
    };
    return { blocks, tools: createVexBlockTools({ blocks: blocks as any }) };
  }

  function getTool(tools: RegisteredTool[], name: string): RegisteredTool {
    const tool = tools.find((t) => t.name === name);
    if (!tool?.handler) throw new Error(`${name} sin handler`);
    return tool;
  }

  const run = async (
    tools: RegisteredTool[],
    name: string,
    args: Record<string, any>,
  ) => JSON.parse(await getTool(tools, name).handler!(args, CONTEXT as any));

  const TOOL_NAMES = [
    'vex_render_table',
    'vex_render_chart',
    'vex_render_kpi',
    'vex_render_image',
    'vex_render_file',
    'vex_block_read',
    'vex_block_transform',
  ];

  // ─── (d)+(e) Registro ─────────────────────────────────────────────
  describe('registro', () => {
    it('expone exactamente las 7 tools del dominio vex_blocks', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual(TOOL_NAMES);
      for (const tool of tools) {
        expect(tool.domain).toBe('vex_blocks');
        expect(tool.version).toBe('1');
        expect(tool.description.length).toBeGreaterThan(20);
      }
    });

    it('las 7 son readOnly puras: sin confirmación ni preview', () => {
      const { tools } = buildTools();
      for (const name of TOOL_NAMES) {
        const tool = getTool(tools, name);
        expect(tool.readOnly).toBe(true);
        expect(tool.requiresConfirmation ?? false).toBe(false);
        expect(tool.preview).toBeUndefined();
        expect(tool.clientSide ?? false).toBe(false);
        expect(typeof tool.handler).toBe('function');
      }
    });

    it('declara requeridos y enums por tool', () => {
      const { tools } = buildTools();
      const byName = (name: string) => getTool(tools, name).parameters;

      expect(byName('vex_render_table').required).toEqual(['columns', 'rows']);
      expect(
        byName('vex_render_table').properties.columns.items.required,
      ).toEqual(['key', 'label']);

      expect(byName('vex_render_chart').required).toEqual([
        'chart_type',
        'series',
      ]);
      expect(byName('vex_render_chart').properties.chart_type.enum).toEqual([
        'bar',
        'line',
        'pie',
        'area',
        'radar',
        'scatter',
        'gauge',
      ]);

      expect(byName('vex_render_kpi').required).toEqual(['label', 'value']);

      expect(byName('vex_render_image').required).toEqual(['s3_key']);
      expect(byName('vex_render_file').required).toEqual([
        's3_key',
        'filename',
      ]);

      expect(byName('vex_block_read').required).toEqual(['block_id']);
      expect(byName('vex_block_transform').required).toEqual(['block_id']);
      expect(
        byName('vex_block_transform').properties.aggregate.properties.function
          .enum,
      ).toEqual(['sum', 'avg', 'count', 'min', 'max']);
    });

    it('vex_render_image encadena ai_generate_image por s3_key, nunca URL firmada', () => {
      const { tools } = buildTools();
      const description = getTool(tools, 'vex_render_image').description;
      expect(description).toContain('ai_generate_image');
      expect(description).toContain('s3_key');
      expect(description).toContain('nunca una URL firmada');
    });

    it('vex_render_file encadena export_report por s3_key, nunca URL firmada', () => {
      const { tools } = buildTools();
      const description = getTool(tools, 'vex_render_file').description;
      expect(description).toContain('export_report');
      expect(description).toContain('s3_key');
      expect(description).toContain('nunca una URL firmada');
    });
  });

  // ─── vex_render_table ─────────────────────────────────────────────
  describe('vex_render_table', () => {
    it('(b) happy: crea el bloque tabla y devuelve el sobre con ui_block', async () => {
      const { blocks, tools } = buildTools();
      const columns = [
        { key: 'categoria', label: 'Categoría' },
        { key: 'total', label: 'Total' },
      ];
      const rows = [
        { categoria: 'A', total: 10 },
        { categoria: 'B', total: 20 },
      ];

      const answer = await run(tools, 'vex_render_table', {
        conversation_id: 42,
        title: 'Ventas por categoría',
        columns,
        rows,
      });

      expect(blocks.create).toHaveBeenCalledWith({
        conversation_id: 42,
        kind: 'table',
        spec: { title: 'Ventas por categoría' },
        data: { columns, rows },
      });
      expect(answer).toEqual({
        tool: 'vex_render_table',
        version: '1',
        data: {
          block_id: 'blk_1',
          kind: 'table',
          rows: 2,
          version: 1,
          block: {
            block_id: 'blk_1',
            kind: 'table',
            version: 1,
            spec: { title: 'Ventas por categoría' },
            data: { columns, rows },
          },
        },
      });
    });

    it('(a) sad: sin conversation_id → error y cero create', async () => {
      const { blocks, tools } = buildTools();

      const answer = await run(tools, 'vex_render_table', {
        columns: [{ key: 'a', label: 'A' }],
        rows: [{ a: 1 }],
      });

      expect(answer.error).toContain('Falta conversation_id');
      expect(answer.next_step).toContain('conversation_id');
      expect(blocks.create).not.toHaveBeenCalled();
    });

    it('(c) el servicio falla → sobre de error guiado', async () => {
      const { blocks, tools } = buildTools();
      blocks.create.mockRejectedValueOnce(new Error('db caída'));

      const answer = await run(tools, 'vex_render_table', {
        conversation_id: 42,
        columns: [{ key: 'a', label: 'A' }],
        rows: [{ a: 1 }],
      });

      expect(answer.tool).toBe('vex_render_table');
      expect(answer.error).toContain('db caída');
      expect(answer.next_step).toContain('5000');
    });
  });

  // ─── vex_render_chart / vex_render_kpi ────────────────────────────
  describe('vex_render_chart', () => {
    it('(b) happy: crea el bloque gráfico con chart_type en el spec', async () => {
      const { blocks, tools } = buildTools();

      const answer = await run(tools, 'vex_render_chart', {
        conversation_id: 42,
        title: 'Tendencia',
        chart_type: 'line',
        labels: ['ene', 'feb'],
        series: [{ name: 'ventas', data: [10, 20] }],
      });

      expect(blocks.create).toHaveBeenCalledWith({
        conversation_id: 42,
        kind: 'chart',
        spec: { title: 'Tendencia', chart_type: 'line' },
        data: {
          labels: ['ene', 'feb'],
          series: [{ name: 'ventas', data: [10, 20] }],
        },
      });
      expect(answer.data.block_id).toBe('blk_1');
      expect(answer.data.kind).toBe('chart');
    });

    it('(a) sad: sin conversation_id → error y cero create', async () => {
      const { blocks, tools } = buildTools();

      const answer = await run(tools, 'vex_render_chart', {
        chart_type: 'bar',
        series: [{ name: 's', data: [1] }],
      });

      expect(answer.error).toContain('Falta conversation_id');
      expect(blocks.create).not.toHaveBeenCalled();
    });
  });

  describe('vex_render_kpi', () => {
    it('(b) happy: crea el bloque kpi con label/value/delta', async () => {
      const { blocks, tools } = buildTools();

      const answer = await run(tools, 'vex_render_kpi', {
        conversation_id: 42,
        label: 'Ventas del mes',
        value: 12500000,
        delta: 0.12,
        hint: 'vs julio',
      });

      expect(blocks.create).toHaveBeenCalledWith({
        conversation_id: 42,
        kind: 'kpi',
        spec: {},
        data: {
          label: 'Ventas del mes',
          value: 12500000,
          delta: 0.12,
          hint: 'vs julio',
        },
      });
      expect(answer.data.block_id).toBe('blk_1');
      expect(answer.data.kind).toBe('kpi');
    });
  });

  // ─── vex_render_image / vex_render_file ───────────────────────────
  describe('vex_render_image', () => {
    it('(b) happy: persiste s3_key, nunca una URL firmada', async () => {
      const { blocks, tools } = buildTools();

      const answer = await run(tools, 'vex_render_image', {
        conversation_id: 42,
        s3_key: 'vexi-generated/stores/7/abc.png',
        alt: 'logo generado',
      });

      expect(blocks.create).toHaveBeenCalledWith({
        conversation_id: 42,
        kind: 'image',
        spec: {},
        data: { s3_key: 'vexi-generated/stores/7/abc.png', alt: 'logo generado' },
      });
      expect(answer.data.block_id).toBe('blk_1');
      expect(answer.data.kind).toBe('image');
    });

    it('(a) sad: sin conversation_id → error y cero create', async () => {
      const { blocks, tools } = buildTools();

      const answer = await run(tools, 'vex_render_image', {
        s3_key: 'vexi-generated/stores/7/abc.png',
      });

      expect(answer.error).toContain('Falta conversation_id');
      expect(blocks.create).not.toHaveBeenCalled();
    });
  });

  describe('vex_render_file', () => {
    it('(b) happy: persiste s3_key + filename, nunca download_url', async () => {
      const { blocks, tools } = buildTools();

      const answer = await run(tools, 'vex_render_file', {
        conversation_id: 42,
        s3_key: 'vexi-reports/stores/7/reporte.xlsx',
        filename: 'ventas-agosto.xlsx',
        mime_type:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      expect(blocks.create).toHaveBeenCalledWith({
        conversation_id: 42,
        kind: 'file',
        spec: {},
        data: {
          s3_key: 'vexi-reports/stores/7/reporte.xlsx',
          filename: 'ventas-agosto.xlsx',
          mime_type:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      });
      expect(answer.data.block_id).toBe('blk_1');
      expect(answer.data.kind).toBe('file');
    });

    it('(a) sad: sin conversation_id → error y cero create', async () => {
      const { blocks, tools } = buildTools();

      const answer = await run(tools, 'vex_render_file', {
        s3_key: 'vexi-reports/stores/7/reporte.xlsx',
        filename: 'ventas.xlsx',
      });

      expect(answer.error).toContain('Falta conversation_id');
      expect(blocks.create).not.toHaveBeenCalled();
    });
  });

  // ─── vex_block_read ───────────────────────────────────────────────
  describe('vex_block_read', () => {
    it('(b) happy: pagina por el servicio y devuelve el sobre', async () => {
      const { blocks, tools } = buildTools();

      const answer = await run(tools, 'vex_block_read', {
        block_id: 'blk_1',
        page: 1,
        page_size: 50,
      });

      expect(blocks.readPaged).toHaveBeenCalledWith('blk_1', 1, 50);
      expect(answer.tool).toBe('vex_block_read');
      expect(answer.data.total_rows).toBe(2);
      expect(answer.data.rows).toHaveLength(2);
    });

    it('(c) bloque inexistente → sobre de error guiado', async () => {
      const { blocks, tools } = buildTools();
      blocks.readPaged.mockRejectedValueOnce(new Error('no existe'));

      const answer = await run(tools, 'vex_block_read', {
        block_id: 'blk_zzz',
      });

      expect(answer.tool).toBe('vex_block_read');
      expect(answer.error).toContain('no existe');
      expect(answer.next_step).toContain('block_id');
    });
  });

  // ─── vex_block_transform ──────────────────────────────────────────
  describe('vex_block_transform', () => {
    it('(a) group_by sin aggregate → error explícito, cero transform (no no-op)', async () => {
      const { blocks, tools } = buildTools();

      const answer = await run(tools, 'vex_block_transform', {
        block_id: 'blk_1',
        group_by: 'categoria',
      });

      expect(answer.tool).toBe('vex_block_transform');
      expect(answer.error).toContain('group_by sin aggregate');
      expect(answer.next_step).toContain('aggregate');
      expect(blocks.transform).not.toHaveBeenCalled();
    });

    it('(b) happy: group_by + aggregate llama al servicio y devuelve preview', async () => {
      const { blocks, tools } = buildTools();

      const answer = await run(tools, 'vex_block_transform', {
        block_id: 'blk_1',
        group_by: 'categoria',
        aggregate: { field: 'total', function: 'sum' },
      });

      expect(blocks.transform).toHaveBeenCalledWith('blk_1', {
        filter: undefined,
        sort: undefined,
        group_by: 'categoria',
        aggregate: { field: 'total', function: 'sum' },
      });
      expect(answer.data.block_id).toBe('blk_1');
      expect(answer.data.rows).toBe(2);
      expect(answer.data.preview).toHaveLength(2);
      expect(answer.data.version).toBe(2);
    });

    it('(b) happy: solo filtro pasa sin aggregate', async () => {
      const { blocks, tools } = buildTools();

      const answer = await run(tools, 'vex_block_transform', {
        block_id: 'blk_1',
        filter: [{ field: 'total', op: 'gt', value: 15 }],
      });

      expect(blocks.transform).toHaveBeenCalledWith('blk_1', {
        filter: [{ field: 'total', op: 'gt', value: 15 }],
        sort: undefined,
        group_by: undefined,
        aggregate: undefined,
      });
      expect(answer.data.block_id).toBe('blk_1');
    });

    it('(c) el servicio falla → sobre de error guiado', async () => {
      const { blocks, tools } = buildTools();
      blocks.transform.mockRejectedValueOnce(new Error('no es tabla'));

      const answer = await run(tools, 'vex_block_transform', {
        block_id: 'blk_1',
        filter: [{ field: 'total', op: 'gt', value: 1 }],
      });

      expect(answer.tool).toBe('vex_block_transform');
      expect(answer.error).toContain('no es tabla');
    });
  });
});
