import { createHash } from 'node:crypto';
import { ToolExecutionResult } from './interfaces/tool.interface';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** Turn-local only. No new budgets, automatic writes, or cross-user state. */
export class ToolRecovery {
  private readonly failures = new Map<
    string,
    Map<string, ToolExecutionResult>
  >();
  private readonly corrections = new Map<string, number>();
  private readonly unresolved = new Map<string, ToolExecutionResult>();
  /** Monotonic work counter; successful recovery may clear active tombstones. */
  private correctionAttempts = 0;
  get attempts(): number {
    return this.correctionAttempts;
  }

  private key(args: unknown): string {
    return createHash('sha256').update(canonical(args)).digest('hex');
  }

  beforeCall(tool: string, args: unknown): ToolExecutionResult | null {
    const failures = this.failures.get(tool);
    if (!failures) return null;
    const active = this.unresolved.get(tool);
    const terminal =
      active &&
      [
        'blocked',
        'unknown_effect',
        'pending_confirmation',
        'needs_user_input',
      ].includes(active.status)
        ? active
        : undefined;
    const previous = terminal ?? failures.get(this.key(args));
    if (!previous && !active) return null;
    if (previous || (this.corrections.get(tool) ?? 0) >= 1) {
      const base = previous ?? active!;
      return {
        ...base,
        data: null,
        retryable: false,
        next_action:
          base.next_action ??
          'Comprueba el estado o el dato pendiente antes de continuar.',
      };
    }
    // One changed-argument correction after a recoverable failure, not N
    // guesses at IDs. Identical args never reach the handler twice on failure.
    this.corrections.set(tool, (this.corrections.get(tool) ?? 0) + 1);
    this.correctionAttempts++;
    return null;
  }

  record(tool: string, args: unknown, result: ToolExecutionResult): void {
    if (result.status === 'ok') {
      this.unresolved.delete(tool);
      this.corrections.delete(tool);
      return;
    }
    const failures =
      this.failures.get(tool) ?? new Map<string, ToolExecutionResult>();
    failures.set(this.key(args), result);
    this.failures.set(tool, failures);
    this.unresolved.set(tool, result);
  }
}
