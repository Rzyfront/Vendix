import { readFileSync } from 'fs';
import { resolve } from 'path';
import { GoldenTurnObservation, gradeGoldenTurn } from './graders';

/**
 * Shape spec for the F5 write-batch cases (T40): happy batch, step denied by
 * role, partial failure, double approval and irreversible step outside the
 * batch. Reads the corpus only: no model, no database, no network.
 */
interface BatchExpectation {
  steps_min?: number;
  domains_min?: number;
  approve?: 'approve' | 'approve_twice';
  final_status?: string;
  single_approval?: boolean;
  summary_mentions_any?: string[];
  proposed?: boolean;
  fail_step?: number;
  remaining_steps?: string;
  second_approval_replayed?: boolean;
  effects_exactly_once?: boolean;
  excludes_irreversible?: string[];
  irreversible_own_card?: boolean;
}
interface BatchCase {
  id: string;
  agent: 'vex' | 'vexi';
  principal: string;
  turns: Array<{
    message: string;
    permission_notice?: 'allowed';
    expect_tools_any?: string[];
    expect_batch: BatchExpectation;
    expect_answer?: { min_chars: number; mentions_any: string[] };
    oracle?: { sql: string; unchanged?: boolean };
  }>;
}

const corpus: Array<{ id: string }> = readFileSync(
  resolve(__dirname, 'golden-conversations.es.jsonl'),
  'utf8',
)
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const batchCases = corpus.filter((c) =>
  c.id.startsWith('g7') && c.id.includes('-vex-lote-'),
) as BatchCase[];
const byId = (fragment: string): BatchCase =>
  batchCases.find((c) => c.id.includes(fragment))!;
const batch = (c: BatchCase): BatchExpectation => c.turns[0].expect_batch;

const observe = (visible: string, proposed = true): GoldenTurnObservation => ({
  agent: 'vex',
  visible,
  tools: [{ frame: 'tool_call', name: 'propose_write_batch' }],
  errorFrame: false,
  proposed,
  known: new Set(['propose_write_batch']),
});

describe('golden write-batch cases — shape', () => {
  it('has exactly one case per scenario, unique ids, Vex only', () => {
    const ids = corpus.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(batchCases).toHaveLength(5);
    for (const fragment of [
      'tres-cambios-un-clic',
      'rol-no-permite',
      'falla-parcial',
      'doble-aprobacion',
      'irreversible',
    ])
      expect(batchCases.filter((c) => c.id.includes(fragment))).toHaveLength(1);
    for (const c of batchCases) {
      expect(c.agent).toBe('vex');
      expect(['owner', 'cashier']).toContain(c.principal);
      expect(c.turns).toHaveLength(1);
      expect(c.turns[0].message.length).toBeGreaterThan(0);
    }
  });

  it('happy batch: three changes in three domains, one approval, applied', () => {
    const c = byId('tres-cambios-un-clic');
    expect(c.turns[0].expect_tools_any).toContain('propose_write_batch');
    expect(batch(c)).toMatchObject({
      approve: 'approve',
      final_status: 'applied',
      single_approval: true,
    });
    expect(batch(c).steps_min).toBeGreaterThanOrEqual(3);
    expect(batch(c).domains_min).toBeGreaterThanOrEqual(3);
  });

  it('denied step: no batch, role refusal, data unchanged', () => {
    const c = byId('rol-no-permite');
    const turn = c.turns[0];
    expect(c.principal).toBe('cashier');
    expect(turn.expect_batch).toEqual({ proposed: false });
    expect(turn.permission_notice).toBe('allowed');
    expect(turn.oracle?.unchanged).toBe(true);
    expect(turn.expect_answer!.mentions_any).toContain('tu rol no permite');
    const checks = gradeGoldenTurn(
      { permission_notice: 'allowed', expect_answer: turn.expect_answer! },
      observe(
        'No pude armar el lote: tu rol no permite anular órdenes. Pídeselo al dueño y, si quieres, cambio solo el precio del café.',
        false,
      ),
    );
    expect(Object.values(checks).every(Boolean)).toBe(true);
  });

  it('partial failure: stops at the failing step, the rest skipped', () => {
    const b = batch(byId('falla-parcial'));
    expect(b).toMatchObject({
      approve: 'approve',
      final_status: 'partially_applied',
      remaining_steps: 'skipped',
    });
    expect(b.fail_step).toBeGreaterThan(1);
    expect(b.fail_step!).toBeLessThan(b.steps_min!);
    expect(b.summary_mentions_any).toEqual([
      `Se aplicó hasta el paso ${b.fail_step}, el resto se omitió.`,
    ]);
  });

  it('double approval: second click replays and never duplicates effects', () => {
    expect(batch(byId('doble-aprobacion'))).toMatchObject({
      approve: 'approve_twice',
      second_approval_replayed: true,
      effects_exactly_once: true,
      final_status: 'applied',
    });
  });

  it('irreversible step leaves the batch with its own card', () => {
    const b = batch(byId('irreversible'));
    expect(b.irreversible_own_card).toBe(true);
    expect(b.excludes_irreversible!.length).toBeGreaterThan(0);
    expect(b.final_status).toBe('applied');
  });
});
