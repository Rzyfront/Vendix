#!/usr/bin/env node
/**
 * Load test of Flows (flujos-adm P7.5).
 *
 * Goal: 1,000 requests per store and 50 simultaneous approvals, with no
 * duplicates. Runs only against a disposable environment (never production):
 * the script refuses any API host other than localhost / 127.0.0.1.
 *
 *   LOAD_API=http://localhost:3099/api \
 *   LOAD_EMAIL=owner@techsolutions.co LOAD_PASSWORD=... LOAD_STORE_SLUG=tech-bogota \
 *   node apps/backend/scripts/load/workflows-load.mjs
 *
 * Optional: LOAD_STARTS (1000), LOAD_CONCURRENCY (25), LOAD_REPLAYS (100),
 * LOAD_APPROVALS (50), LOAD_OUT (path of the JSON result).
 *
 * Phases
 *   1. Imports and publishes a throwaway flow "Carga P7 <run>": a start form,
 *      an approval for the owner role and two end stages.
 *   2. Starts LOAD_STARTS requests with LOAD_CONCURRENCY in flight, each with
 *      its own Idempotency-Key, then replays LOAD_REPLAYS of them with the
 *      same key: a replay must return the same instance and create nothing.
 *   3. Submits the start form of LOAD_APPROVALS requests, then approves them
 *      at the same instant. Each approval is sent three times at once: twice
 *      with the same Idempotency-Key (a network retry) and once with a fresh
 *      key (a double click). Exactly one completion per task must win; the
 *      others replay or are refused.
 *   4. Counts what the API reports for the run's flow.
 *
 * The database invariants (one instance per idempotency key, one completion
 * per task, outbox drained) are checked afterwards with SQL; the report of
 * the run lists the queries.
 */
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const API = (process.env.LOAD_API ?? 'http://localhost:3099/api').replace(/\/$/, '');
const EMAIL = process.env.LOAD_EMAIL ?? '';
const PASSWORD = process.env.LOAD_PASSWORD ?? '';
const STORE_SLUG = process.env.LOAD_STORE_SLUG ?? '';
const STARTS = Number(process.env.LOAD_STARTS ?? 1000);
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? 25);
const REPLAYS = Number(process.env.LOAD_REPLAYS ?? 100);
const APPROVALS = Number(process.env.LOAD_APPROVALS ?? 50);
const OUT = process.env.LOAD_OUT ?? '';
const RUN = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

const host = new URL(API).hostname;
if (!['localhost', '127.0.0.1'].includes(host)) {
  process.stderr.write(`Refusing to load ${host}: only a local disposable API is allowed.\n`);
  process.exit(2);
}
if (!EMAIL || !PASSWORD || !STORE_SLUG) {
  process.stderr.write('LOAD_EMAIL, LOAD_PASSWORD and LOAD_STORE_SLUG are required.\n');
  process.exit(2);
}

let token = '';

async function call(method, path, body, headers = {}) {
  const t0 = performance.now();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ms = performance.now() - t0;
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, ms, json };
}

function must(r, what) {
  if (r.status >= 300) {
    throw new Error(`${what} failed: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  }
  return r.json?.data;
}

function percentiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0);
  const round = (n) => Math.round(n * 10) / 10;
  return {
    count: sorted.length,
    p50: round(at(50)),
    p95: round(at(95)),
    p99: round(at(99)),
    max: round(sorted[sorted.length - 1] ?? 0),
  };
}

function tally(results) {
  const out = {};
  for (const r of results) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(lanes);
  return results;
}

/** Finds the open task of `stageKey` anywhere in the instance detail. */
function openTaskOf(detail, stageKey) {
  const stack = [detail];
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (node && typeof node === 'object') {
      if (
        typeof node.id === 'number' &&
        node.stage_key === stageKey &&
        ['open', 'claimed'].includes(node.status) &&
        'assignee_user_id' in node
      ) {
        return node;
      }
      stack.push(...Object.values(node));
    }
  }
  return null;
}

function rowVersionOf(detail) {
  if (typeof detail?.row_version === 'number') return detail.row_version;
  if (typeof detail?.instance?.row_version === 'number') return detail.instance.row_version;
  return null;
}

const DEFINITION = {
  schema: 'vendix.workflow/v1',
  key: `carga-p7-${RUN}`,
  name: `Carga P7 ${RUN}`,
  description: 'Flujo desechable de la prueba de carga de P7.',
  fields: [
    { key: 'concepto', type: 'text', label: 'Concepto', required: true },
    { key: 'monto', type: 'money', label: 'Monto', required: true },
  ],
  stages: [
    {
      key: 'solicitud',
      name: 'Solicitud',
      type: 'form',
      start: true,
      assignee: { kind: 'initiator' },
      form: { fields: ['concepto', 'monto'] },
      transitions: [{ on: 'submit', to: 'aprobacion' }],
    },
    {
      key: 'aprobacion',
      name: 'Aprobación',
      type: 'approval',
      assignee: { kind: 'role', role_key: 'owner' },
      transitions: [
        { on: 'approve', to: 'aprobada' },
        { on: 'reject', to: 'rechazada', require_comment: true },
      ],
    },
    { key: 'aprobada', name: 'Aprobada', type: 'end', outcome: 'completed' },
    { key: 'rechazada', name: 'Rechazada', type: 'end', outcome: 'rejected' },
  ],
  triggers: [{ kind: 'manual' }],
};

async function main() {
  const report = { run: RUN, api: API, store_slug: STORE_SLUG, settings: { STARTS, CONCURRENCY, REPLAYS, APPROVALS } };

  const login = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD, store_slug: STORE_SLUG });
  token = must(login, 'login')?.access_token ?? '';
  if (!token) throw new Error('login returned no access_token');

  // Phase 1: throwaway flow.
  const imported = must(await call('POST', '/store/workflows/definitions/import', { definition: DEFINITION }), 'import');
  const definitionId = imported?.id ?? imported?.definition?.id;
  if (!definitionId) throw new Error(`import returned no id: ${JSON.stringify(imported).slice(0, 200)}`);
  must(await call('POST', `/store/workflows/definitions/${definitionId}/publish`, { changelog: 'Prueba de carga P7' }), 'publish');
  report.definition_id = definitionId;

  // Phase 2: starts with unique keys, then replays.
  const keys = Array.from({ length: STARTS }, (_, i) => `p7-load-${RUN}-${i}-${randomUUID().slice(0, 8)}`);
  const t0 = performance.now();
  const starts = await pool(keys, CONCURRENCY, (key, i) =>
    call(
      'POST',
      '/store/workflows/instances',
      { definition_id: definitionId, title: `Carga ${i + 1}`, data: { concepto: `Gasto ${i + 1}`, monto: 1000 + i } },
      { 'idempotency-key': key },
    ),
  );
  const startWall = performance.now() - t0;
  const instanceOf = (r) => r.json?.data?.instance?.id ?? null;
  const startedIds = starts.map(instanceOf);
  const uniqueStarted = new Set(startedIds.filter((x) => x !== null));
  report.starts = {
    sent: STARTS,
    statuses: tally(starts),
    distinct_instances: uniqueStarted.size,
    latency_ms: percentiles(starts.map((r) => r.ms)),
    wall_seconds: Math.round(startWall / 100) / 10,
    throughput_per_hour: Math.round((STARTS / (startWall / 1000)) * 3600),
    first_errors: starts.filter((r) => r.status >= 300).slice(0, 3).map((r) => ({ status: r.status, body: r.json })),
  };

  const replayIdx = Array.from({ length: Math.min(REPLAYS, STARTS) }, (_, i) => Math.floor((i * STARTS) / Math.max(1, REPLAYS)));
  const replays = await pool(replayIdx, CONCURRENCY, (i) =>
    call(
      'POST',
      '/store/workflows/instances',
      { definition_id: definitionId, title: `Carga ${i + 1}`, data: { concepto: `Gasto ${i + 1}`, monto: 1000 + i } },
      { 'idempotency-key': keys[i] },
    ),
  );
  report.replays = {
    sent: replayIdx.length,
    statuses: tally(replays),
    same_instance: replays.filter((r, j) => instanceOf(r) !== null && instanceOf(r) === startedIds[replayIdx[j]]).length,
    flagged_replayed: replays.filter((r) => r.json?.data?.replayed === true).length,
    latency_ms: percentiles(replays.map((r) => r.ms)),
  };

  // Phase 3: simultaneous approvals, each sent three times at once. A request
  // starts on its "solicitud" form (assigned to whoever started it), so each
  // target first submits that form to reach its "aprobacion" task.
  const targets = [...uniqueStarted].slice(0, APPROVALS);
  const submits = await pool(targets, CONCURRENCY, async (id) => {
    const detail = must(await call('GET', `/store/workflows/instances/${id}`), `instance ${id}`);
    const form = openTaskOf(detail, 'solicitud');
    const version = rowVersionOf(detail);
    if (!form || version === null) return null;
    return call(
      'POST',
      `/store/workflows/tasks/${form.id}/complete`,
      { outcome: 'submit', values: { concepto: `Gasto ${id}`, monto: 1000 }, expected_row_version: version },
      { 'idempotency-key': `p7-submit-${RUN}-${form.id}` },
    );
  });
  const prepared = [];
  for (const id of targets) {
    const detail = must(await call('GET', `/store/workflows/instances/${id}`), `instance ${id}`);
    const task = openTaskOf(detail, 'aprobacion');
    const version = rowVersionOf(detail);
    if (task && version !== null) prepared.push({ instanceId: id, taskId: task.id, version });
  }
  const approve = (p, key) =>
    call(
      'POST',
      `/store/workflows/tasks/${p.taskId}/complete`,
      { outcome: 'approve', expected_row_version: p.version },
      { 'idempotency-key': key },
    );
  const a0 = performance.now();
  const bursts = await Promise.all(
    prepared.map(async (p) => {
      const sameKey = `p7-approve-${RUN}-${p.taskId}`;
      const [first, retry, doubleClick] = await Promise.all([
        approve(p, sameKey),
        approve(p, sameKey),
        approve(p, `p7-approve-${RUN}-${p.taskId}-${randomUUID().slice(0, 8)}`),
      ]);
      return { p, first, retry, doubleClick };
    }),
  );
  const approvalWall = performance.now() - a0;
  const all = bursts.flatMap((b) => [b.first, b.retry, b.doubleClick]);
  const winnersPerTask = bursts.map(
    (b) => [b.first, b.retry, b.doubleClick].filter((r) => r.status < 300 && r.json?.data?.replayed !== true).length,
  );
  report.approvals = {
    form_submits: tally(submits.filter((r) => r !== null)),
    tasks: prepared.length,
    requests: all.length,
    statuses: tally(all),
    tasks_with_exactly_one_winner: winnersPerTask.filter((n) => n === 1).length,
    tasks_with_more_than_one_winner: winnersPerTask.filter((n) => n > 1).length,
    tasks_without_winner: winnersPerTask.filter((n) => n === 0).length,
    latency_ms: percentiles(all.map((r) => r.ms)),
    wall_seconds: Math.round(approvalWall / 100) / 10,
    refusal_codes: tally(all.filter((r) => r.status >= 400).map((r) => ({ status: r.json?.error_code ?? r.status }))),
  };

  // Phase 4: what the API reports for the run's flow.
  const listed = await call('GET', `/store/workflows/instances?definition_id=${definitionId}&limit=1`);
  report.api_counts = { instances_listed_total: listed.json?.meta?.total ?? listed.json?.total ?? null };

  const text = JSON.stringify(report, null, 2);
  if (OUT) writeFileSync(OUT, text);
  process.stdout.write(`${text}\n`);

  const ok =
    report.starts.distinct_instances === STARTS &&
    report.replays.same_instance === report.replays.sent &&
    report.approvals.tasks === Math.min(APPROVALS, uniqueStarted.size) &&
    report.approvals.tasks_with_exactly_one_winner === report.approvals.tasks;
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
