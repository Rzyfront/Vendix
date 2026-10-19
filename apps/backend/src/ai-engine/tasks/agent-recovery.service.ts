import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ToolExecutionReceipt } from '../tools/interfaces/tool.interface';

export type RecoveryFailureKind =
  | 'invalid_args'
  | 'missing_tool'
  | 'not_found'
  | 'incomplete_data'
  | 'transient_read'
  | 'permission'
  | 'plan'
  | 'unknown_effect'
  | 'other';
export type RecoveryAction =
  | 'continue'
  | 'correct_schema'
  | 'expand_tools'
  | 'lookup_identifier'
  | 'paginate'
  | 'retry_read'
  | 'change_strategy'
  | 'ask_identifier'
  | 'allowed_alternative'
  | 'await_approval'
  | 'reconcile'
  | 'stop';

interface RecoveryFailure {
  tool_hash: string;
  args_hash: string;
  fingerprint: string;
  kind: RecoveryFailureKind;
  count: number;
  schema_corrections: number;
  transient_retries: number;
  alternative_lookups: number;
  progress_hash: string;
  call_hash?: string;
  resolved: boolean;
  alternative_allowed: boolean;
}
/** Objective-scoped checkpoint data: hashes/counters only, never raw arguments. */
export interface AgentRecoveryState {
  schema_version: '1';
  replans: number;
  expansions: number;
  corrections: number;
  transient_retries: number;
  failures: RecoveryFailure[];
  unknown_effect: boolean;
  exhausted: boolean;
}
export interface RecoveryDecision {
  action: RecoveryAction;
  next_action: string;
  retryable: boolean;
  wait_ms?: number;
  next_cursor?: string | number;
  fingerprint?: string;
}
export interface RecoveryLimits {
  max_replans?: number;
  max_expansions?: number;
  max_transient_retries?: number;
  base_backoff_ms?: number;
  max_backoff_ms?: number;
  reserve_ms?: number;
}
export interface RecoveryCallInput {
  tool_name: string;
  arguments: unknown;
  read_only: boolean;
  deadline_at?: number;
  now?: number;
  /** Server-owned reconciliation read; never accepted from model tool args. */
  reconciliation_read?: boolean;
}
export interface RecoveryInput extends RecoveryCallInput {
  receipt: ToolExecutionReceipt;
  /** Server-owned classifier. AI_AGENT_003 alone is ambiguous, never missing_tool. */
  failure_kind?: RecoveryFailureKind;
  http_status?: number;
  call_id?: string;
  missing_identifier?: string;
  alternative_identifier_available?: boolean;
  /** Independent observed progress, not model prose or a claimed verified flag. */
  progress_key?: string;
  jitter?: number;
}

const digest = (value: string): string =>
  createHash('sha256').update(value).digest('hex');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
const stop = (next_action: string): RecoveryDecision => ({
  action: 'stop',
  next_action,
  retryable: false,
});
const decision = (
  action: RecoveryAction,
  next_action: string,
  retryable = false,
): RecoveryDecision => ({ action, next_action, retryable });
const initialState = (): AgentRecoveryState => ({
  schema_version: '1',
  replans: 0,
  expansions: 0,
  corrections: 0,
  transient_retries: 0,
  failures: [],
  unknown_effect: false,
  exhausted: false,
});

/** Pure bounded policy. The caller MUST checkpoint each returned state under D1 CAS before acting. */
@Injectable()
export class AgentRecoveryService {
  private limits(options: RecoveryLimits) {
    const bounded = (
      value: number | undefined,
      fallback: number,
      max: number,
    ) =>
      Number.isSafeInteger(value) && value! >= 0
        ? Math.min(value!, max)
        : fallback;
    return {
      replans: bounded(options.max_replans, 2, 8),
      expansions: bounded(options.max_expansions, 2, 8),
      transient: bounded(options.max_transient_retries, 2, 4),
      base: bounded(options.base_backoff_ms, 250, 10000),
      max: bounded(options.max_backoff_ms, 2000, 30000),
      reserve: bounded(options.reserve_ms, 250, 30000),
    };
  }

  private state(value?: AgentRecoveryState): AgentRecoveryState {
    if (!value) return initialState();
    // Corrupt/missing historical checkpoint data must never silently reset a budget.
    const counters = [
      value.replans,
      value.expansions,
      value.corrections,
      value.transient_retries,
    ];
    const hash = (item: unknown) =>
      typeof item === 'string' && /^[a-f0-9]{64}$/.test(item);
    if (
      value.schema_version !== '1' ||
      typeof value.unknown_effect !== 'boolean' ||
      typeof value.exhausted !== 'boolean' ||
      !counters.every((n) => Number.isSafeInteger(n) && n >= 0) ||
      !Array.isArray(value.failures) ||
      value.failures.length > 64 ||
      !value.failures.every(
        (f) =>
          hash(f.tool_hash) &&
          hash(f.args_hash) &&
          hash(f.fingerprint) &&
          hash(f.progress_hash) &&
          (f.call_hash == null || hash(f.call_hash)) &&
          typeof f.resolved === 'boolean' &&
          typeof f.alternative_allowed === 'boolean' &&
          [
            'invalid_args',
            'missing_tool',
            'not_found',
            'incomplete_data',
            'transient_read',
            'permission',
            'plan',
            'unknown_effect',
            'other',
          ].includes(f.kind) &&
          [
            f.count,
            f.schema_corrections,
            f.transient_retries,
            f.alternative_lookups,
          ].every((n) => Number.isSafeInteger(n) && n >= 0),
      )
    )
      return { ...initialState(), exhausted: true };
    return {
      schema_version: '1',
      replans: value.replans,
      expansions: value.expansions,
      corrections: value.corrections,
      transient_retries: value.transient_retries,
      unknown_effect: value.unknown_effect === true,
      exhausted: value.exhausted === true,
      failures: value.failures.map((f) => ({
        tool_hash: f.tool_hash,
        args_hash: f.args_hash,
        fingerprint: f.fingerprint,
        kind: f.kind,
        count: f.count,
        schema_corrections: f.schema_corrections,
        transient_retries: f.transient_retries,
        alternative_lookups: f.alternative_lookups,
        progress_hash: f.progress_hash,
        resolved: f.resolved,
        alternative_allowed: f.alternative_allowed,
        ...(f.call_hash ? { call_hash: f.call_hash } : {}),
      })),
    };
  }

  private canStart(input: RecoveryCallInput, reserve: number): boolean {
    return (
      input.deadline_at === undefined ||
      (Number.isFinite(input.deadline_at) &&
        input.deadline_at - (input.now ?? Date.now()) > reserve)
    );
  }

  beforeCall(
    input: RecoveryCallInput,
    previous?: AgentRecoveryState,
    options: RecoveryLimits = {},
  ): {
    state: AgentRecoveryState;
    allowed: boolean;
    decision?: RecoveryDecision;
  } {
    const state = this.state(previous);
    const limits = this.limits(options);
    const deny = (why: RecoveryDecision) => ({
      state,
      allowed: false,
      decision: why,
    });
    if (state.exhausted)
      return deny(
        stop(
          'El presupuesto de recuperación se agotó; conserva el avance sin repetir llamadas.',
        ),
      );
    if (!this.canStart(input, limits.reserve))
      return deny(
        stop(
          'El plazo no permite otra llamada; guarda el avance y verifica el estado.',
        ),
      );
    if (state.unknown_effect && !(input.read_only && input.reconciliation_read))
      return deny(
        decision(
          'reconcile',
          'Hay una escritura incierta. Consulta su operación o referencia antes de cualquier otra ejecución.',
        ),
      );
    const toolHash = digest(input.tool_name);
    const argsHash = digest(canonical(input.arguments));
    const records = state.failures.filter((f) => f.tool_hash === toolHash);
    const active = records.filter((f) => !f.resolved);
    const last = active[active.length - 1];
    if (!last) return { state, allowed: true };
    const exact = [...active].reverse().find((f) => f.args_hash === argsHash);
    if (
      exact?.kind === 'transient_read' &&
      input.read_only &&
      exact.transient_retries < limits.transient
    ) {
      exact.transient_retries++;
      state.transient_retries++;
      return { state, allowed: true };
    }
    if (exact) {
      exact.count++;
      return deny(this.replan(state, limits.replans, exact.fingerprint));
    }
    if (['permission', 'plan', 'unknown_effect'].includes(last.kind))
      return deny(
        decision(
          'allowed_alternative',
          'Usa otra capacidad ya autorizada; no reintentes este bloqueo con otros argumentos.',
        ),
      );
    if (last.kind === 'invalid_args') {
      if (records.reduce((n, f) => n + f.schema_corrections, 0) >= 1)
        return deny(
          stop(
            'La corrección del schema ya se utilizó. Falta resolver un dato o una capacidad concreta.',
          ),
        );
      last.schema_corrections++;
      state.corrections++;
    }
    if (last.kind === 'not_found') {
      if (
        !last.alternative_allowed ||
        records.reduce((n, f) => n + f.alternative_lookups, 0) >= 1
      )
        return deny(
          decision(
            'ask_identifier',
            'Indica el identificador exacto del registro existente; no crearé uno nuevo.',
          ),
        );
      last.alternative_lookups++;
    }
    return { state, allowed: true };
  }

  decide(
    input: RecoveryInput,
    previous?: AgentRecoveryState,
    options: RecoveryLimits = {},
  ): {
    state: AgentRecoveryState;
    decision: RecoveryDecision;
  } {
    const state = this.state(previous);
    const limits = this.limits(options);
    const finish = (result: RecoveryDecision) => ({ state, decision: result });
    if (state.exhausted)
      return finish(
        stop('El presupuesto de recuperación se agotó; conserva el avance.'),
      );
    if (
      input.receipt.status === 'unknown_effect' ||
      input.receipt.effect_status === 'unknown'
    ) {
      state.unknown_effect = true;
      return finish(
        decision(
          'reconcile',
          'El efecto de la escritura es incierto. Consulta la operación o referencia; no la repitas.',
        ),
      );
    }
    if (input.receipt.status === 'pending_confirmation')
      return finish(
        decision(
          'await_approval',
          'Revisa y aprueba esta escritura; todavía no se aplicó.',
        ),
      );
    const kind = this.classify(input);
    if (!kind) {
      for (const record of state.failures)
        if (record.tool_hash === digest(input.tool_name))
          record.resolved = true;
      return finish(
        decision(
          'continue',
          'Continúa con la siguiente postcondición pendiente.',
        ),
      );
    }
    const toolHash = digest(input.tool_name);
    const argsHash = digest(canonical(input.arguments));
    const progressHash = digest(input.progress_key ?? '');
    const fingerprint = digest(
      canonical([
        toolHash,
        argsHash,
        kind,
        input.receipt.error_code,
        progressHash,
      ]),
    );
    const callHash = input.call_id ? digest(input.call_id) : undefined;
    let failure = state.failures.find((f) => f.fingerprint === fingerprint);
    if (callHash && failure?.call_hash === callHash)
      return finish(
        stop(
          'Este resultado ya fue registrado; continúa desde el checkpoint sin volver a ejecutarlo.',
        ),
      );
    if (!failure) {
      if (state.failures.length >= 64) {
        state.exhausted = true;
        return finish(
          stop(
            'El historial acotado de recuperación se agotó; conserva la evidencia disponible.',
          ),
        );
      }
      failure = {
        tool_hash: toolHash,
        args_hash: argsHash,
        fingerprint,
        kind,
        count: 0,
        schema_corrections: 0,
        transient_retries: 0,
        alternative_lookups: 0,
        progress_hash: progressHash,
        resolved: false,
        alternative_allowed: input.alternative_identifier_available === true,
      };
      state.failures.push(failure);
    }
    failure.resolved = false;
    failure.count++;
    if (callHash) failure.call_hash = callHash;
    else delete failure.call_hash;
    if (kind === 'permission' || kind === 'plan')
      return finish({
        ...decision(
          'allowed_alternative',
          'Esta capacidad está bloqueada por permisos o plan. Usa una alternativa permitida o solicita ese acceso concreto.',
        ),
        fingerprint,
      });
    if (kind === 'unknown_effect') {
      state.unknown_effect = true;
      return finish(
        decision(
          'reconcile',
          'No repitas la escritura incierta; consulta su referencia de operación.',
        ),
      );
    }
    if (!this.canStart(input, limits.reserve))
      return finish(
        stop(
          'El plazo no permite recuperación; guarda el avance sin iniciar otra llamada.',
        ),
      );
    if (failure.count >= 2 && kind !== 'transient_read')
      return finish(this.replan(state, limits.replans, fingerprint));
    if (kind === 'invalid_args') {
      const used = state.failures
        .filter((f) => f.tool_hash === toolHash)
        .reduce((n, f) => n + f.schema_corrections, 0);
      return finish(
        used < 1
          ? {
              ...decision(
                'correct_schema',
                'Inspecciona el schema y preflight autorizados; corrige una sola vez los campos inválidos.',
              ),
              fingerprint,
            }
          : stop(
              'La corrección de argumentos ya se utilizó; resuelve el dato o contrato concreto que falta.',
            ),
      );
    }
    if (kind === 'missing_tool') {
      if (state.expansions >= limits.expansions)
        return finish(this.replan(state, limits.replans, fingerprint));
      state.expansions++;
      return finish({
        ...decision(
          'expand_tools',
          'Busca la herramienta autorizada con search_tools o la fase pertinente del playbook; conserva el objetivo original.',
        ),
        fingerprint,
      });
    }
    if (kind === 'not_found') {
      const field =
        input.missing_identifier &&
        /^[a-z][a-z0-9_.-]{0,63}$/i.test(input.missing_identifier)
          ? input.missing_identifier
          : 'identificador del registro existente';
      return finish({
        ...decision(
          input.alternative_identifier_available
            ? 'lookup_identifier'
            : 'ask_identifier',
          input.alternative_identifier_available
            ? 'Consulta una vez el identificador alternativo determinista del registro existente; no crees un registro nuevo.'
            : `Indica ${field} exacto para consultar el registro existente; no crearé uno nuevo.`,
        ),
        fingerprint,
      });
    }
    if (kind === 'incomplete_data') {
      const cursor = input.receipt.pagination?.next_cursor;
      if (cursor !== undefined && cursor !== null && cursor !== '')
        return finish({
          ...decision(
            'paginate',
            'Continúa con el cursor pendiente; no trates esta página como el conjunto completo.',
          ),
          next_cursor: cursor,
          fingerprint,
        });
      return finish(this.replan(state, limits.replans, fingerprint));
    }
    if (
      kind === 'transient_read' &&
      input.read_only &&
      input.receipt.retryable
    ) {
      if (failure.transient_retries >= limits.transient)
        return finish(this.replan(state, limits.replans, fingerprint));
      const random = Number.isFinite(input.jitter)
        ? Math.max(0, Math.min(1, input.jitter!))
        : Math.random();
      const wait = Math.ceil(
        Math.min(limits.max, limits.base * 2 ** failure.transient_retries) *
          (0.5 + random * 0.5),
      );
      if (
        input.deadline_at !== undefined &&
        input.deadline_at - (input.now ?? Date.now()) <= wait + limits.reserve
      )
        return finish(
          stop(
            'El plazo no alcanza para el backoff y otra lectura; guarda el avance.',
          ),
        );
      return finish({
        ...decision(
          'retry_read',
          'Reintenta únicamente esta lectura transitoria dentro del plazo restante.',
          true,
        ),
        wait_ms: wait,
        fingerprint,
      });
    }
    return finish(this.replan(state, limits.replans, fingerprint));
  }

  private replan(
    state: AgentRecoveryState,
    max: number,
    fingerprint: string,
  ): RecoveryDecision {
    if (state.replans >= max)
      return stop(
        'Se agotaron las dos estrategias técnicas de recuperación del objetivo; conserva los efectos y solicita solo el dato o decisión concreta pendiente.',
      );
    state.replans++;
    return {
      ...decision(
        'change_strategy',
        'Cambia la estrategia técnica sin cambiar el objetivo, inventar IDs, crear datos faltantes ni repetir escrituras.',
      ),
      fingerprint,
    };
  }

  private classify(input: RecoveryInput): RecoveryFailureKind | null {
    if (input.receipt.status === 'blocked')
      return /^(SUBSCRIPTION_|PLAN_|TRIAL_)/.test(
        input.receipt.error_code ?? '',
      )
        ? 'plan'
        : 'permission';
    if (input.failure_kind) return input.failure_kind;
    if (input.receipt.error_code === 'INVALID_ARGS') return 'invalid_args';
    if (input.receipt.error_code === 'NOT_FOUND') return 'not_found';
    if (
      input.read_only &&
      (input.http_status === 429 ||
        (input.http_status! >= 500 && input.http_status! <= 599))
    )
      return 'transient_read';
    if (
      input.receipt.status === 'ok' &&
      (input.receipt.freshness === 'truncated' ||
        input.receipt.pagination?.has_more === true ||
        input.receipt.pagination?.complete === false)
    )
      return 'incomplete_data';
    return input.receipt.status === 'ok' ? null : 'other';
  }
}
