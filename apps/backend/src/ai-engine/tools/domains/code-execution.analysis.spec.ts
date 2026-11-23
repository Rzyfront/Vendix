import { createAnalysisTools } from './code-execution.tools';
import { RequestContextService } from '../../../common/context/request-context.service';
import { publicSandboxArgs } from '../../sandbox/sandbox-invocation.context';
import { validateAnalysisInputs } from '../../sandbox/analysis-output.validator';
import {
  AnalysisError,
  type AnalysisOutput,
} from '../../sandbox/interfaces/analysis-protocol.interface';

const CONVERSATION = 7;
const STORE = 3;
const SOURCE = "result = {'figures': []}  # PRIVATE_SRC";

const salesBlock = {
  id: 'blk-sales',
  store_id: STORE,
  conversation_id: CONVERSATION,
  kind: 'table',
  spec: {},
  data: {
    columns: [
      { key: 'mes', label: 'Mes' },
      { key: 'total', label: 'Total' },
    ],
    rows: [
      { mes: '2026-01', total: 100 },
      { mes: '2026-02', total: 120 },
    ],
  },
};

function setup(
  overrides: {
    enabled?: boolean | Error;
    available?: boolean;
    output?: AnalysisOutput;
    runError?: Error;
    block?: Record<string, unknown> | Error;
  } = {},
) {
  const runner = {
    available: jest.fn().mockReturnValue(overrides.available ?? true),
    run: jest.fn().mockImplementation(async () => {
      if (overrides.runError) throw overrides.runError;
      return {
        run_id: 'run-1',
        source_hash: 'hash-1',
        output: overrides.output ?? {},
        usage: { duration_ms: 5 },
      };
    }),
  };
  let n = 0;
  const blocks = {
    getById: jest.fn().mockImplementation(async () => {
      if (overrides.block instanceof Error) throw overrides.block;
      return overrides.block ?? salesBlock;
    }),
    create: jest
      .fn()
      .mockImplementation(async () => ({ id: `new-${++n}`, version: 1 })),
  };
  const entitlements = {
    codeAnalysisEnabled: jest.fn().mockImplementation(async () => {
      if (overrides.enabled instanceof Error) throw overrides.enabled;
      return overrides.enabled ?? true;
    }),
  };
  const tool = createAnalysisTools({ runner, blocks, entitlements })[0];
  const call = (extra: Record<string, unknown> = {}) =>
    RequestContextService.run(
      { store_id: STORE, user_id: 1, is_super_admin: false } as never,
      async () =>
        JSON.parse(
          await tool.handler!(
            {
              conversation_id: CONVERSATION,
              source: SOURCE,
              inputs: [{ name: 'ventas', block_id: 'blk-sales' }],
              purpose: 'projection',
              ...extra,
            },
            {},
          ),
        ),
    );
  return { runner, blocks, entitlements, tool, call };
}

describe('run_analysis', () => {
  it('declares a public read-only sandbox tool with turn-bound conversation_id', () => {
    const { tool } = setup();
    expect(tool.name).toBe('run_analysis');
    expect(tool.access).toBe('public');
    expect(tool.readOnly).toBe(true);
    expect(tool.domain).toBe('sandbox');
    expect(tool.parameters.required).not.toContain('conversation_id');
    expect(tool.discovery?.synonyms?.length).toBeGreaterThan(0);
  });

  it('attaches panel-ready ui_blocks when blocks.toUiBlock is provided', async () => {
    const { blocks, call } = setup({
      output: {
        series: [
          {
            title: 'Tendencia',
            chart: 'line',
            x: ['2026-03'],
            datasets: [{ label: 'Ventas', values: [150] }],
          },
        ],
        figures: [{ label: 'Proyección', value: 150 }],
      },
    });
    (blocks as any).create = jest.fn().mockImplementation(async (input) => ({
      id: `blk-${input.kind}`,
      version: 1,
      kind: input.kind,
      spec: input.spec,
      data: input.data,
    }));
    (blocks as any).toUiBlock = jest.fn().mockImplementation(async (row) => ({
      block_id: row.id,
      kind: row.kind,
      version: row.version,
      spec: { kind: row.kind, analysis: row.spec.analysis },
      data: row.data,
    }));
    const r = await call();
    expect(r.data.ui_blocks).toHaveLength(2);
    expect(r.data.ui_blocks[0].spec.analysis.source).toBeUndefined();
    expect(r.data.ui_blocks[1].spec.analysis.source).toBe(SOURCE);
  });

  it('plan without code_analysis: Spanish message, runner never called', async () => {
    const { runner, call } = setup({ enabled: false });
    const r = await call();
    expect(r.error).toBe('Tu plan no incluye «Análisis con código».');
    expect(r.next_step).toContain('Usa compute');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('entitlement resolver failure fails closed', async () => {
    const { runner, call } = setup({ enabled: new Error('redis down') });
    const r = await call();
    expect(r.error).toBe('Tu plan no incluye «Análisis con código».');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('sandbox off: unavailable message and compute fallback', async () => {
    const { runner, call } = setup({ available: false });
    const r = await call();
    expect(r.error).toBe(
      'El análisis avanzado con código no está disponible en este momento.',
    );
    expect(r.next_step).toContain('Usa compute');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('rejects a block from another conversation', async () => {
    const { runner, call } = setup({
      block: { ...salesBlock, conversation_id: 99 },
    });
    const r = await call();
    expect(r.error).toBe(
      'No encontré el bloque de «ventas» en esta conversación.',
    );
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('projection: chart + kpi blocks, source only on the last block', async () => {
    const { runner, blocks, call } = setup({
      output: {
        series: [
          {
            title: 'Proyección',
            chart: 'line',
            x: ['2026-03', '2026-04'],
            datasets: [{ label: 'Ventas', values: [130, 140] }],
          },
        ],
        figures: [{ label: 'Total proyectado', value: 270, unit: 'COP' }],
        notes: ['Regresión lineal.'],
      },
    });
    const r = await call();
    expect(runner.run).toHaveBeenCalledWith({
      source: SOURCE,
      purpose: 'projection',
      inputs: [
        {
          name: 'ventas',
          columns: ['mes', 'total'],
          rows: [
            ['2026-01', 100],
            ['2026-02', 120],
          ],
        },
      ],
    });
    expect(blocks.create).toHaveBeenCalledTimes(2);
    const [chart, kpi] = blocks.create.mock.calls.map((c) => c[0]);
    expect(chart.kind).toBe('chart');
    expect(chart.spec.chart_type).toBe('line');
    expect(chart.data).toEqual({
      labels: ['2026-03', '2026-04'],
      series: [{ name: 'Ventas', data: [130, 140] }],
    });
    expect(chart.spec.analysis).toEqual({
      run_id: 'run-1',
      source_hash: 'hash-1',
      language: 'python',
      purpose: 'projection',
    });
    expect(kpi.kind).toBe('kpi');
    expect(kpi.data).toEqual({
      label: 'Total proyectado',
      value: 270,
      hint: 'COP',
    });
    expect(kpi.spec.analysis).toEqual({
      run_id: 'run-1',
      source_hash: 'hash-1',
      language: 'python',
      purpose: 'projection',
      source: SOURCE,
    });
    expect(r.data.blocks).toEqual([
      { block_id: 'new-1', kind: 'chart' },
      { block_id: 'new-2', kind: 'kpi' },
    ]);
    expect(r.data.message).toBe('Regresión lineal.');
  });

  it('correlation: table output becomes a table block with the source', async () => {
    const { blocks, call } = setup({
      output: {
        tables: [
          {
            title: 'Correlación',
            columns: ['variable', 'r'],
            rows: [['descuento', 0.42]],
          },
        ],
      },
    });
    await call({ purpose: 'correlation' });
    const created = blocks.create.mock.calls[0][0];
    expect(created.kind).toBe('table');
    expect(created.data).toEqual({
      columns: [
        { key: 'c0', label: 'variable' },
        { key: 'c1', label: 'r' },
      ],
      rows: [{ c0: 'descuento', c1: 0.42 }],
    });
    expect(created.spec.analysis).toMatchObject({
      purpose: 'correlation',
      source: SOURCE,
    });
  });

  it('scatter chart places x as the first series for VexBlockChartComponent', async () => {
    const { blocks, call } = setup({
      output: {
        series: [
          {
            title: 'Descuento vs Ventas',
            chart: 'scatter',
            x_label: 'Descuento (%)',
            y_label: 'Unidades',
            x: [5, 10, 15],
            datasets: [{ label: 'Unidades', values: [20, 35, 50] }],
          },
        ],
      },
    });
    await call({ purpose: 'correlation' });
    const created = blocks.create.mock.calls[0][0];
    expect(created.kind).toBe('chart');
    expect(created.spec.chart_type).toBe('scatter');
    expect(created.data.series).toEqual([
      { name: 'Descuento (%)', data: [5, 10, 15] },
      { name: 'Unidades', data: [20, 35, 50] },
    ]);
  });

  it('segmentation: tables then figures, only the last carries the code', async () => {
    const { blocks, call } = setup({
      output: {
        tables: [
          { title: 'Segmentos', columns: ['segmento'], rows: [['frecuentes']] },
        ],
        figures: [{ label: 'Clientes frecuentes', value: 12 }],
      },
    });
    await call({ purpose: 'segmentation' });
    const specs = blocks.create.mock.calls.map((c) => c[0].spec.analysis);
    expect(specs[0]).not.toHaveProperty('source');
    expect(specs[1].source).toBe(SOURCE);
    expect(blocks.create.mock.calls.map((c) => c[0].kind)).toEqual([
      'table',
      'kpi',
    ]);
  });

  it('ANALYSIS_TIMEOUT becomes a Spanish error', async () => {
    const { blocks, call } = setup({
      runError: new AnalysisError('ANALYSIS_TIMEOUT'),
    });
    const r = await call();
    expect(r.error).toBe('El análisis tardó demasiado y se canceló.');
    expect(blocks.create).not.toHaveBeenCalled();
  });

  it('ANALYSIS_RUNTIME includes the bounded detail', async () => {
    const { call } = setup({
      runError: new AnalysisError('ANALYSIS_RUNTIME', 'KeyError: ventas'),
    });
    const r = await call();
    expect(r.error).toBe(
      'El código falló al ejecutarse. Detalle: KeyError: ventas',
    );
  });

  it('ANALYSIS_LIMIT asks to wait', async () => {
    const { call } = setup({ runError: new AnalysisError('ANALYSIS_LIMIT') });
    const r = await call();
    expect(r.error).toBe(
      'Ya hay otro análisis en curso en esta tienda; espera a que termine.',
    );
  });

  it('chart block deduplicates label/series names and bounds columns to <=64 chars', async () => {
    const longPrefix = 's'.repeat(64);
    const { runner, call } = setup({
      block: {
        id: 'blk-chart',
        store_id: STORE,
        conversation_id: CONVERSATION,
        kind: 'chart',
        spec: {},
        data: {
          labels: ['2026-01', '2026-02'],
          series: [
            { name: 'label', data: [10, 20] },
            { name: 'Ventas', data: [30, 40] },
            { name: 'Ventas', data: [50, 60] },
            { name: `${longPrefix}_extra_a`, data: [70, 80] },
            { name: `${longPrefix}_extra_b`, data: [90, 100] },
          ],
        },
      },
      output: { figures: [{ label: 'n', value: 1 }] },
    });

    await call({ inputs: [{ name: 'graf', block_id: 'blk-chart' }] });
    const sentInputs = runner.run.mock.calls[0][0].inputs;
    expect(sentInputs).toHaveLength(1);
    const cols: string[] = sentInputs[0].columns;
    expect(cols).toEqual([
      'label',
      'label_2',
      'Ventas',
      'Ventas_2',
      longPrefix,
      `${'s'.repeat(62)}_2`,
    ]);
    expect(cols.every((c) => c.length <= 64)).toBe(true);
    expect(new Set(cols).size).toBe(cols.length);
    expect(() => validateAnalysisInputs(sentInputs)).not.toThrow();
  });

  it('table block deduplicates and bounds column keys to <=64 chars while keeping row values', async () => {
    const longKeyA = `${'k'.repeat(64)}_1`;
    const longKeyB = `${'k'.repeat(64)}_2`;
    const { runner, call } = setup({
      block: {
        id: 'blk-dup-table',
        store_id: STORE,
        conversation_id: CONVERSATION,
        kind: 'table',
        spec: {},
        data: {
          columns: [
            { key: 'total', label: 'Total 1' },
            { key: 'total', label: 'Total 2' },
            { key: longKeyA, label: 'Largo A' },
            { key: longKeyB, label: 'Largo B' },
          ],
          rows: [{ total: 10, [longKeyA]: 20, [longKeyB]: 30 }],
        },
      },
      output: { figures: [{ label: 'n', value: 1 }] },
    });

    await call({ inputs: [{ name: 'tabla', block_id: 'blk-dup-table' }] });
    const sentInputs = runner.run.mock.calls[0][0].inputs;
    expect(sentInputs[0].columns).toEqual([
      'total',
      'total_2',
      'k'.repeat(64),
      `${'k'.repeat(62)}_2`,
    ]);
    expect(sentInputs[0].rows).toEqual([[10, 10, 20, 30]]);
    expect(() => validateAnalysisInputs(sentInputs)).not.toThrow();
  });

  it('persists LF/NFC-normalized source on the last block matching source_hash', async () => {
    const { blocks, call } = setup({
      output: { figures: [{ label: 'Total', value: 42 }] },
    });
    const crlfSource = 'a = 1\r\nresult = {"figures": [{"label": "Total", "value": a}]}';
    await call({ source: crlfSource });
    expect(blocks.create.mock.calls[0][0].spec.analysis.source).toBe(
      'a = 1\nresult = {"figures": [{"label": "Total", "value": a}]}',
    );
  });

  it('publicSandboxArgs omits source and keeps block ids', () => {
    const out = publicSandboxArgs('run_analysis', {
      conversation_id: CONVERSATION,
      source: SOURCE,
      inputs: [{ name: 'ventas', block_id: 'blk-sales' }],
      purpose: 'projection',
    });
    expect(out).not.toHaveProperty('source');
    expect(JSON.stringify(out)).not.toContain('PRIVATE_SRC');
    expect(out.inputs).toEqual([{ name: 'ventas', block_id: 'blk-sales' }]);
    expect(out.source_omitted).toBe(true);
    expect(out.purpose).toBe('projection');
  });
});
