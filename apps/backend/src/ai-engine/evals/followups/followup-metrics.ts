/**
 * Pure metric computation for the T5 "Seguimientos" labeled set.
 * No I/O: the CLI (`measure-followups.ts`) and the spec both use this file.
 */

export const FOLLOWUP_EVAL_KINDS = ['reminder', 'log_entry'] as const;
export type FollowupEvalKind = (typeof FOLLOWUP_EVAL_KINDS)[number];

export const EXPECTED_TURN_COUNT = 40;
/** Plan thresholds (odd/tasks/vex-agente-avanzado.md:598). */
export const MIN_ACIERTO = 0.85;
export const MIN_NO_FALSE_POSITIVE = 0.8;

export interface LabeledTurn {
  id: string;
  industry: string;
  context: string[];
  user_message: string;
  assistant_reply?: string;
  expects_followup: boolean;
  kind?: FollowupEvalKind;
  expects_date: boolean;
  rationale: string;
}

export interface FollowupPrediction {
  id: string;
  called: boolean;
  kind?: FollowupEvalKind;
  has_date?: boolean;
}

export type MissReason =
  | 'missed_followup'
  | 'wrong_kind'
  | 'false_positive';

export interface TurnMiss {
  id: string;
  reason: MissReason;
  expected: string;
  predicted: string;
}

export interface ConfusionCounts {
  /** Positive turn, tool called (any kind). */
  tp: number;
  /** Positive turn, tool not called. */
  fn: number;
  /** Negative turn, tool called. */
  fp: number;
  /** Negative turn, tool not called. */
  tn: number;
  /** Positive turn, tool called with the wrong kind (subset of tp). */
  wrongKind: number;
}

export interface FollowupMetrics {
  positives: number;
  negatives: number;
  confusion: ConfusionCounts;
  /** Share of positive turns where the tool was called with the right kind. */
  acierto: number;
  /** Share of negative turns where the tool was NOT called. */
  noFalsePositive: number;
  /** Correct-kind calls on positives / all calls. */
  precision: number;
  /** Positive turns with any call / positives. */
  recall: number;
  /** Informational: correct-kind positives whose has_date disagrees with expects_date. */
  dateMismatches: string[];
  misses: TurnMiss[];
  failures: string[];
  passed: boolean;
}

export class FollowupEvalInputError extends Error {}

export function validateDataset(turns: LabeledTurn[]): void {
  if (turns.length !== EXPECTED_TURN_COUNT) {
    throw new FollowupEvalInputError(
      `El conjunto debe tener ${EXPECTED_TURN_COUNT} turnos; tiene ${turns.length}.`,
    );
  }
  const ids = new Set<string>();
  for (const turn of turns) {
    if (ids.has(turn.id)) {
      throw new FollowupEvalInputError(`Id de turno duplicado: ${turn.id}.`);
    }
    ids.add(turn.id);
    if (turn.expects_followup && !turn.kind) {
      throw new FollowupEvalInputError(
        `El turno positivo ${turn.id} no tiene kind.`,
      );
    }
  }
}

export function validatePredictions(
  turns: LabeledTurn[],
  predictions: FollowupPrediction[],
): Map<string, FollowupPrediction> {
  const byId = new Map<string, FollowupPrediction>();
  for (const prediction of predictions) {
    if (byId.has(prediction.id)) {
      throw new FollowupEvalInputError(
        `Predicción duplicada para ${prediction.id}.`,
      );
    }
    byId.set(prediction.id, prediction);
  }
  const datasetIds = new Set(turns.map((turn) => turn.id));
  for (const turn of turns) {
    if (!byId.has(turn.id)) {
      throw new FollowupEvalInputError(`Falta la predicción del turno ${turn.id}.`);
    }
  }
  for (const id of byId.keys()) {
    if (!datasetIds.has(id)) {
      throw new FollowupEvalInputError(`Predicción para un id desconocido: ${id}.`);
    }
  }
  return byId;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

// Epsilon avoids float noise when a ratio sits exactly on a threshold
// (e.g. 17/20 vs 0.85).
const EPS = 1e-9;

export function computeFollowupMetrics(
  turns: LabeledTurn[],
  predictions: FollowupPrediction[],
): FollowupMetrics {
  validateDataset(turns);
  const byId = validatePredictions(turns, predictions);

  const confusion: ConfusionCounts = { tp: 0, fn: 0, fp: 0, tn: 0, wrongKind: 0 };
  const misses: TurnMiss[] = [];
  const dateMismatches: string[] = [];
  let correct = 0;

  for (const turn of turns) {
    const prediction = byId.get(turn.id) as FollowupPrediction;
    const predictedLabel = prediction.called
      ? `called(${prediction.kind ?? '?'})`
      : 'not_called';
    if (turn.expects_followup) {
      if (!prediction.called) {
        confusion.fn += 1;
        misses.push({
          id: turn.id,
          reason: 'missed_followup',
          expected: `called(${turn.kind})`,
          predicted: predictedLabel,
        });
      } else {
        confusion.tp += 1;
        if (prediction.kind === turn.kind) {
          correct += 1;
          if (
            prediction.has_date !== undefined &&
            prediction.has_date !== turn.expects_date
          ) {
            dateMismatches.push(turn.id);
          }
        } else {
          confusion.wrongKind += 1;
          misses.push({
            id: turn.id,
            reason: 'wrong_kind',
            expected: `called(${turn.kind})`,
            predicted: predictedLabel,
          });
        }
      }
    } else if (prediction.called) {
      confusion.fp += 1;
      misses.push({
        id: turn.id,
        reason: 'false_positive',
        expected: 'not_called',
        predicted: predictedLabel,
      });
    } else {
      confusion.tn += 1;
    }
  }

  const positives = confusion.tp + confusion.fn;
  const negatives = confusion.fp + confusion.tn;
  const acierto = ratio(correct, positives);
  const noFalsePositive = ratio(confusion.tn, negatives);
  const precision = ratio(correct, confusion.tp + confusion.fp);
  const recall = ratio(confusion.tp, positives);

  const failures: string[] = [];
  if (acierto + EPS < MIN_ACIERTO) {
    failures.push(
      `acierto ${(acierto * 100).toFixed(1)} % < ${MIN_ACIERTO * 100} %`,
    );
  }
  if (noFalsePositive + EPS < MIN_NO_FALSE_POSITIVE) {
    failures.push(
      `no-falsos-positivos ${(noFalsePositive * 100).toFixed(1)} % < ${MIN_NO_FALSE_POSITIVE * 100} %`,
    );
  }

  return {
    positives,
    negatives,
    confusion,
    acierto,
    noFalsePositive,
    precision,
    recall,
    dateMismatches,
    misses,
    failures,
    passed: failures.length === 0,
  };
}
