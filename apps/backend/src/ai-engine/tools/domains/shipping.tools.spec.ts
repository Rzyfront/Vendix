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
    methodsService?: Record<string, any>;
    zonesService?: Record<string, any>;
  } = {}) {
    const deps = {
      shippingCalculatorService: {
        calculateRates: jest.fn(),
        ...overrides.shippingCalculatorService,
      } as any,
      shippingDistanceService: {
        resolveBuyerCoords: jest.fn(),
        resolveDistanceKm: jest.fn(),
        ...overrides.shippingDistanceService,
      } as any,
      methodsService: {
        findOne: jest.fn(),
        getEnabledForStore: jest.fn(),
        getAvailableForStore: jest.fn(),
        getEffectivePolicy: jest.fn(),
        enableForStore: jest.fn(),
        updateStoreMethod: jest.fn(),
        disableForStore: jest.fn(),
        reEnableForStore: jest.fn(),
        removeFromStore: jest.fn(),
        ...overrides.methodsService,
      } as any,
      zonesService: {
        getStoreZones: jest.fn(),
        getStoreZoneRates: jest.fn(),
        getStats: jest.fn(),
        createStoreZone: jest.fn(),
        updateStoreZone: jest.fn(),
        deleteStoreZone: jest.fn(),
        createStoreRate: jest.fn(),
        updateStoreRate: jest.fn(),
        deleteStoreRate: jest.fn(),
        ...overrides.zonesService,
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
      expect(tools.map((tool) => tool.name)).toEqual([
        'quote_shipping',
        'manage_shipping_method',
        'manage_shipping_rates',
        'list_shipping_config',
      ]);
      for (const tool of tools) {
        expect(tool.version).toBe('1');
        expect(tool.domain).toBe('shipping');
      }
      const quote = getTool(tools, 'quote_shipping');
      expect(quote.readOnly).toBe(true);
      expect(quote.requiresConfirmation).toBeUndefined();
      expect(quote.requiredPermissions).toEqual(['store:orders:read']);
      const config = getTool(tools, 'list_shipping_config');
      expect(config.readOnly).toBe(true);
      expect(config.requiredPermissions).toEqual(['store:orders:read']);
      for (const name of ['manage_shipping_method', 'manage_shipping_rates']) {
        const tool = getTool(tools, name);
        expect(tool.requiresConfirmation).toBe(true);
        expect(typeof tool.preview).toBe('function');
        expect(tool.requiredPermissions).toEqual(['store:orders:update']);
        expect(tool.description).toMatch(/list_shipping_config/);
      }
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

  // ─── Paso 13: D-9 manage_shipping_method ──────────────────────────
  describe('manage_shipping_method (D-9)', () => {
    const METHOD = {
      id: 11,
      name: 'Moto mensajería',
      is_active: true,
      distance_pricing_enabled: false,
      origin_latitude: null,
      origin_longitude: null,
    };

    it('(a) sad: activar distancia sin origen se rechaza (borde + servicio intacto)', async () => {
      const updateStoreMethod = jest.fn();
      const tools = buildTools({
        methodsService: {
          findOne: jest.fn().mockResolvedValue(METHOD),
          updateStoreMethod,
        },
      });
      const tool = getTool(tools, 'manage_shipping_method');
      const args = {
        action: 'update',
        method_id: 11,
        distance_pricing_enabled: true,
      };

      const preview = await tool.preview!(args, CONTEXT as any);
      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/origen pineado/);

      const answer = JSON.parse(await tool.handler!(args, CONTEXT));
      expect(answer.error).toMatch(/origen pineado/);
      expect(updateStoreMethod).not.toHaveBeenCalled();
    });

    it('(b) happy: update parcial con origen mezclado delega (snapshot)', async () => {
      const updateStoreMethod = jest
        .fn()
        .mockResolvedValue({ ...METHOD, distance_pricing_enabled: true });
      const tools = buildTools({
        methodsService: {
          findOne: jest.fn().mockResolvedValue(METHOD),
          updateStoreMethod,
        },
      });
      const tool = getTool(tools, 'manage_shipping_method');
      const args = {
        action: 'update',
        method_id: 11,
        distance_pricing_enabled: true,
        origin_latitude: 4.710989,
        origin_longitude: -74.07209,
      };

      const preview = await tool.preview!(args, CONTEXT as any);
      expect(preview.status).toBe('ok');
      expect(preview.target).toContain('Moto mensajería');

      const answer = JSON.parse(await tool.handler!(args, CONTEXT));
      expect(updateStoreMethod).toHaveBeenCalledWith(
        11,
        expect.objectContaining({
          distance_pricing_enabled: true,
          origin_latitude: 4.710989,
        }),
      );
      expect(answer).toEqual({
        resumen: 'Método "Moto mensajería": método actualizado.',
        method_id: 11,
      });
    });

    it('(e) update sobre método que ya tenía origen no exige re-pinear', async () => {
      const pinned = {
        ...METHOD,
        origin_latitude: '4.71098900',
        origin_longitude: '-74.07209000',
      };
      const updateStoreMethod = jest.fn().mockResolvedValue(pinned);
      const tools = buildTools({
        methodsService: {
          findOne: jest.fn().mockResolvedValue(pinned),
          updateStoreMethod,
        },
      });
      const tool = getTool(tools, 'manage_shipping_method');

      const answer = JSON.parse(
        await tool.handler!(
          {
            action: 'update',
            method_id: 11,
            distance_pricing_enabled: true,
          },
          CONTEXT,
        ),
      );

      expect(updateStoreMethod).toHaveBeenCalled();
      expect(answer.resumen).toContain('actualizado');
    });
  });

  // ─── Paso 13: D-10 manage_shipping_rates ──────────────────────────
  describe('manage_shipping_rates (D-10)', () => {
    it('(a) sad: escala con hueco se rechaza en el borde con el tramo culpable', async () => {
      const createStoreRate = jest.fn();
      const tools = buildTools({
        zonesService: { createStoreRate },
      });
      const tool = getTool(tools, 'manage_shipping_rates');
      const args = {
        action: 'create-rate',
        zone_id: 3,
        shipping_method_id: 11,
        type: 'flat',
        base_cost: 5000,
        distance_tiers: [
          { from_km: 0, to_km: 5, price: 8000 },
          { from_km: 7, to_km: null, price: 12000 },
        ],
      };

      const preview = await tool.preview!(args, CONTEXT as any);
      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/Tramo 2/);
      expect(preview.message).toMatch(/contigua/);

      const answer = JSON.parse(await tool.handler!(args, CONTEXT));
      expect(answer.error).toMatch(/Tramo 2/);
      expect(createStoreRate).not.toHaveBeenCalled();
    });

    it('(a) sad: tramo abierto en el medio se rechaza', async () => {
      const tools = buildTools();
      const tool = getTool(tools, 'manage_shipping_rates');

      const preview = await tool.preview!(
        {
          action: 'create-rate',
          zone_id: 3,
          shipping_method_id: 11,
          type: 'flat',
          base_cost: 5000,
          distance_tiers: [
            { from_km: 0, to_km: null, price: 8000 },
            { from_km: 0, to_km: 5, price: 9000 },
          ],
        },
        CONTEXT as any,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/solo puede ir al final/);
    });

    it('(b) happy create-rate: preview muestra la escala y delega (snapshot)', async () => {
      const createStoreRate = jest.fn().mockResolvedValue({ id: 77 });
      const tools = buildTools({
        zonesService: { createStoreRate },
      });
      const tool = getTool(tools, 'manage_shipping_rates');
      const args = {
        action: 'create-rate',
        zone_id: 3,
        shipping_method_id: 11,
        type: 'flat',
        base_cost: 5000,
        distance_tiers: [
          { from_km: 0, to_km: 5, price: 8000 },
          { from_km: 5, to_km: null, price: 12000 },
        ],
      };

      const preview = await tool.preview!(args, CONTEXT as any);
      expect(preview.status).toBe('ok');
      expect(preview.target).toContain('2 tramo(s) por km');

      const answer = JSON.parse(await tool.handler!(args, CONTEXT));
      expect(createStoreRate).toHaveBeenCalledWith(
        expect.objectContaining({
          shipping_zone_id: 3,
          shipping_method_id: 11,
          base_cost: 5000,
        }),
      );
      expect(answer).toEqual({
        resumen: 'Tarifa #77 creada en la zona #3 (base 5000).',
        rate_id: 77,
      });
    });
  });

  // ─── Paso 13: D-11 list_shipping_config + ECOM exacto ─────────────
  describe('list_shipping_config (D-11)', () => {
    const BUYER = {
      address_line1: 'Calle 45 # 12-30',
      city: 'Bogotá',
      country_code: 'CO',
      latitude: 4.648283,
      longitude: -74.064999,
    };

    function checkTools(overrides: {
      method?: Record<string, any>;
      buyer?: unknown;
      distanceKm?: unknown;
      rates?: unknown[];
    }) {
      return buildTools({
        methodsService: {
          findOne: jest.fn().mockResolvedValue({
            id: 11,
            name: 'Moto mensajería',
            distance_pricing_enabled: true,
            origin_latitude: '4.71098900',
            origin_longitude: '-74.07209000',
            ...overrides.method,
          }),
        },
        shippingDistanceService: {
          resolveBuyerCoords: jest.fn().mockResolvedValue(overrides.buyer),
          resolveDistanceKm: jest.fn().mockResolvedValue(overrides.distanceKm),
        },
        zonesService: {
          getStoreZones: jest.fn().mockResolvedValue([{ id: 3 }]),
          getStoreZoneRates: jest
            .fn()
            .mockResolvedValue(overrides.rates ?? []),
        },
      });
    }

    it('(b) happy listado: métodos + zonas (snapshot)', async () => {
      const tools = buildTools({
        methodsService: {
          getEnabledForStore: jest.fn().mockResolvedValue([
            {
              id: 11,
              name: 'Moto mensajería',
              distance_pricing_enabled: true,
              origin_latitude: '4.71',
              origin_longitude: '-74.07',
            },
          ]),
        },
        zonesService: {
          getStoreZones: jest
            .fn()
            .mockResolvedValue([
              { id: 3, name: 'Bogotá', countries: ['CO'], is_active: true },
            ]),
          getStoreZoneRates: jest.fn().mockResolvedValue([
            {
              id: 55,
              shipping_method_id: 11,
              type: 'flat',
              base_cost: '5000',
              distance_tiers: [{ from_km: 0, to_km: null, price: 8000 }],
            },
          ]),
          getStats: jest.fn().mockResolvedValue({ zones: 1, rates: 1 }),
        },
      });
      const tool = getTool(tools, 'list_shipping_config');
      const answer = JSON.parse(await tool.handler!({}, CONTEXT));

      expect(answer.metodos).toEqual([
        {
          method_id: 11,
          name: 'Moto mensajería',
          distance_pricing_enabled: true,
          origin_pinado: true,
        },
      ]);
      expect(answer.zonas[0].tarifas[0]).toMatchObject({
        rate_id: 55,
        has_distance_tiers: true,
      });
    });

    it('ECOM exacto (buyer_geocode_failed): réplica checkout-distance 411-436', async () => {
      // Sin coords del comprador y sin poder geocodificar: el veredicto
      // porta el MISMO error_code (fijado, no solo la clase) y el MISMO
      // mensaje que la confirmación del checkout — ya NO degrada a zona.
      const resolveDistanceKm = jest.fn();
      const tools = buildTools({
        methodsService: {
          findOne: jest.fn().mockResolvedValue({
            id: 11,
            name: 'Moto mensajería',
            distance_pricing_enabled: true,
            origin_latitude: '4.71098900',
            origin_longitude: '-74.07209000',
          }),
        },
        shippingDistanceService: {
          resolveBuyerCoords: jest.fn().mockResolvedValue(null),
          resolveDistanceKm,
        },
      });
      const tool = getTool(tools, 'list_shipping_config');
      const answer = JSON.parse(
        await tool.handler!(
          { method_id: 11, check_buyer: { address_line1: 'xyz' } },
          CONTEXT,
        ),
      );

      expect(resolveDistanceKm).not.toHaveBeenCalled();
      expect(answer.veredicto.error_code).toBe('ECOM_CHECKOUT_003');
      expect(answer.veredicto.error).toBe(
        'No pudimos ubicar la dirección de entrega. Marca la ubicación en el mapa para calcular el envío.',
      );
    });

    it('ECOM exacto (rechazo estricto SIN tolerancia): réplica checkout-distance 513-544', async () => {
      // 15.1 km con el último tramo cerrado en to_km 15: cae fuera de
      // todos los rangos (matchTier puro, sin gracia de 0.2 km) y el
      // veredicto porta el error_code exacto, no solo la clase.
      const tools = checkTools({
        buyer: {
          latitude: 4.648283,
          longitude: -74.064999,
          source: 'client',
        },
        distanceKm: 15.1,
        rates: [
          {
            id: 55,
            shipping_method_id: 11,
            base_cost: '5000',
            distance_tiers: [
              { from_km: 0, to_km: 10, price: 8000 },
              { from_km: 10, to_km: 15, price: 12000 },
            ],
          },
        ],
      });
      const tool = getTool(tools, 'list_shipping_config');
      const answer = JSON.parse(
        await tool.handler!(
          { method_id: 11, check_buyer: BUYER },
          CONTEXT,
        ),
      );

      expect(answer.distancia_km).toBe(15.1);
      expect(answer.veredictos).toEqual([
        {
          rate_id: 55,
          zona: 3,
          resultado: 'excluida',
          error_code: 'ECOM_CHECKOUT_003',
          error:
            'La tarifa de envío seleccionada ya no cubre la distancia a tu dirección; vuelve a cotizar el envío',
        },
      ]);
    });

    it('distance-check happy: 8.5 km matchea el tramo y reporta desde dónde se midió', async () => {
      const tools = checkTools({
        buyer: {
          latitude: 4.648283,
          longitude: -74.064999,
          source: 'client',
        },
        distanceKm: 8.5,
        rates: [
          {
            id: 55,
            shipping_method_id: 11,
            base_cost: '5000',
            distance_tiers: [
              { from_km: 0, to_km: 10, price: 8000 },
              { from_km: 10, to_km: null, price: 12000 },
            ],
          },
        ],
      });
      const tool = getTool(tools, 'list_shipping_config');
      const answer = JSON.parse(
        await tool.handler!(
          { method_id: 11, check_buyer: BUYER },
          CONTEXT,
        ),
      );

      expect(answer.veredictos).toEqual([
        {
          rate_id: 55,
          zona: 3,
          resultado: 'tramo',
          tramo: { from_km: 0, to_km: 10 },
          precio: 8000,
        },
      ]);
      expect(answer.medido_desde.origen).toBe('pin del comprador');
    });

    it('distance-check: método sin distancia ni origen no rechaza (zona/infra)', async () => {
      const flat = checkTools({
        method: { distance_pricing_enabled: false },
        buyer: null,
        distanceKm: null,
        rates: [],
      });
      const flatAnswer = JSON.parse(
        await getTool(flat, 'list_shipping_config').handler!(
          { method_id: 11, check_buyer: BUYER },
          CONTEXT,
        ),
      );
      expect(flatAnswer.distancia_activa).toBe(false);

      const noOrigin = checkTools({
        method: { origin_latitude: null, origin_longitude: null },
        buyer: null,
        distanceKm: null,
        rates: [],
      });
      const noOriginAnswer = JSON.parse(
        await getTool(noOrigin, 'list_shipping_config').handler!(
          { method_id: 11, check_buyer: BUYER },
          CONTEXT,
        ),
      );
      expect(noOriginAnswer.origen).toBeNull();
      expect(noOriginAnswer.nota).toMatch(/rige precio de zona/);
    });
  });
});