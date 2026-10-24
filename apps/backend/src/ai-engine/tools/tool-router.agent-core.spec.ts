import { AIToolRegistry } from './ai-tool-registry';
import {
  AGENT_TOOL_CORE,
  agentToolCore,
  ToolRouterService,
} from './tool-router.service';
import { isAgentPlanTool } from '../interfaces/agent-plan.interface';
import { localToolRanking, localToolScores } from './tool-catalog';
import { CORE_DISCOVERY, TOOL_WORKING_SET } from './tool-working-set';
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
import { createSalesTools } from './domains/sales.tools';
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
    createSalesTools,
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

/** Lexical-only ranking with a complete index, as prod without vectors. */
const lexicalRank = jest.fn(async (query, docs, _scope, domain) => ({
  names: localToolRanking(query, docs, domain),
  degraded: ['vector_unavailable'],
  scores: Object.fromEntries(
    [...localToolScores(query, docs, domain)].filter(([, s]) => s > 0),
  ),
  coverage: 1,
  source: 'lexical_local',
}));

const MAX_TOOLS =
  CORE_DISCOVERY.length +
  Math.max(...Object.values(AGENT_TOOL_CORE).map((c) => c.length)) +
  TOOL_WORKING_SET.maxLoaded;

describe('ToolRouterService: núcleo fijo por agente + conjunto dinámico (registry real)', () => {
  let registry: AIToolRegistry;
  let router: ToolRouterService;
  /** Vex niega los ui_* (fila `vex` del seed de agentes). */
  let vexAuth: ReturnType<AIToolRegistry['getAgentDefinitions']>;
  /** Vexi no recibe bloques de Vex (isForeignSurfaceTool en el loop). */
  let vexiAuth: ReturnType<AIToolRegistry['getAgentDefinitions']>;

  beforeEach(() => {
    registry = realRegistry();
    router = new ToolRouterService(registry, { rank: lexicalRank } as any);
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
    vexiAuth = registry
      .getAgentDefinitions(every, {})
      .filter((d) => !d.function.name.startsWith('vex_'));
  });

  it('el registry real contiene las tools del núcleo citadas en los prompts', () => {
    for (const name of [
      ...AGENT_TOOL_CORE.vexi,
      ...AGENT_TOOL_CORE.vex,
      ...CORE_DISCOVERY,
    ])
      expect(registry.get(name)).toBeDefined();
    expect(
      CORE_DISCOVERY.length + AGENT_TOOL_CORE.vexi.length,
    ).toBeLessThanOrEqual(14);
    expect(
      CORE_DISCOVERY.length + AGENT_TOOL_CORE.vex.length,
    ).toBeLessThanOrEqual(14);
  });

  it('Vexi: "analiza el cierre de caja de hoy" carga caja + núcleo, no el catálogo completo', async () => {
    const session = router.createSession(
      'analiza el cierre de caja de hoy',
      's',
      [],
      'vexi',
    );
    const selection = await router.select(session, vexiAuth, false, false);
    expect(names(selection)).toEqual(
      expect.arrayContaining([
        ...CORE_DISCOVERY,
        'list_cash_sessions',
        'get_cash_session_status',
      ]),
    );
    expect(selection.degraded).not.toContain('full_catalog_fallback');
    expect(selection.definitions.length).toBeLessThanOrEqual(MAX_TOOLS);
    expect(selection.definitions.length).toBeLessThan(vexiAuth.length / 3);
    expect(selection.retrievalSource).toBe('lexical_local');
  });

  it('Vexi: el núcleo (discovery + agente) encabeza la lista ordenado por nombre', async () => {
    const selection = await router.select(
      router.createSession('analiza el cierre de caja de hoy', 's', [], 'vexi'),
      vexiAuth,
      false,
      false,
    );
    const core = [...CORE_DISCOVERY, ...AGENT_TOOL_CORE.vexi].sort((a, b) =>
      a.localeCompare(b),
    );
    expect(names(selection).slice(0, core.length)).toEqual(core);
    expect(selection.coreCount).toBe(core.length);
  });

  it('sin agent_key se resuelve como Vexi (default del motor)', async () => {
    const selection = await router.select(
      router.createSession('producto', 's'),
      vexiAuth,
      false,
      false,
    );
    expect(names(selection)).toContain('ui_navigate');
    expect(agentToolCore('agente_desconocido')).toEqual([]);
  });

  it('Vex: "Hazme una gráfica de ventas" trae vex_render_chart y ventas, nunca un ui_*', async () => {
    const selection = await router.select(
      router.createSession('Hazme una gráfica de ventas', 's', [], 'vex'),
      vexAuth,
      false,
      false,
    );
    expect(names(selection)).toEqual(
      expect.arrayContaining([...AGENT_TOOL_CORE.vex, 'call_endpoint']),
    );
    expect(names(selection).filter((n) => n.startsWith('ui_'))).toEqual([]);
    expect(names(selection).some((n) => /sales/.test(n))).toBe(true);
    expect(selection.definitions.length).toBeLessThanOrEqual(MAX_TOOLS);
  });

  it('Vexi nunca recibe bloques vex_* aunque la petición hable de gráficas', async () => {
    const selection = await router.select(
      router.createSession('Hazme una gráfica de ventas', 's', [], 'vexi'),
      vexiAuth,
      false,
      false,
    );
    expect(names(selection).filter((n) => n.startsWith('vex_'))).toEqual([]);
  });

  it('el núcleo y lo cargado nunca incluyen una tool no autorizada', async () => {
    const denied = new Set([
      'ui_navigate',
      'get_report',
      'call_endpoint',
      'write_endpoint',
      'explain_capability',
      'list_cash_sessions',
    ]);
    const auth = vexiAuth.filter((d) => !denied.has(d.function.name));
    const selection = await router.select(
      router.createSession('analiza el cierre de caja de hoy', 's', [], 'vexi'),
      auth,
      false,
      false,
    );
    for (const name of denied) expect(names(selection)).not.toContain(name);
    expect(names(selection)).toContain('ui_pos_checkout');
    const noBlocks = vexAuth.filter((d) => !d.function.name.startsWith('vex_'));
    const vex = await router.select(
      router.createSession('Hazme una gráfica de ventas', 's', [], 'vex'),
      noBlocks,
      false,
      false,
    );
    expect(names(vex).filter((n) => n.startsWith('vex_'))).toEqual([]);
  });

  it('sin evidencia en ninguna capa cae al catálogo autorizado completo (piso de la cascada)', async () => {
    const selection = await router.select(
      router.createSession('qwxz', 's', [], 'vexi'),
      vexiAuth,
      false,
      false,
    );
    expect(selection.degraded).toContain('full_catalog_fallback');
    expect(selection.retrievalSource).toBe('full_catalog_fallback');
    expect(names(selection)).toContain('adjust_stock');
    expect(selection.definitions).toHaveLength(
      vexiAuth.filter((d) => !isAgentPlanTool(d.function.name)).length,
    );
  });

  it('una escritura autorizada con evidencia se carga desde la primera inferencia', async () => {
    const session = router.createSession('ajustar stock', 's', [], 'vexi');
    expect(
      names(await router.select(session, vexiAuth, false, false)),
    ).toContain('adjust_stock');
  });
});
