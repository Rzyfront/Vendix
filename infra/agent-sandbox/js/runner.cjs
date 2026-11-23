'use strict';
/**
 * Code Mode round runner (protocol vendix.codemode/v1).
 *
 * Contract mirrored from apps/backend/src/ai-engine/sandbox/interfaces/
 * codemode-protocol.interface.ts. handler.cjs spawns a NEW node process with
 * this file for EVERY round: it reads one JSON request from stdin, runs the AI
 * written script inside QuickJS (compiled to WASM, quickjs-emscripten) and
 * prints one JSON result to stdout. Nothing survives between rounds.
 *
 * Inside the interpreter only these globals exist besides the language
 * built-ins: `tools` (frozen, one async function per manifest name), `console`
 * (captured, bounded) and `vex.block(block)`. There is no require, process,
 * fetch, timers or file system, and `Date` / `Math.random` are deterministic.
 * The script NEVER executes a tool: a call is either answered from the journal
 * (same seq, same tool, same args_hash) or left pending for the host.
 *
 * Never log source, args or results.
 */
const { createHash } = require('node:crypto');

const ERROR_CODES = new Set([
  'CODEMODE_SYNTAX', 'CODEMODE_RUNTIME', 'CODEMODE_TIMEOUT', 'CODEMODE_MEMORY',
  'CODEMODE_STALLED', 'CODEMODE_REPLAY_DIVERGENCE', 'CODEMODE_LIMIT', 'CODEMODE_OUTPUT',
]);
const MAX_STACK_BYTES = 512 * 1024;
const MAX_LOG_LINE_CHARS = 1000;
const LOG_TRUNCATED = '[logs truncated]';

/** Canonical JSON shared with the host: sorted keys (UTF-16), no whitespace. */
function codeModeCanonicalJson(value) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new Error('non-finite number');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((item) => codeModeCanonicalJson(item)).join(',')}]`;
      return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${codeModeCanonicalJson(value[key])}`)
        .join(',')}}`;
    }
    default:
      throw new Error('non-JSON value');
  }
}

function codeModeArgsHash(args) {
  return createHash('sha256').update(codeModeCanonicalJson(args), 'utf8').digest('hex');
}

/**
 * Runs inside QuickJS. Receives the native bridge once, deletes it from the
 * global object, and returns `run(source)`. Built-ins are captured up front so
 * a script that tampers with them can only hurt itself.
 */
const PRELUDE = `(function (host, manifest, clockMs, seedWords) {
  'use strict';
  const stringify = JSON.stringify, parse = JSON.parse, isArray = Array.isArray;
  const PromiseCtor = Promise, RealDate = Date, RealMath = Math;
  const construct = Reflect.construct, freeze = Object.freeze, define = Object.defineProperty;
  const hostCall = host.call, hostLog = host.log, hostBlock = host.block, hostDone = host.done, hostFail = host.fail;
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

  const tools = Object.create(null);
  for (const name of manifest) {
    const fn = function (args) {
      try {
        const a = args === undefined ? {} : args;
        if (a === null || typeof a !== 'object' || isArray(a)) throw new TypeError('tool arguments must be an object');
        let json;
        try { json = stringify(a); } catch (e) { throw new TypeError('tool arguments are not JSON-serializable'); }
        const r = parse(hostCall(name, json));
        if (r.s === 'ok') return PromiseCtor.resolve(r.v);
        if (r.s === 'err') return PromiseCtor.reject(new Error(r.e));
        return new PromiseCtor(function () {});
      } catch (e) {
        return PromiseCtor.reject(e);
      }
    };
    define(fn, 'name', { value: name });
    tools[name] = freeze(fn);
  }
  freeze(tools);

  const show = function (v) {
    if (typeof v === 'string') return v;
    try { const s = stringify(v); return s === undefined ? String(v) : s; } catch (e) {
      try { return String(v); } catch (e2) { return '[unprintable]'; }
    }
  };
  const logger = function () {
    const parts = [];
    for (let i = 0; i < arguments.length; i += 1) parts.push(show(arguments[i]));
    hostLog(parts.join(' '));
  };
  const consoleObject = freeze({ log: logger, info: logger, warn: logger, error: logger, debug: logger });
  const vex = freeze({
    block: function (block) {
      if (block === null || typeof block !== 'object' || isArray(block)) throw new TypeError('vex.block expects an object');
      let json;
      try { json = stringify(block); } catch (e) { throw new TypeError('vex.block argument is not JSON-serializable'); }
      hostBlock(json);
    },
  });

  // Date frozen at clock_ms; the real Date stays unreachable.
  const FrozenDate = function Date() {
    if (!new.target) return new RealDate(clockMs).toString();
    return construct(RealDate, arguments.length === 0 ? [clockMs] : Array.prototype.slice.call(arguments), new.target);
  };
  FrozenDate.prototype = RealDate.prototype;
  define(RealDate.prototype, 'constructor', { value: FrozenDate, writable: true, configurable: true });
  define(FrozenDate, 'now', { value: function now() { return clockMs; }, writable: true, configurable: true });
  define(FrozenDate, 'UTC', { value: RealDate.UTC, writable: true, configurable: true });
  define(FrozenDate, 'parse', { value: RealDate.parse, writable: true, configurable: true });
  define(globalThis, 'Date', { value: FrozenDate, writable: true, configurable: true });

  // Math.random: sfc32 seeded from the request seed (same sequence every round).
  const mix = function (x, y) { return (x ^ Math.imul(y, 0x9e3779b1)) | 0; };
  let a = mix(seedWords[0], seedWords[4]), b = mix(seedWords[1], seedWords[5]);
  let c = mix(seedWords[2], seedWords[6]), d = mix(seedWords[3], seedWords[7]);
  const next = function () {
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i += 1) next();
  define(RealMath, 'random', { value: function random() { return next(); }, writable: true, configurable: true });

  define(globalThis, 'tools', { value: tools });
  define(globalThis, 'console', { value: consoleObject, writable: true, configurable: true });
  define(globalThis, 'vex', { value: vex });

  return function run(source) {
    let main;
    try { main = AsyncFunction(source); } catch (e) { hostFail('syntax', show(e && e.name) + ': ' + show(e && e.message)); return; }
    let p;
    try { p = main(); } catch (e) { hostFail('runtime', show(e && e.name) + ': ' + show(e && e.message)); return; }
    p.then(function (value) {
      let json;
      try { json = value === undefined ? 'null' : stringify(value); if (json === undefined) json = 'null'; } catch (e) {
        hostFail('runtime', 'The script result is not JSON-serializable'); return;
      }
      hostDone(json);
    }, function (e) {
      hostFail('runtime', e !== null && typeof e === 'object' ? show(e.name) + ': ' + show(e.message) : show(e));
    });
  };
})`;

function stripPaths(text) {
  return String(text)
    .replace(/file:\/\/[^\s'")]*/g, '<path>')
    .replace(/(?:[A-Za-z]:)?(?:[\\/][\w.@+~-]+){2,}[\\/]?/g, '<path>')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ');
}

function safeMessage(text) {
  return stripPaths(text).slice(0, 500);
}

function seedToWords(seed) {
  const words = [];
  for (let i = 0; i < 8; i += 1) words.push(parseInt(seed.slice(i * 8, i * 8 + 8), 16) | 0);
  return words;
}

/** Executes one round. `req` is the already validated request body. */
async function executeRound(req) {
  const { getQuickJS } = require('quickjs-emscripten');
  const limits = req.limits;
  const startedAt = Date.now();
  const deadline = startedAt + limits.round_cpu_ms;
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(limits.memory_mb * 1024 * 1024);
  runtime.setMaxStackSize(MAX_STACK_BYTES);

  const state = {
    timedOut: false, fatal: null, seq: 0, pending: [], logs: [], logBytes: 0, logsFull: false,
    blocks: [], done: null, failed: null,
  };
  runtime.setInterruptHandler(() => {
    if (!state.timedOut && Date.now() > deadline) state.timedOut = true;
    return state.timedOut;
  });
  const journal = req.journal;

  const fatal = (code, message) => { if (!state.fatal) state.fatal = { code, message }; };
  const NEVER = JSON.stringify({ s: 'p' });

  const hostCall = (name, argsJson) => {
    state.seq += 1;
    const seq = state.seq;
    if (state.fatal) return NEVER;
    if (seq > limits.calls) { fatal('CODEMODE_LIMIT', `tool call limit exceeded (${limits.calls})`); return NEVER; }
    if (Buffer.byteLength(argsJson, 'utf8') > limits.args_bytes) {
      fatal('CODEMODE_LIMIT', `tool arguments exceed ${limits.args_bytes} bytes`);
      return NEVER;
    }
    const args = JSON.parse(argsJson);
    const hash = codeModeArgsHash(args);
    const entry = journal[seq - 1];
    if (entry) {
      if (entry.tool !== name || entry.args_hash !== hash) {
        fatal('CODEMODE_REPLAY_DIVERGENCE', `call ${seq} (${name}) differs from the journal`);
        return NEVER;
      }
      return entry.outcome.ok
        ? `{"s":"ok","v":${JSON.stringify(entry.outcome.value)}}`
        : JSON.stringify({ s: 'err', e: entry.outcome.error });
    }
    state.pending.push({ seq, tool: name, args });
    return NEVER;
  };

  const out = (extra) => ({
    logs: state.logs,
    usage: { cpu_ms: Math.max(0, Date.now() - startedAt) },
    ...extra,
  });

  let context;
  try {
    context = runtime.newContext();
    const bridge = context.newObject();
    const fn = (name, impl) => { const h = context.newFunction(name, impl); context.setProp(bridge, name, h); h.dispose(); };
    fn('call', (n, a) => context.newString(hostCall(context.getString(n), context.getString(a))));
    fn('log', (line) => {
      if (state.logsFull) return;
      let text = context.getString(line);
      if (text.length > MAX_LOG_LINE_CHARS) text = text.slice(0, MAX_LOG_LINE_CHARS);
      const size = Buffer.byteLength(text, 'utf8');
      if (state.logBytes + size > limits.log_bytes) {
        state.logsFull = true;
        state.logs.push(LOG_TRUNCATED);
        return;
      }
      state.logBytes += size;
      state.logs.push(text);
    });
    fn('block', (json) => {
      if (state.blocks.length >= limits.blocks) { fatal('CODEMODE_LIMIT', `vex.block limit exceeded (${limits.blocks})`); return; }
      state.blocks.push(JSON.parse(context.getString(json)));
    });
    fn('done', (json) => { state.done = context.getString(json); });
    fn('fail', (kind, message) => { state.failed = { kind: context.getString(kind), message: context.getString(message) }; });

    const prelude = `${PRELUDE}(__vx, ${JSON.stringify(req.manifest)}, ${req.clock_ms}, ${JSON.stringify(seedToWords(req.seed))})`;
    context.setProp(context.global, '__vx', bridge);
    bridge.dispose();
    const runHandle = context.unwrapResult(context.evalCode(`(function () { const r = ${prelude}; delete globalThis.__vx; return r; })()`, 'prelude'));
    // The bridge lives only inside the prelude closure from here on.
    const sourceHandle = context.newString(req.source);
    const call = context.callFunction(runHandle, context.undefined, sourceHandle);
    sourceHandle.dispose();
    runHandle.dispose();
    if (call.error) { const e = context.dump(call.error); call.error.dispose(); state.failed = state.failed || { kind: 'runtime', message: describe(e) }; } else call.value.dispose();

    for (let guard = 0; guard < 1_000_000; guard += 1) {
      const r = runtime.executePendingJobs();
      if (r.error) {
        const e = context.dump(r.error); r.error.dispose();
        state.failed = state.failed || { kind: 'runtime', message: describe(e) };
        break;
      }
      if (r.value === 0) break;
    }

    if (state.timedOut) return out({ status: 'error', error_code: 'CODEMODE_TIMEOUT', error_message: 'round CPU limit exceeded' });
    if (state.fatal) return out({ status: 'error', error_code: state.fatal.code, error_message: safeMessage(state.fatal.message) });
    if (state.failed) {
      const memory = /out of memory/i.test(state.failed.message);
      return out({
        status: 'error',
        error_code: memory ? 'CODEMODE_MEMORY' : state.failed.kind === 'syntax' ? 'CODEMODE_SYNTAX' : 'CODEMODE_RUNTIME',
        error_message: safeMessage(memory ? 'interpreter memory limit exceeded' : state.failed.message),
      });
    }
    if (state.done !== null) return out({ status: 'completed', result: JSON.parse(state.done), blocks: state.blocks });
    if (state.pending.length > 0) {
      return out({ status: 'pending', pending: state.pending.slice(0, limits.pending_per_round) });
    }
    return out({ status: 'error', error_code: 'CODEMODE_STALLED', error_message: 'the script cannot make progress: no settled result and no pending tool call' });
  } catch (error) {
    const message = String((error && error.message) || error);
    if (state.timedOut) return out({ status: 'error', error_code: 'CODEMODE_TIMEOUT', error_message: 'round CPU limit exceeded' });
    if (/out of memory|memory access|Aborted|alloc/i.test(message)) {
      return out({ status: 'error', error_code: 'CODEMODE_MEMORY', error_message: 'interpreter memory limit exceeded' });
    }
    return out({ status: 'error', error_code: 'CODEMODE_RUNTIME', error_message: safeMessage('sandbox error: ' + message) });
  }
}

function describe(dumped) {
  if (dumped && typeof dumped === 'object') return `${dumped.name || 'Error'}: ${dumped.message || ''}`;
  return String(dumped);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

async function main() {
  let result;
  try {
    result = await executeRound(JSON.parse(await readStdin()));
  } catch (error) {
    result = { status: 'error', error_code: 'CODEMODE_RUNTIME', error_message: safeMessage('runner error: ' + ((error && error.message) || error)) };
  }
  process.stdout.write(JSON.stringify(result), () => process.exit(0));
}

module.exports = { ERROR_CODES, codeModeCanonicalJson, codeModeArgsHash, safeMessage, executeRound };

if (require.main === module) main();
