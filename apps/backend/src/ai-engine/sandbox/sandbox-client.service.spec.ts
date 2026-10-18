import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { SandboxClientService } from './sandbox-client.service';
import {
  SANDBOX_LIMITS,
  SandboxStart,
} from './interfaces/sandbox-protocol.interface';

jest.mock('node:child_process', () => ({ spawn: jest.fn() }));
const originalPlatform = process.platform;
const keys = [
  'AI_SANDBOX_SUPERVISOR',
  'AI_SANDBOX_SUPERVISOR_CONFIG',
  'AI_SANDBOX_RUNTIME_DIGEST',
  'AI_SANDBOX_POLICY_DIGEST',
  'AI_SANDBOX_SECURITY_REVIEWED',
];
const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));

describe('SandboxClientService: fixed supervisor-only transport', () => {
  let child: any;
  let service: SandboxClientService;
  let start: SandboxStart;
  const emit = (value: unknown) =>
    child.stdout.write(`${JSON.stringify(value)}\n`);
  const ready = () =>
    emit({
      type: 'ready',
      execution_id: start.execution_id,
      nonce: start.nonce,
      policy_digest: start.policy_digest,
      runtime_digest: start.runtime_digest,
      isolation: 'gvisor',
    });
  const result = (value: unknown = { done: true }) => {
    emit({
      type: 'result',
      execution_id: start.execution_id,
      nonce: start.nonce,
      value,
    });
    child.emit('close', 0);
  };

  beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(process, 'platform', { value: 'linux' });
    Object.assign(process.env, {
      AI_SANDBOX_SUPERVISOR: '/opt/agent-sandbox/supervisor.py',
      AI_SANDBOX_SUPERVISOR_CONFIG: '/etc/agent-sandbox.json',
      AI_SANDBOX_SECURITY_REVIEWED: 'true',
      AI_SANDBOX_RUNTIME_DIGEST: `sha256:${'b'.repeat(64)}`,
      AI_SANDBOX_POLICY_DIGEST: `sha256:${'a'.repeat(64)}`,
    });
    child = new EventEmitter();
    Object.assign(child, {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: jest.fn(() => true),
    });
    jest.mocked(spawn).mockReturnValue(child);
    service = new SandboxClientService();
    start = {
      type: 'start',
      execution_id: 'synthetic-exec',
      nonce: 'synthetic-capability',
      source: 'return {}',
      language: 'javascript',
      tools: ['list_products'],
      limits: { ...SANDBOX_LIMITS },
      ...service.configuration()!,
    };
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    for (const key of keys)
      saved[key] === undefined
        ? delete process.env[key]
        : (process.env[key] = saved[key]);
  });

  it('never spawns Deno directly, a shell, or with backend secrets', async () => {
    const pending = service.run(start, jest.fn(), new AbortController().signal);
    ready();
    result();
    await expect(pending).resolves.toEqual({ done: true });
    expect(spawn).toHaveBeenCalledWith(
      '/opt/agent-sandbox/supervisor.py',
      ['--config', '/etc/agent-sandbox.json'],
      {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: '/usr/bin:/bin' },
      },
    );
    expect(child.kill).not.toHaveBeenCalled();
  });
  it.each(['darwin', 'win32'])(
    'degrades unavailable on %s, even if Deno might be installed',
    async (platform) => {
      Object.defineProperty(process, 'platform', { value: platform });
      expect(service.configuration()).toBeNull();
      await expect(
        service.run(start, jest.fn(), new AbortController().signal),
      ).rejects.toMatchObject({ code: 'SANDBOX_UNAVAILABLE' });
      expect(spawn).not.toHaveBeenCalled();
    },
  );
  it.each(keys)(
    'requires operator-supplied immutable reviewed configuration: %s',
    (key) => {
      delete process.env[key];
      expect(service.configuration()).toBeNull();
    },
  );
  it.each([
    { type: 'ready', isolation: 'docker' },
    { type: 'ready', runtime_digest: 'wrong' },
    { type: 'ready', policy_digest: 'wrong' },
    { type: 'ready', nonce: 'foreign' },
    { type: 'call' },
    { type: 'result', value: {} },
  ])(
    'rejects any result/RPC before verified gvisor ready: %j',
    async (patch) => {
      const pending = service.run(
        start,
        jest.fn(),
        new AbortController().signal,
      );
      emit({
        type: 'ready',
        execution_id: start.execution_id,
        nonce: start.nonce,
        isolation: 'gvisor',
        ...service.configuration(),
        ...patch,
      });
      await expect(pending).rejects.toMatchObject({ code: 'SANDBOX_PROTOCOL' });
    },
  );
  it('parses multi-byte UTF8 frames split across transport chunks', async () => {
    const pending = service.run(start, jest.fn(), new AbortController().signal);
    ready();
    const data = Buffer.from(
      JSON.stringify({
        type: 'result',
        execution_id: start.execution_id,
        nonce: start.nonce,
        value: 'café',
      }) + '\n',
    );
    const at = data.indexOf(Buffer.from('é')) + 1;
    child.stdout.write(data.subarray(0, at));
    child.stdout.write(data.subarray(at));
    child.emit('close', 0);
    await expect(pending).resolves.toBe('café');
  });
  it('enforces watchdog and fences late results/RPC after cancellation', async () => {
    const controller = new AbortController();
    const call = jest.fn();
    const pending = service.run(start, call, controller.signal);
    ready();
    controller.abort();
    result();
    await expect(pending).rejects.toMatchObject({ code: 'SANDBOX_EXPIRED' });
    expect(call).not.toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    jest.advanceTimersByTime(1500);
    expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');
  });
  it('times out even when supervisor never becomes ready', async () => {
    const pending = service.run(start, jest.fn(), new AbortController().signal);
    jest.advanceTimersByTime(30000);
    await expect(pending).rejects.toMatchObject({ code: 'SANDBOX_EXPIRED' });
  });
  it('rejects stdout floods and never logs stderr payload', async () => {
    const pending = service.run(start, jest.fn(), new AbortController().signal);
    ready();
    child.stderr.write('private'.repeat(10000));
    await expect(pending).rejects.toMatchObject({ code: 'SANDBOX_LIMIT' });
  });
  it('kills malformed frames, foreign nonce, and unexpected EOF', async () => {
    const pending = service.run(start, jest.fn(), new AbortController().signal);
    ready();
    emit({
      type: 'result',
      execution_id: 'other',
      nonce: start.nonce,
      value: {},
    });
    await expect(pending).rejects.toMatchObject({ code: 'SANDBOX_PROTOCOL' });
  });
  it('does not emit a late RPC reply after cancellation', async () => {
    let release: (value: unknown) => void = () => {};
    const call = jest.fn(
      () =>
        new Promise<any>((resolve) => {
          release = resolve;
        }),
    );
    const c = new AbortController();
    const pending = service.run(start, call, c.signal);
    ready();
    emit({
      type: 'call',
      execution_id: start.execution_id,
      nonce: start.nonce,
      seq: 1,
      tool: 'list_products',
      args: {},
    });
    c.abort();
    release({ result: 'late' });
    await expect(pending).rejects.toMatchObject({ code: 'SANDBOX_EXPIRED' });
    expect(child.stdin.read()?.toString()).not.toContain('late');
  });
  it('does not claim success until supervisor cleanup exits zero', async () => {
    const pending = service.run(start, jest.fn(), new AbortController().signal);
    ready();
    emit({
      type: 'result',
      execution_id: start.execution_id,
      nonce: start.nonce,
      value: {},
    });
    child.emit('close', 1);
    await expect(pending).rejects.toMatchObject({
      code: 'SANDBOX_UNAVAILABLE',
    });
    expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');
  });
  it('fails closed on missing cleanup acknowledgement without killing the watchdog', async () => {
    const pending = service.run(start, jest.fn(), new AbortController().signal);
    ready();
    emit({
      type: 'result',
      execution_id: start.execution_id,
      nonce: start.nonce,
      value: {},
    });
    jest.advanceTimersByTime(10000);
    await expect(pending).rejects.toMatchObject({
      code: 'SANDBOX_UNAVAILABLE',
    });
    expect(child.kill).not.toHaveBeenCalled();
  });
});
