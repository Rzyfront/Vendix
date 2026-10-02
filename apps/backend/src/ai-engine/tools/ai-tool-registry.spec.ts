import { AIToolRegistry } from './ai-tool-registry';
import {
  buildToolErrorEnvelope,
  buildToolSuccessEnvelope,
  RegisteredTool,
} from './interfaces/tool.interface';
import { uiTools } from './domains/ui.tools';
import { VendixHttpException } from '../../common/errors';

/**
 * T3 — Validación en el borde del registry.
 *
 * `executeTool` valida los args contra el JSON Schema del tool ANTES del
 * `preview` y del `handler`. El fallo no lanza `AI_AGENT_003`: devuelve
 * `{error, next_step}` en español para que el modelo se corrija en el turno.
 * Estos casos fijan ese contrato: handler espiado que NO se invoca en sad.
 */
describe('ai-tool-registry · T3 validación en el borde', () => {
  const confirmations = {
    issue: jest.fn(),
    redeem: jest.fn(),
  };

  const parameters = {
    type: 'object',
    properties: {
      order_id: {
        type: 'number',
        description: 'Identificador interno de la orden.',
      },
      state: {
        type: 'string',
        enum: ['processing', 'shipped', 'delivered'],
        description: 'Filtro por estado.',
      },
      limit: {
        type: 'number',
        description: 'Filas por página.',
      },
    },
    required: ['order_id'],
  };

  function buildRegistry(handler: jest.Mock) {
    const registry = new AIToolRegistry(confirmations as any);
    const tool: RegisteredTool = {
      name: 'get_order_probe',
      domain: 'orders',
      readOnly: true,
      description: 'Sonda de prueba para la validación de borde.',
      parameters,
      handler,
    };
    registry.register(tool);
    return registry;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('happy: args válidos llegan al handler y su respuesta pasa intacta', async () => {
    const handler = jest
      .fn()
      .mockResolvedValue(JSON.stringify({ orden: { order_id: 7 } }));
    const registry = buildRegistry(handler);

    const result = await registry.executeTool('get_order_probe', {
      order_id: 7,
      state: 'shipped',
      limit: 10,
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result)).toEqual({ orden: { order_id: 7 } });
  });

  it('sad: falta un requerido → {error, next_step} sin invocar al handler', async () => {
    const handler = jest.fn();
    const registry = buildRegistry(handler);

    const result = await registry.executeTool('get_order_probe', {
      state: 'shipped',
    });

    expect(handler).not.toHaveBeenCalled();
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('order_id');
    expect(parsed.next_step).toContain('order_id');
  });

  it('sad: enum inválido → nombra los valores esperados, handler intacto', async () => {
    const handler = jest.fn();
    const registry = buildRegistry(handler);

    const result = await registry.executeTool('get_order_probe', {
      order_id: 7,
      state: 'volando',
    });

    expect(handler).not.toHaveBeenCalled();
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('processing');
    expect(parsed.error).toContain('shipped');
    expect(parsed.error).toContain('delivered');
    expect(parsed.next_step).toContain('get_order_probe');
  });

  it('sad: tipo incorrecto → {error, next_step}, handler intacto', async () => {
    const handler = jest.fn();
    const registry = buildRegistry(handler);

    const result = await registry.executeTool('get_order_probe', {
      order_id: 7,
      limit: true,
    });

    expect(handler).not.toHaveBeenCalled();
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('limit');
    expect(parsed.next_step).toContain('opcionales');
  });

  it('tolerante: cadena numérica para un number se coacciona y pasa', async () => {
    const handler = jest.fn().mockResolvedValue('ok');
    const registry = buildRegistry(handler);

    const result = await registry.executeTool('get_order_probe', {
      order_id: '7',
    });

    expect(result).toBe('ok');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].order_id).toBe(7);
  });

  it('el borde no relaja el permiso: sin permiso sigue AI_AGENT_004', async () => {
    const handler = jest.fn();
    const registry = new AIToolRegistry(confirmations as any);
    registry.register({
      name: 'gated_probe',
      domain: 'orders',
      readOnly: true,
      description: 'Sonda con permiso requerido.',
      parameters,
      requiredPermissions: ['store:orders:read'],
      handler,
    });

    // Sin contexto de request no hay permisos concedidos.
    await expect(
      registry.executeTool('gated_probe', { order_id: 1 }),
    ).rejects.toMatchObject({ errorCode: 'AI_AGENT_004' } as Partial<VendixHttpException>);
    expect(handler).not.toHaveBeenCalled();
  });

  it('herramienta desconocida sigue lanzando AI_AGENT_003 con sugerencias', async () => {
    const registry = buildRegistry(jest.fn());

    const failure: VendixHttpException = await registry
      .executeTool('get_orders_list', { order_id: 1 })
      .catch((error) => error);

    expect(failure).toBeInstanceOf(VendixHttpException);
    expect(failure.errorCode).toBe('AI_AGENT_003');
  });
});

/**
 * T2 — Contratos versionados + envelope + alias.
 *
 * `RegisteredTool.version` defaultea a `'1'` en el registro; el nombre viejo
 * de un breaking resuelve al nuevo vía `registerAlias` durante el sunset; la
 * salida formal es el envelope `{tool, version, data} | {tool, version, error,
 * next_step}`. `executeTool()` devuelve el string del handler intacto: el
 * envelope es el contrato que las tools nuevas construyen, no un re-wrap.
 */
describe('ai-tool-registry · T2 versionado + alias + envelope', () => {
  const confirmations = {
    issue: jest.fn(),
    redeem: jest.fn(),
  };

  const parameters = {
    type: 'object',
    properties: {
      order_id: {
        type: 'number',
        description: 'Identificador interno de la orden.',
      },
    },
    required: ['order_id'],
  };

  function buildRegistry(handler: jest.Mock, version?: string) {
    const registry = new AIToolRegistry(confirmations as any);
    const tool: RegisteredTool = {
      name: 'get_order',
      domain: 'orders',
      readOnly: true,
      description: 'Sonda de prueba para el versionado.',
      parameters,
      handler,
      ...(version ? { version } : {}),
    };
    registry.register(tool);
    return registry;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registrar sin version defaultea a 1 y el catálogo la porta', () => {
    const registry = buildRegistry(jest.fn());

    expect(registry.get('get_order')?.version).toBe('1');
    expect(registry.getToolVersion('get_order')).toBe('1');
  });

  it('la versión declarada se preserva tal cual', () => {
    const registry = buildRegistry(jest.fn(), '2');

    expect(registry.get('get_order')?.version).toBe('2');
    expect(registry.getToolVersion('get_order')).toBe('2');
  });

  it('alias: el nombre viejo ejecuta el handler del nuevo', async () => {
    const handler = jest.fn().mockResolvedValue(JSON.stringify({ ok: true }));
    const registry = buildRegistry(handler);
    registry.registerAlias('fetch_order', 'get_order');

    expect(registry.canonicalName('fetch_order')).toBe('get_order');
    const result = await registry.executeTool('fetch_order', { order_id: 3 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result)).toEqual({ ok: true });
  });

  it('alias hacia un destino ausente cae a AI_AGENT_003 con sugerencias', async () => {
    const registry = buildRegistry(jest.fn());
    registry.registerAlias('get_orders_list', 'get_order_missing');

    const failure: VendixHttpException = await registry
      .executeTool('get_orders_list', { order_id: 1 })
      .catch((error) => error);

    expect(failure).toBeInstanceOf(VendixHttpException);
    expect(failure.errorCode).toBe('AI_AGENT_003');
    expect(failure.message).toContain('get_order');
  });

  it('alias en ciclo no cuelga: resuelve nulo y lanza AI_AGENT_003', async () => {
    const registry = buildRegistry(jest.fn());
    registry.registerAlias('name_a', 'name_b');
    registry.registerAlias('name_b', 'name_a');

    const failure: VendixHttpException = await registry
      .executeTool('name_a', { order_id: 1 })
      .catch((error) => error);

    expect(failure).toBeInstanceOf(VendixHttpException);
    expect(failure.errorCode).toBe('AI_AGENT_003');
  });

  it('envelope de éxito porta tool + version + data', () => {
    expect(buildToolSuccessEnvelope('get_order', { order_id: 3 })).toEqual({
      tool: 'get_order',
      version: '1',
      data: { order_id: 3 },
    });
    expect(
      buildToolSuccessEnvelope('get_order', { order_id: 3 }, '2'),
    ).toEqual({
      tool: 'get_order',
      version: '2',
      data: { order_id: 3 },
    });
  });

  it('envelope de error porta tool + version + error + next_step', () => {
    expect(
      buildToolErrorEnvelope(
        'get_order',
        'Falta el campo requerido "order_id".',
        'Reintenta get_order con order_id.',
      ),
    ).toEqual({
      tool: 'get_order',
      version: '1',
      error: 'Falta el campo requerido "order_id".',
      next_step: 'Reintenta get_order con order_id.',
    });
  });

  it('el versionado no cambia la salida: el handler pasa intacto', async () => {
    const payload = JSON.stringify({ orden: { order_id: 7 } });
    const handler = jest.fn().mockResolvedValue(payload);
    const registry = buildRegistry(handler, '1');

    const result = await registry.executeTool('get_order', { order_id: 7 });

    expect(result).toBe(payload);
  });
});

/**
 * T5 — Deprecación con alias post-remoción (paso 15).
 *
 * Pinnea (a) que invocar un tool deprecado resuelve igual pero emite
 * `logger.warn` con since/sunset/replacedBy, (b) `getDeprecation` sobre
 * nombre directo y alias, y (c) que `removeTool` retira el handler pero el
 * alias sobrevive: re-registrar el destino revive la resolución del nombre
 * viejo (los turnos persistidos en `ai_messages.tool_calls` lo necesitan).
 */
describe('ai-tool-registry · T5 deprecación + remoción', () => {
  const confirmations = {
    issue: jest.fn(),
    redeem: jest.fn(),
  };

  function buildRegistry() {
    const registry = new AIToolRegistry(confirmations as any);
    const handler = jest
      .fn()
      .mockResolvedValue(JSON.stringify({ ok: true }));
    registry.register({
      name: 'get_order_v2',
      domain: 'orders',
      readOnly: true,
      description: 'Sonda vigente.',
      parameters: { type: 'object', properties: {} },
      version: '1',
      handler,
    });
    registry.register({
      name: 'get_order',
      domain: 'orders',
      readOnly: true,
      description: 'Sonda deprecada.',
      parameters: { type: 'object', properties: {} },
      version: '1',
      deprecated: { since: '1', sunset: 'v9', replacedBy: 'get_order_v2' },
      handler,
    });
    return { registry, handler };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deprecado resuelve igual pero emite warn con since/sunset/replacedBy', async () => {
    const { registry, handler } = buildRegistry();
    const warn = jest
      .spyOn((registry as any).logger, 'warn')
      .mockImplementation(() => undefined);

    const result = await registry.executeTool('get_order', {});

    expect(handler).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result)).toEqual({ ok: true });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('get_order');
    expect(warn.mock.calls[0][0]).toContain('v1');
    expect(warn.mock.calls[0][0]).toContain('v9');
    expect(warn.mock.calls[0][0]).toContain('get_order_v2');
  });

  it('vigente no emite warn de deprecación', async () => {
    const { registry } = buildRegistry();
    const warn = jest
      .spyOn((registry as any).logger, 'warn')
      .mockImplementation(() => undefined);

    await registry.executeTool('get_order_v2', {});

    expect(warn).not.toHaveBeenCalled();
  });

  it('getDeprecation resuelve directo, alias y namespace; vigente es undefined', () => {
    const { registry } = buildRegistry();
    registry.registerAlias('fetch_order', 'get_order');

    expect(registry.getDeprecation('get_order')).toEqual({
      since: '1',
      sunset: 'v9',
      replacedBy: 'get_order_v2',
    });
    expect(registry.getDeprecation('fetch_order')).toEqual({
      since: '1',
      sunset: 'v9',
      replacedBy: 'get_order_v2',
    });
    expect(registry.getDeprecation('default_api.get_order')).toEqual({
      since: '1',
      sunset: 'v9',
      replacedBy: 'get_order_v2',
    });
    expect(registry.getDeprecation('get_order_v2')).toBeUndefined();
    expect(registry.getDeprecation('no_existe')).toBeUndefined();
  });

  it('removeTool retira el handler pero el alias sobrevive a la remoción', async () => {
    const { registry } = buildRegistry();
    registry.registerAlias('fetch_order', 'get_order_v2');

    expect(registry.removeTool('get_order_v2')).toBe(true);
    expect(registry.removeTool('get_order_v2')).toBe(false);

    // Destino ausente: el alias no resuelve mal, cae al camino desconocido.
    const failure: VendixHttpException = await registry
      .executeTool('fetch_order', {})
      .catch((error) => error);
    expect(failure).toBeInstanceOf(VendixHttpException);
    expect(failure.errorCode).toBe('AI_AGENT_003');

    // El alias sobrevivió: re-registrar el destino revive el nombre viejo.
    registry.register({
      name: 'get_order_v2',
      domain: 'orders',
      readOnly: true,
      description: 'Sonda vigente re-registrada.',
      parameters: { type: 'object', properties: {} },
      version: '1',
      handler: jest.fn().mockResolvedValue(JSON.stringify({ revived: true })),
    });
    const result = await registry.executeTool('fetch_order', {});
    expect(JSON.parse(result)).toEqual({ revived: true });
  });
});

/**
 * RX2 — `denied_tools` del agente sobre el registry REAL.
 *
 * El spec del loop mockea `getAgentDefinitions` (fija el contrato del turno),
 * así que el filtrado real se pinnea acá, sin `jest.fn` en el camino:
 * `ui_navigate` queda fuera del catálogo con alcance Vex y presente sin
 * alcance (Vexi). Si `ui.tools.ts` renombra la tool, este spec falla y avisa.
 */
describe('ai-tool-registry · RX2 denied_tools con alcance de agente', () => {
  const confirmations = {
    issue: jest.fn(),
    redeem: jest.fn(),
  };

  function buildCatalog(): AIToolRegistry {
    const registry = new AIToolRegistry(confirmations as any);
    registry.registerMany(uiTools);
    registry.register({
      name: 'list_orders',
      domain: 'orders',
      readOnly: true,
      description: 'Sonda de lectura del dominio orders.',
      parameters: { type: 'object', properties: {} },
      handler: jest.fn().mockResolvedValue('[]'),
    });
    return registry;
  }

  function namesOf(defs: { function: { name: string } }[]): string[] {
    return defs.map((d) => d.function.name);
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ui_navigate excluido con denied_tools de vex, presente sin alcance (vexi)', () => {
    const registry = buildCatalog();

    const vex = namesOf(
      registry.getAgentDefinitions([], { denied_tools: ['ui_navigate'] }),
    );
    expect(vex).not.toContain('ui_navigate');
    expect(vex).toContain('list_orders');

    const vexi = namesOf(registry.getAgentDefinitions([], {}));
    expect(vexi).toContain('ui_navigate');
    expect(vexi).toContain('list_orders');
  });

  it('negar el dominio ui excluye todas las ui_* de una vez', () => {
    const registry = buildCatalog();

    const vex = namesOf(
      registry.getAgentDefinitions([], { denied_tools: ['ui'] }),
    );
    expect(vex).not.toContain('ui_navigate');
    expect(vex.filter((n) => n.startsWith('ui_'))).toEqual([]);
    expect(vex).toContain('list_orders');
  });

  it('el deny gana sobre el allow aunque ambos nombren la tool', () => {
    const registry = buildCatalog();

    const scoped = namesOf(
      registry.getAgentDefinitions([], {
        allowed_tools: ['ui_navigate', 'list_orders'],
        denied_tools: ['ui_navigate'],
      }),
    );
    expect(scoped).not.toContain('ui_navigate');
    expect(scoped).toEqual(['list_orders']);
  });
});
