import { readFileSync } from 'fs';
import { resolve } from 'path';
import { GoldenTurnObservation, gradeGoldenTurn } from './graders';
import { summarizeWriteBatch } from '../../src/domains/store/vex/services/write-batch.types';

/**
 * Shape spec for the F5 write-batch cases (T40): happy batch, an irreversible
 * order cancellation asked "en un solo paso", partial failure, double approval
 * and irreversible step outside the batch. Reads the corpus only: no model, no
 * database, no network.
 *
 * Every case must describe what the system really does:
 *  - only harness principals that pass `VexController`'s `@Roles(OWNER, ADMIN)`
 *    (a cashier never reaches Vex);
 *  - the partial-failure sentence is the executor's own
 *    (`summarizeWriteBatch`: failing step N reads "hasta el paso N-1").
 */

/** Harness principals (`live-http.adapter.ts`) whose role can open Vex. */
const VEX_PRINCIPALS = ['owner', 'restaurant_owner'];
interface BatchExpectation {
  steps_min?: number;
  domains_min?: number;
  approve?: 'approve' | 'approve_twice';
  final_status?: string;
  single_approval?: boolean;
  summary_mentions_any?: string[];
  proposed?: boolean;
  fail_step?: number;
  /** Why the step fails at execution although its preview passed. */
  fail_cause?: string;
  remaining_steps?: string;
  second_approval_replayed?: boolean;
  effects_exactly_once?: boolean;
  excludes_irreversible?: string[];
  irreversible_own_card?: boolean;
}
interface BatchCase {
  id: string;
  agent: 'vex' | 'vexi';
  principal: 'owner' | 'restaurant_owner' | 'cashier';
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
      'anular-orden',
      'falla-parcial',
      'doble-aprobacion',
      'irreversible',
    ])
      expect(batchCases.filter((c) => c.id.includes(fragment))).toHaveLength(1);
    for (const c of batchCases) {
      expect(c.agent).toBe('vex');
      expect(VEX_PRINCIPALS).toContain(c.principal);
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

  it('order cancellation asked "en un solo paso": never inside a batch, own card, data unchanged', () => {
    const c = byId('anular-orden');
    const turn = c.turns[0];
    // A real Vex role: owner and admin inherit every `store:` permission, so
    // no principal that can open Vex is refused by role; what the system does
    // here is keep the irreversible cancellation out of the batch.
    expect(VEX_PRINCIPALS).toContain(c.principal);
    expect(turn.permission_notice).toBeUndefined();
    expect(turn.expect_batch).toEqual({
      excludes_irreversible: ['cancel_order'],
      irreversible_own_card: true,
    });
    expect(turn.oracle?.unchanged).toBe(true);
    const checks = gradeGoldenTurn(
      { expect_answer: turn.expect_answer! },
      observe(
        'Anular la orden no se puede deshacer, así que va con su propia tarjeta de confirmación. El cambio de precio del café lo dejé listo para que lo apruebes aparte.',
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
    // The failure must happen at execution: a value the preview rejects never
    // becomes a batch (it is refused when proposing).
    expect(b.fail_cause).toEqual(expect.stringContaining('not_applied'));
    // The expected sentence is the executor's own for that run.
    const steps = Array.from({ length: b.steps_min! }, (_, i) => ({
      order: i + 1,
      compensable: false,
      status:
        i + 1 < b.fail_step!
          ? ('applied' as const)
          : i + 1 === b.fail_step!
            ? ('failed' as const)
            : ('skipped' as const),
    }));
    const { message } = summarizeWriteBatch(steps);
    expect(message).toBe(
      `Se aplicó hasta el paso ${b.fail_step! - 1}, el resto se omitió.`,
    );
    expect(b.summary_mentions_any).toEqual([message]);
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
