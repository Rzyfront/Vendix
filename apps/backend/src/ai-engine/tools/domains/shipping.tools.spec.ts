import {
  createShippingTools,
  ShippingToolDeps,
} from './shipping.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Track B paso 8 — contrato D-8 (cotización de envío).
 *
 * Patrón canónico T4: (a) happy/sad, (b) snapshot de salida, (c) forma
 * `{error, next_step}`, (d) permiso declarado, (e) `readOnly: true`.
 * La tool usa el MISMO `resolveBuyerCoords` que el cotizador y la
 * confirmación; sin punto del comprador las tarifas por distancia se excluyen
 * (regla 2026-09-27) y la respuesta pide el mapa en vez de un 0 engañoso.
 */
describe('shipping.tools · D-8 quote_shipping', () => {
  const CONTEXT = { store_id: 7, organization_id: 3, user_id: 11, roles: [] };

  function buildTools(overrides: {
    shippingCalculatorService?: Record<string, any>;
    shippingDistanceService?: Record<string, any>;
  } = {}) {
    const deps = {
      shippingCalculatorService: {
        calculateRates: jest.fn(),
        ...overrides.shippingCalculatorService,
      } as any,
      shippingDistanceService: {
        resolveBuyerCoords: jest.fn(),
        ...overrides.shippingDistanceService,
      } as any,
    } satisfies ShippingToolDeps;
    return createShippingTools(deps);
  }

  function getTool(tools: RegisteredTool[], name: string): RegisteredTool {
    const tool = tools.find((t) => t.name === name);
    if (!tool?.handler) throw new Error(`${name} sin handler`);
    return tool;
  }

  const OPTIONS = [
    {
      id: 501,
      rate_id: 501,
      method_id: 11,
      method_name: 'Moto mensajería',
      method_type: 'own_fleet',
      cost: 12000,
      base: 12000,
      currency: 'COP',
      estimated_days: { min: 0, max: 1 },
      zone_id: 3,
      is_fallback: false,
    },
    {
      id: 502,
      rate_id: 502,
      method_id: 12,
      method_name: 'Retiro en tienda',
      method_type: 'pickup',
      cost: 0,
      base: 0,
      currency: 'COP',
      zone_id: null,
      is_fallback: true,
    },
  ];

  const ARGS = {
    country_code: 'CO',
    city: 'Bogotá',
    address_line1: 'Calle 45 # 12-30',
    latitude: 4.648283,
    longitude: -74.064999,
    items: [{ product_id: 9, quantity: 2, price: 50000, weight: 1.5 }],
  };

  describe('contrato de familia', () => {
    it('declara version 1, readOnly y permiso del flujo de órdenes', () => {
      const tools = buildTools();
      const tool = getTool(tools, 'quote_shipping');
      expect(tool.version).toBe('1');
      expect(tool.readOnly).toBe(true);
      expect(tool.requiresConfirmation).toBeUndefined();
      expect(tool.requiredPermissions).toEqual(['store:orders:read']);
    });
  });

  describe('quote_shipping (D-8)', () => {
    it('happy: opciones + punto del comprador (snapshot)', async () => {
      const calculateRates = jest.fn().mockResolvedValue(OPTIONS);
      const resolveBuyerCoords = jest.fn().mockResolvedValue({
        latitude: 4.648283,
        longitude: -74.064999,
        source: 'client',
      });
      const tools = buildTools({
        shippingCalculatorService: { calculateRates },
        shippingDistanceService: { resolveBuyerCoords },
      });
      const tool = getTool(tools, 'quote_shipping');
      const answer = JSON.parse(await tool.handler!(ARGS, CONTEXT));

      expect(answer).toEqual({
        direccion: {
          country_code: 'CO',
          city: 'Bogotá',
          address_line1: 'Calle 45 # 12-30',
        },
        opciones: [
          {
            rate_id: 501,
            method_id: 11,
            method: 'Moto mensajería',
            type: 'own_fleet',
            cost: 12000,
            base: 12000,
            currency: 'COP',
            estimated_days: { min: 0, max: 1 },
            zone_id: 3,
            is_fallback: false,
          },
          {
            rate_id: 502,
            method_id: 12,
            method: 'Retiro en tienda',
            type: 'pickup',
            cost: 0,
            base: 0,
            currency: 'COP',
            estimated_days: null,
            zone_id: null,
            is_fallback: true,
          },
        ],
        nota: 'Alguna opción viene del fallback de retiro en tienda: no hay despacho a esta dirección para esos métodos.',
        geocodificacion: {
          resuelta: true,
          latitud: 4.648283,
          longitud: -74.064999,
          origen: 'pin del comprador',
        },
      });
      expect(calculateRates).toHaveBeenCalledWith(
        7,
        [
          {
            product_id: 9,
            quantity: 2,
            price: 50000,
            weight: 1.5,
          },
        ],
        expect.objectContaining({ country_code: 'CO' }),
      );
      expect(resolveBuyerCoords).toHaveBeenCalledWith(
        expect.objectContaining({
          country_code: 'CO',
          latitude: 4.648283,
        }),
      );
    });

    it('happy: punto geocodificado reporta precisión', async () => {
      const tools = buildTools({
        shippingCalculatorService: {
          calculateRates: jest.fn().mockResolvedValue([OPTIONS[0]]),
        },
        shippingDistanceService: {
          resolveBuyerCoords: jest.fn().mockResolvedValue({
            latitude: 4.65,
            longitude: -74.06,
            precision: 'intersection',
            source: 'geocoded',
          }),
        },
      });
      const tool = getTool(tools, 'quote_shipping');
      const { latitude: _lat, longitude: _lng, ...noPin } = ARGS;
      const answer = JSON.parse(await tool.handler!(noPin, CONTEXT));

      expect(answer.geocodificacion).toEqual({
        resuelta: true,
        latitud: 4.65,
        longitud: -74.06,
        origen: 'geocode (intersection)',
      });
      expect(answer.opciones).toHaveLength(1);
    });

    it('happy: sin punto del comprador pide el mapa (regla 2026-09-27)', async () => {
      const tools = buildTools({
        shippingCalculatorService: {
          calculateRates: jest.fn().mockResolvedValue([OPTIONS[0]]),
        },
        shippingDistanceService: {
          resolveBuyerCoords: jest.fn().mockResolvedValue(null),
        },
      });
      const tool = getTool(tools, 'quote_shipping');
      const answer = JSON.parse(
        await tool.handler!(
          {
            country_code: 'CO',
            items: [{ product_id: 9, quantity: 1 }],
          },
          CONTEXT,
        ),
      );

      expect(answer.geocodificacion.resuelta).toBe(false);
      expect(answer.geocodificacion.nota).toMatch(/mapa/);
      expect(answer.geocodificacion.nota).toMatch(/distancia/);
      // La zona que sí resolvió sigue presente; la tool no inventa.
      expect(answer.opciones).toHaveLength(1);
    });

    it('happy: method_id filtra a un método', async () => {
      const tools = buildTools({
        shippingCalculatorService: {
          calculateRates: jest.fn().mockResolvedValue(OPTIONS),
        },
        shippingDistanceService: {
          resolveBuyerCoords: jest.fn().mockResolvedValue({
            latitude: 4.64,
            longitude: -74.06,
            source: 'client',
          }),
        },
      });
      const tool = getTool(tools, 'quote_shipping');
      const answer = JSON.parse(
        await tool.handler!({ ...ARGS, method_id: 12 }, CONTEXT),
      );

      expect(answer.opciones).toHaveLength(1);
      expect(answer.opciones[0].method_id).toBe(12);
    });

    it('happy: sin cobertura responde nota + next_step (no error crudo)', async () => {
      const tools = buildTools({
        shippingCalculatorService: {
          calculateRates: jest.fn().mockResolvedValue([]),
        },
        shippingDistanceService: {
          resolveBuyerCoords: jest.fn().mockResolvedValue(null),
        },
      });
      const tool = getTool(tools, 'quote_shipping');
      const answer = JSON.parse(await tool.handler!(ARGS, CONTEXT));

      expect(answer.opciones).toEqual([]);
      expect(answer.nota).toMatch(/Ninguna zona/);
      expect(answer.next_step).toMatch(/mapa/);
    });

    it('happy: include_geocoding false omite la sección', async () => {
      const tools = buildTools({
        shippingCalculatorService: {
          calculateRates: jest.fn().mockResolvedValue([OPTIONS[0]]),
        },
        shippingDistanceService: {
          resolveBuyerCoords: jest.fn().mockResolvedValue({
            latitude: 4.64,
            longitude: -74.06,
            source: 'client',
          }),
        },
      });
      const tool = getTool(tools, 'quote_shipping');
      const answer = JSON.parse(
        await tool.handler!({ ...ARGS, include_geocoding: false }, CONTEXT),
      );

      expect(answer.opciones).toHaveLength(1);
      expect(answer.geocodificacion).toBeUndefined();
    });

    it('sad: sin tienda no llama al cotizador', async () => {
      const calculateRates = jest.fn();
      const tools = buildTools({
        shippingCalculatorService: { calculateRates },
      });
      const tool = getTool(tools, 'quote_shipping');
      const answer = JSON.parse(await tool.handler!(ARGS, {}));

      expect(answer.error).toMatch(/tienda/);
      expect(calculateRates).not.toHaveBeenCalled();
    });

    it('sad: items vacío o línea inválida no llama al cotizador', async () => {
      const calculateRates = jest.fn();
      const tools = buildTools({
        shippingCalculatorService: { calculateRates },
      });
      const tool = getTool(tools, 'quote_shipping');
      const empty = JSON.parse(
        await tool.handler!(
          { country_code: 'CO', items: [] },
          CONTEXT,
        ),
      );
      const badLine = JSON.parse(
        await tool.handler!(
          {
            country_code: 'CO',
            items: [{ product_id: 9, quantity: 0 }],
          },
          CONTEXT,
        ),
      );

      expect(empty.error).toMatch(/al menos una línea/);
      expect(badLine.error).toMatch(/items\[0\]/);
      expect(calculateRates).not.toHaveBeenCalled();
    });

    it('sad: fallo del cotizador responde {error, next_step}', async () => {
      const tools = buildTools({
        shippingCalculatorService: {
          calculateRates: jest
            .fn()
            .mockRejectedValue(new Error('Routing timeout')),
        },
        shippingDistanceService: {
          resolveBuyerCoords: jest.fn().mockResolvedValue({
            latitude: 4.64,
            longitude: -74.06,
            source: 'client',
          }),
        },
      });
      const tool = getTool(tools, 'quote_shipping');
      const answer = JSON.parse(await tool.handler!(ARGS, CONTEXT));

      expect(answer.error).toMatch(/No se pudo cotizar/);
      expect(answer.next_step).toMatch(/zonas y métodos/);
    });
  });
});