/**
 * Offline baseline of the tool-token cost of Vex (T60, config 0 = today's
 * routing). No model, DB, network or server: it builds the real tool registry
 * from the source tree, the real ToolRouterService (with a stub ranker) and
 * estimates sizes with the repo's `bytes_v1` estimator.
 *
 *   npx ts-node --transpile-only --project tsconfig.json -r tsconfig-paths/register \
 *     src/ai-engine/evals/tool-tokens/measure-tool-tokens.ts --config 0|1 [--out <dir>]
 *
 * Deterministic: same tree, same bytes. Config 0 writes baseline.config-0.json
 * and REPORT.md; config 1 (T62: AI_TOOL_DISCOVERY_STUBS on) writes
 * baseline.config-1.json and appends the "Configuración 1" section to REPORT.md.
 * Both are bytes_v1 ESTIMATES, never provider-observed tokens.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Logger } from '@nestjs/common';
import { AIToolRegistry } from '../../tools/ai-tool-registry';
import { ToolRouterService } from '../../tools/tool-router.service';
import { collectToolCatalog } from '../../tools/tool-catalog.test-helper';
import { isForeignSurfaceTool } from '../../tools/surface-tools';
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
  measureTrajectory,
  successProxy,
  summarizeByKind,
} from './tool-token-metrics';

/** Assumption: the Vex system prompt is sized at this many bytes (not measured). */
const SYSTEM_PLACEHOLDER_BYTES = 6000;
const HELP =
  'Uso: ts-node measure-tool-tokens.ts --config 0|1 [--out <dir>]\n  --config 0  enrutador actual\n  --config 1  fichas cortas + describe_tool (AI_TOOL_DISCOVERY_STUBS); requiere haber corrido la 0\n  (la config 2 llega con T70)';

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
  if (cli.config === 2)
    throw new Error('La config 2 la implementa T70; aquí solo la 0 y la 1.');
  if (cli.config !== 0 && cli.config !== 1)
    throw new Error(`Falta --config 0|1\n${HELP}`);
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
        // Code Mode (F10) is config 2 (T70): kept out so configs 0 and 1 stay comparable.
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
  writeFileSync(reportPath, head + renderConfig1(config1));
  console.log(
    `config1 tasks=${rows.length} unreachable=${rows.filter((r) => !r.reachable).length} ` +
      `input_c0=${config1.totals.all.input_c0} input_describe=${config1.totals.all.input_describe}`,
  );
  if (rows.some((r) => !r.reachable)) process.exitCode = 1;
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
    '**Límites propios de la config 1:** el oráculo siempre acierta la precarga, así que las fichas cubren las herramientas necesarias; el modelo real puede pedir \`describe_tool\` de más o de menos, y la compactación de resultados y la caché de prompt no se modelan (cambiar de ficha a definición entre vueltas invalida el prefijo cacheado en algunos proveedores: \`describe_tool\` entrega la ficha como resultado de tool para no tocar la lista). La config 2 (Code Mode) llega con T70.',
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
    '- **Pendiente:** medición en vivo con modelo (requiere backend y gasto de proveedor; fuera de alcance de T60). Config 1 y 2 las añade T70.',
    '',
  ];
  return lines.join('\n');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
