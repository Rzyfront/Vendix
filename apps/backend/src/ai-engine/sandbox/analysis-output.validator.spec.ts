import {
  ANALYSIS_LIMITS,
  AnalysisError,
} from './interfaces/analysis-protocol.interface';
import {
  validateAnalysisInputs,
  validateAnalysisOutput,
} from './analysis-output.validator';

const valid = () => ({
  tables: [{ title: 'T', columns: ['a', 'b'], rows: [[1, 'x'], [null, 'y']] }],
  series: [
    {
      title: 'S',
      chart: 'line',
      x: ['a', 'b'],
      datasets: [{ label: 'd', values: [1, null] }],
    },
  ],
  figures: [{ label: 'f', value: 3, unit: 'COP' }],
  notes: ['ok'],
});

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof AnalysisError ? e.code : 'OTHER';
  }
  return undefined;
}

describe('validateAnalysisOutput', () => {
  it('accepts a valid output', () => {
    expect(validateAnalysisOutput(valid())).toEqual(valid());
  });

  const mutations: Array<[string, (o: any) => void]> = [
    ['extra root key', (o) => (o.extra = 1)],
    ['extra table key', (o) => (o.tables[0].extra = 1)],
    ['NaN cell', (o) => (o.tables[0].rows[0][0] = NaN)],
    ['Infinity series value', (o) => (o.series[0].datasets[0].values[0] = Infinity)],
    ['row/column mismatch', (o) => o.tables[0].rows.push([1])],
    ['dataset length mismatch', (o) => o.series[0].datasets[0].values.push(1)],
    ['bad chart type', (o) => (o.series[0].chart = 'pie')],
    ['too many tables', (o) => (o.tables = Array(6).fill(o.tables[0]))],
    [
      'too many rows',
      (o) => (o.tables[0].rows = Array(1001).fill([1, 'x'])),
    ],
    [
      'too many columns',
      (o) => {
        o.tables[0].columns = Array.from({ length: 51 }, (_, i) => `c${i}`);
        o.tables[0].rows = [];
      },
    ],
    ['too many series', (o) => (o.series = Array(7).fill(o.series[0]))],
    [
      'too many datasets',
      (o) => (o.series[0].datasets = Array(7).fill(o.series[0].datasets[0])),
    ],
    [
      'too many points',
      (o) => {
        o.series[0].x = Array(1001).fill(1);
        o.series[0].datasets[0].values = Array(1001).fill(1);
      },
    ],
    ['too many figures', (o) => (o.figures = Array(21).fill(o.figures[0]))],
    ['too many notes', (o) => (o.notes = Array(6).fill('n'))],
    ['long note', (o) => (o.notes = ['n'.repeat(301)])],
    ['long title', (o) => (o.tables[0].title = 't'.repeat(121))],
    ['non-string note', (o) => (o.notes = [1])],
    ['non-finite figure', (o) => (o.figures[0].value = NaN)],
  ];
  it.each(mutations)('rejects %s with ANALYSIS_OUTPUT', (_name, mutate) => {
    const output = valid();
    mutate(output);
    expect(codeOf(() => validateAnalysisOutput(output))).toBe('ANALYSIS_OUTPUT');
  });

  it('rejects an empty output and non-objects', () => {
    expect(codeOf(() => validateAnalysisOutput({ notes: ['x'] }))).toBe(
      'ANALYSIS_OUTPUT',
    );
    expect(codeOf(() => validateAnalysisOutput(null))).toBe('ANALYSIS_OUTPUT');
    expect(codeOf(() => validateAnalysisOutput([]))).toBe('ANALYSIS_OUTPUT');
  });

  it('rejects output above the byte limit', () => {
    const output = {
      tables: [{ title: 'T', columns: ['a'], rows: [['x'.repeat(300_000)]] }],
    };
    expect(codeOf(() => validateAnalysisOutput(output))).toBe('ANALYSIS_OUTPUT');
  });
});

describe('validateAnalysisInputs', () => {
  const table = () => ({ name: 'sales', columns: ['a', 'b'], rows: [[1, 'x']] });

  it('accepts valid inputs', () => {
    expect(validateAnalysisInputs([table()])).toEqual([table()]);
  });

  const cases: Array<[string, unknown]> = [
    ['bad name', [{ ...table(), name: 'Sales' }]],
    ['duplicate names', [table(), table()]],
    ['too many tables', Array.from({ length: 6 }, (_, i) => ({ ...table(), name: `t${i}` }))],
    ['too many columns', [{ name: 't', columns: Array.from({ length: 51 }, (_, i) => `c${i}`), rows: [] }]],
    ['too many rows', [{ name: 't', columns: ['a'], rows: Array(5001).fill([1]) }]],
    ['object cell', [{ name: 't', columns: ['a'], rows: [[{}]] }]],
    ['NaN cell', [{ name: 't', columns: ['a'], rows: [[NaN]] }]],
    ['row mismatch', [{ name: 't', columns: ['a', 'b'], rows: [[1]] }]],
    ['not an array', {}],
    ['extra key', [{ ...table(), extra: 1 }]],
    [
      'bytes over limit',
      [
        { name: 'a', columns: ['c'], rows: [['x'.repeat(ANALYSIS_LIMITS.input_bytes)]] },
      ],
    ],
  ];
  it.each(cases)('rejects %s with ANALYSIS_INPUT', (_n, input) => {
    expect(codeOf(() => validateAnalysisInputs(input))).toBe('ANALYSIS_INPUT');
  });
});
