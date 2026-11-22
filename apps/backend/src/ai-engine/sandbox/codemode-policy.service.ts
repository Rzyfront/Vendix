import { ForbiddenException, Injectable } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context.service';
import { safeObjectiveArtifact } from '../tasks/agent-artifact-safety';
import { AIToolRegistry } from '../tools/ai-tool-registry';
import {
  DEFAULT_TOOL_VERSION,
  RegisteredTool,
  ToolExecutionResult,
} from '../tools/interfaces/tool.interface';
import { validateToolArgs } from '../tools/tool-args.validator';
import {
  CodeModeAllowlistEntry,
  codeModeEntryFor,
  codeModeShapeOk,
} from './codemode-allowlist.derive';
import { CODEMODE_ALLOWLIST } from './codemode-allowlist.generated';
import { CODEMODE_LIMITS } from './interfaces/codemode-protocol.interface';
import {
  hashContract,
  SandboxAuthorityScope,
  SandboxPolicyService,
} from './sandbox-policy.service';

const ENTRIES: ReadonlyMap<string, CodeModeAllowlistEntry> = new Map(
  CODEMODE_ALLOWLIST.map((entry) => [entry.name, entry]),
);
const TOOL_NAME = /^[a-z][a-z0-9_]{0,79}$/;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const bytesOf = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf8');

/** Rows a tool result hands to the script: its largest array (or itself). */
function rowCount(data: unknown): number {
  if (Array.isArray(data)) return data.length;
  if (data === null || typeof data !== 'object') return 0;
  return Math.max(
    0,
    ...Object.values(data as Record<string, unknown>).map((value) =>
      Array.isArray(value) ? value.length : 0,
    ),
  );
}

/**
 * F10 (T65) Code Mode policy. Separate from `SandboxPolicyService` (the Deno
 * `list_products` audit, untouched): here the list is the generated, snapshotted
 * `CODEMODE_ALLOWLIST`, and a tool qualifies only while the LIVE definition still
 * matches its entry (read-only, no client/confirmation/irreversible flag, same
 * permissions, version and parameters hash). Authority derivation is NOT
 * re-implemented: it is the base policy's, given this scope.
 */
@Injectable()
export class CodeModePolicyService {
  constructor(
    private readonly registry: AIToolRegistry,
    private readonly base: SandboxPolicyService,
  ) {}

  /** The names a script may ever call, from the release-owned list only. */
  static allowlistedNames(): string[] {
    return [...ENTRIES.keys()];
  }

  /** In the generated list, whatever the live registry says. */
  allowlisted(name: unknown): boolean {
    return typeof name === 'string' && ENTRIES.has(name);
  }

  /** Allowlisted AND the live definition still equals the audited entry. */
  eligible(tool: RegisteredTool | undefined): boolean {
    if (!tool || !this.allowlisted(tool.name) || !codeModeShapeOk(tool))
      return false;
    const entry = ENTRIES.get(tool.name)!;
    const live = codeModeEntryFor(tool);
    return (
      live.domain === entry.domain &&
      (tool.version ?? DEFAULT_TOOL_VERSION) === entry.version &&
      live.permissions.length === entry.permissions.length &&
      live.permissions.every((p, i) => p === entry.permissions[i]) &&
      hashContract(tool.parameters) === entry.parameters_hash
    );
  }

  /** Plain JSON object within the args cap, valid for the tool's own schema. */
  assertArgs(name: string, args: unknown): asserts args is Record<string, unknown> {
    const tool = this.registry.get(name);
    if (
      !TOOL_NAME.test(name) ||
      !this.eligible(tool) ||
      !isPlainObject(args) ||
      !this.plainJson(args) ||
      bytesOf(args) > CODEMODE_LIMITS.args_bytes
    )
      this.deny();
    if (!validateToolArgs(name, tool!.parameters, args).ok) this.deny();
  }

  /**
   * Redacts secrets (same artifact filter as the Deno path) and bounds the
   * result: more rows than the cap, or a payload past the journal budget (2 MiB), is
   * reported as a recoverable error instead of reaching the script.
   */
  filterResult(name: string, result: ToolExecutionResult): ToolExecutionResult {
    if (
      !this.eligible(this.registry.get(name)) ||
      !isPlainObject(result) ||
      !this.plainJson(result)
    )
      this.deny();
    const clean = safeObjectiveArtifact(result) as ToolExecutionResult;
    if (clean.status !== 'ok') return { ...clean, data: null };
    if (
      rowCount(clean.data) > CODEMODE_LIMITS.rows ||
      bytesOf(clean.data) > CODEMODE_LIMITS.journal_bytes
    )
      return {
        ...clean,
        status: 'recoverable_error',
        error_code: 'CODEMODE_RESULT_TOO_LARGE',
        retryable: false,
        next_action: 'Filtra o pagina la consulta para traer menos datos.',
        data: null,
      };
    return clean;
  }

  /** Same authority derivation as the Deno policy, scoped to this allowlist. */
  authorize<T>(
    snapshot: RequestContext,
    agentKey: string,
    initialNames: string[],
    objectivePermissions: string[],
    callback: (context: RequestContext, names: string[]) => Promise<T>,
  ): Promise<T> {
    const scope: SandboxAuthorityScope = {
      allowedName: (name) => this.allowlisted(name),
      eligible: (tool) => this.eligible(tool),
    };
    return this.base.authorize(
      snapshot,
      agentKey,
      initialNames,
      objectivePermissions,
      callback,
      scope,
    );
  }

  /** JSON transport cannot carry accessors, prototypes, cycles or non-finite values. */
  private plainJson(value: unknown, depth = 0, seen = new Set<object>()): boolean {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
      return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'object' || depth > 16 || seen.has(value)) return false;
    if (!Array.isArray(value) && !isPlainObject(value)) return false;
    seen.add(value);
    try {
      if (Object.getOwnPropertySymbols(value).length) return false;
      for (const key of Object.getOwnPropertyNames(value)) {
        if (Array.isArray(value) && key === 'length') continue;
        if (['__proto__', 'prototype', 'constructor'].includes(key)) return false;
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (
          !('value' in descriptor) ||
          !descriptor.enumerable ||
          !this.plainJson(descriptor.value, depth + 1, seen)
        )
          return false;
      }
      return true;
    } finally {
      seen.delete(value);
    }
  }

  private deny(): never {
    throw new ForbiddenException('SANDBOX_DENIED');
  }
}
