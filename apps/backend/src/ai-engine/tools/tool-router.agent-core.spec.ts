import { AIToolRegistry } from './ai-tool-registry';
import {
  AGENT_TOOL_CORE,
  agentToolCore,
  ToolRouterService,
} from './tool-router.service';
import {
  buildToolManifest,
  localToolRanking,
  localToolScores,
  mayFillWithoutEvidence,
} from './tool-catalog';
import { createApiBridgeTools } from './bridge/api-bridge.tools';
import { createCapabilityTools } from './bridge/capability.tools';
import { createAccountingTools } from './domains/accounting.tools';
import { createAiToolboxTools } from './domains/ai-toolbox.tools';
import { createCashRegisterTools } from './domains/cash-register.tools';
import { createCustomerTools } from './domains/customers.tools';
import { createDiscoveryTools } from './domains/discovery.tools';
import { createExpenseTools } from './domains/expenses.tools';
import { createFiscalTools } from './domains/fiscal.tools';
import { createInventoryTools } from './domains/inventory.tools';
import { createInvoicingTools } from './domains/invoicing.tools';
import { createOrdersTools } from './domains/orders.tools';
import { createPaymentTools } from './domains/payments.tools';
import { createPlanningTools } from './domains/planning.tools';
import { createPlaybookTools } from './domains/playbook.tools';
import { createProductTools } from './domains/products.tools';
import { createPurchasingTools } from './domains/purchasing.tools';
import { createReportingTools } from './domains/reporting.tools';
import { createReportTools } from './domains/reports.tools';
import { createTaskTools } from './domains/tasks.tools';
import { uiTools } from './domains/ui.tools';
import { createVexBlockTools } from './domains/vex-blocks.tools';
import {
  createCustomerWriteTools,
  createInventoryWriteTools,
  createOrderWriteTools,
  createProductWriteTools,
} from './domains/writes.tools';

/**
 * Paso 6 / P0-6, P0-7 — núcleo fijo de routing con el REGISTRY REAL.
 *
 * Fábricas reales (las mismas que registran AIEngineModule y los módulos de
 * dominio) con deps vacías: las fábricas solo tocan deps dentro de
 * handlers/previews, así que nada se ejecuta. Ranking léxico local (el mismo
 * fallback que usa producción sin embeddings).
 */
function realRegistry(): AIToolRegistry {
  const deps = {} as any;
  const registry = new AIToolRegistry(deps);
  registry.registerMany(createDiscoveryTools());
  registry.registerMany(createPlaybookTools());
  registry.registerMany(createPlanningTools());
  registry.registerMany(uiTools);
  registry.registerMany(
    createApiBridgeTools({ catalog: deps, attachments: deps }),
  );
  registry.registerMany(createCapabilityTools({ capabilities: deps }));
  registry.registerMany(createTaskTools(deps));
  registry.registerMany(createReportTools(deps));
  registry.registerMany(createVexBlockTools(deps));
  for (const factory of [
    createAccountingTools,
    createAiToolboxTools,
    createCashRegisterTools,
    createCustomerTools,
    createExpenseTools,
    createFiscalTools,
    createInventoryTools,
    createInvoicingTools,
    createOrdersTools,
    createPaymentTools,
    createProductTools,
    createPurchasingTools,
    createReportingTools,
    createInventoryWriteTools,
    createProductWriteTools,
    createCustomerWriteTools,
    createOrderWriteTools,
  ])
    registry.registerMany((factory as (d: unknown) => any[])(deps));
  return registry;
}

const names = (selection: { definitions: { function: { name: string } }[] }) =>
  selection.definitions.map((d) => d.function.name);

/** Sessions as the Vex/Vexi text loop creates them. */
const TEXT_LOOP = { writesNeedEvidence: true };

describe('ToolRouterService Paso 6: núcleo fijo por agente y escrituras sin evidencia', () => {
  let registry: AIToolRegistry;
  let router: ToolRouterService;
  /** Vex niega los ui_* (fila `vex` del seed de agentes). */
  let vexAuth: ReturnType<AIToolRegistry['getAgentDefinitions']>;

  beforeEach(() => {
    registry = realRegistry();
    router = new ToolRouterService(registry, {
      rank: jest.fn(async (query, docs, _scope, domain) => ({
        names: localToolRanking(query, docs, domain),
        degraded: [],
      })),
    } as any);
    // Owner con todos los permisos: la fila de agente es el único recorte.
    const every = [
      ...new Set(registry.getAll().flatMap((t) => t.requiredPermissions ?? [])),
    ];
    vexAuth = registry.getAgentDefinitions(every, {
      denied_tools: registry
        .getAll()
        .map((t) => t.name)
        .filter((n) => n.startsWith('ui_')),
    });
  });

  /** Every offered relevance-filled tool must be a read or carry evidence. */
  function assertNoScoreZeroWrite(
    query: string,
    offered: string[],
    agent: string | undefined,
  ) {
    const docs = buildToolManifest(registry).documents;
    const scores = localToolScores(query, docs);
    const core = new Set(agentToolCore(agent));
    const scaffold = new Set([
      'search_tools',
      'search_playbooks',
      'load_playbook',
      'search_recipes',
      'load_recipe',
      'list_capabilities',
      'list_endpoints',
      'call_endpoint',
      'write_endpoint',
      'explain_capability',
    ]);
    const offenders = offered.filter((name) => {
      if (core.has(name) || scaffold.has(name)) return false;
      const doc = docs.find((d) => d.name === name)!;
      return !mayFillWithoutEvidence(doc) && (scores.get(name) ?? 0) === 0;
    });
    expect(offenders).toEqual([]);
  }

  it('el registry real contiene las tools del núcleo citadas en los prompts', () => {
    for (const name of [...AGENT_TOOL_CORE.vexi, ...AGENT_TOOL_CORE.vex])
      expect(registry.get(name)).toBeDefined();
  });

  it('Vexi: "analiza el cierre de caja de hoy" ofrece call_endpoint y las lecturas de caja', async () => {
    const query = 'analiza el cierre de caja de hoy';
    const session = router.createSession(query, 's', [], 'vexi', TEXT_LOOP);
    const selection = await router.select(
      session,
      registry.getAllDefinitions(),
      false,
      false,
    );
    expect(names(selection)).toEqual(
      expect.arrayContaining([
        'call_endpoint',
        'list_cash_sessions',
        'get_cash_session_status',
        'list_endpoints',
        'explain_capability',
        'write_endpoint',
      ]),
    );
    expect(session.expansions).toBe(0);
    assertNoScoreZeroWrite(query, names(selection), 'vexi');
  });

  it('Vexi: el núcleo incluye ui_navigate y va POR ENCIMA de las 12 operativas', async () => {
    const selection = await router.select(
      router.createSession('analiza el cierre de caja de hoy', 's', [], 'vexi', TEXT_LOOP),
      registry.getAllDefinitions(),
      false,
      false,
    );
    expect(names(selection)).toEqual(
      expect.arrayContaining([...AGENT_TOOL_CORE.vexi]),
    );
    expect(names(selection)).toContain('ui_navigate');
    expect(selection.operationalCount).toBe(12);
    // Vexi no recibe el núcleo de Vex.
    expect(names(selection)).not.toContain('vex_render_chart');
  });

  it('sin agent_key se resuelve como Vexi (default del motor)', async () => {
    const selection = await router.select(
      router.createSession('producto', 's'),
      registry.getAllDefinitions(),
      false,
      false,
    );
    expect(names(selection)).toContain('ui_navigate');
    expect(agentToolCore('agente_desconocido')).toEqual([]);
  });

  it('Vex: "Hazme una gráfica de ventas" ofrece vex_render_chart y nunca un ui_*', async () => {
    const query = 'Hazme una gráfica de ventas';
    const selection = await router.select(
      router.createSession(query, 's', [], 'vex', TEXT_LOOP),
      vexAuth,
      false,
      false,
    );
    expect(names(selection)).toEqual(
      expect.arrayContaining([...AGENT_TOOL_CORE.vex, 'call_endpoint']),
    );
    expect(names(selection).filter((n) => n.startsWith('ui_'))).toEqual([]);
    expect(selection.operationalCount).toBe(12);
    assertNoScoreZeroWrite(query, names(selection), 'vex');
  });

  it('el núcleo y el andamiaje nunca ofrecen una tool no autorizada', async () => {
    const denied = new Set([
      'ui_navigate',
      'get_report',
      'call_endpoint',
      'write_endpoint',
      'explain_capability',
    ]);
    const auth = registry
      .getAllDefinitions()
      .filter((d) => !denied.has(d.function.name));
    const selection = await router.select(
      router.createSession('analiza el cierre de caja de hoy', 's', [], 'vexi', TEXT_LOOP),
      auth,
      false,
      false,
    );
    for (const name of denied) expect(names(selection)).not.toContain(name);
    expect(names(selection)).toContain('ui_pos_checkout');
    // Vex sin autorización a sus bloques tampoco los recibe.
    const noBlocks = vexAuth.filter((d) => !d.function.name.startsWith('vex_'));
    const vex = await router.select(
      router.createSession('Hazme una gráfica de ventas', 's', [], 'vex', TEXT_LOOP),
      noBlocks,
      false,
      false,
    );
    expect(names(vex).filter((n) => n.startsWith('vex_'))).toEqual([]);
  });

  it('una lectura con score 0 rellena; una escritura con score 0 nunca entra por desempate', async () => {
    const query = 'qwxz';
    const selection = await router.select(
      router.createSession(query, 's', [], 'vexi', TEXT_LOOP),
      registry.getAllDefinitions(),
      false,
      false,
    );
    const docs = buildToolManifest(registry).documents;
    const core = new Set(AGENT_TOOL_CORE.vexi);
    const filled = names(selection).filter(
      (n) =>
        !core.has(n) &&
        ![
          'search_tools',
          'search_playbooks',
          'load_playbook',
          'list_capabilities',
          'list_endpoints',
          'call_endpoint',
          'write_endpoint',
          'explain_capability',
        ].includes(n),
    );
    expect(selection.operationalCount).toBe(12);
    expect(filled.length).toBe(12);
    expect(
      filled.every((n) =>
        mayFillWithoutEvidence(docs.find((d) => d.name === n)!),
      ),
    ).toBe(true);
    // Sin el filtro, el desempate alfabético habría metido escrituras.
    const operativeDocs = docs.filter(
      (d) =>
        !core.has(d.name) &&
        ![
          'search_tools',
          'search_playbooks',
          'load_playbook',
          'list_capabilities',
          'list_endpoints',
          'call_endpoint',
          'write_endpoint',
          'explain_capability',
        ].includes(d.name) &&
        d.domain !== 'planning',
    );
    const alphabetical = localToolRanking(query, operativeDocs).slice(0, 12);
    expect(
      alphabetical.some(
        (n) => !mayFillWithoutEvidence(docs.find((d) => d.name === n)!),
      ),
    ).toBe(true);
  });

  it('fuera del loop de texto (voz) no aplica el filtro de escrituras', async () => {
    const selection = await router.select(
      router.createSession('qwxz', 's'),
      registry.getAllDefinitions(),
      false,
      false,
    );
    const docs = buildToolManifest(registry).documents;
    expect(
      names(selection).some((n) => {
        const doc = docs.find((d) => d.name === n);
        return !!doc && !mayFillWithoutEvidence(doc);
      }),
    ).toBe(true);
  });

  it('una escritura con evidencia léxica o fijada explícitamente sí se ofrece', async () => {
    const auth = registry.getAllDefinitions();
    const lexical = await router.select(
      router.createSession('ajustar stock', 's', [], 'vexi', TEXT_LOOP),
      auth,
      false,
      false,
    );
    expect(names(lexical)).toContain('adjust_stock');
    const session = router.createSession('qwxz', 's', [], 'vexi', TEXT_LOOP);
    await router.select(session, auth, false, false);
    expect(router.requestTool(session, 'adjust_stock', auth)).toBe(true);
    expect(names(await router.select(session, auth, false, false))).toContain(
      'adjust_stock',
    );
  });
});
