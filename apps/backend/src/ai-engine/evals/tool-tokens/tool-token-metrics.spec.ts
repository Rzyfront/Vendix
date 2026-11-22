import type { AIToolDefinition } from '../../interfaces/ai-provider.interface';
import { estimateAgentInputTokens } from '../../context/agent-context-budget';
import {
  FINAL_ANSWER_OUTPUT_BYTES,
  ResultFixture,
  assertBank,
  fixtureResult,
  measureTrajectory,
  roundTrips,
  successProxy,
  summarizeByKind,
} from './tool-token-metrics';

const tool = (name: string): AIToolDefinition => ({
  type: 'function',
  function: {
    name,
    description: `${name} description`,
    parameters: { type: 'object', properties: { q: { type: 'string' } } },
  },
});

const fixtures: Record<string, ResultFixture> = {
  list_things: {
    rows_key: 'data',
    envelope: { summary: 'x', has_more: false },
    sample_row: { id: 1, name: 'Cafe', total: 12.5 },
    default_rows: 2,
    fidelity: 'handler_shape',
    derived_from: 'test',
  },
  get_one: {
    rows_key: null,
    envelope: { id: 1, state: 'ok' },
    fidelity: 'handler_shape',
    derived_from: 'test',
  },
};

describe('tool-token-metrics (pure, no model/DB/network)', () => {
  describe('fixtureResult', () => {
    it('repeats the sample row N times inside the envelope, deterministically', () => {
      const a = fixtureResult(fixtures.list_things, 3);
      const b = fixtureResult(fixtures.list_things, 3);
      expect(a).toBe(b);
      expect(JSON.parse(a).data).toHaveLength(3);
      expect(JSON.parse(a).summary).toBe('x');
    });
    it('uses default_rows when the call gives none and ignores rows for scalar tools', () => {
      expect(JSON.parse(fixtureResult(fixtures.list_things)).data).toHaveLength(2);
      expect(fixtureResult(fixtures.get_one, 50)).toBe(
        JSON.stringify({ id: 1, state: 'ok' }),
      );
    });
    it('grows linearly with the row count', () => {
      const len = (n: number) => fixtureResult(fixtures.list_things, n).length;
      expect(len(30) - len(20)).toBe(len(20) - len(10));
    });
  });

  describe('roundTrips', () => {
    it('counts one model call per sequential group plus the final answer; a parallel group is one round-trip', () => {
      expect(roundTrips([])).toBe(1);
      expect(roundTrips([[{ tool: 'list_things' }]])).toBe(2);
      expect(
        roundTrips([
          [{ tool: 'list_things' }, { tool: 'get_one' }, { tool: 'get_one' }],
          [{ tool: 'get_one' }],
        ]),
      ).toBe(3);
    });
  });

  describe('measureTrajectory', () => {
    const base = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'hola' },
    ];
    const groups = [
      [{ tool: 'list_things', rows: 4 }],
      [{ tool: 'get_one' }, { tool: 'get_one' }],
    ];
    const tools = [tool('list_things'), tool('get_one')];
    const run = () =>
      measureTrajectory({
        base,
        groups,
        fixtures,
        toolsForRound: () => tools,
      });

    it('is deterministic and reports one input estimate per round-trip', () => {
      const r = run();
      expect(r).toEqual(run());
      expect(r.round_trips).toBe(3);
      expect(r.input_by_round).toHaveLength(3);
    });
    it('round 0 equals the repo estimator over base + tools and each later round only grows', () => {
      const r = run();
      expect(r.input_by_round[0]).toBe(estimateAgentInputTokens(base, tools));
      expect(r.input_by_round[1]).toBeGreaterThan(r.input_by_round[0]);
      expect(r.input_by_round[2]).toBeGreaterThan(r.input_by_round[1]);
      expect(r.input_total).toBe(
        r.input_by_round.reduce((a, b) => a + b, 0),
      );
    });
    it('carries the intermediate results into every later round and reports their size', () => {
      const r = run();
      const first = fixtureResult(fixtures.list_things, 4);
      expect(r.intermediate_result_bytes).toBe(
        Buffer.byteLength(first) + 2 * Buffer.byteLength(fixtureResult(fixtures.get_one)),
      );
      // Same trajectory with a 40-row first result costs strictly more input.
      const heavy = measureTrajectory({
        base,
        groups: [[{ tool: 'list_things', rows: 40 }], groups[1]],
        fixtures,
        toolsForRound: () => tools,
      });
      expect(heavy.input_total).toBeGreaterThan(r.input_total);
    });
    it('adds a tool that is loaded on demand only from the next round', () => {
      const later = measureTrajectory({
        base,
        groups,
        fixtures,
        toolsForRound: (k) => (k === 0 ? [tool('list_things')] : tools),
      });
      const all = run();
      expect(later.input_by_round[0]).toBeLessThan(all.input_by_round[0]);
      expect(later.input_by_round[1]).toBe(all.input_by_round[1]);
    });
    it('output estimate = assistant tool-call messages + the final-answer placeholder', () => {
      const r = run();
      expect(r.output_estimate).toBeGreaterThan(FINAL_ANSWER_OUTPUT_BYTES);
    });
    it('T62: baseForRound replaces the leading messages per round and resultFor feeds non-fixture tools', () => {
      const bigger = [{ role: 'system' as const, content: 'sys'.repeat(500) }];
      const r = measureTrajectory({
        base,
        groups: [[{ tool: 'describe_tool', args: { name: 'x' } }], groups[1]],
        fixtures,
        toolsForRound: () => tools,
        baseForRound: (k) => (k === 0 ? base : [...bigger, base[1]]),
        resultFor: (c) =>
          c.tool === 'describe_tool' ? 'declaration of x' : undefined,
      });
      const plain = measureTrajectory({
        base,
        groups: [[{ tool: 'describe_tool', args: { name: 'x' } }], groups[1]],
        fixtures,
        toolsForRound: () => tools,
        resultFor: () => 'declaration of x',
      });
      expect(r.input_by_round[0]).toBe(plain.input_by_round[0]);
      expect(r.input_by_round[1]).toBeGreaterThan(plain.input_by_round[1]);
      expect(r.intermediate_result_bytes).toBeGreaterThan(
        'declaration of x'.length,
      );
    });
    it('fails loudly when a trajectory uses a tool without a result fixture', () => {
      expect(() =>
        measureTrajectory({
          base,
          groups: [[{ tool: 'no_fixture' }]],
          fixtures,
          toolsForRound: () => tools,
        }),
      ).toThrow(/no_fixture/);
    });
  });

  describe('successProxy', () => {
    const authorized = new Set(['list_things', 'get_one']);
    const known = new Set(['list_things', 'get_one', 'denied_tool']);
    it('is true only when every oracle tool is authorized and exists', () => {
      expect(successProxy(['list_things', 'get_one'], authorized, known)).toEqual({
        reachable: true,
        missing: [],
        unauthorized: [],
      });
    });
    it('names unknown and known-but-unauthorized tools separately', () => {
      expect(
        successProxy(['list_things', 'denied_tool', 'ghost'], authorized, known),
      ).toEqual({
        reachable: false,
        missing: ['ghost'],
        unauthorized: ['denied_tool'],
      });
    });
  });

  describe('summarizeByKind', () => {
    it('totals per kind and overall, with the success rate of the proxy', () => {
      const rows = [
        { kind: 'single' as const, input_total: 100, output_estimate: 10, round_trips: 2, reachable: true },
        { kind: 'multi_step' as const, input_total: 300, output_estimate: 30, round_trips: 4, reachable: true },
        { kind: 'multi_step' as const, input_total: 500, output_estimate: 50, round_trips: 5, reachable: false },
      ];
      const s = summarizeByKind(rows);
      expect(s.single).toEqual({ tasks: 1, input_total: 100, output_estimate: 10, round_trips: 2, reachable: 1 });
      expect(s.multi_step).toEqual({ tasks: 2, input_total: 800, output_estimate: 80, round_trips: 9, reachable: 1 });
      expect(s.all).toEqual({ tasks: 3, input_total: 900, output_estimate: 90, round_trips: 11, reachable: 2 });
    });
  });

  describe('assertBank', () => {
    const ok = (id: string, kind: 'single' | 'multi_step', groups: any[]) => ({
      id,
      source: 'authored',
      message: 'm',
      kind,
      oracle: { groups },
    });
    it('accepts a bank whose kinds match the trajectory shape', () => {
      expect(() =>
        assertBank([
          ok('a', 'single', [[{ tool: 'x' }]]),
          ok('b', 'multi_step', [[{ tool: 'x' }], [{ tool: 'y' }]]),
        ]),
      ).not.toThrow();
    });
    it('rejects duplicate ids, empty trajectories and a kind that contradicts the groups', () => {
      expect(() =>
        assertBank([ok('a', 'single', [[{ tool: 'x' }]]), ok('a', 'single', [[{ tool: 'x' }]])]),
      ).toThrow(/duplicate/i);
      expect(() => assertBank([ok('a', 'single', [])])).toThrow(/empty/i);
      expect(() =>
        assertBank([ok('a', 'single', [[{ tool: 'x' }], [{ tool: 'y' }]])]),
      ).toThrow(/kind/i);
      expect(() =>
        assertBank([ok('a', 'multi_step', [[{ tool: 'x' }, { tool: 'y' }]])]),
      ).toThrow(/kind/i);
    });
  });
});
