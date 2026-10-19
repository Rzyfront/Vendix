import { AIToolRegistry } from './ai-tool-registry';
import { ToolRouterService } from './tool-router.service';
import { localToolRanking, localToolScores } from './tool-catalog';
import {
  appendLoaded,
  composeWorkingSet,
  recentToolNames,
  relevantTop,
  TOOL_WORKING_SET,
} from './tool-working-set';
import { createDiscoveryTools } from './domains/discovery.tools';
import { createCashRegisterTools } from './domains/cash-register.tools';
import { createInventoryTools } from './domains/inventory.tools';
import { createProductTools } from './domains/products.tools';
import { createCustomerTools } from './domains/customers.tools';
import { uiTools } from './domains/ui.tools';

describe('tool-working-set (funciones puras)', () => {
  it('relevantTop: umbral relativo al top-1, tope y desempate por nombre', () => {
    expect(relevantTop({ a: 10, b: 4, c: 3.4, d: 0 })).toEqual(['a', 'b']);
    expect(relevantTop({ b: 1, a: 1, c: 1 }, 2)).toEqual(['a', 'b']);
    expect(relevantTop({})).toEqual([]);
    const many = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`t${i}`, 1]),
    );
    expect(relevantTop(many)).toHaveLength(TOOL_WORKING_SET.prefetchTop);
  });

  it('recentToolNames: solo los 3 últimos turnos del usuario, en orden cronológico', () => {
    const call = (name: string) => ({ function: { name } });
    const messages = [
      { role: 'user' },
      { role: 'assistant', tool_calls: [call('old_turn_tool')] },
      { role: 'user' },
      { role: 'assistant', tool_calls: [call('list_cash_sessions')] },
      { role: 'user' },
      { role: 'assistant', tool_calls: [call('list_cash_session_movements')] },
      { role: 'user' },
      {
        role: 'assistant',
        tool_calls: [call('list_cash_sessions'), call('find_product')],
      },
    ];
    expect(recentToolNames(messages)).toEqual([
      'list_cash_sessions',
      'list_cash_session_movements',
      'find_product',
    ]);
    expect(recentToolNames(undefined)).toEqual([]);
    expect(recentToolNames([{ role: 'assistant' }])).toEqual([]);
  });

  it('appendLoaded: append-only, sin duplicados, sin núcleo, sin no autorizadas y con tope', () => {
    const loaded = ['a'];
    const added = appendLoaded(
      loaded,
      ['a', 'core', 'denied', 'b', 'c'],
      new Set(['a', 'b', 'c', 'core']),
      new Set(['core']),
      2,
    );
    expect(added).toEqual(['b']);
    expect(loaded).toEqual(['a', 'b']);
    appendLoaded(loaded, ['c'], new Set(['c']), new Set(), null);
    expect(loaded).toEqual(['a', 'b', 'c']);
  });

  it('composeWorkingSet: núcleo ordenado + cargadas en orden de carga, ∩ autoridad', () => {
    expect(
      composeWorkingSet(
        ['z_core', 'a_core', 'denied_core'],
        ['m', 'a_core', 'b', 'denied'],
        new Set(['z_core', 'a_core', 'm', 'b']),
      ),
    ).toEqual({ core: ['a_core', 'z_core'], loaded: ['m', 'b'] });
  });
});

describe('ToolRouterService: conjunto dinámico por turno (fábricas reales)', () => {
  let registry: AIToolRegistry;
  let router: ToolRouterService;
  const lexicalRank = jest.fn(async (query, docs, _scope, domain) => ({
    names: localToolRanking(query, docs, domain),
    degraded: [],
    scores: Object.fromEntries(
      [...localToolScores(query, docs, domain)].filter(([, s]) => s > 0),
    ),
    coverage: 1,
    source: 'lexical_local',
  }));
  const names = (s: { definitions: { function: { name: string } }[] }) =>
    s.definitions.map((d) => d.function.name);

  beforeEach(() => {
    const deps = {} as any;
    registry = new AIToolRegistry(deps);
    registry.registerMany(createDiscoveryTools());
    registry.registerMany(uiTools);
    for (const factory of [
      createCashRegisterTools,
      createInventoryTools,
      createProductTools,
      createCustomerTools,
    ])
      registry.registerMany((factory as (d: unknown) => any[])(deps));
    router = new ToolRouterService(registry, { rank: lexicalRank } as any);
  });

  it('cambio de tema: el turno 2 trae inventario y conserva las de caja usadas', async () => {
    const auth = registry.getAllDefinitions();
    const turn1 = router.createSession(
      'Oe me ayudas a analizar un cierre de caja que no me dio?',
      's',
      [],
      'vexi',
    );
    const first = await router.select(turn1, auth, false, false);
    expect(names(first)).toContain('list_cash_sessions');
    // Turn 2 is rebuilt from the history (no DB state).
    const history = recentToolNames([
      { role: 'user' },
      {
        role: 'assistant',
        tool_calls: [{ function: { name: 'list_cash_sessions' } }],
      },
      { role: 'user' },
    ]);
    const turn2 = router.createSession(
      'y ahora cuánto stock tengo de cocacola',
      's',
      [],
      'vexi',
      { history },
    );
    const second = names(await router.select(turn2, auth, false, false));
    expect(second).toContain('list_cash_sessions');
    expect(second.some((n) => /stock|inventory|product/.test(n))).toBe(true);
  });

  it('conversación legacy: las tools del historial se recargan aunque el mensaje no tenga evidencia', async () => {
    const auth = registry.getAllDefinitions();
    const session = router.createSession('sí, dale', 's', [], 'vexi', {
      history: ['list_cash_session_movements'],
    });
    const selection = await router.select(session, auth, false, false);
    expect(names(selection)).toContain('list_cash_session_movements');
    expect(selection.degraded).not.toContain('full_catalog_fallback');
  });

  it('orden estable: mismo input → mismo arreglo byte a byte; cargar solo agrega al final', async () => {
    const auth = registry.getAllDefinitions();
    const run = async () => {
      const session = router.createSession('cierre de caja', 's', [], 'vexi');
      return {
        session,
        selection: await router.select(session, auth, false, false),
      };
    };
    const a = await run();
    const b = await run();
    expect(JSON.stringify(a.selection.definitions)).toBe(
      JSON.stringify(b.selection.definitions),
    );
    const prefix = JSON.stringify(a.selection.definitions);
    await router.search(a.session, { query: 'clientes' }, auth);
    const after = await router.select(a.session, auth, false, false);
    expect(
      JSON.stringify(after.definitions).startsWith(prefix.slice(0, -1)),
    ).toBe(true);
    // Same round twice: byte-identical (no reordering between iterations).
    expect(
      JSON.stringify(
        (await router.select(a.session, auth, false, false)).definitions,
      ),
    ).toBe(JSON.stringify(after.definitions));
  });

  it('índice del taller: dominios ordenados con los nombres autorizados, sin andamiaje ni denegadas', () => {
    const auth = registry
      .getAllDefinitions()
      .filter((d) => d.function.name !== 'list_cash_sessions');
    const digest = router.buildToolIndexDigest(auth);
    expect(digest).toMatch(/^Índice del taller/);
    expect(digest).toContain('list_cash_session_movements');
    expect(digest).not.toContain('list_cash_sessions');
    expect(digest.split('\n').slice(1).join('\n')).not.toContain(
      'search_tools',
    );
    const domains = digest
      .split('\n')
      .slice(1)
      .map((line) => line.slice(2, line.indexOf(':')));
    expect(domains).toEqual([...domains].sort((x, y) => x.localeCompare(y)));
    expect(router.buildToolIndexDigest(auth)).toBe(digest);
  });

  it('alternativas ante un nombre alucinado: devuelve y carga herramientas reales', async () => {
    const auth = registry.getAllDefinitions();
    const session = router.createSession('proveedores', 's', [], 'vexi');
    await router.select(session, auth, false, false);
    const alternatives = await router.alternatives(
      session,
      'list_customers_by_city',
      'buscar clientes',
      auth,
    );
    expect(alternatives.length).toBeGreaterThan(0);
    expect(alternatives.every((n) => registry.get(n))).toBe(true);
    for (const n of alternatives)
      expect(router.isLoaded(session, n)).toBe(true);
  });
});
