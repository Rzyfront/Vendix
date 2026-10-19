import { AIToolRegistry } from './ai-tool-registry';
import { isAgentPlanTool } from '../interfaces/agent-plan.interface';
import {
  AGENT_TOOL_CORE,
  agentToolCore,
  ToolRouterService,
} from './tool-router.service';
import {
  buildToolManifest,
  localToolRanking,
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

  it('el registry real contiene las tools del núcleo citadas en los prompts', () => {
    for (const name of [...AGENT_TOOL_CORE.vexi, ...AGENT_TOOL_CORE.vex])
      expect(registry.get(name)).toBeDefined();
  });

  it('Vexi: "analiza el cierre de caja de hoy" ofrece TODO lo autorizado, con caja y bridge', async () => {
    const query = 'analiza el cierre de caja de hoy';
    const session = router.createSession(query, 's', [], 'vexi', TEXT_LOOP);
    const all = registry.getAllDefinitions();
    const selection = await router.select(session, all, false, false);
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
    // Prod 2026-10: un top-K hacía que el modelo llamara tools autorizadas
    // no ofrecidas → aviso falso de permisos. Ahora se ofrece el catálogo
    // autorizado completo (sin herramientas de plan sin hook).
    expect(selection.definitions).toHaveLength(
      all.filter((d) => !isAgentPlanTool(d.function.name)).length,
    );
    expect(session.expansions).toBe(0);
  });

  it('Vexi: el núcleo incluye ui_navigate y encabeza el catálogo ordenado', async () => {
    const selection = await router.select(
      router.createSession('analiza el cierre de caja de hoy', 's', [], 'vexi', TEXT_LOOP),
      registry.getAllDefinitions(),
      false,
      false,
    );
    const offered = names(selection);
    expect(offered).toEqual(expect.arrayContaining([...AGENT_TOOL_CORE.vexi]));
    expect(offered.slice(0, AGENT_TOOL_CORE.vexi.length).sort()).toEqual(
      [...AGENT_TOOL_CORE.vexi].sort(),
    );
    // El router ordena, no recorta: excluir los bloques de Vex de un turno
    // Vexi es decisión de autoridad del loop (isForeignSurfaceTool), no suya.
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
    expect(selection.definitions).toHaveLength(
      vexAuth.filter((d) => !isAgentPlanTool(d.function.name)).length,
    );
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

  it('sin evidencia léxica igual se ofrecen lecturas y escrituras autorizadas (la escritura exige aprobación al ejecutar)', async () => {
    const all = registry.getAllDefinitions();
    const selection = await router.select(
      router.createSession('qwxz', 's', [], 'vexi', TEXT_LOOP),
      all,
      false,
      false,
    );
    const docs = buildToolManifest(registry).documents;
    expect(names(selection)).toContain('adjust_stock');
    expect(
      names(selection).some((n) => {
        const doc = docs.find((d) => d.name === n);
        return !!doc && !mayFillWithoutEvidence(doc);
      }),
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

  it('una escritura autorizada se ofrece desde la primera inferencia, sin fijarla', async () => {
    const auth = registry.getAllDefinitions();
    for (const query of ['ajustar stock', 'qwxz']) {
      const session = router.createSession(query, 's', [], 'vexi', TEXT_LOOP);
      expect(names(await router.select(session, auth, false, false))).toContain(
        'adjust_stock',
      );
    }
  });
});
