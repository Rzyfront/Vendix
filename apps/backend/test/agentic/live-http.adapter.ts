/**
 * Live golden-conversation runner (F6 «el mecánico»). Ports the e2e-router
 * `run_e2e.py`: conversation → stream-intent → SSE → persisted message,
 * multi-turn, graded PER TURN with `gradeGoldenTurn`.
 *
 * Runs ONLY against a local backend wired to a disposable cloned DB (the DB
 * name must contain `e2e`); it spends real provider money, so it tracks the
 * real OpenRouter credit delta and stops before the configured floor.
 *
 *   npx ts-node --transpile-only test/agentic/live-http.adapter.ts \
 *     --suite test/agentic/golden-conversations.es.jsonl --label dynamic \
 *     --base http://localhost:3100/api --out /tmp/e2e --db-url-file /tmp/db \
 *     [--cases g01,g05] [--or-key-file /tmp/key] [--min-credit-usd 0.4]
 *
 * Secrets are read from files and never printed.
 */
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import {
  GoldenToolFrame,
  GoldenTurnExpectation,
  gradeGoldenTurn,
} from './graders';

export interface GoldenTurn extends GoldenTurnExpectation {
  message: string;
  approve?: 'approve' | 'reject';
  allow_no_write?: boolean;
  oracle?: {
    sql: string;
    before?: string;
    after_approve?: string;
    unchanged?: boolean;
  };
}
export interface GoldenCase {
  id: string;
  agent: 'vex' | 'vexi';
  principal: 'owner' | 'cashier' | 'restaurant_owner';
  channel?: 'text' | 'dictation' | 'realtime';
  topic_change?: boolean;
  setup?: 'empty_index';
  /**
   * Fixture SQL del caso, solo sobre el clon `e2e` (el adaptador rechaza otra
   * DB). Corre antes de crear la conversación; `teardown_sql` corre siempre al
   * final para dejar el clon listo para el siguiente caso.
   */
  setup_sql?: string[];
  teardown_sql?: string[];
  expect_retrieval?: string;
  seed_history?: { user: string };
  turns: GoldenTurn[];
}

interface Options {
  suite: string;
  label: string;
  base: string;
  out: string;
  dbUrlFile: string;
  orKeyFile?: string;
  cases?: string[];
  minCreditUsd: number;
  psql: string;
  password: string;
}

const PRINCIPALS: Record<GoldenCase['principal'], [string, string]> = {
  owner: ['owner@techsolutions.co', 'tech-bogota'],
  restaurant_owner: ['owner@roku.vendix.com', 'roku'],
  cashier: ['cashier@roku.com', 'roku'],
};

function parseArgs(argv: string[]): Options {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const required = (flag: string) => {
    const value = get(flag);
    if (!value) throw new Error(`Missing ${flag}`);
    return value;
  };
  return {
    suite: resolve(required('--suite')),
    label: required('--label'),
    base: get('--base') ?? 'http://localhost:3100/api',
    out: resolve(required('--out')),
    dbUrlFile: required('--db-url-file'),
    orKeyFile: get('--or-key-file'),
    cases: get('--cases')?.split(',').filter(Boolean),
    minCreditUsd: Number(get('--min-credit-usd') ?? '0.4'),
    psql: get('--psql') ?? 'psql',
    password: process.env.E2E_SEED_PASSWORD ?? '1125634q',
  };
}

/**
 * `{{run}}` in a case becomes a per-run tag so writes approved in one run
 * (a customer email, a product name) never collide with the next run's
 * oracles on the same cloned DB. No cleanup DELETE needed.
 */
export function loadSuite(path: string, run = ''): GoldenCase[] {
  const tag = run.toLowerCase().replace(/[^a-z0-9]/g, '');
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line.split('{{run}}').join(tag)) as GoldenCase);
}

class Db {
  private readonly url: string;
  constructor(
    file: string,
    private readonly psql: string,
  ) {
    this.url = readFileSync(file, 'utf8')
      .trim()
      .replace(/\?schema=[^&]*/, '');
    const name = this.query('select current_database()');
    if (!/e2e/.test(name))
      throw new Error('Refusing to run outside a cloned e2e database');
  }
  file(path: string): void {
    execFileSync(
      this.psql,
      [this.url, '-q', '-v', 'ON_ERROR_STOP=1', '-f', path],
      {
        encoding: 'utf8',
      },
    );
  }
  query(sql: string): string {
    return execFileSync(this.psql, [this.url, '-At', '-F', '|', '-c', sql], {
      encoding: 'utf8',
    }).trim();
  }
}

async function credits(keyFile?: string): Promise<number | null> {
  if (!keyFile || !existsSync(keyFile)) return null;
  const key = readFileSync(keyFile, 'utf8').trim();
  const response = await fetch('https://openrouter.ai/api/v1/credits', {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    data?: { total_credits?: number; total_usage?: number };
  };
  return (body.data?.total_credits ?? 0) - (body.data?.total_usage ?? 0);
}

class Api {
  private tokens = new Map<string, string>();
  constructor(private readonly options: Options) {}

  async token(principal: GoldenCase['principal']): Promise<string> {
    const cached = this.tokens.get(principal);
    if (cached) return cached;
    const [email, store] = PRINCIPALS[principal];
    const body = await this.raw('POST', '/auth/login', undefined, {
      email,
      password: this.options.password,
      store_slug: store,
    });
    const token = body?.data?.access_token as string | undefined;
    if (!token) throw new Error(`Login failed for ${principal}`);
    this.tokens.set(principal, token);
    return token;
  }

  async raw(
    method: string,
    path: string,
    token?: string,
    body?: unknown,
  ): Promise<any> {
    const response = await fetch(`${this.options.base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    try {
      return { status: response.status, ...JSON.parse(text) };
    } catch {
      return { status: response.status, raw: text.slice(0, 500) };
    }
  }

  async stream(
    token: string,
    conversationId: number,
    streamId: string,
  ): Promise<any[]> {
    const response = await fetch(
      `${this.options.base}/store/ai-chat/conversations/${conversationId}/stream?stream_id=${encodeURIComponent(streamId)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'text/event-stream',
        },
        signal: AbortSignal.timeout(420_000),
      },
    );
    const events: any[] = [];
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let data = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        if (line.startsWith('data:')) data += line.slice(5).trim();
        else if (line === '' && data) {
          let event: any;
          try {
            event = JSON.parse(data);
          } catch {
            event = { raw: data };
          }
          data = '';
          events.push(event);
          if (event.type === 'tool_call' && isUiCommand(event.tool?.name))
            void this.raw('POST', '/store/vexi/ui-result', token, {
              stream_id: streamId,
              tool_call_id: String(event.tool.id),
              result: headlessUiResult(event.tool.name, event.tool.arguments),
            }).catch(() => undefined);
          if (event.type === 'done' || event.type === 'error') {
            await reader.cancel().catch(() => undefined);
            return events;
          }
        }
      }
    }
    return events;
  }
}

/**
 * Headless browser for Vexi's client-side `ui_*` tools. The agent loop waits
 * on `(stream_id, tool_call_id)` for the tab to report what happened; without
 * a reply it times out and the turn reads as exhausted. Replies follow the
 * shapes of `vexi-ui-command.service.ts` over a small fixed module catalog —
 * enough to grade routing, not a substitute for the Playwright check.
 */
const HEADLESS_MODULES = [
  { key: 'pos', label: 'Punto de Venta', route: '/admin/pos' },
  { key: 'orders', label: 'Órdenes', route: '/admin/orders' },
  { key: 'products', label: 'Productos', route: '/admin/products' },
  { key: 'inventory', label: 'Inventario', route: '/admin/inventory' },
  { key: 'customers', label: 'Clientes', route: '/admin/customers' },
  { key: 'expenses', label: 'Gastos', route: '/admin/expenses' },
  { key: 'accounting', label: 'Contabilidad', route: '/admin/accounting' },
  { key: 'reports', label: 'Reportes', route: '/admin/reports' },
  { key: 'settings', label: 'Configuración', route: '/admin/settings' },
];

function isUiCommand(name: unknown): boolean {
  return typeof name === 'string' && name.startsWith('ui_');
}

function headlessUiResult(name: string, args: unknown): string {
  const params = (args && typeof args === 'object' ? args : {}) as Record<
    string,
    unknown
  >;
  const key = String(params.module_key ?? '').toLowerCase();
  const entry =
    HEADLESS_MODULES.find(
      (module) => module.key === key || module.label.toLowerCase() === key,
    ) ?? null;
  switch (name) {
    case 'ui_list_modules':
      return JSON.stringify({
        modules: HEADLESS_MODULES.map((module) => ({
          ...module,
          visible: true,
        })),
        total: HEADLESS_MODULES.length,
      });
    case 'ui_navigate':
      return JSON.stringify(
        entry
          ? { status: 'ok', target: entry.label, landed_on: entry.route }
          : { status: 'unknown_module', module_key: key },
      );
    case 'ui_explain_module':
    case 'ui_why_hidden':
      return JSON.stringify(
        entry
          ? { ...entry, visible: true }
          : { status: 'unknown_module', module_key: key },
      );
    default:
      return JSON.stringify({ status: 'ok', note: 'headless e2e browser' });
  }
}

/** First object in the frames carrying a confirmation token (browser contract). */
export function findProposal(
  events: unknown[],
): { tool: string; arguments: Record<string, unknown>; token: string } | null {
  const stack: unknown[] = [...events];
  while (stack.length) {
    const node = stack.shift();
    if (!node || typeof node !== 'object') continue;
    const record = node as Record<string, unknown>;
    const token = record.confirmation_token ?? record.confirmationToken;
    const tool = record.tool ?? record.tool_name ?? record.name;
    const args = record.arguments ?? record.args;
    if (
      typeof token === 'string' &&
      token &&
      typeof tool === 'string' &&
      args &&
      typeof args === 'object'
    )
      return { tool, arguments: args as Record<string, unknown>, token };
    for (const value of Object.values(record))
      if (value && typeof value === 'object') stack.push(value);
  }
  return null;
}

function toolFrames(events: any[]): GoldenToolFrame[] {
  return events
    .filter(
      (event) =>
        (event.type === 'tool_call' || event.type === 'tool_result') &&
        event.tool?.name,
    )
    .map((event) => ({
      frame: event.type,
      name: String(event.tool.name),
      error_code: event.tool.execution?.error_code ?? null,
    }));
}

function proposedIn(events: any[]): boolean {
  return events.some(
    (event) =>
      ['pending_confirmation', 'confirmation', 'plan_approval'].includes(
        event.type,
      ) ||
      (event.type === 'done' &&
        (event.pending_confirmation ||
          event.plan ||
          ['pending_confirmation', 'awaiting_approval'].includes(
            event.execution?.outcome,
          ))) ||
      (event.type === 'tool_result' &&
        event.tool?.execution?.status === 'pending_confirmation'),
  );
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function knownTools(db: Db): Set<string> {
  return new Set(
    db
      .query(
        "select distinct canonical_name from ai_knowledge_documents where knowledge_scope='global' and entity_type='tool'",
      )
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

function compareOracle(expected: string, actual: string): boolean {
  if (expected.startsWith('>'))
    return Number(actual) > Number(expected.slice(1));
  return actual === expected;
}

/**
 * Idempotent local fixture (`fixtures/golden-e2e.fixture.sql`). Returns true
 * when it changed a row: the subscription feature cache (`sub:features:*`,
 * 60 s TTL) must expire before the first case sees the new plan.
 */
function applyFixture(db: Db): boolean {
  const before = db.query(FIXTURE_PROBE);
  db.file(join(__dirname, 'fixtures', 'golden-e2e.fixture.sql'));
  return db.query(FIXTURE_PROBE) !== before;
}
const FIXTURE_PROBE =
  "select coalesce(string_agg(ss.plan_id||':'||ss.paid_plan_id, ','), '') from store_subscriptions ss join stores s on s.id=ss.store_id where s.slug='roku'";

export async function runLiveSuite(options: Options): Promise<void> {
  mkdirSync(options.out, { recursive: true });
  const db = new Db(options.dbUrlFile, options.psql);
  if (applyFixture(db)) {
    process.stdout.write('fixture aplicado; esperando 61 s la caché de plan\n');
    await new Promise((resolve) => setTimeout(resolve, 61_000));
  }
  const api = new Api(options);
  const known = knownTools(db);
  const suite = loadSuite(options.suite, options.label).filter(
    (testCase) =>
      !options.cases ||
      options.cases.some((prefix) => testCase.id.startsWith(prefix)),
  );
  const startCredit = await credits(options.orKeyFile);
  const summary: any[] = [];
  for (const testCase of suite) {
    const remaining = await credits(options.orKeyFile);
    if (remaining !== null && remaining < options.minCreditUsd) {
      summary.push({ id: testCase.id, skipped: 'credit_floor', remaining });
      process.stdout.write(
        `${testCase.id}: SKIP (crédito ${remaining.toFixed(3)} < piso)\n`,
      );
      continue;
    }
    const record = await runCase(testCase, options, api, db, known);
    const after = await credits(options.orKeyFile);
    record.cost_usd =
      remaining !== null && after !== null
        ? Number((remaining - after).toFixed(5))
        : null;
    writeFileSync(
      join(options.out, `${options.label}-${testCase.id}.json`),
      JSON.stringify(record, null, 2),
    );
    summary.push(
      record.summary && { ...record.summary, cost_usd: record.cost_usd },
    );
    process.stdout.write(
      `${testCase.id}: ${record.pass ? 'PASS' : 'FAIL'} calls=${record.tokens.calls} p50=${record.tokens.prompt_p50} max=${record.tokens.prompt_max} cost=${record.cost_usd ?? '?'} ${record.failed_checks.join(',')}\n`,
    );
  }
  const endCredit = await credits(options.orKeyFile);
  writeFileSync(
    join(options.out, `${options.label}-summary.json`),
    JSON.stringify(
      {
        label: options.label,
        started_credit: startCredit,
        ended_credit: endCredit,
        spent_usd:
          startCredit !== null && endCredit !== null
            ? Number((startCredit - endCredit).toFixed(5))
            : null,
        cases: summary,
      },
      null,
      2,
    ),
  );
}

async function runCase(
  testCase: GoldenCase,
  options: Options,
  api: Api,
  db: Db,
  known: ReadonlySet<string>,
): Promise<any> {
  const started = Date.now();
  const token = await api.token(testCase.principal);
  let disabledIds = '';
  if (testCase.setup === 'empty_index')
    disabledIds = db.query(
      "with d as (update ai_knowledge_documents set active=false where knowledge_scope='global' and active returning id) select string_agg(id::text, ',') from d",
    );
  const turns: any[] = [];
  let conversationId = 0;
  for (const statement of testCase.setup_sql ?? []) db.query(statement);
  try {
    const created = await api.raw(
      'POST',
      '/store/ai-chat/conversations',
      token,
      {
        agent_key: testCase.agent,
        title: `E2E ${options.label} ${testCase.id}`,
      },
    );
    conversationId = Number(created?.data?.id);
    if (!conversationId) throw new Error(`conversation: ${created.status}`);
    const plan: Array<GoldenTurn & { graded: boolean }> = [
      ...(testCase.seed_history
        ? [{ message: testCase.seed_history.user, graded: false }]
        : []),
      ...testCase.turns.map((turn) => ({ ...turn, graded: true })),
    ];
    let pendingProposal: ReturnType<typeof findProposal> = null;
    for (const turn of plan) {
      const oracleBefore = turn.oracle ? db.query(turn.oracle.sql) : undefined;
      const intent = await api.raw(
        'POST',
        `/store/ai-chat/conversations/${conversationId}/stream-intent`,
        token,
        { content: turn.message },
      );
      const streamId = intent?.data?.stream_id;
      const events = streamId
        ? await api.stream(token, conversationId, streamId)
        : [{ type: 'error', status: intent.status }];
      const streamed = events
        .filter((event) => event.type === 'text')
        .map((event) => event.content ?? '')
        .join('');
      const conversation = await api.raw(
        'GET',
        `/store/ai-chat/conversations/${conversationId}`,
        token,
      );
      const assistant = (conversation?.data?.messages ?? []).filter(
        (message: any) => message.role === 'assistant',
      );
      const visible = String(assistant.at(-1)?.content ?? streamed);
      const proposal = findProposal(events);
      if (proposal) pendingProposal = proposal;
      const proposed = proposedIn(events) || !!proposal;
      const oracleMid = turn.oracle ? db.query(turn.oracle.sql) : undefined;
      let approval: any;
      if (turn.approve === 'approve' && pendingProposal) {
        approval = await api.raw(
          'POST',
          `/store/${testCase.agent}/confirmations/apply`,
          token,
          {
            conversation_id: conversationId,
            tool: pendingProposal.tool,
            arguments: pendingProposal.arguments,
            confirmation_token: pendingProposal.token,
          },
        );
        approval = {
          status: approval.status,
          success: approval.success,
          message: approval.message,
        };
        pendingProposal = null;
      } else if (turn.approve === 'reject') pendingProposal = null;
      const oracleAfter = turn.oracle ? db.query(turn.oracle.sql) : undefined;
      const tools = toolFrames(events);
      const oracleOk = turn.oracle
        ? (turn.oracle.before === undefined ||
            compareOracle(turn.oracle.before, oracleBefore!)) &&
          (!turn.oracle.unchanged || oracleAfter === oracleBefore) &&
          (turn.oracle.after_approve === undefined ||
            turn.approve !== 'approve' ||
            compareOracle(turn.oracle.after_approve, oracleAfter!))
        : undefined;
      const checks = turn.graded
        ? gradeGoldenTurn(turn, {
            agent: testCase.agent,
            visible,
            tools,
            errorFrame: events.some((event) => event.type === 'error'),
            proposed,
            oracleUnchangedBeforeApproval: turn.oracle
              ? oracleMid === oracleBefore
              : undefined,
            known,
          })
        : {};
      if (turn.graded && oracleOk !== undefined) checks.oracle = oracleOk;
      if (turn.graded && turn.approve === 'approve' && turn.expect_write)
        checks.approval_applied =
          !!approval && approval.status < 300 && approval.success !== false;
      turns.push({
        message: turn.message,
        graded: turn.graded,
        visible,
        tools_called: tools
          .filter((tool) => tool.frame === 'tool_call')
          .map((tool) => tool.name),
        tool_errors: tools
          .filter((tool) => tool.frame === 'tool_result' && tool.error_code)
          .map((tool) => `${tool.name}:${tool.error_code}`),
        proposed,
        approval,
        oracle: turn.oracle
          ? { before: oracleBefore, mid: oracleMid, after: oracleAfter }
          : undefined,
        done_execution: events.find((event) => event.type === 'done')
          ?.execution,
        event_types: events.map((event) => event.type),
        error_frames: events
          .filter((event) => event.type === 'error')
          .map((event) => JSON.stringify(event).slice(0, 400)),
        checks,
      });
    }
  } finally {
    for (const statement of testCase.teardown_sql ?? []) db.query(statement);
    if (disabledIds)
      db.query(
        `update ai_knowledge_documents set active=true where id in (${disabledIds
          .split(',')
          .map((id) => `'${id.replace(/'/g, '')}'`)
          .join(',')})`,
      );
  }
  const logs = conversationId
    ? db
        .query(
          `select prompt_tokens, completion_tokens, cache_read_tokens from ai_engine_logs where conversation_id='${conversationId}' order by created_at`,
        )
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split('|').map(Number))
    : [];
  const prompts = logs.map(([prompt]) => prompt);
  const router = conversationId
    ? db
        .query(
          `select coalesce(attributes->>'tool_count','')||'|'||coalesce(attributes->>'definition_tokens','')||'|'||coalesce(attributes->>'retrieval_source','') from ai_agent_trace_spans where kind='router' and conversation_id='${conversationId}' order by started_at`,
        )
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split('|'))
    : [];
  const retrievalSources = [
    ...new Set(router.map((row) => row[2]).filter(Boolean)),
  ];
  const failed = turns.flatMap((turn, index) =>
    Object.entries(turn.checks)
      .filter(([, ok]) => !ok)
      .map(([name]) => `t${index + 1}:${name}`),
  );
  if (
    testCase.expect_retrieval &&
    !retrievalSources.includes(testCase.expect_retrieval) &&
    retrievalSources.length
  )
    failed.push(`retrieval:${retrievalSources.join('+')}`);
  const tokens = {
    calls: logs.length,
    prompt_total: prompts.reduce((sum, value) => sum + value, 0),
    prompt_p50: median(prompts),
    prompt_max: Math.max(0, ...prompts),
    completion_total: logs.reduce((sum, [, completion]) => sum + completion, 0),
    cache_read_total: logs.reduce((sum, [, , cache]) => sum + cache, 0),
    router_tool_count_p50: median(
      router.map((row) => Number(row[0])).filter(Boolean),
    ),
    router_definition_tokens_p50: median(
      router.map((row) => Number(row[1])).filter(Boolean),
    ),
    retrieval_sources: retrievalSources,
  };
  const pass = failed.length === 0;
  return {
    label: options.label,
    case: testCase.id,
    agent: testCase.agent,
    principal: testCase.principal,
    channel: testCase.channel ?? 'text',
    conversation_id: conversationId,
    elapsed_s: Math.round((Date.now() - started) / 100) / 10,
    turns,
    tokens,
    failed_checks: failed,
    pass,
    summary: {
      id: testCase.id,
      agent: testCase.agent,
      pass,
      failed,
      turns: turns.filter((turn) => turn.graded).length,
      ...tokens,
    },
  };
}

/** Entry used by `npm run eval:agentic -- --mode live --suite …`. */
export function runLiveFromArgv(argv: string[]): Promise<void> {
  return runLiveSuite(parseArgs(argv));
}

if (require.main === module) {
  runLiveSuite(parseArgs(process.argv.slice(2))).catch((error: unknown) => {
    process.stderr.write(
      `live-http: ${error instanceof Error ? error.message : 'failed'}\n`,
    );
    process.exitCode = 1;
  });
}
