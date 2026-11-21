import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  FollowupEvalInputError,
  FollowupPrediction,
  LabeledTurn,
  computeFollowupMetrics,
} from './followup-metrics';

const dataset = JSON.parse(
  readFileSync(resolve(__dirname, 'followup-labeled-turns.json'), 'utf8'),
) as { turns: LabeledTurn[] };
const turns = dataset.turns;
const positives = turns.filter((t) => t.expects_followup);
const negatives = turns.filter((t) => !t.expects_followup);

function perfect(): FollowupPrediction[] {
  return turns.map((t) =>
    t.expects_followup
      ? { id: t.id, called: true, kind: t.kind, has_date: t.expects_date }
      : { id: t.id, called: false },
  );
}

/** Break `missPositives` positives (not called) and `fpNegatives` negatives (called). */
function degrade(missPositives: number, fpNegatives: number): FollowupPrediction[] {
  const missed = new Set(positives.slice(0, missPositives).map((t) => t.id));
  const fps = new Set(negatives.slice(0, fpNegatives).map((t) => t.id));
  return perfect().map((p) => {
    if (missed.has(p.id)) return { id: p.id, called: false };
    if (fps.has(p.id)) return { id: p.id, called: true, kind: 'reminder' as const };
    return p;
  });
}

describe('followup labeled set', () => {
  it('has 40 unique ids with both labels', () => {
    expect(turns).toHaveLength(40);
    expect(new Set(turns.map((t) => t.id)).size).toBe(40);
    expect(positives.length).toBe(24);
    expect(negatives.length).toBe(16);
    expect(positives.every((t) => t.kind === 'reminder' || t.kind === 'log_entry')).toBe(true);
  });
});

describe('computeFollowupMetrics', () => {
  it('passes with perfect predictions', () => {
    const m = computeFollowupMetrics(turns, perfect());
    expect(m.acierto).toBe(1);
    expect(m.noFalsePositive).toBe(1);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.misses).toEqual([]);
    expect(m.passed).toBe(true);
  });

  it('passes exactly at both thresholds (21/24 = 87.5 % and 13/16 = 81.25 %)', () => {
    const m = computeFollowupMetrics(turns, degrade(3, 3));
    expect(m.acierto).toBeCloseTo(21 / 24);
    expect(m.noFalsePositive).toBeCloseTo(13 / 16);
    expect(m.passed).toBe(true);
  });

  it('fails naming acierto just below 85 % (20/24 = 83.3 %)', () => {
    const m = computeFollowupMetrics(turns, degrade(4, 0));
    expect(m.passed).toBe(false);
    expect(m.failures).toHaveLength(1);
    expect(m.failures[0]).toContain('acierto');
  });

  it('fails naming no-falsos-positivos just below 80 % (12/16 = 75 %)', () => {
    const m = computeFollowupMetrics(turns, degrade(0, 4));
    expect(m.passed).toBe(false);
    expect(m.failures).toHaveLength(1);
    expect(m.failures[0]).toContain('no-falsos-positivos');
  });

  it('counts a wrong kind on a positive as a miss', () => {
    const target = positives[0];
    const wrong = perfect().map((p) =>
      p.id === target.id
        ? { ...p, kind: target.kind === 'reminder' ? ('log_entry' as const) : ('reminder' as const) }
        : p,
    );
    const m = computeFollowupMetrics(turns, wrong);
    expect(m.confusion.wrongKind).toBe(1);
    expect(m.confusion.tp).toBe(24);
    expect(m.acierto).toBeCloseTo(23 / 24);
    expect(m.misses).toEqual([
      expect.objectContaining({ id: target.id, reason: 'wrong_kind' }),
    ]);
  });

  it('reports confusion counts and false positives', () => {
    const m = computeFollowupMetrics(turns, degrade(2, 1));
    expect(m.confusion).toEqual({ tp: 22, fn: 2, fp: 1, tn: 15, wrongKind: 0 });
    expect(m.misses.map((x) => x.reason).sort()).toEqual([
      'false_positive',
      'missed_followup',
      'missed_followup',
    ]);
  });

  it('rejects a missing prediction', () => {
    expect(() => computeFollowupMetrics(turns, perfect().slice(1))).toThrow(
      FollowupEvalInputError,
    );
  });

  it('rejects duplicate and unknown prediction ids', () => {
    expect(() =>
      computeFollowupMetrics(turns, [...perfect(), { id: turns[0].id, called: false }]),
    ).toThrow(FollowupEvalInputError);
    expect(() =>
      computeFollowupMetrics(turns, [...perfect(), { id: 'zzz', called: false }]),
    ).toThrow(FollowupEvalInputError);
  });

  it('rejects a dataset that is not 40 turns', () => {
    expect(() => computeFollowupMetrics(turns.slice(1), perfect())).toThrow(
      FollowupEvalInputError,
    );
  });
});
