import type { ToolExecutionResult } from '../../tools/interfaces/tool.interface';

export const sandboxEnabled = (): boolean =>
  process.env.AI_SANDBOX_ENABLED === 'true';

/** Operator canary opt-in, empty by default. Never a tenant id supplied by guest. */
export function sandboxStoreEnabled(storeId: number | undefined): boolean {
  const raw = process.env.AI_SANDBOX_STORE_IDS ?? '';
  const ids = raw.split(',').map((id) => id.trim());
  if (
    !storeId ||
    !raw ||
    ids.length > 100 ||
    ids.some(
      (id) => !/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id)),
    )
  )
    return false;
  return ids.includes(String(storeId));
}

export interface SandboxLimits {
  wall_ms: number;
  cpu_ms: number;
  memory_mb: number;
  calls: number;
  concurrency: number;
  pages: number;
  rows: number;
  input_bytes: number;
  output_bytes: number;
  source_bytes: number;
}
export const SANDBOX_LIMITS: Readonly<SandboxLimits> = Object.freeze({
  wall_ms: 30_000,
  cpu_ms: 2_000,
  memory_mb: 256,
  calls: 20,
  concurrency: 3,
  pages: 10,
  rows: 5_000,
  input_bytes: 2 * 1024 * 1024,
  output_bytes: 64 * 1024,
  source_bytes: 32 * 1024,
});
export interface SandboxStart {
  type: 'start';
  execution_id: string;
  nonce: string;
  source: string;
  language: 'javascript' | 'typescript';
  tools: string[];
  limits: SandboxLimits;
  policy_digest: string;
  runtime_digest: string;
}
export interface SandboxCall {
  type: 'call';
  execution_id: string;
  nonce: string;
  seq: number;
  tool: string;
  args: Record<string, unknown>;
}
export type SandboxReply = {
  type: 'reply';
  execution_id: string;
  nonce: string;
  seq: number;
} & ({ result: ToolExecutionResult } | { error: string });

export class SandboxError extends Error {
  constructor(
    readonly code:
      | 'SANDBOX_DENIED'
      | 'SANDBOX_LIMIT'
      | 'SANDBOX_PROTOCOL'
      | 'SANDBOX_EXPIRED'
      | 'SANDBOX_UNAVAILABLE',
  ) {
    super(code);
  }
}
