import { Injectable } from '@nestjs/common';
import {
  RequestContextService,
  type RequestContext,
} from '../../common/context/request-context.service';
import type { RegisteredTool } from './interfaces/tool.interface';

export const parallelReadsEnabled = (): boolean =>
  process.env.AI_PARALLEL_READS_ENABLED === 'true';
export interface ScheduledToolCall {
  call_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  /** Trusted DAG edges from the server plan, never arbitrary provider metadata. */
  depends_on?: string[];
}
export type ScheduledToolResult<T> =
  | { call_id: string; status: 'fulfilled'; value: T }
  | { call_id: string; status: 'rejected'; reason: unknown };
export interface ToolBatchInput<T> {
  objective_id: string;
  context: RequestContext;
  calls: readonly ScheduledToolCall[];
  offered_tools: readonly RegisteredTool[];
  completed_call_ids?: readonly string[];
  /** Pure schema/preflight checks, no dispatch. Failure rejects the entire batch. */
  validate: (
    call: ScheduledToolCall,
    tool: RegisteredTool,
  ) => unknown | Promise<unknown>;
  /** Must retain registry permission, token and current offered-catalog guards. */
  execute: (call: ScheduledToolCall, tool: RegisteredTool) => Promise<T>;
  signal?: AbortSignal;
  deadline_at?: number;
  /** Notification only; callers checkpoint mutable D1 state serially after completion. */
  onSettled?: (result: ScheduledToolResult<T>) => void;
  /** Audit-only completion AFTER the batch has rejected this call. Never current evidence. */
  onLateResult?: (
    result: Extract<ScheduledToolResult<T>, { status: 'fulfilled' }>,
  ) => void | Promise<void>;
}
export class ToolSchedulerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public late_result?: unknown,
  ) {
    super(message);
    this.name = 'ToolSchedulerError';
  }
}
interface PermitRequest {
  objective: string;
  store: string;
  heavy: boolean;
  resources: string[];
  exclusive: boolean;
  resolve: (release: () => void) => void;
  reject: (reason: unknown) => void;
  cleanup: () => void;
  input: Pick<ToolBatchInput<unknown>, 'signal' | 'deadline_at'>;
}
const failure = (code: string, message: string): ToolSchedulerError =>
  new ToolSchedulerError(code, message);
const cloneContext = (context: RequestContext): RequestContext => ({
  ...context,
  roles: context.roles ? [...context.roles] : undefined,
  permissions: context.permissions ? [...context.permissions] : undefined,
});
const validScope = (context: RequestContext) =>
  [context.user_id, context.organization_id, context.store_id].every(
    (n) => Number.isSafeInteger(n) && n! > 0,
  );
const abortReason = (
  input: Pick<ToolBatchInput<unknown>, 'signal' | 'deadline_at'>,
): ToolSchedulerError | null => {
  if (input.signal?.aborted)
    return failure('SCHEDULER_ABORTED', 'El lote fue cancelado.');
  if (
    input.deadline_at !== undefined &&
    (!Number.isFinite(input.deadline_at) || Date.now() >= input.deadline_at)
  )
    return failure('SCHEDULER_DEADLINE', 'El plazo del lote terminó.');
  return null;
};

/** Bounded worker-local broker. No registry bypass or changes to tool-success semantics. */
@Injectable()
export class ToolSchedulerService {
  private active = 0;
  private readonly objectives = new Map<string, number>();
  private readonly exclusives = new Set<string>();
  private readonly heavyStores = new Set<string>();
  private readonly resources = new Set<string>();
  private readonly waiting: PermitRequest[] = [];

  async executeBatch<T>(
    input: ToolBatchInput<T>,
  ): Promise<ScheduledToolResult<T>[]> {
    const context = cloneContext(input.context);
    this.assertContext(context);
    const stopped = abortReason(input);
    if (stopped) throw stopped;
    if (!input.objective_id || !input.objective_id.trim())
      throw failure('SCHEDULER_OBJECTIVE', 'Falta el objetivo del lote.');
    if (input.calls.length > 100)
      throw failure('SCHEDULER_BATCH_LIMIT', 'El lote excede cien llamadas.');
    const tools = new Map(input.offered_tools.map((tool) => [tool.name, tool]));
    const calls = input.calls.map((call) => structuredClone(call));
    const ids = new Set<string>();
    for (const call of calls) {
      if (!call.call_id || ids.has(call.call_id))
        throw failure(
          'SCHEDULER_CALL_ID',
          'Los IDs del lote deben ser únicos.',
        );
      ids.add(call.call_id);
      if (!tools.has(call.tool_name))
        throw failure(
          'SCHEDULER_NOT_OFFERED',
          'El lote contiene una herramienta no ofrecida.',
        );
    }
    const complete = new Set(input.completed_call_ids ?? []);
    const dependencies = new Map<string, string[]>();
    for (const call of calls) {
      const tool = tools.get(call.tool_name)!;
      const deps = [
        ...new Set([
          ...(call.depends_on ?? []),
          ...(tool.scheduling?.depends_on ?? []),
        ]),
      ];
      if (deps.some((id) => !ids.has(id) && !complete.has(id)))
        throw failure(
          'SCHEDULER_UNRESOLVED_DEPENDENCY',
          'El lote tiene una dependencia sin evidencia resuelta.',
        );
      // Stable provider order and serial mutations require topological server order.
      if (
        deps.some(
          (id) =>
            ids.has(id) &&
            !calls
              .slice(0, calls.indexOf(call))
              .some((prior) => prior.call_id === id),
        )
      )
        throw failure(
          'SCHEDULER_DEPENDENCY_ORDER',
          'El lote requiere orden topológico de sus dependencias.',
        );
      dependencies.set(call.call_id, deps);
      const checked = await RequestContextService.runIsolated(
        cloneContext(context),
        () => input.validate(call, tool),
      );
      if (
        checked === false ||
        (checked &&
          typeof checked === 'object' &&
          'ok' in checked &&
          checked.ok === false)
      )
        throw failure(
          'SCHEDULER_INVALID_ARGS',
          'El preflight del lote rechazó argumentos.',
        );
      const interrupted = abortReason(input);
      if (interrupted) throw interrupted;
    }
    // No dispatch occurred until EVERY call passed offered/schema/DAG/context validation.
    const results: ScheduledToolResult<T>[] = [];
    const byId = new Map<string, ScheduledToolResult<T>>();
    const objective = `${context.organization_id}:${context.store_id}:${context.user_id}:${input.objective_id}`;
    const store = `${context.organization_id}:${context.store_id}`;
    const run = async (
      call: ScheduledToolCall,
    ): Promise<ScheduledToolResult<T>> => {
      const tool = tools.get(call.tool_name)!;
      const deps = dependencies.get(call.call_id)!;
      let result: ScheduledToolResult<T>;
      const failedDependency = deps.some(
        (id) => byId.get(id)?.status === 'rejected',
      );
      if (failedDependency)
        result = {
          call_id: call.call_id,
          status: 'rejected',
          reason: failure(
            'SCHEDULER_DEPENDENCY_FAILED',
            'Una dependencia del paso falló; no se ejecutó esta llamada.',
          ),
        };
      else {
        let release: (() => void) | undefined;
        try {
          const safe =
            parallelReadsEnabled() &&
            this.parallelSafe(tool, deps, call.arguments);
          release = await this.acquire(
            {
              objective,
              store,
              heavy: tool.scheduling?.heavy === true,
              resources: (
                this.resourceKeys(tool, call.arguments) ?? [
                  `unresolved:${tool.name}`,
                ]
              ).map((key) => `${store}:${key}`),
              exclusive: !safe,
            },
            input,
          );
          const interrupted = abortReason(input);
          if (interrupted) throw interrupted;
          const execution = RequestContextService.runIsolated(
            cloneContext(context),
            async () => input.execute(call, tool),
          );
          // Dispatch owns the permit until the ACTUAL handler settles. The
          // caller can stop waiting at its hard deadline without falsely freeing
          // capacity for another hung operation.
          const heldRelease = release;
          release = undefined;
          const value = await this.settleExecution(
            execution,
            input,
            heldRelease,
            (value) => {
              const callback = input.onLateResult;
              if (!callback) return;
              try {
                const observed = RequestContextService.runIsolated(
                  cloneContext(context),
                  () =>
                    callback({
                      call_id: call.call_id,
                      status: 'fulfilled',
                      value,
                    }),
                );
                void Promise.resolve(observed).catch(() => undefined);
              } catch {
                /* audit observer cannot resurrect a completed batch */
              }
            },
          );
          if (
            tool.scheduling &&
            Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8') >
              tool.scheduling.max_result_bytes
          )
            throw failure(
              'SCHEDULER_RESULT_LIMIT',
              'El resultado excede el contrato; consulta una página o agregado acotado.',
            );
          result = { call_id: call.call_id, status: 'fulfilled', value };
        } catch (reason) {
          result = { call_id: call.call_id, status: 'rejected', reason };
        } finally {
          release?.();
        }
      }
      byId.set(call.call_id, result);
      // Observation errors cannot erase successful sibling evidence or change its outcome.
      try {
        input.onSettled?.(result);
      } catch {
        /* caller notification is not execution */
      }
      return result;
    };
    let parallel: ScheduledToolCall[] = [];
    const flush = async () => {
      if (!parallel.length) return;
      const pending = parallel;
      parallel = [];
      const settled = await Promise.allSettled(pending.map(run));
      settled.forEach((item, index) =>
        results.push(
          item.status === 'fulfilled'
            ? item.value
            : {
                call_id: pending[index].call_id,
                status: 'rejected',
                reason: item.reason,
              },
        ),
      );
    };
    for (const call of calls) {
      const tool = tools.get(call.tool_name)!;
      if (
        parallelReadsEnabled() &&
        this.parallelSafe(tool, dependencies.get(call.call_id)!, call.arguments)
      )
        parallel.push(call);
      else {
        await flush();
        results.push(await run(call));
      }
    }
    await flush();
    return results;
  }

  private settleExecution<T>(
    execution: Promise<T>,
    input: Pick<ToolBatchInput<unknown>, 'signal' | 'deadline_at'>,
    release: () => void,
    onLate: (value: T) => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let published = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        input.signal?.removeEventListener('abort', cancel);
      };
      const cancel = () => {
        if (published) return;
        const reason = abortReason(input);
        if (!reason) {
          schedule();
          return;
        }
        published = true;
        cleanup();
        reject(reason);
        // Do NOT release here: non-cooperative work still occupies its slot.
      };
      const schedule = () => {
        if (timer) clearTimeout(timer);
        if (
          input.deadline_at !== undefined &&
          Number.isFinite(input.deadline_at)
        )
          timer = setTimeout(
            cancel,
            Math.min(2147483647, Math.max(1, input.deadline_at - Date.now())),
          );
      };
      input.signal?.addEventListener('abort', cancel, { once: true });
      schedule();
      // Install real-completion observers even if cancellation already happened.
      // Both branches release exactly once and consume late rejection safely.
      execution.then(
        (value) => {
          release();
          const late = published || abortReason(input) !== null;
          if (!published) {
            published = true;
            cleanup();
            if (late) reject(abortReason(input)!);
            else resolve(value);
          }
          if (late) onLate(value);
        },
        (reason) => {
          release();
          if (!published) {
            published = true;
            cleanup();
            reject(abortReason(input) ?? reason);
          }
        },
      );
      cancel(); // Covers abort between dispatch and listener registration.
    });
  }

  private assertContext(context: RequestContext): void {
    const live = RequestContextService.asyncLocalStorage.getStore();
    // Never adopt RequestContextService.getContext()'s mutable process fallback.
    if (
      !validScope(context) ||
      !live ||
      !validScope(live) ||
      live.user_id !== context.user_id ||
      live.organization_id !== context.organization_id ||
      live.store_id !== context.store_id
    )
      throw failure(
        'SCHEDULER_CONTEXT',
        'Se requiere ALS explícito del mismo usuario, organización y tienda.',
      );
    const same = (a: string[] | undefined, b: string[] | undefined) =>
      JSON.stringify([...(a ?? [])].sort()) ===
      JSON.stringify([...(b ?? [])].sort());
    if (
      !same(live.permissions, context.permissions) ||
      !same(live.roles, context.roles) ||
      live.is_owner !== context.is_owner ||
      live.is_super_admin !== context.is_super_admin ||
      live.access_token !== context.access_token
    )
      throw failure(
        'SCHEDULER_CONTEXT',
        'El snapshot del lote no puede ampliar la autoridad vigente.',
      );
  }

  private parallelSafe(
    tool: RegisteredTool,
    dependencies: string[],
    args: Record<string, unknown>,
  ): boolean {
    const metadata = tool.scheduling;
    // Scratch blocks/planning/discovery/UI are not independent reads, even if mislabelled.
    return (
      !!metadata &&
      metadata.parallelSafe === true &&
      metadata.idempotent_read === true &&
      Number.isSafeInteger(metadata.max_result_bytes) &&
      metadata.max_result_bytes > 0 &&
      metadata.max_result_bytes <= 2 * 1024 * 1024 &&
      this.resourceKeys(tool, args) !== null &&
      tool.readOnly === true &&
      tool.requiresConfirmation !== true &&
      tool.clientSide !== true &&
      dependencies.length === 0 &&
      !/^(ui_|vex_|plan_|create_plan$|propose_plan$|revise_plan$|ask_user$|resume_plan$|verify_deliverables$|search_tools$|search_playbooks$|load_playbook$)/.test(
        tool.name,
      ) &&
      !/^(planning|vex|blocks|ui|playbooks)$/.test(tool.domain)
    );
  }

  private resourceKeys(
    tool: RegisteredTool,
    args: Record<string, unknown>,
  ): string[] | null {
    const keys = tool.scheduling?.resource_keys;
    if (!Array.isArray(keys)) return null;
    const resolved: string[] = [];
    for (const key of keys) {
      if (typeof key !== 'string' || !key.length || key.length > 128)
        return null;
      let valid = true;
      const value = key.replace(
        /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g,
        (_, field: string) => {
          const item = Object.prototype.hasOwnProperty.call(args, field)
            ? args[field]
            : undefined;
          if (
            !['string', 'number', 'boolean'].includes(typeof item) ||
            (typeof item === 'number' && !Number.isFinite(item)) ||
            String(item).length > 128
          ) {
            valid = false;
            return '';
          }
          return encodeURIComponent(String(item));
        },
      );
      if (!valid || /[{}]/.test(value)) return null;
      resolved.push(value);
    }
    return [...new Set(resolved)];
  }

  private poolLimit(): number | undefined {
    const value = Number(process.env.DATABASE_POOL_MAX);
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }

  private objectiveLimit(): number {
    const raw = Number(process.env.AI_PARALLEL_READS_OBJECTIVE_CAP ?? 3);
    const configured =
      Number.isSafeInteger(raw) && raw > 0 ? Math.min(3, raw) : 3;
    const pool = this.poolLimit();
    return Math.min(configured, pool ? Math.max(1, Math.floor(pool / 2)) : 3);
  }

  private globalLimit(): number {
    const value = Number(process.env.AI_PARALLEL_READS_GLOBAL_CAP ?? 6);
    const configured =
      Number.isSafeInteger(value) && value >= 1 ? Math.min(value, 32) : 6;
    const pool = this.poolLimit();
    return Math.min(configured, pool ? Math.max(1, pool - 1) : configured);
  }

  private acquire(
    keys: Pick<
      PermitRequest,
      'objective' | 'store' | 'heavy' | 'resources' | 'exclusive'
    >,
    input: Pick<ToolBatchInput<unknown>, 'signal' | 'deadline_at'>,
  ): Promise<() => void> {
    return new Promise((resolve, reject) => {
      const stopped = abortReason(input);
      if (stopped) {
        reject(stopped);
        return;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cancel = () => {
        const index = this.waiting.indexOf(request);
        if (index >= 0) {
          this.waiting.splice(index, 1);
          request.cleanup();
          reject(
            abortReason(input) ??
              failure('SCHEDULER_ABORTED', 'El lote fue cancelado.'),
          );
          this.pump();
        }
      };
      const request: PermitRequest = {
        ...keys,
        input,
        resolve,
        reject,
        cleanup: () => {
          if (timer) clearTimeout(timer);
          input.signal?.removeEventListener('abort', cancel);
        },
      };
      input.signal?.addEventListener('abort', cancel, { once: true });
      if (input.deadline_at !== undefined)
        timer = setTimeout(
          cancel,
          Math.min(2147483647, Math.max(1, input.deadline_at - Date.now())),
        );
      this.waiting.push(request);
      this.pump();
    });
  }

  private pump(): void {
    for (let i = 0; i < this.waiting.length; ) {
      const request = this.waiting[i];
      const stopped = abortReason(request.input);
      if (stopped) {
        this.waiting.splice(i, 1);
        request.cleanup();
        request.reject(stopped);
        continue;
      }
      const objectiveCount = this.objectives.get(request.objective) ?? 0;
      if (
        this.active >= this.globalLimit() ||
        objectiveCount >= this.objectiveLimit() ||
        this.exclusives.has(request.objective) ||
        (request.exclusive && objectiveCount > 0) ||
        (request.heavy && this.heavyStores.has(request.store)) ||
        request.resources.some((key) => this.resources.has(key))
      ) {
        i++;
        continue;
      }
      this.waiting.splice(i, 1);
      request.cleanup();
      this.active++;
      this.objectives.set(request.objective, objectiveCount + 1);
      if (request.exclusive) this.exclusives.add(request.objective);
      if (request.heavy) this.heavyStores.add(request.store);
      request.resources.forEach((key) => this.resources.add(key));
      let released = false;
      request.resolve(() => {
        if (released) return;
        released = true;
        this.active--;
        const remaining = (this.objectives.get(request.objective) ?? 1) - 1;
        if (remaining) this.objectives.set(request.objective, remaining);
        else this.objectives.delete(request.objective);
        this.exclusives.delete(request.objective);
        if (request.heavy) this.heavyStores.delete(request.store);
        request.resources.forEach((key) => this.resources.delete(key));
        this.pump();
      });
    }
  }
}
