import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import {
  SandboxError,
  SandboxStart,
  SandboxCall,
  SandboxReply,
} from './interfaces/sandbox-protocol.interface';

/** Trusted supervisor only. NEVER runs Deno/JS/Node vm inside the API process. */
@Injectable()
export class SandboxClientService {
  configuration(): { policy_digest: string; runtime_digest: string } | null {
    const policy = process.env.AI_SANDBOX_POLICY_DIGEST ?? '';
    const runtime = process.env.AI_SANDBOX_RUNTIME_DIGEST ?? '';
    const executable = process.env.AI_SANDBOX_SUPERVISOR ?? '';
    const config = process.env.AI_SANDBOX_SUPERVISOR_CONFIG ?? '';
    if (
      process.platform !== 'linux' ||
      !isAbsolute(executable) ||
      !isAbsolute(config) ||
      !/^sha256:[a-f0-9]{64}$/.test(policy) ||
      !/^sha256:[a-f0-9]{64}$/.test(runtime) ||
      process.env.AI_SANDBOX_SECURITY_REVIEWED !== 'true'
    )
      return null;
    return { policy_digest: policy, runtime_digest: runtime };
  }

  async run(
    start: SandboxStart,
    onCall: (frame: SandboxCall) => Promise<SandboxReply>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const configured = this.configuration();
    if (
      !configured ||
      configured.policy_digest !== start.policy_digest ||
      configured.runtime_digest !== start.runtime_digest
    )
      throw new SandboxError('SANDBOX_UNAVAILABLE');
    if (signal.aborted) throw new SandboxError('SANDBOX_EXPIRED');
    return new Promise((resolve, reject) => {
      const child = spawn(
        process.env.AI_SANDBOX_SUPERVISOR!,
        ['--config', process.env.AI_SANDBOX_SUPERVISOR_CONFIG!],
        {
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { PATH: '/usr/bin:/bin' },
        },
      );
      let stopped = false;
      let ready = false;
      let buffer = Buffer.alloc(0);
      let received = 0;
      let stderrBytes = 0;
      // Guest output is bounded in aggregate, not merely per JSON line.
      const transportBudget = start.limits.output_bytes + 128 * 1024;
      const send = (frame: unknown) => {
        if (stopped || signal.aborted || child.stdin.destroyed) return;
        child.stdin.write(`${JSON.stringify(frame)}\n`);
      };
      const finish = (error?: SandboxError, value?: unknown) => {
        if (stopped) return;
        stopped = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        // EOF/SIGTERM lets supervisor synchronously destroy the whole capsule.
        child.stdin.end();
        if (error) child.kill('SIGTERM');
        // NEVER kill the trusted supervisor while its cgroup.kill/rm cleanup is
        // running. It has bounded Docker subprocesses and owns capsule teardown.
        // On success wait for cleanup/exit; failed cleanup cannot yield success.
        if (error) reject(error);
        else {
          const cleanup = setTimeout(
            () => reject(new SandboxError('SANDBOX_UNAVAILABLE')),
            10_000,
          );
          cleanup.unref();
          child.once('close', (code) => {
            clearTimeout(cleanup);
            code === 0
              ? resolve(value)
              : reject(new SandboxError('SANDBOX_UNAVAILABLE'));
          });
        }
      };
      const abort = () => finish(new SandboxError('SANDBOX_EXPIRED'));
      const timer = setTimeout(abort, start.limits.wall_ms);
      signal.addEventListener('abort', abort, { once: true });
      child.on('error', () => finish(new SandboxError('SANDBOX_UNAVAILABLE')));
      child.stdin.on('error', () =>
        finish(new SandboxError('SANDBOX_PROTOCOL')),
      );
      child.on('close', () => {
        if (!stopped) finish(new SandboxError('SANDBOX_PROTOCOL'));
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length; // Never log guest/supervisor stderr, even on failure.
        if (stderrBytes > start.limits.output_bytes)
          finish(new SandboxError('SANDBOX_LIMIT'));
      });
      child.stdout.on('data', (chunk: Buffer) => {
        if (stopped) return;
        received += chunk.length;
        if (received > transportBudget)
          return finish(new SandboxError('SANDBOX_LIMIT'));
        buffer = Buffer.concat([buffer, chunk]);
        let newline: number;
        while (!stopped && (newline = buffer.indexOf(10)) >= 0) {
          const line = buffer.subarray(0, newline);
          buffer = buffer.subarray(newline + 1);
          let frame: Record<string, unknown>;
          try {
            frame = JSON.parse(line.toString('utf8'));
          } catch {
            return finish(new SandboxError('SANDBOX_PROTOCOL'));
          }
          if (
            !frame ||
            typeof frame !== 'object' ||
            Array.isArray(frame) ||
            frame.execution_id !== start.execution_id ||
            frame.nonce !== start.nonce
          )
            return finish(new SandboxError('SANDBOX_PROTOCOL'));
          if (!ready) {
            if (
              frame.type !== 'ready' ||
              frame.isolation !== 'gvisor' ||
              frame.runtime_digest !== start.runtime_digest ||
              frame.policy_digest !== start.policy_digest
            )
              return finish(new SandboxError('SANDBOX_PROTOCOL'));
            ready = true;
          } else if (frame.type === 'call') {
            void onCall(frame as unknown as SandboxCall).then(
              (reply) => send(reply),
              () => finish(new SandboxError('SANDBOX_DENIED')),
            );
          } else if (frame.type === 'result') {
            if (
              Buffer.byteLength(JSON.stringify(frame.value) ?? '') >
              start.limits.output_bytes
            )
              return finish(new SandboxError('SANDBOX_LIMIT'));
            finish(undefined, frame.value);
          } else return finish(new SandboxError('SANDBOX_PROTOCOL'));
        }
      });
      send(start);
    });
  }
}
