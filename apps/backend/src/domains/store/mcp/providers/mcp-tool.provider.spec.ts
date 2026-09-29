import { RequestContextService } from '@common/context/request-context.service';
import { McpToolProvider } from './mcp-tool.provider';

/**
 * Paso 15 (T5) — el catálogo MCP marca el sunset.
 *
 * Pinnea (a) que una tool vigente sale SIN `deprecated` y con la descripción
 * intacta, y (b) que una tool deprecada sale CON el marcador `deprecated` y
 * la línea de sunset adherida a la descripción (los SDK de MCP pueden pelar
 * claves extra, pero la descripción siempre llega).
 */
describe('mcp-tool.provider · T5 sunset en el catálogo', () => {
  const DEFINITIONS = [
    {
      type: 'function',
      function: {
        name: 'get_order',
        description: 'Lee una orden.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'fetch_order',
        description: 'Lee una orden (nombre viejo).',
        parameters: { type: 'object', properties: {} },
      },
    },
  ];

  function buildProvider() {
    const registry = {
      getAvailableDefinitions: jest.fn().mockReturnValue(DEFINITIONS),
      getToolVersion: jest.fn().mockReturnValue('1'),
      getDeprecation: jest.fn((name: string) =>
        name === 'fetch_order'
          ? { since: '1', sunset: 'v9', replacedBy: 'get_order' }
          : undefined,
      ),
    };
    return {
      registry,
      provider: new McpToolProvider(registry as any),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ permissions: ['*'] } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('vigente: sin deprecated y descripción intacta', () => {
    const { provider } = buildProvider();
    const [current] = provider.listTools();

    expect(current.name).toBe('get_order');
    expect(current.version).toBe('1');
    expect(current.deprecated).toBeUndefined();
    expect('deprecated' in current).toBe(false);
    expect(current.description).toBe('Lee una orden.');
  });

  it('deprecado: marcador + línea de sunset en la descripción', () => {
    const { provider } = buildProvider();
    const [, old] = provider.listTools();

    expect(old.name).toBe('fetch_order');
    expect(old.deprecated).toEqual({
      since: '1',
      sunset: 'v9',
      replacedBy: 'get_order',
    });
    expect(old.description).toContain('Lee una orden (nombre viejo).');
    expect(old.description).toContain('DEPRECADO desde v1');
    expect(old.description).toContain('se retira en v9');
    expect(old.description).toContain('usa get_order');
  });
});
