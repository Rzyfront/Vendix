/**
 * Offline baseline of the tool-token cost of Vex (T60, config 0 = today's
 * routing). No model, DB, network or server: it builds the real tool registry
 * from the source tree, the real ToolRouterService (with a stub ranker) and
 * estimates sizes with the repo's `bytes_v1` estimator.
 *
 *   npx ts-node --transpile-only --project tsconfig.json -r tsconfig-paths/register \
 *     src/ai-engine/evals/tool-tokens/measure-tool-tokens.ts --config 0|1|2 [--out <dir>]
 *
 * Deterministic: same tree, same bytes. Config 0 writes baseline.config-0.json
 * and REPORT.md; config 1 (T62: AI_TOOL_DISCOVERY_STUBS on) writes
 * baseline.config-1.json and appends the "Configuración 1" section to REPORT.md.
 * Config 2 (T70: Code Mode scripts over config 0) writes baseline.config-2.json
 * and appends "Configuración 2". All are bytes_v1 ESTIMATES, never provider-observed tokens.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Logger } from '@nestjs/common';
import { AIToolRegistry } from '../../tools/ai-tool-registry';
import { ToolRouterService } from '../../tools/tool-router.service';
import { collectToolCatalog } from '../../tools/tool-catalog.test-helper';
import { isForeignSurfaceTool } from '../../tools/surface-tools';
import { createCodeModeTools } from '../../tools/domains/code-execution.tools';
import { CODEMODE_ALLOWLIST } from '../../sandbox/codemode-allowlist.generated';
import {
  CODEMODE_LIMITS,
  CODEMODE_SCRIPTS_PER_TURN,
} from '../../sandbox/interfaces/codemode-protocol.interface';
import { DESCRIBE_TOOL, TOOL_WORKING_SET } from '../../tools/tool-working-set';
import {
  TOOL_STUBS_ROUTING_SENTENCE,
  toolStubsText,
} from '../../tools/tool-stubs-text';
import { estimateAgentInputTokens } from '../../context/agent-context-budget';
import type {
  AIMessage,
  AIToolDefinition,
} from '../../interfaces/ai-provider.interface';
import {
  BankTask,
  FINAL_ANSWER_OUTPUT_BYTES,
  ResultFixture,
  TOKEN_ESTIMATOR,
  assertBank,
  SCRIPT_MIN_CALLS,
  SCRIPT_MIN_ROWS,
  buildScriptSource,
  fixtureResult,
  measureScriptedTrajectory,
  measureTrajectory,
  scriptability,
  scriptResultText,
  shouldScript,
  successProxy,
  summarizeByKind,
} from './tool-token-metrics';

/** Assumption: the Vex system prompt is sized at this many bytes (not measured). */
const SYSTEM_PLACEHOLDER_BYTES = 6000;
const HELP =
  'Uso: ts-node measure-tool-tokens.ts --config 0|1|2 [--out <dir>]\n  --config 0  enrutador actual\n  --config 1  fichas cortas + describe_tool (AI_TOOL_DISCOVERY_STUBS); requiere haber corrido la 0\n  --config 2  config 0 + run_code (Code Mode, scripts de solo lectura); requiere haber corrido la 0\n              base = config 0 (el descubrimiento queda apagado: la config 1 no pasó su compuerta)';

function parseCli(argv: string[]): { config: number; out: string } {
  const cli = { config: -1, out: __dirname };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help') {
      console.log(HELP);
      process.exit(0);
    } else if (argv[i] === '--config') cli.config = Number(argv[++i]);
    else if (argv[i] === '--out') cli.out = resolve(argv[++i] ?? '');
    else throw new Error(`Argumento desconocido ${argv[i]}\n${HELP}`);
  }
  if (![0, 1, 2].includes(cli.config))
    throw new Error(`Falta --config 0|1|2\n${HELP}`);
  return cli;
}

const read = <T>(name: string): T =>
  JSON.parse(readFileSync(resolve(__dirname, name), 'utf8')) as T;

function systemMessage(digest: string): AIMessage {
  const base =
    'Eres Vex, el agente de negocio del dueño. Responde en español, con cifras verificadas por herramientas. ';
  const body = base
    .repeat(Math.ceil(SYSTEM_PLACEHOLDER_BYTES / base.length))
    .slice(0, SYSTEM_PLACEHOLDER_BYTES);
  return { role: 'system', content: `${body}\n${digest}` };
}

function rankerFor(oracle: string[], coverage: number) {
  return {
    rank: async () => ({
      names: oracle,
      degraded: [],
      scores: Object.fromEntries(oracle.map((n, i) => [n, 100 - i])),
      coverage,
      source: 'baseline_stub',
    }),
  } as any;
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  Logger.overrideLogger(false);
  // Read when the tool factories run, so it must be set before the registry is built.
  if (cli.config === 1) process.env.AI_TOOL_DISCOVERY_STUBS = 'true';
  const tasks = read<{ tasks: BankTask[] }>('task-bank.json').tasks;
  const fixtures = read<{ tools: Record<string, ResultFixture> }>(
    'tool-result-fixtures.json',
  ).tools;
  assertBank(tasks);

  const registry = new AIToolRegistry({} as any);
  const catalog = collectToolCatalog();
  registry.registerMany(catalog.map((c) => c.tool));
  const all = registry.getAll();
  const permissions = [
    ...new Set(all.flatMap((t) => t.requiredPermissions ?? [])),
  ].sort();
  // Same authority as AIAgentService.resolveRoutedAuthority for an owner, Vex, non-durable turn.
  const denied = all.map((t) => t.name).filter((n) => n.startsWith('ui_'));
  const authorized: AIToolDefinition[] = registry
    .getAgentDefinitions(permissions, { denied_tools: denied })
    .filter(
      (d) =>
        d.function.name !== 'run_readonly_script' &&
        d.function.name !== 'run_analysis' &&
        // Code Mode (F10) is config 2 (T70), added on top of this list there: kept out so configs 0 and 1 stay comparable.
        d.function.name !== 'run_code' &&
        !isForeignSurfaceTool(d.function.name, 'vex'),
    );
  const known = new Set(all.map((t) => t.name));
  const authorizedSet = new Set(authorized.map((d) => d.function.name));

  const digestRouter = new ToolRouterService(registry, rankerFor([], 1));
  const digest = digestRouter.buildToolIndexDigest(authorized);
  if (cli.config === 1)
    return runConfig1({
      cli,
      tasks,
      fixtures,
      registry,
      authorized,
      authorizedSet,
      known,
      digest,
      systemMessage,
    });
  if (cli.config === 2)
    return runConfig2({
      cli,
      tasks,
      fixtures,
      registry,
      authorized,
      authorizedSet,
      known,
      digest,
    });
  const base = (message: string): AIMessage[] => [
    systemMessage(digest),
    { role: 'user', content: message },
  ];

  const rows = [];
  for (const task of tasks) {
    const oracleTools = task.oracle.groups.flat().map((c) => c.tool);
    const proxy = successProxy(oracleTools, authorizedSet, known);
    const variants: Record<string, any> = {};
    for (const [variant, coverage] of [
      ['routed', 1],
      ['full_catalog', 0.5],
    ] as const) {
      const router = new ToolRouterService(
        registry,
        rankerFor([...new Set(oracleTools)], coverage),
      );
      const session = router.createSession(task.message, 'baseline', [], 'vex');
      const selection = await router.select(session, authorized, false, false);
      const offered = new Set(selection.definitions.map((d) => d.function.name));
      const byName = new Map(authorized.map((d) => [d.function.name, d]));
      // A tool called in group g reaches the provider from round g+1 (hard rule).
      const toolsForRound = (round: number): AIToolDefinition[] => {
        const extra = task.oracle.groups
          .slice(0, round)
          .flat()
          .map((c) => c.tool)
          .filter((n) => !offered.has(n) && byName.has(n));
        return [
          ...selection.definitions,
          ...[...new Set(extra)].map((n) => byName.get(n)!),
        ];
      };
      const m = measureTrajectory({
        base: base(task.message),
        groups: task.oracle.groups,
        fixtures,
        toolsForRound,
      });
      variants[variant] = {
        offered_tool_count: selection.definitions.length,
        full_catalog_reason: selection.fullCatalogReason,
        definition_tokens_turn0: estimateAgentInputTokens([], selection.definitions) - 32,
        ...m,
      };
    }
    rows.push({
      id: task.id,
      source: task.source,
      kind: task.kind,
      message: task.message,
      round_trips: task.oracle.groups.length + 1,
      oracle_tools: [...new Set(oracleTools)],
      reachable: proxy.reachable,
      missing: proxy.missing,
      unauthorized: proxy.unauthorized,
      variants,
    });
  }

  const totals = (variant: string) =>
    summarizeByKind(
      rows.map((r) => ({
        kind: r.kind,
        input_total: r.variants[variant].input_total,
        output_estimate: r.variants[variant].output_estimate,
        round_trips: r.round_trips,
        reachable: r.reachable,
      })),
    );
  const fullDefTokens = estimateAgentInputTokens([], authorized) - 32;
  const baseline = {
    config: 0,
    config_name: 'enrutador actual (working set dinámico) vs catálogo completo de referencia',
    token_estimator: TOKEN_ESTIMATOR,
    assumptions: {
      system_prompt_bytes: SYSTEM_PLACEHOLDER_BYTES,
      final_answer_output_bytes: FINAL_ANSWER_OUTPUT_BYTES,
      prefetch_top: TOOL_WORKING_SET.prefetchTop,
    },
    tools: {
      declared_unique: all.length,
      factory_outputs: catalog.length,
      authorized_for_owner_vex: authorized.length,
      owner_permissions_used: permissions.length,
      denied_ui_tools: denied.length,
    },
    definition_tokens_full_catalog: fullDefTokens,
    digest_bytes: Buffer.byteLength(digest, 'utf8'),
    totals: { routed: totals('routed'), full_catalog: totals('full_catalog') },
    tasks: rows,
  };
  writeFileSync(
    resolve(cli.out, 'baseline.config-0.json'),
    `${JSON.stringify(baseline, null, 1)}\n`,
  );
  writeFileSync(
    resolve(cli.out, 'REPORT.md'),
    renderReport(baseline) + keptConfig1Section(resolve(cli.out, 'REPORT.md')),
  );
  console.log(
    `declared=${all.length} authorized=${authorized.length} tasks=${rows.length} ` +
      `unreachable=${rows.filter((r) => !r.reachable).length}`,
  );
  if (rows.some((r) => !r.reachable)) process.exitCode = 1;
}

const CONFIG1_HEADING = '## Configuración 1';
const CONFIG2_HEADING = '## Configuración 2';

/** The config 2 section of an existing REPORT.md (empty when absent). */
function keptConfig2Section(text: string): string {
  const at = text.indexOf(CONFIG2_HEADING);
  return at < 0 ? '' : text.slice(at);
}

/** The config 1 section of an existing REPORT.md, so a config 0 run never drops it. */
function keptConfig1Section(path: string): string {
  if (!existsSync(path)) return '';
  const text = readFileSync(path, 'utf8');
  const at = text.indexOf(CONFIG1_HEADING);
  return at < 0 ? '' : text.slice(at);
}

interface Config1World {
  cli: { config: number; out: string };
  tasks: BankTask[];
  fixtures: Record<string, ResultFixture>;
  registry: AIToolRegistry;
  authorized: AIToolDefinition[];
  authorizedSet: Set<string>;
  known: Set<string>;
  digest: string;
  systemMessage: (digest: string) => AIMessage;
}

/**
 * Config 1 (T62): AI_TOOL_DISCOVERY_STUBS on. The preload (and every tool the
 * trajectory calls) travels as a one-line stub instead of a definition.
 * Two readings of the same bank, both estimates:
 *  - `direct`: the model calls a stubbed tool straight from its stub (the hard
 *    rule keeps it callable); optimistic, wrong arguments would cost a retry.
 *  - `describe`: before each group the model calls `describe_tool` for every
 *    tool of that group not yet described (one extra round-trip per group);
 *    pessimistic, it is the headline.
 */
async function runConfig1(w: Config1World): Promise<void> {
  const base0Path = resolve(w.cli.out, 'baseline.config-0.json');
  if (!existsSync(base0Path))
    throw new Error('Falta baseline.config-0.json: corre antes --config 0.');
  const base0 = JSON.parse(readFileSync(base0Path, 'utf8'));
  const c0ById = new Map<string, any>(base0.tasks.map((t: any) => [t.id, t]));
  const sentenceDigest = `${w.digest}\n${TOOL_STUBS_ROUTING_SENTENCE}`;
  const rows = [];
  for (const task of w.tasks) {
    const oracleTools = task.oracle.groups.flat().map((c) => c.tool);
    const proxy = successProxy(oracleTools, w.authorizedSet, w.known);
    const c0 = c0ById.get(task.id);
    if (!c0) throw new Error(`La config 0 no tiene la tarea ${task.id}`);
    const router = new ToolRouterService(
      w.registry,
      rankerFor([...new Set(oracleTools)], 1),
    );
    const session = router.createSession(task.message, 'baseline', [], 'vex');
    // sel[d] = the offer once the first d groups have run (hard rule loads them).
    const sel = [] as Awaited<ReturnType<typeof router.select>>[];
    for (let d = 0; d <= task.oracle.groups.length; d++) {
      if (d > 0)
        for (const call of task.oracle.groups[d - 1])
          router.markUsed(session, call.tool, w.authorized);
      sel.push(
        await router.select(session, w.authorized, false, false, {
          stubs: true,
        }),
      );
    }
    const measure = (groups: BankTask['oracle']['groups'], done: number[]) =>
      measureTrajectory({
        base: [],
        groups,
        fixtures: w.fixtures,
        toolsForRound: (r) => sel[done[r]].definitions,
        baseForRound: (r) => [
          w.systemMessage(sentenceDigest),
          { role: 'system', content: toolStubsText(sel[done[r]].stubs) },
          { role: 'user', content: task.message },
        ],
        resultFor: (call) =>
          call.tool === DESCRIBE_TOOL
            ? router.describe(call.args ?? {}, w.authorized)
            : undefined,
      });
    const direct = measure(
      task.oracle.groups,
      task.oracle.groups.map((_, i) => i).concat(task.oracle.groups.length),
    );
    const describedGroups: BankTask['oracle']['groups'] = [];
    const done: number[] = [];
    const described = new Set<string>();
    task.oracle.groups.forEach((group, i) => {
      const fresh = [...new Set(group.map((c) => c.tool))].filter(
        (t) => !described.has(t),
      );
      if (fresh.length) {
        describedGroups.push(
          fresh.map((tool) => ({ tool: DESCRIBE_TOOL, args: { name: tool } })),
        );
        done.push(i);
        fresh.forEach((t) => described.add(t));
      }
      describedGroups.push(group);
      done.push(i);
    });
    done.push(task.oracle.groups.length);
    const withDescribe = measure(describedGroups, done);
    rows.push({
      id: task.id,
      kind: task.kind,
      reachable: proxy.reachable,
      full_catalog_reason: sel[0].fullCatalogReason,
      offered_tool_count_c0: c0.variants.routed.offered_tool_count,
      offered_tool_count_c1: sel[0].definitions.length,
      stub_count_turn0: sel[0].stubs?.length ?? 0,
      definition_tokens_turn0_c0: c0.variants.routed.definition_tokens_turn0,
      definition_tokens_turn0_c1:
        estimateAgentInputTokens([], sel[0].definitions) - 32,
      round_trips_c0: c0.round_trips,
      round_trips_direct: direct.round_trips,
      round_trips_describe: withDescribe.round_trips,
      input_c0: c0.variants.routed.input_total,
      input_direct: direct.input_total,
      input_describe: withDescribe.input_total,
      output_c0: c0.variants.routed.output_estimate,
      output_describe: withDescribe.output_estimate,
    });
  }
  const sum = (kind: string, key: string) =>
    rows
      .filter((r) => kind === 'all' || r.kind === kind)
      .reduce((a: number, r: any) => a + r[key], 0);
  const group = (kind: string) => ({
    tasks: rows.filter((r) => kind === 'all' || r.kind === kind).length,
    reachable: rows.filter(
      (r) => (kind === 'all' || r.kind === kind) && r.reachable,
    ).length,
    input_c0: sum(kind, 'input_c0'),
    input_direct: sum(kind, 'input_direct'),
    input_describe: sum(kind, 'input_describe'),
    round_trips_c0: sum(kind, 'round_trips_c0'),
    round_trips_describe: sum(kind, 'round_trips_describe'),
    output_c0: sum(kind, 'output_c0'),
    output_describe: sum(kind, 'output_describe'),
  });
  // Upper bound of a compact index (`dominio: n herramientas`, no names): computed
  // from the real digest, never emitted by the product.
  const tokensOf = (text: string) =>
    estimateAgentInputTokens([{ role: 'system', content: text }], []) - 32;
  const compactDigest = w.digest
    .split('\n')
    .map((line) => {
      const m = line.match(/^- ([^:]+): (.+)$/);
      return m ? `- ${m[1]}: ${m[2].split(', ').length} herramientas` : line;
    })
    .join('\n');
  const config1 = {
    config: 1,
    config_name:
      'fichas cortas + describe_tool (AI_TOOL_DISCOVERY_STUBS=true), índice del taller sin cambios',
    token_estimator: TOKEN_ESTIMATOR,
    label: 'ESTIMACIÓN determinista bytes_v1; no son tokens observados del proveedor',
    index_decision: {
      choice: 'keep_names',
      digest_bytes: Buffer.byteLength(w.digest, 'utf8'),
      digest_tokens: tokensOf(w.digest),
      compact_digest_tokens: tokensOf(compactDigest),
      rounds_c0: rows.reduce((a, r) => a + r.round_trips_c0, 0),
      routing_sentence_bytes: Buffer.byteLength(
        TOOL_STUBS_ROUTING_SENTENCE,
        'utf8',
      ),
      definition_tokens_full_catalog:
        estimateAgentInputTokens([], w.authorized) - 32,
      core_definition_tokens_turn0: rows[0].definition_tokens_turn0_c1,
    },
    totals: {
      single: group('single'),
      multi_step: group('multi_step'),
      all: group('all'),
    },
    tasks: rows,
  };
  writeFileSync(
    resolve(w.cli.out, 'baseline.config-1.json'),
    `${JSON.stringify(config1, null, 1)}\n`,
  );
  const reportPath = resolve(w.cli.out, 'REPORT.md');
  const current = existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : '';
  const at = current.indexOf(CONFIG1_HEADING);
  const head = at < 0 ? current : current.slice(0, at);
  writeFileSync(
    reportPath,
    head + renderConfig1(config1) + keptConfig2Section(current),
  );
  console.log(
    `config1 tasks=${rows.length} unreachable=${rows.filter((r) => !r.reachable).length} ` +
      `input_c0=${config1.totals.all.input_c0} input_describe=${config1.totals.all.input_describe}`,
  );
  if (rows.some((r) => !r.reachable)) process.exitCode = 1;
}

/** The routing rule text, read from the product source (it is not exported). */
function readRoutingRule(): string {
  const src = readFileSync(resolve(__dirname, '../../ai-agent.service.ts'), 'utf8');
  const m = src.match(/const CODE_MODE_ROUTING_RULE = \[([\s\S]*?)\]\.join\(' '\);/);
  if (!m) throw new Error('No encuentro CODE_MODE_ROUTING_RULE en ai-agent.service.ts');
  return (new Function(`return [${m[1]}].join(' ');`) as () => string)();
}

interface Config2World {
  cli: { config: number; out: string };
  tasks: BankTask[];
  fixtures: Record<string, ResultFixture>;
  registry: AIToolRegistry;
  authorized: AIToolDefinition[];
  authorizedSet: Set<string>;
  known: Set<string>;
  digest: string;
}

/**
 * Config 2 (T70): config 0 routing + `run_code` offered on every turn. A
 * multi-step task whose tools are all allowlisted, read-only and offered at
 * turn 0 can run as ONE script (2 model rounds). Two readings, both estimates:
 *  - `policy` (headline): the model follows the routing rule, so only tasks
 *    with >= 3 calls or >= 50 intermediate rows script; 1-2 small reads stay direct.
 *  - `max` (upper bound): every scriptable multi-step task scripts.
 * Every non-scripted task stays on its config 0 trajectory but pays the offer
 * overhead (run_code definition + routing-rule message) on every round.
 */
async function runConfig2(w: Config2World): Promise<void> {
  const base0Path = resolve(w.cli.out, 'baseline.config-0.json');
  if (!existsSync(base0Path))
    throw new Error('Falta baseline.config-0.json: corre antes --config 0.');
  const base0 = JSON.parse(readFileSync(base0Path, 'utf8'));
  const c0ById = new Map<string, any>(base0.tasks.map((t: any) => [t.id, t]));
  const rule = readRoutingRule();
  const ruleMessage: AIMessage = { role: 'system', content: rule };
  const tokensOf = (text: string) =>
    estimateAgentInputTokens([{ role: 'system', content: text }], []) - 32;

  // The run_code definition exactly as the product registers it (stub deps: only the schema is read).
  const codeRegistry = new AIToolRegistry({} as any);
  codeRegistry.registerMany(
    createCodeModeTools({
      runner: { available: () => true },
      blocks: {},
      entitlements: {},
      registry: w.registry,
      policy: { eligible: () => true },
    } as any),
  );
  const runCode = codeRegistry.getAgentDefinitions([], {}).find(
    (d) => d.function.name === 'run_code',
  );
  if (!runCode) throw new Error('No pude construir la definición de run_code');
  const runCodeDefTokens = estimateAgentInputTokens([], [runCode]) - 32;

  const allowlist = new Set(CODEMODE_ALLOWLIST.map((e) => e.name));
  const writeTools = new Set(
    w.registry
      .getAll()
      .filter((t) => t.readOnly !== true)
      .map((t) => t.name),
  );
  const userBase = (message: string): AIMessage[] => [
    { role: 'system', content: (systemMessage(w.digest).content as string) },
    ruleMessage,
    { role: 'user', content: message },
  ];

  const rows = [];
  for (const task of w.tasks) {
    const oracleCalls = task.oracle.groups.flat();
    const oracleTools = oracleCalls.map((c) => c.tool);
    const proxy = successProxy(oracleTools, w.authorizedSet, w.known);
    const c0 = c0ById.get(task.id);
    if (!c0) throw new Error(`La config 0 no tiene la tarea ${task.id}`);
    const c0r = c0.variants.routed;

    // Same routed selection as config 0.
    const router = new ToolRouterService(
      w.registry,
      rankerFor([...new Set(oracleTools)], 1),
    );
    const session = router.createSession(task.message, 'baseline', [], 'vex');
    const selection = await router.select(session, w.authorized, false, false);
    const offered = new Set(selection.definitions.map((d) => d.function.name));
    const byName = new Map(w.authorized.map((d) => [d.function.name, d]));
    const toolsForRound = (round: number): AIToolDefinition[] => {
      const extra = task.oracle.groups
        .slice(0, round)
        .flat()
        .map((c) => c.tool)
        .filter((n) => !offered.has(n) && byName.has(n));
      return [
        ...selection.definitions,
        ...[...new Set(extra)].map((n) => byName.get(n)!),
      ];
    };
    // Replication check: without the offer this is exactly config 0.
    const replica = measureTrajectory({
      base: [
        { role: 'system', content: (systemMessage(w.digest).content as string) },
        { role: 'user', content: task.message },
      ],
      groups: task.oracle.groups,
      fixtures: w.fixtures,
      toolsForRound,
    });
    if (replica.input_total !== c0r.input_total)
      throw new Error(
        `La réplica de la config 0 no coincide en ${task.id}: ${replica.input_total} vs ${c0r.input_total}`,
      );
    // Direct trajectory with run_code offered (definition + rule on every round).
    const directOffer = measureTrajectory({
      base: userBase(task.message),
      groups: task.oracle.groups,
      fixtures: w.fixtures,
      toolsForRound: (r) => [...toolsForRound(r), runCode],
    });

    const intermediateRows = oracleCalls.reduce((a, c) => {
      const f = w.fixtures[c.tool];
      return a + (f?.sample_row ? (c.rows ?? f.default_rows ?? 1) : 0);
    }, 0);
    const notOffered = [...new Set(oracleTools)]
      .filter((t) => !offered.has(t))
      .map((t) => `not_offered_turn0:${t}`);
    const sc = scriptability(oracleTools, allowlist, writeTools);
    const blockers = [...sc.blockers, ...notOffered];
    const scriptable = task.kind === 'multi_step' && blockers.length === 0;
    const scriptedMax = scriptable;
    const scriptedPolicy =
      scriptable &&
      shouldScript({ calls: oracleCalls.length, intermediateRows });
    const scripted = scriptedMax
      ? measureScriptedTrajectory({
          base: userBase(task.message),
          groups: task.oracle.groups,
          fixtures: w.fixtures,
          definitions: [...selection.definitions, runCode],
          purpose: task.message.slice(0, 120),
        })
      : null;
    const source = scriptedMax ? buildScriptSource(task.oracle.groups) : '';
    const pick = (use: boolean) => (use && scripted ? scripted : directOffer);
    rows.push({
      id: task.id,
      kind: task.kind,
      reachable: proxy.reachable,
      calls: oracleCalls.length,
      intermediate_rows: intermediateRows,
      scriptable,
      script_blockers: blockers,
      scripted_policy: scriptedPolicy,
      scripted_max: scriptedMax,
      script_source_bytes: Buffer.byteLength(source, 'utf8'),
      intermediate_result_bytes_c0: directOffer.intermediate_result_bytes,
      script_result_bytes: scripted
        ? Buffer.byteLength(
            scriptResultText(
              oracleCalls.map((c) =>
                fixtureResult(w.fixtures[c.tool], c.rows),
              ),
              oracleTools,
            ),
            'utf8',
          )
        : 0,
      definition_tokens_turn0_c0: c0r.definition_tokens_turn0,
      definition_tokens_turn0_c2: c0r.definition_tokens_turn0 + runCodeDefTokens,
      round_trips_c0: c0.round_trips,
      round_trips_policy: pick(scriptedPolicy).round_trips,
      round_trips_max: pick(scriptedMax).round_trips,
      input_c0: c0r.input_total,
      input_direct_offer: directOffer.input_total,
      input_policy: pick(scriptedPolicy).input_total,
      input_max: pick(scriptedMax).input_total,
      output_c0: c0r.output_estimate,
      output_policy: pick(scriptedPolicy).output_estimate,
      output_max: pick(scriptedMax).output_estimate,
    });
  }

  const sel = (kind: string) =>
    rows.filter((r) => kind === 'all' || r.kind === kind);
  const sum = (kind: string, key: string) =>
    sel(kind).reduce((a: number, r: any) => a + r[key], 0);
  const group = (kind: string) => ({
    tasks: sel(kind).length,
    scriptable: sel(kind).filter((r) => r.scriptable).length,
    scripted_policy: sel(kind).filter((r) => r.scripted_policy).length,
    scripted_max: sel(kind).filter((r) => r.scripted_max).length,
    reachable: sel(kind).filter((r) => r.reachable).length,
    input_c0: sum(kind, 'input_c0'),
    input_direct_offer: sum(kind, 'input_direct_offer'),
    input_policy: sum(kind, 'input_policy'),
    input_max: sum(kind, 'input_max'),
    definition_tokens_turn0_c0: sum(kind, 'definition_tokens_turn0_c0'),
    definition_tokens_turn0_c2: sum(kind, 'definition_tokens_turn0_c2'),
    round_trips_c0: sum(kind, 'round_trips_c0'),
    round_trips_policy: sum(kind, 'round_trips_policy'),
    round_trips_max: sum(kind, 'round_trips_max'),
    output_c0: sum(kind, 'output_c0'),
    output_policy: sum(kind, 'output_policy'),
  });
  const c1Path = resolve(w.cli.out, 'baseline.config-1.json');
  const c1 = existsSync(c1Path)
    ? JSON.parse(readFileSync(c1Path, 'utf8')).totals
    : null;
  const totals = {
    single: group('single'),
    multi_step: group('multi_step'),
    all: group('all'),
  };
  const drop = (a: number, c: number) => (c - a) / c;
  const m = totals.multi_step;
  const gate = (input: number, rounds: number) => ({
    input_reduction: drop(input, m.input_c0),
    rounds_reduction: drop(rounds, m.round_trips_c0),
    tokens_leg_met: drop(input, m.input_c0) >= 0.5,
    rounds_leg_met: drop(rounds, m.round_trips_c0) >= 0.4,
    success_leg: 'pending_live_run',
    gate_met: false,
  });
  const config2 = {
    config: 2,
    config_name:
      'config 0 (enrutador actual, descubrimiento apagado) + run_code ofrecido en cada turno',
    token_estimator: TOKEN_ESTIMATOR,
    label: 'ESTIMACIÓN determinista bytes_v1; no son tokens observados del proveedor',
    base_config: 0,
    assumptions: {
      routing_rule_bytes: Buffer.byteLength(rule, 'utf8'),
      routing_rule_tokens: tokensOf(rule),
      run_code_definition_tokens: runCodeDefTokens,
      script_min_calls: SCRIPT_MIN_CALLS,
      script_min_rows: SCRIPT_MIN_ROWS,
      result_bytes_limit: CODEMODE_LIMITS.result_bytes,
      preview_rows: 5,
      scripts_per_turn: CODEMODE_SCRIPTS_PER_TURN,
      allowlist_size: allowlist.size,
      write_tools_declared: writeTools.size,
    },
    gate_n14: {
      policy: gate(m.input_policy, m.round_trips_policy),
      max: gate(m.input_max, m.round_trips_max),
    },
    totals,
    config1_totals_for_reference: c1,
    tasks: rows,
  };
  writeFileSync(
    resolve(w.cli.out, 'baseline.config-2.json'),
    `${JSON.stringify(config2, null, 1)}\n`,
  );
  const reportPath = resolve(w.cli.out, 'REPORT.md');
  const current = existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : '';
  const at = current.indexOf(CONFIG2_HEADING);
  const head = at < 0 ? current : current.slice(0, at);
  writeFileSync(reportPath, head + renderConfig2(config2));
  console.log(
    `config2 tasks=${rows.length} scriptable=${totals.all.scriptable} scripted_policy=${totals.all.scripted_policy} ` +
      `multi_input_c0=${m.input_c0} policy=${m.input_policy} max=${m.input_max} ` +
      `rounds ${m.round_trips_c0} -> ${m.round_trips_policy}/${m.round_trips_max}`,
  );
  if (rows.some((r) => !r.reachable)) process.exitCode = 1;
}

function renderConfig2(b: any): string {
  const n = (v: number) => v.toLocaleString('es-CO');
  const pct = (a: number, c: number) =>
    `${(((a - c) / c) * 100).toFixed(1).replace('.', ',')} %`;
  const t = b.totals;
  const a = b.assumptions;
  const c1 = b.config1_totals_for_reference;
  const gp = b.gate_n14.policy;
  const gm = b.gate_n14.max;
  const yes = (v: boolean) => (v ? 'cumple' : 'NO cumple');
  const row = (label: string, v: any) =>
    `| ${label} | ${v.tasks} | ${n(v.input_c0)} | ${n(v.input_policy)} (${pct(v.input_policy, v.input_c0)}) | ${n(v.input_max)} (${pct(v.input_max, v.input_c0)}) | ${n(v.definition_tokens_turn0_c0)} → ${n(v.definition_tokens_turn0_c2)} | ${v.round_trips_c0} → ${v.round_trips_policy} / ${v.round_trips_max} | ${v.scripted_policy} / ${v.scripted_max} de ${v.tasks} (scriptables ${v.scriptable}) |`;
  const c1row = (label: string, v: any) =>
    `| ${label} | ${v.tasks} | ${n(v.input_c0)} | ${n(v.input_describe)} (${pct(v.input_describe, v.input_c0)}) | ${v.round_trips_c0} → ${v.round_trips_describe} |`;
  return [
    `${'## Configuración 2'} (T70, Code Mode: scripts de solo lectura)`,
    '',
    `**${b.label}.** Generado por \`measure-tool-tokens.ts --config 2\`; no edites a mano. Misma autoridad, banco, fixtures y supuestos que la config 0; compara contra su columna "enrutado".`,
    '',
    '- **Base: config 0.** El descubrimiento (config 1) queda apagado porque no pasó su compuerta (N14: −2,5 % / +65,1 %, lejos del −30 %). Config 2 = config 0 + `run_code` ofrecido en cada turno, con su definición real (construida por `createCodeModeTools`) y el mensaje de sistema `CODE_MODE_ROUTING_RULE` (leído del código del producto).',
    `- **Costo fijo de ofrecer scripts:** definición de \`run_code\` ≈ ${n(a.run_code_definition_tokens)} tokens + regla de ruteo ${n(a.routing_rule_bytes)} bytes (≈ ${n(a.routing_rule_tokens)} tokens) en CADA vuelta de CADA tarea, también las que no usan script. Esos tokens están incluidos en todas las cifras de la config 2.`,
    `- **Qué es "scriptable":** tarea multi-paso cuyas herramientas están todas en la lista blanca generada (${a.allowlist_size} herramientas), ninguna es escritura (\`readOnly !== true\`) y todas se ofrecen en el turno 0 (el manifiesto de \`run_code\` solo admite las ya autorizadas en el turno). Una tarea de una llamada nunca se convierte en script.`,
    `- **Dos lecturas:** *política* (titular) = el modelo sigue la regla de ruteo: solo hace script con ≥ ${a.script_min_calls} llamadas o ≥ ${a.script_min_rows} filas intermedias; con 1-2 lecturas pequeñas llama directo. *máx* (cota superior) = todo lo scriptable va por script. Las tareas no convertidas conservan su trayectoria de la config 0 (más el costo fijo de arriba).`,
    '- **Un script = 2 vueltas** (la que pide `run_code` y la que redacta la respuesta). Entrada = contexto + definiciones (turno + `run_code`) + la llamada `run_code` con el script + el resultado acotado que recibe el modelo (sobre `result` ≤ 8 KiB, vista previa de 5 filas por lista y conteo de filas), en lugar de los N resultados intermedios.',
    '',
    '### Totales: configuraciones 0, 1 y 2 (entrada en tokens estimados; vueltas = suma de vueltas al modelo; los porcentajes son la variación contra la config 0)',
    '',
    '| Grupo | Tareas | Config 0 entrada | Config 2 política | Config 2 máx | Def. turno 0 (0 → 2) | Vueltas (0 → política / máx) | Con script (política / máx) |',
    '|---|---|---|---|---|---|---|---|',
    row('una llamada', t.single),
    row('multi-paso', t.multi_step),
    row('todas', t.all),
    '',
    ...(c1
      ? [
          'Referencia, config 1 (fichas + describe_tool, lectura pesimista; sin scripts):',
          '',
          '| Grupo | Tareas | Config 0 entrada | Config 1 con describe_tool | Vueltas (0 → 1) |',
          '|---|---|---|---|---|',
          c1row('una llamada', c1.single),
          c1row('multi-paso', c1.multi_step),
          c1row('todas', c1.all),
          '',
        ]
      : []),
    '### Compuerta N14 de scripts (tareas multi-paso)',
    '',
    'Umbral: ≥ 50 % menos tokens de entrada Y ≥ 40 % menos vueltas, sin bajar la tasa de éxito. Las cifras son la variación contra la config 0 (negativo = ahorro); config 0 = 100 %.',
    '',
    '| Pata | Política (titular) | Máx (cota superior) |',
    '|---|---|---|',
    `| Tokens de entrada (≥ 50 %) | ${pct(t.multi_step.input_policy, t.multi_step.input_c0)} → ${yes(gp.tokens_leg_met)} | ${pct(t.multi_step.input_max, t.multi_step.input_c0)} → ${yes(gm.tokens_leg_met)} |`,
    `| Vueltas (≥ 40 %) | ${pct(t.multi_step.round_trips_policy, t.multi_step.round_trips_c0)} → ${yes(gp.rounds_leg_met)} | ${pct(t.multi_step.round_trips_max, t.multi_step.round_trips_c0)} → ${yes(gm.rounds_leg_met)} |`,
    '| Éxito (sin bajar) | PENDIENTE de corrida en vivo | PENDIENTE de corrida en vivo |',
    '',
    '**Veredicto: la compuerta NO se da por cumplida.** La tasa de éxito no se puede observar sin un modelo en vivo (el "alcanzable" estructural no es éxito), así que esa pata queda pendiente y los scripts siguen apagados por defecto (interruptor y capacidad por plan). Las otras dos patas son solo estimaciones de este banco, no tokens del proveedor.',
    '',
    '### Por tarea',
    '',
    '| Id | Tipo | Llamadas | Filas interm. | Scriptable (bloqueos) | Script (política / máx) | Def. turno 0 (0 → 2) | Entrada config 0 | Entrada política | Entrada máx | Vueltas (0 → política / máx) |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...b.tasks.map(
      (r: any) =>
        `| ${r.id} | ${r.kind === 'single' ? 'una' : 'multi'} | ${r.calls} | ${r.intermediate_rows} | ${r.scriptable ? 'sí' : r.kind === 'single' ? 'n/a (una llamada)' : `no: ${r.script_blockers.join(', ')}`} | ${r.scripted_policy ? 'sí' : 'no'} / ${r.scripted_max ? 'sí' : 'no'} | ${n(r.definition_tokens_turn0_c0)} → ${n(r.definition_tokens_turn0_c2)} | ${n(r.input_c0)} | ${n(r.input_policy)} | ${n(r.input_max)} | ${r.round_trips_c0} → ${r.round_trips_policy} / ${r.round_trips_max} |`,
    ),
    '',
    '### Supuestos de la config 2 (todos son del modelo, no medidos)',
    '',
    '- **Script generado, no escrito por un modelo.** `buildScriptSource` arma el script de forma determinista desde las llamadas planeadas de cada tarea: un `await` por grupo secuencial (`Promise.all` si es paralelo), con los argumentos del oráculo, y un `return` genérico que recorta cada lista a 5 filas y añade el conteo. No se ajusta por tarea. Un modelo real puede escribir scripts más largos, más cortos, o fallar y reintentar (el reintento y el máximo de 3 scripts por turno no se modelan).',
    '- **Resultado que ve el modelo.** Se reutiliza el sobre real de `run_code` (`status`, `result`, `logs` vacíos, `calls` con filas, `rows_seen`) con el resultado ya recortado; el recorte es una elección del script modelado, así que el modelo no recibe las filas completas. Si el modelo pidiera más datos, habría vueltas extra que aquí no existen.',
    '- **Los intermedios dependientes no se enhebran.** El oráculo trae argumentos estáticos; el script los usa tal cual y solo expresa la dependencia con `await` secuencial.',
    '- **Tareas con salida a pantalla (`vex_render_*`), `compute`, playbooks y escrituras no son scriptables:** esas herramientas no están en la lista blanca de solo lectura. `vex.block` dentro de un script permitiría renderizar desde el script, pero el modelo no lo usa aquí (cota conservadora; los bloqueos de cada tarea están en la tabla por tarea).',
    '- **Costo fijo en todas las tareas.** Se carga a las tareas directas el costo de ofrecer `run_code` (definición + regla). Si la oferta dependiera de la tarea (p. ej. solo con varias lecturas), las tareas de una llamada no lo pagarían; aquí se paga siempre, que es lo que hace hoy `ai-agent.service.ts` cuando la capacidad está activa.',
    '- **Éxito.** "Alcanzable" sigue siendo estructural. Que el script correcto salga a la primera, que el modelo elija bien entre directo y script (≥ 80 % en las conversaciones de oro es una verificación sobre transcripciones, no sobre un modelo) y que la respuesta final no pierda cifras por el recorte requieren corrida en vivo.',
    '- **No se modela** la latencia de la Lambda, la caché de prompt (ofrecer `run_code` añade un mensaje de sistema que cambia el prefijo cuando se activa), el costo de salida del script más allá del tamaño del mensaje de llamada, ni el dinero.',
    '',
  ].join('\n');
}

function renderConfig1(b: any): string {
  const n = (v: number) => v.toLocaleString('es-CO');
  const pct = (a: number, c: number) =>
    `${(((a - c) / c) * 100).toFixed(1).replace('.', ',')} %`;
  const line = (label: string, v: any) =>
    `| ${label} | ${v.tasks} | ${n(v.input_c0)} | ${n(v.input_direct)} (${pct(v.input_direct, v.input_c0)}) | ${n(v.input_describe)} (${pct(v.input_describe, v.input_c0)}) | ${v.round_trips_c0} → ${v.round_trips_describe} | ${v.reachable}/${v.tasks} |`;
  const d = b.index_decision;
  return [
    `${CONFIG1_HEADING} (T62, fichas cortas y describe_tool)`,
    '',
    `**${b.label}.** Generado por \`measure-tool-tokens.ts --config 1\`; no edites a mano. Misma autoridad, banco, fixtures y supuestos que la config 0; compara contra su columna "enrutado".`,
    '',
    '- **Qué cambia:** con \`AI_TOOL_DISCOVERY_STUBS=true\` la precarga (y cada herramienta que la tarea va llamando) viaja como una línea \`nombre — una línea (lee|escribe)\` en un mensaje de sistema, sin esquema; \`describe_tool\` entra al núcleo. Apagado, el turno es idéntico al de hoy.',
    `- **Índice del taller: se queda con nombres (decisión provisional).** Pesa ${n(d.digest_bytes)} bytes (≈ ${n(d.digest_tokens)} tokens estimados por vuelta, dentro del prefijo cacheable), frente a ${n(d.core_definition_tokens_turn0)} tokens de definiciones en el turno 0 con fichas. Reducirlo a \`dominio: n herramientas\` bajaría a ≈ ${n(d.compact_digest_tokens)} tokens: cota superior de ahorro ${n((d.digest_tokens - d.compact_digest_tokens) * d.rounds_c0)} tokens sobre las ${d.rounds_c0} vueltas del banco, pero quita al modelo los nombres exactos que hoy le permiten llamar sin buscar y no existe todavía una estadística de uso para elegir los "más usados". Se decide con medición en vivo; apagado el índice no cambia. La frase de ruteo nueva suma ${d.routing_sentence_bytes} bytes.`,
    '- **Dos lecturas de la misma trayectoria:** *directo* = el modelo llama la herramienta desde su ficha (optimista: un argumento errado costaría un reintento); *con describe_tool* = antes de cada grupo de llamadas pide la ficha completa de cada herramienta nueva, una vuelta extra por grupo (pesimista, es la lectura principal).',
    '',
    '| Grupo | Tareas | Config 0 entrada | Config 1 directo | Config 1 con describe_tool | Vueltas (0 → 1) | Alcanzables |',
    '|---|---|---|---|---|---|---|',
    line('una llamada', b.totals.single),
    line('multi-paso', b.totals.multi_step),
    line('todas', b.totals.all),
    '',
    `**Lectura:** el núcleo fijo (${n(d.core_definition_tokens_turn0)} tokens de definiciones en el turno 0 con fichas) domina el costo de cada vuelta, así que quitar la precarga de definiciones solo cambia la entrada ${pct(b.totals.all.input_direct, b.totals.all.input_c0)} en la lectura directa y, si el modelo pide la ficha de cada herramienta, la entrada cambia ${pct(b.totals.all.input_describe, b.totals.all.input_c0)} por las vueltas extra que reenvían todo el contexto. Con estos supuestos la config 1 NO baja los tokens de entrada de forma útil; las 30 tareas siguen alcanzables.`,
    '',
    'Entrada = suma de todas las vueltas al modelo, en tokens estimados. Las tareas que la config 0 ya sirve con el catálogo completo (cobertura insuficiente del oráculo) no mejoran: el respaldo no usa fichas.',
    '',
    '| Id | Tipo | Motivo catálogo completo | Def. turno 0 (0 → 1) | Fichas | Entrada config 0 | Entrada directo | Entrada con describe | Vueltas | Alcanzable |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...b.tasks.map(
      (r: any) =>
        `| ${r.id} | ${r.kind === 'single' ? 'una' : 'multi'} | ${r.full_catalog_reason ?? '—'} | ${n(r.definition_tokens_turn0_c0)} → ${n(r.definition_tokens_turn0_c1)} | ${r.stub_count_turn0} | ${n(r.input_c0)} | ${n(r.input_direct)} | ${n(r.input_describe)} | ${r.round_trips_c0} → ${r.round_trips_describe} | ${r.reachable ? 'sí' : 'no'} |`,
    ),
    '',
    '**Límites propios de la config 1:** el oráculo siempre acierta la precarga, así que las fichas cubren las herramientas necesarias; el modelo real puede pedir \`describe_tool\` de más o de menos, y la compactación de resultados y la caché de prompt no se modelan (cambiar de ficha a definición entre vueltas invalida el prefijo cacheado en algunos proveedores: \`describe_tool\` entrega la ficha como resultado de tool para no tocar la lista). La config 2 (Code Mode, scripts) está en su propia sección, más abajo.',
    '',
  ].join('\n');
}

function renderReport(b: any): string {
  const n = (v: number) => v.toLocaleString('es-CO');
  const t = b.totals;
  const line = (label: string, v: any) =>
    `| ${label} | ${v.tasks} | ${n(v.input_total)} | ${n(v.output_estimate)} | ${v.round_trips} | ${v.reachable}/${v.tasks} |`;
  const lines = [
    '# Línea base de tokens de herramientas (T60, config 0)',
    '',
    `Estimador: \`${b.token_estimator}\` (bytes del JSON; pesimista, no es un tokenizador). Generado por \`measure-tool-tokens.ts\`; no edites a mano.`,
    '',
    '## Herramientas',
    '',
    `- Declaradas (nombres únicos en el código): **${b.tools.declared_unique}** (${b.tools.factory_outputs} salidas de fábrica; el "~489" del plan era un grep).`,
    `- Autorizadas para owner en Vex (permisos ∩ agente − ${b.tools.denied_ui_tools} \`ui_*\` − extranjeras − sandbox fuera de durable): **${b.tools.authorized_for_owner_vex}**.`,
    `- Definiciones del catálogo completo autorizado: **${n(b.definition_tokens_full_catalog)}** tokens estimados por turno; índice del taller en el prompt: ${n(b.digest_bytes)} bytes.`,
    '',
    '## Totales (entrada = suma de todas las vueltas al modelo)',
    '',
    '### Enrutado (config 0, precarga ideal del oráculo)',
    '',
    '| Grupo | Tareas | Entrada (tokens) | Salida est. (tokens) | Vueltas | Alcanzables |',
    '|---|---|---|---|---|---|',
    line('una llamada', t.routed.single),
    line('multi-paso', t.routed.multi_step),
    line('todas', t.routed.all),
    '',
    '### Catálogo completo (cobertura < 90 %, respaldo)',
    '',
    '| Grupo | Tareas | Entrada (tokens) | Salida est. (tokens) | Vueltas | Alcanzables |',
    '|---|---|---|---|---|---|',
    line('una llamada', t.full_catalog.single),
    line('multi-paso', t.full_catalog.multi_step),
    line('todas', t.full_catalog.all),
    '',
    '## Por tarea',
    '',
    '| Id | Tipo | Vueltas | Herr. turno 0 (enrutado) | Def. turno 0 enrutado | Def. turno 0 completo | Entrada enrutado | Entrada completo | Salida est. | Alcanzable |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...b.tasks.map(
      (r: any) =>
        `| ${r.id} | ${r.kind === 'single' ? 'una' : 'multi'} | ${r.round_trips} | ${r.variants.routed.offered_tool_count} | ${n(r.variants.routed.definition_tokens_turn0)} | ${n(r.variants.full_catalog.definition_tokens_turn0)} | ${n(r.variants.routed.input_total)} | ${n(r.variants.full_catalog.input_total)} | ${n(r.variants.routed.output_estimate)} | ${r.reachable ? 'sí' : 'no'} |`,
    ),
    '',
    '## Método y límites',
    '',
    '- **Estimador, no tokenizador.** `bytes_v1` cuenta bytes del JSON enviado; sobreestima. Sirve para comparar configuraciones, no para facturar. No son tokens observados del proveedor.',
    '- **Trayectorias de oráculo escritas a mano.** `task-bank.json` fija qué herramientas llama cada tarea y en qué orden; el modelo real puede llamar otras, repetir o fallar. 15 tareas salen de las conversaciones doradas de Vex, 15 son multi-paso redactadas.',
    '- **Resultados de muestra, no datos de producción.** `tool-result-fixtures.json` trae una fila por herramienta con la forma del handler y se repite N veces. Cada fixture declara su `fidelity`: `handler_shape` (leído del handler), `service_shape_approx` (el handler devuelve el payload crudo del servicio) o `assumed_shape` (handler sin leer; forma supuesta). El tamaño real de los resultados depende de la tienda.',
    `- **Prompt de sistema supuesto.** Se usa un relleno de ${n(b.assumptions.system_prompt_bytes)} bytes más el índice real del taller; el prompt real de Vex no se mide aquí.`,
    '- **Enrutado = mejor caso.** El ranker es un sustituto que puntúa las herramientas del oráculo, así que la precarga (máx. 8) acierta siempre; el enrutador real puede fallar y caer al catálogo completo. Una herramienta fuera de la precarga se ofrece desde la vuelta siguiente a su primera llamada (regla dura), sin vuelta extra de `search_tools`.',
    '- **No se modela** la compactación de resultados, la caché de prompt del proveedor, la latencia ni el costo en dinero. La salida estimada son los mensajes de tool_calls más un cierre de ' +
      `${b.assumptions.final_answer_output_bytes} bytes.`,
    '- **Alcanzable** es una prueba estructural (todas las herramientas del oráculo existen y están autorizadas para el owner), no una tasa de éxito del modelo.',
    '- **Pendiente:** medición en vivo con modelo (requiere backend y gasto de proveedor; fuera de alcance de T60). Las configs 1 (T62) y 2 (T70) añaden sus secciones al final.',
    '',
  ];
  return lines.join('\n');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
