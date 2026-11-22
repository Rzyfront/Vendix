// Offline tests for the Code Mode executor (protocol vendix.codemode/v1):
// `node --test infra/agent-sandbox/js/handler.test.cjs`. No AWS, no network.
// The handler really spawns the QuickJS runner, so these are light integration
// tests of the whole Lambda body (handler.cjs -> runner.cjs -> WASM).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'codemode-tmp-'));
const DIGEST = 'sha256:' + 'a'.repeat(64);
process.env.CODEMODE_RUNTIME_DIGEST = DIGEST;
process.env.CODEMODE_TMP_ROOT = SCRATCH;

const handlerModule = require('./handler.cjs');
const runner = require('./runner.cjs');
const { handler } = handlerModule;

test.after(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));

// Mirror of CODEMODE_LIMITS in the TS contract (apps/backend/.../codemode-protocol.interface.ts).
const LIMITS = {
  wall_ms: 30000, round_cpu_ms: 2000, memory_mb: 256, calls: 20, rounds: 6,
  pending_per_round: 8, manifest_tools: 20, rows: 5000, source_bytes: 32768,
  journal_bytes: 2 * 1024 * 1024, args_bytes: 16384, result_bytes: 8192,
  log_bytes: 2048, output_bytes: 65536, blocks: 5,
};
const NONCE = 'b'.repeat(64);
const SEED = 'c'.repeat(64);

function request(over = {}) {
  return {
    protocol: 'vendix.codemode/v1', execution_id: 'exec-1', nonce: NONCE, round: 1,
    language: 'javascript', source: 'return 1;', manifest: [], journal: [],
    clock_ms: 1760000000000, seed: SEED, limits: { ...LIMITS }, ...over,
  };
}

/** Plays the host: runs rounds, executing pending calls with `tools`. */
async function drive(source, manifest, toolImpl = {}, over = {}) {
  const journal = [];
  const responses = [];
  for (let round = 1; round <= LIMITS.rounds; round += 1) {
    const res = await handler(request({ source, manifest, journal: journal.map((e) => ({ ...e })), round, ...over }));
    responses.push(res);
    if (res.status !== 'pending') return { res, responses, journal };
    for (const call of res.pending) {
      let outcome;
      try {
        outcome = { ok: true, value: await toolImpl[call.tool](call.args) };
      } catch (e) {
        outcome = { ok: false, error: String(e.message) };
      }
      journal.push({ seq: call.seq, tool: call.tool, args_hash: runner.codeModeArgsHash(call.args), outcome });
    }
  }
  throw new Error('too many rounds');
}

test('hash vectors match the TS contract (canonical JSON + sha256)', () => {
  const vectors = [
    {
      args: { b: 1, a: [{ d: 2, c: 'x' }], ñ: 'é' },
      canonical: '{"a":[{"c":"x","d":2}],"b":1,"ñ":"é"}',
      sha256: '8eb4d2289bb29772b51463f3c628b3c74ccb6ab372535e311d7bbd6b06c02497',
    },
    {
      args: {}, canonical: '{}',
      sha256: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
    },
  ];
  for (const v of vectors) {
    assert.strictEqual(runner.codeModeCanonicalJson(v.args), v.canonical);
    assert.strictEqual(runner.codeModeArgsHash(v.args), v.sha256);
  }
  assert.throws(() => runner.codeModeCanonicalJson({ a: NaN }));
  assert.throws(() => runner.codeModeCanonicalJson({ a: undefined }));
  // Drift guard: the vectors must still be the ones written in the TS contract.
  const ts = fs.readFileSync(
    path.join(__dirname, '../../../apps/backend/src/ai-engine/sandbox/interfaces/codemode-protocol.interface.ts'),
    'utf8',
  );
  for (const v of vectors) {
    assert.ok(ts.includes(v.sha256), 'contract vector changed: ' + v.sha256);
    assert.ok(ts.includes(v.canonical), 'contract vector changed: ' + v.canonical);
  }
});

test('limits mirror the TS contract', () => {
  assert.deepStrictEqual(handlerModule.HARD_LIMITS, LIMITS);
});

test('two sequential Promise.all stages finish in exactly 3 rounds using the journal', async () => {
  const source = `
    const [orders, products] = await Promise.all([tools.list_orders({ page: 1 }), tools.list_products({ page: 1 })]);
    const [a, b] = await Promise.all([tools.get_order({ id: orders.ids[0] }), tools.get_product({ id: products.ids[0] })]);
    return { total: a.total + b.price };`;
  const seen = [];
  const { res, responses, journal } = await drive(
    source, ['list_orders', 'list_products', 'get_order', 'get_product'],
    {
      list_orders: async () => { seen.push('list_orders'); return { ids: [7] }; },
      list_products: async () => { seen.push('list_products'); return { ids: [9] }; },
      get_order: async (args) => { seen.push('get_order'); return { total: args.id * 10 }; },
      get_product: async (args) => { seen.push('get_product'); return { price: args.id }; },
    },
  );
  assert.strictEqual(responses.length, 3);
  assert.deepStrictEqual(responses.map((r) => r.status), ['pending', 'pending', 'completed']);
  assert.deepStrictEqual(responses[0].pending.map((p) => [p.seq, p.tool]), [[1, 'list_orders'], [2, 'list_products']]);
  assert.deepStrictEqual(responses[1].pending.map((p) => [p.seq, p.tool, p.args]), [[3, 'get_order', { id: 7 }], [4, 'get_product', { id: 9 }]]);
  assert.deepStrictEqual(res.result, { total: 79 });
  assert.strictEqual(journal.length, 4);
  assert.deepStrictEqual(seen.sort(), ['get_order', 'get_product', 'list_orders', 'list_products']);
});

test('echoes protocol, execution_id, nonce, round and runtime_digest; exact keys; no journal ever', async () => {
  const done = await handler(request({ source: 'console.log("hi"); return { a: 1 };', round: 2 }));
  assert.deepStrictEqual(Object.keys(done).sort(), ['blocks', 'execution_id', 'logs', 'nonce', 'protocol', 'result', 'round', 'runtime_digest', 'status', 'usage'].sort());
  assert.strictEqual(done.protocol, 'vendix.codemode/v1');
  assert.strictEqual(done.execution_id, 'exec-1');
  assert.strictEqual(done.nonce, NONCE);
  assert.strictEqual(done.round, 2);
  assert.strictEqual(done.runtime_digest, DIGEST);
  assert.deepStrictEqual(done.logs, ['hi']);
  assert.deepStrictEqual(done.blocks, []);

  const pending = await handler(request({ source: 'await tools.a({});', manifest: ['a'] }));
  assert.deepStrictEqual(Object.keys(pending).sort(), ['execution_id', 'nonce', 'pending', 'protocol', 'round', 'runtime_digest', 'status', 'usage']);

  const err = await handler(request({ source: 'throw new Error("x")' }));
  assert.deepStrictEqual(Object.keys(err).sort(), ['error_code', 'error_message', 'execution_id', 'nonce', 'protocol', 'round', 'runtime_digest', 'status', 'usage']);
  for (const res of [done, pending, err]) {
    assert.ok(!('journal' in res));
    assert.ok(!JSON.stringify(res).includes('"journal"'));
  }
});

test('a tool outside the manifest does not exist on `tools` and fails inside the Lambda', async () => {
  const res = await handler(request({
    source: 'return { present: typeof tools.allowed, absent: typeof tools.secret_tool, keys: Object.keys(tools), frozen: Object.isFrozen(tools) };',
    manifest: ['allowed'],
  }));
  assert.strictEqual(res.status, 'completed');
  assert.deepStrictEqual(res.result, { present: 'function', absent: 'undefined', keys: ['allowed'], frozen: true });

  const bad = await handler(request({ source: 'await tools.secret_tool({ id: 1 }); return 1;', manifest: ['allowed'] }));
  assert.strictEqual(bad.status, 'error');
  assert.strictEqual(bad.error_code, 'CODEMODE_RUNTIME');
  assert.ok(!('pending' in bad));
});

test('fetch, require, process, timers and the file system do not exist', async () => {
  const res = await handler(request({
    source: `
      const names = ['fetch', 'require', 'process', 'module', 'exports', 'Buffer', 'setTimeout', 'setInterval', 'setImmediate',
        'XMLHttpRequest', 'WebSocket', 'fs', 'os', 'std', 'print', 'queueMicrotask', 'globalThis.__vx_call'];
      const out = {};
      for (const n of names) out[n] = typeof globalThis[n];
      out.own = Object.getOwnPropertyNames(globalThis).filter((k) => k.startsWith('__'));
      return out;`,
  }));
  assert.strictEqual(res.status, 'completed');
  for (const [name, type] of Object.entries(res.result)) {
    if (name === 'own') assert.deepStrictEqual(type, [], 'no host bridge left on globalThis');
    else assert.strictEqual(type, 'undefined', name);
  }
  for (const src of [
    'return require("fs").readFileSync("/etc/passwd", "utf8");',
    'return process.env;',
    'return await fetch("http://169.254.169.254/");',
    'const m = await import("fs"); return typeof m.readFileSync;',
    'return (function () { return typeof this.process; }).call(undefined) + typeof new Function("return process")();',
  ]) {
    const r = await handler(request({ source: src }));
    if (r.status === 'completed') assert.match(String(r.result), /^(undefined)+$/, src);
    else assert.strictEqual(r.error_code, 'CODEMODE_RUNTIME', src);
  }
});

test('an infinite loop is cut by the CPU interrupt (CODEMODE_TIMEOUT)', async () => {
  const started = Date.now();
  for (const source of ['while (true) {}', 'for (;;) { await null; }']) {
    const res = await handler(request({ source, limits: { ...LIMITS, round_cpu_ms: 300 } }));
    assert.strictEqual(res.status, 'error');
    assert.strictEqual(res.error_code, 'CODEMODE_TIMEOUT');
  }
  assert.ok(Date.now() - started < 15000);
});

test('a memory bomb is stopped by the interpreter heap limit (CODEMODE_MEMORY)', async () => {
  const res = await handler(request({
    source: 'const keep = []; while (true) { keep.push("x".repeat(1024 * 1024) + keep.length); }',
    limits: { ...LIMITS, memory_mb: 32 },
  }));
  assert.strictEqual(res.status, 'error');
  assert.strictEqual(res.error_code, 'CODEMODE_MEMORY');
});

test('syntax errors are CODEMODE_SYNTAX; thrown errors are CODEMODE_RUNTIME with a bounded message', async () => {
  const syntax = await handler(request({ source: 'return (' }));
  assert.strictEqual(syntax.error_code, 'CODEMODE_SYNTAX');
  const thrown = await handler(request({ source: 'throw new TypeError("boom " + "x".repeat(2000));' }));
  assert.strictEqual(thrown.error_code, 'CODEMODE_RUNTIME');
  assert.ok(thrown.error_message.startsWith('TypeError: boom'));
  assert.ok(thrown.error_message.length <= 500);
  const circular = await handler(request({ source: 'const a = {}; a.a = a; return a;' }));
  assert.strictEqual(circular.error_code, 'CODEMODE_RUNTIME');
});

test('a journal entry with another tool or args hash is CODEMODE_REPLAY_DIVERGENCE', async () => {
  const entry = (tool, args) => ({ seq: 1, tool, args_hash: runner.codeModeArgsHash(args), outcome: { ok: true, value: 1 } });
  const manifest = ['a', 'b'];
  const sameTool = await handler(request({ source: 'await tools.a({ x: 2 });', manifest, journal: [entry('a', { x: 1 })] }));
  assert.strictEqual(sameTool.error_code, 'CODEMODE_REPLAY_DIVERGENCE');
  const otherTool = await handler(request({ source: 'await tools.b({ x: 1 });', manifest, journal: [entry('a', { x: 1 })] }));
  assert.strictEqual(otherTool.error_code, 'CODEMODE_REPLAY_DIVERGENCE');
  const ok = await handler(request({ source: 'return await tools.a({ x: 1 });', manifest, journal: [entry('a', { x: 1 })] }));
  assert.deepStrictEqual([ok.status, ok.result], ['completed', 1]);
  // Divergence cannot be hidden by the script.
  const swallowed = await handler(request({
    source: 'try { await Promise.race([tools.a({ x: 2 }), Promise.resolve(0)]); } catch (e) {} return "fine";',
    manifest, journal: [entry('a', { x: 1 })],
  }));
  assert.strictEqual(swallowed.error_code, 'CODEMODE_REPLAY_DIVERGENCE');
});

test('a journaled failure rejects the call with an Error carrying the journaled text', async () => {
  const res = await handler(request({
    source: 'try { await tools.a({}); return "no"; } catch (e) { return [e instanceof Error, e.message]; }',
    manifest: ['a'],
    journal: [{ seq: 1, tool: 'a', args_hash: runner.codeModeArgsHash({}), outcome: { ok: false, error: 'denied by policy' } }],
  }));
  assert.deepStrictEqual(res.result, [true, 'denied by policy']);
});

test('a script that cannot progress is CODEMODE_STALLED', async () => {
  const res = await handler(request({ source: 'await new Promise(() => {}); return 1;' }));
  assert.strictEqual(res.status, 'error');
  assert.strictEqual(res.error_code, 'CODEMODE_STALLED');
});

test('more than pending_per_round calls returns the 8 lowest seq; the rest re-issue next round', async () => {
  const source = 'const r = await Promise.all(Array.from({ length: 12 }, (_, i) => tools.t({ i }))); return r.length;';
  const first = await handler(request({ source, manifest: ['t'] }));
  assert.strictEqual(first.status, 'pending');
  assert.deepStrictEqual(first.pending.map((p) => p.seq), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepStrictEqual(first.pending.map((p) => p.args.i), [0, 1, 2, 3, 4, 5, 6, 7]);
  const journal = first.pending.map((p) => ({ seq: p.seq, tool: 't', args_hash: runner.codeModeArgsHash(p.args), outcome: { ok: true, value: p.args.i } }));
  const second = await handler(request({ source, manifest: ['t'], journal, round: 2 }));
  assert.deepStrictEqual(second.pending.map((p) => p.seq), [9, 10, 11, 12]);
});

test('calls beyond limits.calls fail with CODEMODE_LIMIT', async () => {
  const res = await handler(request({
    source: 'await Promise.all(Array.from({ length: 21 }, (_, i) => tools.t({ i })));', manifest: ['t'],
  }));
  assert.strictEqual(res.error_code, 'CODEMODE_LIMIT');
});

test('Date is frozen at clock_ms and Math.random is seeded: identical across rounds and runs', async () => {
  const source = `
    console.log(JSON.stringify([Date.now(), new Date().getTime(), new Date().toISOString(), Math.random(), Math.random()]));
    await tools.t({});
    return [Date.now(), new Date(2020, 0, 1).getFullYear(), new Date() instanceof Date, Math.random()];`;
  const run = (seed, clock) => drive(source, ['t'], { t: async () => 1 }, { seed, clock_ms: clock });
  const a = await run(SEED, 1760000000000);
  const [r1, r2] = a.responses;
  assert.strictEqual(r1.logs[0], r2.logs[0], 'same logs each round');
  const [now, now2, iso] = JSON.parse(r1.logs[0]);
  assert.strictEqual(now, 1760000000000);
  assert.strictEqual(now2, 1760000000000);
  assert.strictEqual(iso, new Date(1760000000000).toISOString());
  const b = await run(SEED, 1760000000000);
  assert.deepStrictEqual(b.res.result, a.res.result);
  assert.strictEqual(a.res.result[0], 1760000000000);
  assert.strictEqual(a.res.result[1], 2020);
  assert.strictEqual(a.res.result[2], true);
  const c = await run('d'.repeat(64), 1760000000000);
  assert.notStrictEqual(c.responses[0].logs[0], r1.logs[0], 'another seed gives another sequence');
  // The real clock and the real Date are not reachable.
  const probe = await handler(request({
    source: 'const D = Object.getPrototypeOf(new Date()).constructor; return [D === Date, D.now(), Object.getPrototypeOf(Date) === Function.prototype];',
  }));
  assert.deepStrictEqual(probe.result, [true, 1760000000000, true]);
});

test('vex.block queues blocks (<= limits.blocks) returned only on completion; console is bounded', async () => {
  const ok = await handler(request({ source: 'vex.block({ type: "kpi", n: 1 }); vex.block({ type: "x" }); return null;' }));
  assert.deepStrictEqual(ok.blocks, [{ type: 'kpi', n: 1 }, { type: 'x' }]);
  assert.strictEqual(ok.result, null);
  const over = await handler(request({ source: 'for (let i = 0; i < 6; i += 1) vex.block({ i }); return 1;' }));
  assert.strictEqual(over.error_code, 'CODEMODE_LIMIT');
  const logs = await handler(request({ source: 'for (let i = 0; i < 200; i += 1) console.log("line " + i + " ".repeat(40)); console.warn({ a: 1 }); return 1;' }));
  assert.strictEqual(logs.status, 'completed');
  const bytes = logs.logs.reduce((n, l) => n + Buffer.byteLength(l), 0);
  assert.ok(bytes <= LIMITS.log_bytes + 64, 'logs bounded, got ' + bytes);
  assert.ok(logs.logs.some((l) => /truncated/.test(l)));
});

test('invalid requests are CODEMODE_INPUT (strict, any deviation)', async () => {
  const cases = {
    protocol: request({ protocol: 'vendix.codemode/v2' }),
    unknown_key: { ...request(), extra: 1 },
    nonce: request({ nonce: 'xyz' }),
    execution_id: request({ execution_id: '' }),
    language: request({ language: 'python' }),
    round: request({ round: 0 }),
    source_empty: request({ source: '   ' }),
    source_big: request({ source: 'a'.repeat(LIMITS.source_bytes + 1) }),
    source_nul: request({ source: 'return 1;\u0000' }),
    manifest_dup: request({ manifest: ['a', 'a'] }),
    manifest_name: request({ manifest: ['__proto__'] }),
    manifest_big: request({ manifest: Array.from({ length: 21 }, (_, i) => 't' + i) }),
    journal_gap: request({ manifest: ['a'], journal: [{ seq: 2, tool: 'a', args_hash: 'a'.repeat(64), outcome: { ok: true, value: 1 } }] }),
    journal_tool: request({ manifest: ['a'], journal: [{ seq: 1, tool: 'zzz', args_hash: 'a'.repeat(64), outcome: { ok: true, value: 1 } }] }),
    journal_hash: request({ manifest: ['a'], journal: [{ seq: 1, tool: 'a', args_hash: 'nope', outcome: { ok: true, value: 1 } }] }),
    journal_outcome: request({ manifest: ['a'], journal: [{ seq: 1, tool: 'a', args_hash: 'a'.repeat(64), outcome: { ok: true } }] }),
    journal_extra: request({ manifest: ['a'], journal: [{ seq: 1, tool: 'a', args_hash: 'a'.repeat(64), outcome: { ok: true, value: 1 }, x: 1 }] }),
    journal_error_long: request({ manifest: ['a'], journal: [{ seq: 1, tool: 'a', args_hash: 'a'.repeat(64), outcome: { ok: false, error: 'e'.repeat(301) } }] }),
    clock: request({ clock_ms: -1 }),
    seed: request({ seed: 'abc' }),
    limits_missing: request({ limits: { wall_ms: 1000 } }),
    limits_bad: request({ limits: { ...LIMITS, calls: 0 } }),
    limits_extra: request({ limits: { ...LIMITS, nope: 1 } }),
    not_object: 'hello',
    null_event: null,
  };
  for (const [name, event] of Object.entries(cases)) {
    const res = await handler(event);
    assert.strictEqual(res.status, 'error', name);
    assert.strictEqual(res.error_code, 'CODEMODE_INPUT', name);
    assert.ok(res.error_message.length <= 500, name);
    assert.strictEqual(res.runtime_digest, DIGEST, name);
  }
  const echo = await handler(request({ protocol: 'bad' }));
  assert.strictEqual(echo.execution_id, 'exec-1');
  assert.strictEqual(echo.nonce, NONCE);
});

test('round above limits.rounds and a missing runtime digest are rejected without running the script', async () => {
  const over = await handler(request({ round: LIMITS.rounds + 1 }));
  assert.strictEqual(over.error_code, 'CODEMODE_LIMIT');
  process.env.CODEMODE_RUNTIME_DIGEST = '';
  try {
    const res = await handler(request());
    assert.strictEqual(res.status, 'error');
    assert.strictEqual(res.error_code, 'CODEMODE_RUNTIME');
    assert.strictEqual(res.runtime_digest, 'sha256:' + '0'.repeat(64));
  } finally {
    process.env.CODEMODE_RUNTIME_DIGEST = DIGEST;
  }
});

test('error messages are stripped of paths and bounded to 500 chars', () => {
  const msg = handlerModule.sanitizeMessage('boom at /var/task/runner.cjs:12:3 and C:\\Users\\x\\a.js and file:///tmp/x/y.js ' + 'z'.repeat(900));
  assert.ok(msg.length <= 500);
  assert.ok(!/\/var\/task|\/tmp\/x|Users/.test(msg), msg);
});

test('child process: empty env, new process per round, group kill', () => {
  const opts = handlerModule.childSpawnOptions('/tmp/some-private-dir');
  assert.deepStrictEqual(opts.env, {});
  assert.strictEqual(opts.cwd, '/tmp/some-private-dir');
  assert.strictEqual(opts.detached, true);
  assert.deepStrictEqual(opts.stdio, ['pipe', 'pipe', 'pipe']);
});

test('two invocations with different TenantId share nothing: globals, /tmp and process state', async () => {
  const tenantA = { clientContext: { custom: { TenantId: 'tenant-a' } } };
  const tenantB = { clientContext: { custom: { TenantId: 'tenant-b' } } };
  const a = await handler(request({ execution_id: 'exec-a', source: 'globalThis.leak = "A-secret"; Array.prototype.polluted = 1; Math.random = () => 7; return [typeof leak, Math.random() !== 7];' }), tenantA);
  assert.deepStrictEqual(a.result, ['string', false]);
  // Residue left in /tmp by tenant A (e.g. by a hostile dependency) is wiped before and after.
  fs.mkdirSync(path.join(SCRATCH, 'left-by-a'));
  fs.writeFileSync(path.join(SCRATCH, 'left-by-a', 'secret.txt'), 'A-secret');
  fs.writeFileSync(path.join(SCRATCH, 'note.txt'), 'A-secret');
  const b = await handler(request({
    execution_id: 'exec-b', source: 'return [typeof globalThis.leak, [].polluted, Math.random() === 7];',
  }), tenantB);
  assert.deepStrictEqual(b.result, ['undefined', null, false]);
  assert.deepStrictEqual(fs.readdirSync(SCRATCH), [], '/tmp is empty after each round');
  assert.strictEqual(b.execution_id, 'exec-b');
});

test('no residue in /tmp after a round, even when the round fails', async () => {
  await handler(request({ source: 'return 1;' }));
  assert.deepStrictEqual(fs.readdirSync(SCRATCH), []);
  await handler(request({ source: 'while (true) {}', limits: { ...LIMITS, round_cpu_ms: 200 } }));
  assert.deepStrictEqual(fs.readdirSync(SCRATCH), []);
});

// ---- T68 case (9): residue between invocations of DIFFERENT tenants -------------
// The guest has no file system or process API, so the attack is run from every
// angle that exists: guest-side writes to globals/prototypes, every attempt at a
// file-system route, and host-side residue planted in /tmp (what a hostile
// dependency or a crashed round would leave) before the next tenant's round.
// Distinct from the runtime digest ('a' x 64) and the nonce so a hit is a real leak.
const TENANT_A_ID = '0123456789abcdef'.repeat(4);
const TENANT_B_ID = 'fedcba9876543210'.repeat(4);
const TENANT_A = { clientContext: { custom: { TenantId: TENANT_A_ID } } };
const TENANT_B = { clientContext: { custom: { TenantId: TENANT_B_ID } } };

test('T68(9): globals, prototypes, builtins and registries written by tenant A are pristine for tenant B', async () => {
  const a = await handler(request({
    execution_id: 'exec-a', source: `
      globalThis.leak = 'SECRET-A'; globalThis['__tenant'] = 'SECRET-A';
      Object.prototype.leakedProto = 'SECRET-A'; Array.prototype.leakedArr = 'SECRET-A';
      Function.prototype.leakedFn = 'SECRET-A'; String.prototype.leakedStr = 'SECRET-A';
      JSON.stringify = () => '"SECRET-A"'; Date.now = () => 1; Math.floor = () => 7;
      Error.prepareStackTrace = () => 'SECRET-A';
      Symbol.for('vx.tenant'); Object.defineProperty(globalThis, 'hidden', { value: 'SECRET-A', enumerable: false });
      return [typeof leak, ({}).leakedProto, JSON.stringify({}) ];`,
  }), TENANT_A);
  assert.strictEqual(a.status, 'completed');
  assert.deepStrictEqual(a.result, ['string', 'SECRET-A', '"SECRET-A"']);
  const b = await handler(request({
    execution_id: 'exec-b', source: `
      const seen = {
        leak: typeof globalThis.leak, tenant: typeof globalThis.__tenant, hidden: typeof globalThis.hidden,
        proto: ({}).leakedProto, arr: [].leakedArr, fn: (function () {}).leakedFn, str: 'x'.leakedStr,
        json: JSON.stringify({ a: 1 }), floor: Math.floor(1.9), prep: typeof Error.prepareStackTrace,
        sym: Symbol.keyFor(Symbol.for('vx.tenant')),
        globals: Object.getOwnPropertyNames(globalThis).filter((k) => /leak|tenant|hidden|SECRET/i.test(k)),
      };
      return seen;`,
  }), TENANT_B);
  assert.strictEqual(b.status, 'completed');
  assert.strictEqual(JSON.stringify(b).includes('SECRET-A'), false, 'nothing of tenant A in the reply');
  assert.deepStrictEqual(b.result.globals, []);
  assert.strictEqual(b.result.leak, 'undefined');
  assert.strictEqual(b.result.tenant, 'undefined');
  assert.strictEqual(b.result.hidden, 'undefined');
  assert.strictEqual(b.result.proto, undefined);
  assert.strictEqual(b.result.arr, undefined);
  assert.strictEqual(b.result.fn, undefined);
  assert.strictEqual(b.result.str, undefined);
  assert.strictEqual(b.result.json, '{"a":1}');
  assert.strictEqual(b.result.floor, 1);
});

test('T68(9): the guest cannot write to /tmp by any route, and /tmp is empty after the round', async () => {
  const attempts = [
    'return require("fs").writeFileSync("/tmp/leak.txt", "SECRET-A");',
    'const fs = await import("fs"); fs.writeFileSync("/tmp/leak.txt", "SECRET-A"); return 1;',
    'return process.mainModule.require("fs").writeFileSync("/tmp/leak.txt", "SECRET-A");',
    'return std.open("/tmp/leak.txt", "w").puts("SECRET-A");',
    'return os.open("/tmp/leak.txt", os.O_WRONLY | os.O_CREAT);',
    'return (new Function("return this")()).process.binding("fs");',
    'return await fetch("file:///tmp/leak.txt");',
    'return typeof globalThis.require + typeof globalThis.process + typeof globalThis.std + typeof globalThis.os;',
  ];
  for (const src of attempts) {
    const res = await handler(request({ execution_id: 'exec-a', source: src }), TENANT_A);
    if (res.status === 'completed') assert.match(String(res.result ?? ''), /^(undefined)*$|^null$/, src);
    else assert.ok(['CODEMODE_RUNTIME', 'CODEMODE_SYNTAX'].includes(res.error_code), src);
    assert.deepStrictEqual(fs.readdirSync(SCRATCH), [], `no residue after: ${src}`);
    assert.ok(!fs.existsSync('/tmp/leak.txt'), `nothing created outside the private root: ${src}`);
  }
});

test('T68(9): residue planted in /tmp by tenant A (files, hidden files, nested dirs, symlinks) is gone and unreadable for tenant B', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'codemode-outside-'));
  try {
    fs.writeFileSync(path.join(outside, 'target.txt'), 'outside-must-survive');
    fs.writeFileSync(path.join(SCRATCH, 'a-secret.txt'), 'SECRET-A');
    fs.writeFileSync(path.join(SCRATCH, '.hidden-a'), 'SECRET-A');
    fs.mkdirSync(path.join(SCRATCH, 'codemode-stale', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(SCRATCH, 'codemode-stale', 'deep', 'x.json'), '{"t":"SECRET-A"}');
    fs.symlinkSync(path.join(outside, 'target.txt'), path.join(SCRATCH, 'link-to-outside'));
    const b = await handler(request({ execution_id: 'exec-b', source: 'return "b-ran";' }), TENANT_B);
    assert.strictEqual(b.result, 'b-ran');
    assert.strictEqual(JSON.stringify(b).includes('SECRET-A'), false);
    assert.deepStrictEqual(fs.readdirSync(SCRATCH), [], 'every residue is wiped before and after tenant B\'s round');
    // wiping a symlink removes the link, never what it points to
    assert.strictEqual(fs.readFileSync(path.join(outside, 'target.txt'), 'utf8'), 'outside-must-survive');
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('T68(9): the TenantId of the invoking tenant never reaches the guest or the reply', async () => {
  const res = await handler(request({
    execution_id: 'exec-a',
    source: 'return Object.getOwnPropertyNames(globalThis).concat(Object.keys(globalThis)).join(",");',
  }), TENANT_A);
  assert.strictEqual(res.status, 'completed');
  assert.strictEqual(JSON.stringify(res).includes(TENANT_A_ID), false);
  assert.ok(!/tenant/i.test(String(res.result)), 'no tenant-looking global is exposed to the script');
});

test('T68(9): interleaved invocations of two tenants do not share state or leave residue', async () => {
  const [a, b] = await Promise.all([
    handler(request({ execution_id: 'exec-a', source: 'globalThis.k = "SECRET-A"; return globalThis.k;' }), TENANT_A),
    handler(request({ execution_id: 'exec-b', source: 'return typeof globalThis.k;' }), TENANT_B),
  ]);
  assert.strictEqual(a.result, 'SECRET-A');
  assert.strictEqual(b.result, 'undefined');
  assert.strictEqual(a.execution_id, 'exec-a');
  assert.strictEqual(b.execution_id, 'exec-b');
  assert.deepStrictEqual(fs.readdirSync(SCRATCH), []);
});
