import { SimulationResult } from './workflow.interfaces';
import { HttpTestResult } from '../editor/components/http-action/http-action-api.service';

// ─── Simulator: parallel stages and variables per step (P5.2) ──────────

export interface SimulatedBranch {
  key: string;
  name: string;
  assignee: { kind: string; label: string } | null;
}

/** A parallel stage the run passed through, resolved as `joined`. */
export interface SimulatedParallel {
  join: 'all' | 'any' | 'n_of_m' | string;
  needed: number;
  total: number;
  branches: SimulatedBranch[];
  outcome: 'joined';
}

/** One stage of the simulated path with the variables once it was done. */
export interface SimulatedStep {
  stage_key: string;
  stage_name: string;
  type: string;
  data: Record<string, unknown>;
  /** Keys that differ from the previous step. */
  changed: string[];
  parallel?: SimulatedParallel;
}

/** The simulator answer including the per-step variables. */
export type SimulationWithSteps = SimulationResult & { steps?: SimulatedStep[] };

// ─── Instance debugger ─────────────────────────────────────────────────

export interface DebugChange {
  key: string;
  before: unknown;
  after: unknown;
}

export interface DebugEvent {
  seq: number;
  type: string;
  from_stage_key: string | null;
  to_stage_key: string | null;
  actor_type: string;
  actor_id: number | null;
  occurred_at: string;
  payload: unknown;
  /** `null` for events recorded before variables were captured. */
  data_snapshot: Record<string, unknown> | null;
  changes: DebugChange[];
}

export interface InstanceDebug {
  instance_id: number;
  events: DebugEvent[];
  current_data: Record<string, unknown>;
}

// ─── "Probar esta acción" ──────────────────────────────────────────────

export interface ActionTestBody {
  action: Record<string, unknown>;
  data?: Record<string, unknown>;
  instance?: { reference?: string; title?: string };
}

export interface ActionSchemaError {
  key: string;
  label: string;
  message: string;
}

export interface ConnectorTestResult {
  ok: boolean;
  simulated: boolean;
  message: string;
}

export type ActionTestResult =
  | {
      mode: 'preview';
      executed: false;
      action: string;
      label: string;
      resolved_input: Record<string, unknown>;
      schema_errors: ActionSchemaError[];
      permission: { required: string | null; granted: boolean };
    }
  | { mode: 'http'; executed: true; action: string; label: string; result: HttpTestResult }
  | {
      mode: 'connector';
      executed: true;
      action: string;
      label: string;
      connector: 'email_out' | 'whatsapp';
      result: ConnectorTestResult;
    };
