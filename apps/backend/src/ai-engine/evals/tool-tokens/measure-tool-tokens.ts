/**
 * Offline baseline of the tool-token cost of Vex (T60, config 0 = today's
 * routing). No model, DB, network or server: it builds the real tool registry
 * from the source tree, the real ToolRouterService (with a stub ranker) and
 * estimates sizes with the repo's `bytes_v1` estimator.
 *
 *   npx ts-node --transpile-only --project tsconfig.json -r tsconfig-paths/register \
 *     src/ai-engine/evals/tool-tokens/measure-tool-tokens.ts --config 0 [--out <dir>]
 *
 * Deterministic: same tree, same bytes. Writes baseline.config-0.json and REPORT.md.
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Logger } from '@nestjs/common';
import { AIToolRegistry } from '../../tools/ai-tool-registry';
import { ToolRouterService } from '../../tools/tool-router.service';
import { collectToolCatalog } from '../../tools/tool-catalog.test-helper';
import { isForeignSurfaceTool } from '../../tools/surface-tools';
import { TOOL_WORKING_SET } from '../../tools/tool-working-set';
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
  'Uso: ts-node measure-tool-tokens.ts --config 0 [--out <dir>]\n  --config 0  enrutador actual (config 1 y 2 llegan con T70)';

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
  if (cli.config === 1 || cli.config === 2)
    throw new Error(`La config ${cli.config} la implementa T70; aquí solo la 0.`);
  if (cli.config !== 0) throw new Error(`Falta --config 0\n${HELP}`);
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
        !isForeignSurfaceTool(d.function.name, 'vex'),
    );
  const known = new Set(all.map((t) => t.name));
  const authorizedSet = new Set(authorized.map((d) => d.function.name));

  const digestRouter = new ToolRouterService(registry, rankerFor([], 1));
  const digest = digestRouter.buildToolIndexDigest(authorized);
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
  writeFileSync(resolve(cli.out, 'REPORT.md'), renderReport(baseline));
  console.log(
    `declared=${all.length} authorized=${authorized.length} tasks=${rows.length} ` +
      `unreachable=${rows.filter((r) => !r.reachable).length}`,
  );
  if (rows.some((r) => !r.reachable)) process.exitCode = 1;
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
