'use strict';
/**
 * AWS Lambda entrypoint of the Vex Code Mode executor (protocol
 * vendix.codemode/v1, Node 22).
 *
 * Contract mirrored from apps/backend/src/ai-engine/sandbox/interfaces/
 * codemode-protocol.interface.ts. Containment is the Lambda itself (VPC without
 * egress, role limited to ENI management, no secrets, read-only code, tenant
 * isolation mode PER_TENANT). On top of it EVERY round gets a private /tmp dir
 * and a NEW child process (runner.cjs, QuickJS in WASM) with an empty
 * environment, in its own process group that is SIGKILLed afterwards; /tmp is
 * wiped before and after because execution environments are reused (within a
 * tenant). The Lambda never executes a tool and never returns a journal.
 *
 * Never log source, args, results or journal contents.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ERROR_CODES, safeMessage } = require('./runner.cjs');

const PROTOCOL = 'vendix.codemode/v1';
const RUNNER_PATH = path.join(__dirname, 'runner.cjs');
const TMP_ROOT = process.env.CODEMODE_TMP_ROOT || '/tmp';
const TMP_PREFIX = 'codemode-';
const ZERO_DIGEST = 'sha256:' + '0'.repeat(64);

// Hard maxima baked in (mirror of CODEMODE_LIMITS): request limits above these
// are clamped, never trusted.
const HARD_LIMITS = Object.freeze({
  wall_ms: 30000, round_cpu_ms: 2000, memory_mb: 256, calls: 20, rounds: 6,
  pending_per_round: 8, manifest_tools: 20, rows: 5000, source_bytes: 32 * 1024,
  journal_bytes: 2 * 1024 * 1024, args_bytes: 16 * 1024, result_bytes: 8 * 1024,
  log_bytes: 2 * 1024, output_bytes: 64 * 1024, blocks: 5,
});
const CHILD_STARTUP_SLACK_MS = 5000;
const STDERR_TAIL_BYTES = 2048;
const STDOUT_SLACK_BYTES = 4096;
const JOURNAL_ERROR_MAX = 300;

const REQUEST_KEYS = ['protocol', 'execution_id', 'nonce', 'round', 'language', 'source', 'manifest', 'journal', 'clock_ms', 'seed', 'limits'];
const NONCE_RE = /^[0-9a-f]{64}$/;
const EXEC_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const TOOL_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

class RequestError extends Error {}

function sameKeys(obj, keys) {
  const actual = Object.keys(obj).sort();
  return actual.length === keys.length && [...keys].sort().every((k, i) => k === actual[i]);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInt(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isJson(value, depth = 0) {
  if (depth > 64) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((v) => isJson(v, depth + 1));
  if (isPlainObject(value)) return Object.values(value).every((v) => isJson(v, depth + 1));
  return false;
}

function validDigest() {
  const digest = process.env.CODEMODE_RUNTIME_DIGEST || '';
  return DIGEST_RE.test(digest) && digest !== ZERO_DIGEST ? digest : null;
}

/** Returns the validated request (limits clamped) or throws RequestError. */
function validateRequest(event) {
  if (!isPlainObject(event)) throw new RequestError('request must be an object');
  if (!sameKeys(event, REQUEST_KEYS)) throw new RequestError('request has missing or unknown keys');
  if (event.protocol !== PROTOCOL) throw new RequestError('unsupported protocol');
  if (typeof event.execution_id !== 'string' || !EXEC_ID_RE.test(event.execution_id)) throw new RequestError('invalid execution_id');
  if (typeof event.nonce !== 'string' || !NONCE_RE.test(event.nonce)) throw new RequestError('invalid nonce');
  if (!isPositiveInt(event.round)) throw new RequestError('invalid round');
  if (event.language !== 'javascript') throw new RequestError('unsupported language');
  if (typeof event.seed !== 'string' || !NONCE_RE.test(event.seed)) throw new RequestError('invalid seed');
  if (!Number.isSafeInteger(event.clock_ms) || event.clock_ms < 0 || event.clock_ms > 8.64e15) throw new RequestError('invalid clock_ms');

  if (!isPlainObject(event.limits) || !sameKeys(event.limits, Object.keys(HARD_LIMITS))) throw new RequestError('limits missing or unknown keys');
  const limits = {};
  for (const [key, hard] of Object.entries(HARD_LIMITS)) {
    if (!isPositiveInt(event.limits[key])) throw new RequestError(`invalid limit ${key}`);
    limits[key] = Math.min(event.limits[key], hard);
  }

  if (typeof event.source !== 'string' || !event.source.trim()) throw new RequestError('source must be a non-empty string');
  if (Buffer.byteLength(event.source, 'utf8') > limits.source_bytes) throw new RequestError(`source exceeds ${limits.source_bytes} bytes`);
  if (event.source.includes('\u0000')) throw new RequestError('source contains NUL');

  if (!Array.isArray(event.manifest) || event.manifest.length > limits.manifest_tools) throw new RequestError('invalid manifest');
  const names = new Set();
  for (const name of event.manifest) {
    if (typeof name !== 'string' || !TOOL_RE.test(name) || names.has(name)) throw new RequestError('invalid manifest tool name');
    names.add(name);
  }

  if (!Array.isArray(event.journal) || event.journal.length > limits.calls) throw new RequestError('invalid journal');
  event.journal.forEach((entry, index) => {
    if (!isPlainObject(entry) || !sameKeys(entry, ['seq', 'tool', 'args_hash', 'outcome'])) throw new RequestError('invalid journal entry');
    if (entry.seq !== index + 1) throw new RequestError('journal seq must be contiguous from 1');
    if (typeof entry.tool !== 'string' || !names.has(entry.tool)) throw new RequestError('journal tool is not in the manifest');
    if (typeof entry.args_hash !== 'string' || !NONCE_RE.test(entry.args_hash)) throw new RequestError('invalid journal args_hash');
    const o = entry.outcome;
    const okShape = isPlainObject(o) && o.ok === true && sameKeys(o, ['ok', 'value']) && isJson(o.value);
    const errShape = isPlainObject(o) && o.ok === false && sameKeys(o, ['ok', 'error']) && typeof o.error === 'string' && o.error.length <= JOURNAL_ERROR_MAX;
    if (!okShape && !errShape) throw new RequestError('invalid journal outcome');
  });
  if (Buffer.byteLength(JSON.stringify(event.journal), 'utf8') > limits.journal_bytes) throw new RequestError(`journal exceeds ${limits.journal_bytes} bytes`);
  return { ...event, limits };
}

function rm(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 2 });
  } catch (_) { /* best effort */ }
}

/** Remove everything under TMP_ROOT (one round at a time per environment). */
function wipeTmp() {
  const root = path.resolve(TMP_ROOT);
  if (root === path.parse(root).root) return;
  let entries = [];
  try { entries = fs.readdirSync(root); } catch (_) { return; }
  for (const entry of entries) rm(path.join(root, entry));
}

function childSpawnOptions(tmpdir) {
  return {
    cwd: tmpdir,
    env: {}, // nothing from the Lambda environment (AWS_*, digest, tokens) reaches the guest process
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true, // own process group: killed as a whole
    windowsHide: true,
  };
}

function killGroup(child) {
  try { process.kill(-child.pid, 'SIGKILL'); } catch (_) {
    try { child.kill('SIGKILL'); } catch (__) { /* already gone */ }
  }
}

/** Spawn one runner. Resolves {code, message, body} where code null means a parsed body. */
function runChild(payload, limits, tmpdir) {
  return new Promise((resolve) => {
    const wallMs = Math.min(limits.wall_ms, limits.round_cpu_ms + CHILD_STARTUP_SLACK_MS);
    let child;
    try {
      child = spawn(process.execPath, ['--max-old-space-size=128', RUNNER_PATH], childSpawnOptions(tmpdir));
    } catch (error) {
      resolve({ code: 'CODEMODE_RUNTIME', message: `sandbox error: ${error.code || error.name}` });
      return;
    }
    const maxStdout = limits.output_bytes + STDOUT_SLACK_BYTES;
    const out = [];
    let outBytes = 0;
    let errTail = '';
    let settled = false;
    let overflow = false;
    let timedOut = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killGroup(child);
      resolve(result);
    };
    const timer = setTimeout(() => { timedOut = true; finish({ code: 'CODEMODE_TIMEOUT', message: 'wall time limit exceeded' }); }, wallMs);

    child.stdout.on('data', (chunk) => {
      outBytes += chunk.length;
      if (outBytes > maxStdout) { overflow = true; finish({ code: 'CODEMODE_OUTPUT', message: `output exceeds ${limits.output_bytes} bytes` }); return; }
      out.push(chunk);
    });
    child.stderr.on('data', (chunk) => { errTail = (errTail + chunk.toString('utf8')).slice(-STDERR_TAIL_BYTES); });
    child.stdin.on('error', () => { /* child died before reading */ });
    child.on('error', (error) => finish({ code: 'CODEMODE_RUNTIME', message: `sandbox error: ${error.code || error.name}` }));
    child.on('close', (exitCode, signal) => {
      if (timedOut || overflow) return;
      if (exitCode === 0 && out.length) {
        try {
          finish({ code: null, body: JSON.parse(Buffer.concat(out).toString('utf8')) });
          return;
        } catch (_) {
          finish({ code: 'CODEMODE_OUTPUT', message: 'runner output is not valid JSON' });
          return;
        }
      }
      if (signal === 'SIGKILL' || signal === 'SIGABRT' || signal === 'SIGSEGV' || signal === 'SIGBUS' || exitCode === 134 || /heap out of memory/i.test(errTail)) {
        finish({ code: 'CODEMODE_MEMORY', message: 'process killed (memory limit)' });
        return;
      }
      finish({ code: 'CODEMODE_RUNTIME', message: safeMessage(errTail.trim().split('\n').pop() || 'child exited without a result') });
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

/** Strict re-validation of what the runner printed; anything else is CODEMODE_OUTPUT. */
function validateRunnerBody(body, req) {
  const limits = req.limits;
  const bad = (m) => { throw new RequestError(m); };
  if (!isPlainObject(body)) bad('runner body malformed');
  const { status } = body;
  const common = ['status', 'usage', 'logs'];
  const allowed = {
    pending: [...common, 'pending'],
    completed: [...common, 'result', 'blocks'],
    error: [...common, 'error_code', 'error_message'],
  }[status];
  if (!allowed) bad('runner status invalid');
  for (const key of Object.keys(body)) if (!allowed.includes(key)) bad('runner key not allowed: ' + key);
  const logs = body.logs === undefined ? [] : body.logs;
  if (!Array.isArray(logs) || !logs.every((l) => typeof l === 'string')) bad('runner logs invalid');
  const usage = { duration_ms: 0 };
  if (isPlainObject(body.usage) && Number.isFinite(body.usage.cpu_ms)) usage.cpu_ms = Math.max(0, Math.round(body.usage.cpu_ms));
  const clean = { status, logs, usage };
  if (status === 'pending') {
    const calls = body.pending;
    if (!Array.isArray(calls) || calls.length < 1 || calls.length > limits.pending_per_round) bad('runner pending count invalid');
    clean.pending = calls.map((c, i) => {
      if (!isPlainObject(c) || !sameKeys(c, ['seq', 'tool', 'args'])) bad('runner pending call malformed');
      if (c.seq !== req.journal.length + 1 + i) bad('runner pending seq not contiguous');
      if (typeof c.tool !== 'string' || !req.manifest.includes(c.tool)) bad('runner pending tool not in manifest');
      if (!isPlainObject(c.args) || !isJson(c.args)) bad('runner pending args invalid');
      return { seq: c.seq, tool: c.tool, args: c.args };
    });
  } else if (status === 'completed') {
    if (!isJson(body.result === undefined ? null : body.result)) bad('runner result invalid');
    if (!Array.isArray(body.blocks) || body.blocks.length > limits.blocks || !body.blocks.every((b) => isPlainObject(b) && isJson(b))) bad('runner blocks invalid');
    clean.result = body.result === undefined ? null : body.result;
    clean.blocks = body.blocks;
  } else {
    if (!ERROR_CODES.has(body.error_code)) bad('runner error_code invalid');
    clean.error_code = body.error_code;
    clean.error_message = safeMessage(typeof body.error_message === 'string' ? body.error_message : 'script failed');
  }
  return clean;
}

function response(echo, startedAt, fields) {
  const digest = validDigest();
  const base = {
    protocol: PROTOCOL, execution_id: echo.execution_id, nonce: echo.nonce, round: echo.round,
    runtime_digest: digest || ZERO_DIGEST,
  };
  let body;
  if (!digest) {
    body = { ...base, status: 'error', error_code: 'CODEMODE_RUNTIME', error_message: 'runtime digest missing', usage: { duration_ms: 0 } };
  } else {
    body = { ...base, ...fields };
  }
  body.usage = { ...(body.usage || {}), duration_ms: Date.now() - startedAt };
  if (body.logs !== undefined && body.logs.length === 0) delete body.logs;
  return body;
}

function errorFields(code, message) {
  return { status: 'error', error_code: code, error_message: safeMessage(message) };
}

async function handler(event, _context) {
  const startedAt = Date.now();
  const echo = {
    execution_id: isPlainObject(event) && typeof event.execution_id === 'string' && EXEC_ID_RE.test(event.execution_id) ? event.execution_id : '',
    nonce: isPlainObject(event) && typeof event.nonce === 'string' && NONCE_RE.test(event.nonce) ? event.nonce : '',
    round: isPlainObject(event) && isPositiveInt(event.round) ? event.round : 0,
  };
  if (!validDigest()) return response(echo, startedAt, errorFields('CODEMODE_RUNTIME', 'runtime digest missing'));
  let req;
  try {
    req = validateRequest(event);
  } catch (error) {
    if (!(error instanceof RequestError)) throw error;
    return response(echo, startedAt, errorFields('CODEMODE_INPUT', error.message));
  }
  if (req.round > req.limits.rounds) return response(echo, startedAt, errorFields('CODEMODE_LIMIT', `round exceeds ${req.limits.rounds}`));

  wipeTmp();
  let tmpdir;
  let fields;
  try {
    tmpdir = fs.mkdtempSync(path.join(TMP_ROOT, TMP_PREFIX));
    fs.chmodSync(tmpdir, 0o700);
    const payload = {
      source: req.source, manifest: req.manifest, journal: req.journal, clock_ms: req.clock_ms,
      seed: req.seed, limits: req.limits,
    };
    const result = await runChild(payload, req.limits, tmpdir);
    if (result.code) {
      fields = errorFields(result.code, result.message);
    } else {
      try {
        fields = validateRunnerBody(result.body, req);
      } catch (error) {
        if (!(error instanceof RequestError)) throw error;
        fields = errorFields('CODEMODE_OUTPUT', error.message);
      }
    }
  } catch (error) { // infrastructure failure; never echo guest data
    fields = errorFields('CODEMODE_RUNTIME', `sandbox error: ${(error && error.name) || 'Error'}`);
  } finally {
    if (tmpdir) rm(tmpdir);
    wipeTmp();
  }
  let body = response(echo, startedAt, fields);
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > req.limits.output_bytes) {
    body = response(echo, startedAt, errorFields('CODEMODE_OUTPUT', `response exceeds ${req.limits.output_bytes} bytes`));
  }
  return body;
}

module.exports = {
  handler, validateRequest, validateRunnerBody, childSpawnOptions, sanitizeMessage: safeMessage,
  HARD_LIMITS, RequestError, TMP_ROOT,
};
