import {
  WORKFLOW_ACTION_CATALOG,
  WorkflowActionInputSpec,
  WorkflowVendixActionName,
} from '@common/workflows/contract';
import { WorkflowInstanceRow } from '../workflow-engine.types';

/**
 * What a Vendix action handler receives. `map` holds the `map_resolved` of the
 * outbox row: strings (tokens already replaced) or an assignee definition.
 * The publisher's permission for the action was already checked.
 */
export interface WorkflowActionContext {
  instance: WorkflowInstanceRow;
  map: Record<string, unknown>;
  /** Person who published the version: the effect acts as them. */
  actingUserId: number;
  /** Their REAL store permissions (never widened by the flow). */
  permissions: string[];
  /**
   * Runs `fn` in the instance's store and organization as the publisher, with
   * their permissions, so the domain service sees the same context a request
   * of that person would.
   */
  asPublisher<T>(fn: () => Promise<T>): Promise<T>;
}

/** Id of the record created or touched (stored so a retry never repeats it). */
export interface WorkflowActionResult {
  record_id: number | null;
}

export type WorkflowActionHandler = (
  ctx: WorkflowActionContext,
) => Promise<WorkflowActionResult>;

export type WorkflowActionHandlerMap = Partial<
  Record<WorkflowVendixActionName, WorkflowActionHandler>
>;

/** A provider that runs some actions of the registry (P1.2). */
export interface WorkflowActionGroup {
  readonly handlers: WorkflowActionHandlerMap;
}

/** Wrong input: retrying cannot fix it, so it fails at once (`action_failed`). */
export class WorkflowActionInputError extends Error {}

const POSITIVE_INT = /^\d{1,12}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function raw(map: Record<string, unknown>, key: string): string {
  const v = map[key];
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

function spec(action: WorkflowVendixActionName, key: string): WorkflowActionInputSpec {
  const inputs = WORKFLOW_ACTION_CATALOG[action].inputs as Record<
    string,
    WorkflowActionInputSpec
  >;
  const s = inputs[key];
  if (!s) throw new Error(`"${key}" is not an input of ${action}`);
  return s;
}

/**
 * Typed readers of one action input, following the registry (required,
 * minimum, enum values). An empty optional input returns `undefined`.
 */
export function actionInputs(
  action: WorkflowVendixActionName,
  map: Record<string, unknown>,
) {
  const missing = (key: string) =>
    new WorkflowActionInputError(`"${key}" resolved to an empty value`);
  const read = (key: string): string | undefined => {
    const value = raw(map, key);
    if (value === '') {
      if (spec(action, key).required) throw missing(key);
      return undefined;
    }
    return value;
  };
  return {
    id(key: string): number | undefined {
      const v = read(key);
      if (v === undefined) return undefined;
      if (!POSITIVE_INT.test(v) || Number(v) < 1) {
        throw new WorkflowActionInputError(`"${key}" must be a positive integer (got "${v}")`);
      }
      return Number(v);
    },
    int(key: string): number | undefined {
      const v = read(key);
      if (v === undefined) return undefined;
      const n = Number(v);
      const min = spec(action, key).min;
      if (!/^-?\d{1,12}$/.test(v) || (min !== undefined && n < min)) {
        throw new WorkflowActionInputError(
          `"${key}" must be an integer${min !== undefined ? ` >= ${min}` : ''} (got "${v}")`,
        );
      }
      return n;
    },
    money(key: string): number | undefined {
      const v = read(key);
      if (v === undefined) return undefined;
      const n = Number(v);
      const min = spec(action, key).min;
      if (!Number.isFinite(n) || (min !== undefined && n < min)) {
        throw new WorkflowActionInputError(
          `"${key}" must be a number${min !== undefined ? ` >= ${min}` : ''} (got "${v}")`,
        );
      }
      return Math.round(n * 100) / 100;
    },
    text(key: string, max = 2000): string | undefined {
      const v = read(key);
      return v === undefined ? undefined : v.slice(0, max);
    },
    date(key: string): string | undefined {
      const v = read(key);
      if (v === undefined) return undefined;
      if (!ISO_DATE.test(v) || Number.isNaN(Date.parse(v))) {
        throw new WorkflowActionInputError(`"${key}" must be a date YYYY-MM-DD (got "${v}")`);
      }
      return v;
    },
    enum<T extends string>(key: string): T | undefined {
      const v = read(key);
      if (v === undefined) return undefined;
      const values = spec(action, key).values ?? [];
      if (!values.includes(v)) {
        throw new WorkflowActionInputError(
          `"${key}" must be one of ${values.join(', ')} (got "${v}")`,
        );
      }
      return v as T;
    },
  };
}

/** Required variant: the registry already says it is required. */
export function must<T>(value: T | undefined, key: string): T {
  if (value === undefined) {
    throw new WorkflowActionInputError(`"${key}" resolved to an empty value`);
  }
  return value;
}

/** The id a domain service returned, or an error (never a fake success). */
export function returnedId(created: unknown, what: string): number {
  const id = Number((created as { id?: unknown } | null)?.id);
  if (!Number.isInteger(id) || id < 1) {
    throw new Error(`${what} returned no id`);
  }
  return id;
}
