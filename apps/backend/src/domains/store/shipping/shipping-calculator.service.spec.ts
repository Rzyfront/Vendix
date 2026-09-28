import { Test, TestingModule } from '@nestjs/testing';
import { ShippingCalculatorService } from './shipping-calculator.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ShippingTaxService } from './services/shipping-tax.service';
import { ShippingDistanceService } from './services/shipping-distance.service';
import { shipping_rate_type_enum } from '@prisma/client';

describe('ShippingCalculatorService', () => {
  let service: ShippingCalculatorService;
  let mockPrisma: any;
  let mockSettings: any;
  let mockShippingTax: any;

  beforeEach(async () => {
    mockPrisma = {
      shipping_zones: {
        findMany: jest.fn(),
      },
      shipping_rates: {
        findMany: jest.fn(),
      },
      addresses: {
        findMany: jest.fn(),
      },
    };

    mockSettings = {
      getStoreCurrency: jest.fn().mockResolvedValue('COP'),
    };

    // Default: ninguna tarifa con contexto fiscal ⇒ costo tal cual, sin
    // campos de comerciante (comportamiento pre-lote-C).
    mockShippingTax = {
      loadRateTaxContext: jest.fn().mockResolvedValue(new Map()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShippingCalculatorService,
        { provide: StorePrismaService, useValue: mockPrisma },
        { provide: SettingsService, useValue: mockSettings },
        { provide: ShippingTaxService, useValue: mockShippingTax },
      ],
    }).compile();

    service = module.get<ShippingCalculatorService>(ShippingCalculatorService);
  });

  describe('resolveMatchingZones y resolveZone (ADR-02: Prevalencia de Ciudad)', () => {
    const riohachaZone = {
      id: 10,
      store_id: 1,
      name: 'Riohacha Local',
      countries: ['CO'],
      regions: ['La Guajira'],
      cities: ['Riohacha'],
      zip_codes: [],
      is_active: true,
    };

    it('matchea zona de Riohacha con departamento y ciudad normales', async () => {
      mockPrisma.shipping_zones.findMany.mockResolvedValue([riohachaZone]);

      const zones = await service.resolveMatchingZones(1, {
        country_code: 'CO',
        state_province: 'La Guajira',
        city: 'Riohacha',
      });

      expect(zones).toHaveLength(1);
      expect(zones[0].id).toBe(10);
    });

    it('ADR-02: matchea zona de Riohacha incluso si el departamento viene como ID numérico "19"', async () => {
      mockPrisma.shipping_zones.findMany.mockResolvedValue([riohachaZone]);

      const zones = await service.resolveMatchingZones(1, {
        country_code: 'CO',
        state_province: '19',
        city: 'Riohacha',
      });

      expect(zones).toHaveLength(1);
      expect(zones[0].id).toBe(10);
    });

    it('ADR-02: matchea zona de Riohacha cuando no se especifica departamento', async () => {
      mockPrisma.shipping_zones.findMany.mockResolvedValue([riohachaZone]);

      const zones = await service.resolveMatchingZones(1, {
        country_code: 'CO',
        city: 'Riohacha',
      });

      expect(zones).toHaveLength(1);
      expect(zones[0].id).toBe(10);
    });

    it('no matchea zona de Riohacha si la ciudad es otra', async () => {
      mockPrisma.shipping_zones.findMany.mockResolvedValue([riohachaZone]);

      const zones = await service.resolveMatchingZones(1, {
        country_code: 'CO',
        state_province: 'La Guajira',
        city: 'Maicao',
      });

      expect(zones).toHaveLength(0);
    });

    it('tolera códigos postales de 5 y 6 dígitos en la zona y dirección', async () => {
      const zoneWithZip = {
        ...riohachaZone,
        zip_codes: ['440001'],
      };
      mockPrisma.shipping_zones.findMany.mockResolvedValue([zoneWithZip]);

      const zones = await service.resolveMatchingZones(1, {
        country_code: 'CO',
        city: 'Riohacha',
        postal_code: '44001',
      });

      expect(zones).toHaveLength(1);
      expect(zones[0].id).toBe(10);
    });
  });

  describe('calculateRates (ADR-01: Multi-Zona)', () => {
    const riohachaZone = {
      id: 10,
      store_id: 1,
      name: 'Riohacha Local',
      countries: ['CO'],
      regions: ['La Guajira'],
      cities: ['Riohacha'],
      zip_codes: [],
      is_active: true,
    };

    const nationalZone = {
      id: 1,
      store_id: 1,
      name: 'Nacional',
      countries: ['CO'],
      regions: [],
      cities: [],
      zip_codes: [],
      is_active: true,
    };

    it('devuelve la tarifa activa para Riohacha cuando es la única zona activa', async () => {
      mockPrisma.shipping_zones.findMany.mockResolvedValue([riohachaZone]);
      mockPrisma.shipping_rates.findMany.mockResolvedValue([
        {
          id: 101,
          shipping_zone_id: 10,
          shipping_method_id: 5,
          name: 'Envío a domicilio',
          type: shipping_rate_type_enum.flat,
          base_cost: 5000,
          is_active: true,
          shipping_method: {
            id: 5,
            name: 'Envío a domicilio',
            type: 'own_fleet',
            is_active: true,
            display_order: 1,
          },
        },
      ]);

      const options = await service.calculateRates(
        1,
        [{ product_id: 1, quantity: 1, price: 50000 }],
        { country_code: 'CO', state_province: '19', city: 'Riohacha' },
      );

      expect(options).toHaveLength(1);
      expect(options[0].rate_id).toBe(101);
      expect(options[0].method_name).toBe('Envío a domicilio');
      expect(options[0].cost).toBe(5000);
      expect(options[0].zone_id).toBe(10);
    });

    it('ADR-01: agrega tarifas de zona local y zona nacional para métodos distintos', async () => {
      mockPrisma.shipping_zones.findMany.mockResolvedValue([
        riohachaZone,
        nationalZone,
      ]);

      mockPrisma.shipping_rates.findMany.mockResolvedValue([
        {
          id: 101,
          shipping_zone_id: 10,
          shipping_method_id: 5,
          name: 'Domicilio Local',
          type: shipping_rate_type_enum.flat,
          base_cost: 5000,
          is_active: true,
          shipping_method: {
            id: 5,
            name: 'Envío a domicilio',
            type: 'own_fleet',
            is_active: true,
            display_order: 1,
          },
        },
        {
          id: 201,
          shipping_zone_id: 1,
          shipping_method_id: 2,
          name: 'Envío Nacional Coordinadora',
          type: shipping_rate_type_enum.flat,
          base_cost: 15000,
          is_active: true,
          shipping_method: {
            id: 2,
            name: 'Envío Nacional',
            type: 'carrier',
            is_active: true,
            display_order: 2,
          },
        },
      ]);

      const options = await service.calculateRates(
        1,
        [{ product_id: 1, quantity: 1, price: 50000 }],
        { country_code: 'CO', state_province: 'La Guajira', city: 'Riohacha' },
      );

      expect(options).toHaveLength(2);
      expect(options.map((o) => o.method_id)).toEqual([5, 2]);
      expect(options.find((o) => o.method_id === 5)?.cost).toBe(5000);
      expect(options.find((o) => o.method_id === 2)?.cost).toBe(15000);
    });

    it('ADR-01: si ambas zonas definen el mismo método, prevalece la zona más específica', async () => {
      mockPrisma.shipping_zones.findMany.mockResolvedValue([
        riohachaZone,
        nationalZone,
      ]);

      mockPrisma.shipping_rates.findMany.mockResolvedValue([
        {
          id: 101,
          shipping_zone_id: 10,
          shipping_method_id: 5,
          name: 'Tarifa Local Riohacha',
          type: shipping_rate_type_enum.flat,
          base_cost: 4000,
          is_active: true,
          shipping_method: {
            id: 5,
            name: 'Envío a domicilio',
            type: 'own_fleet',
            is_active: true,
            display_order: 1,
          },
        },
        {
          id: 201,
          shipping_zone_id: 1,
          shipping_method_id: 5,
          name: 'Tarifa General Domicilio',
          type: shipping_rate_type_enum.flat,
          base_cost: 12000,
          is_active: true,
          shipping_method: {
            id: 5,
            name: 'Envío a domicilio',
            type: 'own_fleet',
            is_active: true,
            display_order: 1,
          },
        },
      ]);

      const options = await service.calculateRates(
        1,
        [{ product_id: 1, quantity: 1, price: 50000 }],
        { country_code: 'CO', state_province: 'La Guajira', city: 'Riohacha' },
      );

      expect(options).toHaveLength(1);
      expect(options[0].method_id).toBe(5);
      expect(options[0].cost).toBe(4000);
      expect(options[0].zone_id).toBe(10);
    });

    it('no descarta zonas del municipio si el código postal no coincide, pero prioriza y marca postal_code_match cuando coincide', async () => {
      const zoneRiohacha1 = {
        id: 101,
        store_id: 1,
        name: 'Riohacha Comuna 1',
        countries: ['CO'],
        regions: ['La Guajira'],
        cities: ['Riohacha'],
        zip_codes: ['440001'],
        is_active: true,
      };
      const zoneRiohacha2 = {
        id: 102,
        store_id: 1,
        name: 'Riohacha Comuna 2',
        countries: ['CO'],
        regions: ['La Guajira'],
        cities: ['Riohacha'],
        zip_codes: ['440002'],
        is_active: true,
      };

      mockPrisma.shipping_zones.findMany.mockResolvedValue([
        zoneRiohacha1,
        zoneRiohacha2,
      ]);

      mockPrisma.shipping_rates.findMany.mockResolvedValue([
        {
          id: 301,
          shipping_zone_id: 101,
          shipping_method_id: 5,
          name: 'Tarifa Comuna 1',
          type: shipping_rate_type_enum.flat,
          base_cost: 5000,
          is_active: true,
          shipping_method: {
            id: 5,
            name: 'Envío a domicilio',
            type: 'own_fleet',
            is_active: true,
            display_order: 1,
          },
        },
        {
          id: 302,
          shipping_zone_id: 102,
          shipping_method_id: 5,
          name: 'Tarifa Comuna 2',
          type: shipping_rate_type_enum.flat,
          base_cost: 7000,
          is_active: true,
          shipping_method: {
            id: 5,
            name: 'Envío a domicilio',
            type: 'own_fleet',
            is_active: true,
            display_order: 1,
          },
        },
      ]);

      // Comprador con código postal 440001
      const optionsWithMatch = await service.calculateRates(
        1,
        [{ product_id: 1, quantity: 1, price: 50000 }],
        {
          country_code: 'CO',
          state_province: 'La Guajira',
          city: 'Riohacha',
          postal_code: '440001',
        },
      );

      // Ambas tarifas de Riohacha deben estar disponibles
      expect(optionsWithMatch).toHaveLength(2);
      // La tarifa de la Comuna 1 (440001) debe tener postal_code_match: true y quedar de primera
      expect(optionsWithMatch[0].id).toBe(301);
      expect(optionsWithMatch[0].postal_code_match).toBe(true);
      expect(optionsWithMatch[1].id).toBe(302);
      expect(optionsWithMatch[1].postal_code_match).toBe(false);

      // Comprador con código postal no registrado (ej. 440005)
      const optionsWithoutMatch = await service.calculateRates(
        1,
        [{ product_id: 1, quantity: 1, price: 50000 }],
        {
          country_code: 'CO',
          state_province: 'La Guajira',
          city: 'Riohacha',
          postal_code: '440005',
        },
      );

      // Sigue mostrando todas las tarifas de Riohacha sin descartar ninguna
      expect(optionsWithoutMatch).toHaveLength(2);
      expect(optionsWithoutMatch[0].postal_code_match).toBe(false);
      expect(optionsWithoutMatch[1].postal_code_match).toBe(false);
    });
  });

  describe('free_shipping_threshold (ADR-04, F-008: threshold 0 = gratis explícito)', () => {
    const riohachaZone = {
      id: 10,
      store_id: 1,
      name: 'Riohacha Local',
      countries: ['CO'],
      regions: ['La Guajira'],
      cities: ['Riohacha'],
      zip_codes: [],
      is_active: true,
    };

    const address = {
      country_code: 'CO',
      state_province: 'La Guajira',
      city: 'Riohacha',
    };

    const rateWithThreshold = (threshold: any) => ({
      id: 101,
      shipping_zone_id: 10,
      shipping_method_id: 5,
      name: 'Envío a domicilio',
      type: shipping_rate_type_enum.flat,
      base_cost: 8000,
      free_shipping_threshold: threshold,
      is_active: true,
      shipping_method: {
        id: 5,
        name: 'Envío a domicilio',
        type: 'own_fleet',
        is_active: true,
        display_order: 1,
      },
    });

    const quote = (threshold: any, cartPrice = 50000) => {
      mockPrisma.shipping_zones.findMany.mockResolvedValue([riohachaZone]);
      mockPrisma.shipping_rates.findMany.mockResolvedValue([
        rateWithThreshold(threshold),
      ]);
      return service.calculateRates(
        1,
        [{ product_id: 1, quantity: 1, price: cartPrice }],
        address,
      );
    };

    it('threshold 0 = envío gratis deliberado aunque el carrito sea mínimo', async () => {
      const options = await quote(0, 1000);
      expect(options).toHaveLength(1);
      expect(options[0].cost).toBe(0);
    });

    it('threshold 0 como objeto Decimal (truthy en runtime Prisma) = gratis', async () => {
      // Regresión del accidente original: `Decimal(0)` es un objeto truthy;
      // la comparación explícita `>= 0` lo trata como gratis intencional.
      const decimalZero = { valueOf: () => 0, toString: () => '0' };
      const options = await quote(decimalZero, 1000);
      expect(options).toHaveLength(1);
      expect(options[0].cost).toBe(0);
    });

    it('threshold null = sin umbral, se cobra el costo base', async () => {
      const options = await quote(null);
      expect(options).toHaveLength(1);
      expect(options[0].cost).toBe(8000);
    });

    it('threshold negativo legacy = sin gratis, se cobra el costo base', async () => {
      const options = await quote(-5);
      expect(options).toHaveLength(1);
      expect(options[0].cost).toBe(8000);
    });

    it('threshold positivo se respeta: gratis solo desde el umbral', async () => {
      const below = await quote(100000, 50000);
      expect(below).toHaveLength(1);
      expect(below[0].cost).toBe(8000);

      const above = await quote(100000, 150000);
      expect(above).toHaveLength(1);
      expect(above[0].cost).toBe(0);
    });
  });

  describe('cotización emite el bruto (lote C, paso 13)', () => {
    const riohachaZone = {
      id: 10,
      store_id: 1,
      name: 'Riohacha Local',
      countries: ['CO'],
      regions: ['La Guajira'],
      cities: ['Riohacha'],
      zip_codes: [],
      is_active: true,
    };

    const address = {
      country_code: 'CO',
      state_province: 'La Guajira',
      city: 'Riohacha',
    };

    const iva19 = {
      id: 92,
      name: 'IVA 19%',
      tax_type: 'iva',
      tax_rates: [{ id: 7, name: 'IVA 19%', rate: 0.19 }],
    };
    const inc8 = {
      id: 93,
      name: 'INC 8%',
      tax_type: 'inc',
      tax_rates: [{ id: 8, name: 'INC 8%', rate: 0.08 }],
    };

    const ctxFor = (
      rate_id: number,
      tax_is_inclusive: boolean,
      category: any,
    ) =>
      new Map([
        [
          rate_id,
          {
            rate_id,
            tax_is_inclusive,
            category,
            vat_responsible: true,
            inc_responsible: true,
          },
        ],
      ]);

    const flatRate = (overrides: any = {}) => ({
      id: 101,
      shipping_zone_id: 10,
      shipping_method_id: 5,
      name: 'Envío a domicilio',
      type: shipping_rate_type_enum.flat,
      base_cost: 10000,
      free_shipping_threshold: null,
      is_active: true,
      shipping_method: {
        id: 5,
        name: 'Envío a domicilio',
        type: 'own_fleet',
        is_active: true,
        display_order: 1,
      },
      ...overrides,
    });

    const quote = (rate: any, cartPrice = 50000) => {
      mockPrisma.shipping_zones.findMany.mockResolvedValue([riohachaZone]);
      mockPrisma.shipping_rates.findMany.mockResolvedValue([rate]);
      return service.calculateRates(
        1,
        [{ product_id: 1, quantity: 1, price: cartPrice }],
        address,
      );
    };

    it('tarifa AGREGADA 10.000 IVA 19 % ⇒ cost 11900 + desglose de comerciante', async () => {
      mockShippingTax.loadRateTaxContext.mockResolvedValue(
        ctxFor(101, false, iva19),
      );

      const options = await quote(flatRate());

      expect(options).toHaveLength(1);
      expect(options[0].cost).toBe(11900);
      expect(options[0].base).toBe(10000);
      expect(options[0].shipping_tax_amount).toBe(1900);
      expect(options[0].tax_is_inclusive).toBe(false);
    });

    it('una sola lectura fiscal por cotización, con store_id explícito', async () => {
      mockShippingTax.loadRateTaxContext.mockResolvedValue(
        ctxFor(101, false, iva19),
      );

      await quote(flatRate());

      expect(mockShippingTax.loadRateTaxContext).toHaveBeenCalledTimes(1);
      expect(mockShippingTax.loadRateTaxContext).toHaveBeenCalledWith([101], {
        store_id: 1,
      });
    });

    it('tarifa INCLUIDA 15.000 INC 8 % ⇒ cost 15000 y el impuesto se despeja', async () => {
      mockShippingTax.loadRateTaxContext.mockResolvedValue(
        ctxFor(101, true, inc8),
      );

      const options = await quote(flatRate({ base_cost: 15000 }));

      expect(options).toHaveLength(1);
      expect(options[0].cost).toBe(15000);
      expect(options[0].base).toBeCloseTo(13888.89, 2);
      expect(options[0].shipping_tax_amount).toBeCloseTo(1111.11, 2);
      expect(options[0].tax_is_inclusive).toBe(true);
    });

    it('umbral alcanzado con tarifa agregada ⇒ envío 0 sin impuesto', async () => {
      mockShippingTax.loadRateTaxContext.mockResolvedValue(
        ctxFor(101, false, iva19),
      );

      const options = await quote(
        flatRate({ free_shipping_threshold: 50000 }),
        50000,
      );

      expect(options).toHaveLength(1);
      expect(options[0].cost).toBe(0);
      expect(options[0].shipping_tax_amount).toBe(0);
      expect(options[0].tax_is_inclusive).toBe(false);
    });

    it('tarifa free con categoría agregada ⇒ 0 sin impuesto', async () => {
      mockShippingTax.loadRateTaxContext.mockResolvedValue(
        ctxFor(101, false, iva19),
      );

      const options = await quote(
        flatRate({ type: shipping_rate_type_enum.free, base_cost: 0 }),
      );

      expect(options).toHaveLength(1);
      expect(options[0].cost).toBe(0);
      expect(options[0].shipping_tax_amount).toBe(0);
    });

    it('tarifa sin contexto fiscal ⇒ costo tal cual, sin campos de comerciante', async () => {
      mockShippingTax.loadRateTaxContext.mockResolvedValue(new Map());

      const options = await quote(flatRate());

      expect(options).toHaveLength(1);
      expect(options[0].cost).toBe(10000);
      expect(options[0].base).toBeUndefined();
      expect(options[0].shipping_tax_amount).toBeUndefined();
      expect(options[0].tax_is_inclusive).toBeUndefined();
    });

    it('tarifa sin categoría (category null) ⇒ bruto = precio, impuesto 0', async () => {
      mockShippingTax.loadRateTaxContext.mockResolvedValue(
        ctxFor(101, true, null),
      );

      const options = await quote(flatRate());

      expect(options).toHaveLength(1);
      expect(options[0].cost).toBe(10000);
      expect(options[0].base).toBe(10000);
      expect(options[0].shipping_tax_amount).toBe(0);
      expect(options[0].tax_is_inclusive).toBe(true);
    });
  });

  describe('quoteRateGross (paso 1 — unificación de la cotización de una tarifa puntual)', () => {
    const riohachaZone = {
      id: 10,
      store_id: 1,
      name: 'Riohacha Local',
      countries: ['CO'],
      regions: ['La Guajira'],
      cities: ['Riohacha'],
      zip_codes: [],
      is_active: true,
    };

    const address = {
      country_code: 'CO',
      state_province: 'La Guajira',
      city: 'Riohacha',
    };

    it('flat con umbral de envío gratis superado ⇒ 0', async () => {
      mockPrisma.shipping_zones.findMany.mockResolvedValue([riohachaZone]);
      mockPrisma.shipping_rates.findMany.mockResolvedValue([
        {
          id: 101,
          shipping_zone_id: 10,
          shipping_method_id: 5,
          name: 'Envío a domicilio',
          type: shipping_rate_type_enum.flat,
          base_cost: 10000,
          free_shipping_threshold: 50000,
          is_active: true,
          shipping_method: {
            id: 5,
            name: 'Envío a domicilio',
            type: 'own_fleet',
            is_active: true,
            display_order: 1,
          },
        },
      ]);

      const cost = await service.quoteRateGross(
        1,
        101,
        [{ product_id: 1, quantity: 1, price: 60000 }],
        address,
      );

      expect(cost).toBe(0);
    });

    // Adaptado: `per_unit_cost` solo aplica a tarifas `weight_based` en el
    // cotizador real (no a `flat`, como sugería literalmente el caso del
    // encargo). Se documenta la desviación en el reporte final.
    it('adaptado — weight_based con per_unit_cost y 3kg ⇒ base + 3×unitario', async () => {
      mockPrisma.shipping_zones.findMany.mockResolvedValue([riohachaZone]);
      mockPrisma.shipping_rates.findMany.mockResolvedValue([
        {
          id: 102,
          shipping_zone_id: 10,
          shipping_method_id: 5,
          name: 'Envío por peso',
          type: shipping_rate_type_enum.weight_based,
          base_cost: 5000,
          per_unit_cost: 1000,
          min_val: null,
          max_val: null,
          free_shipping_threshold: null,
          is_active: true,
          shipping_method: {
            id: 5,
            name: 'Envío por peso',
            type: 'own_fleet',
            is_active: true,
            display_order: 1,
          },
        },
      ]);

      const cost = await service.quoteRateGross(
        1,
        102,
        [{ product_id: 1, quantity: 1, price: 10000, weight: 3 }],
        address,
      );

      expect(cost).toBe(8000);
    });

    describe('con distancia activa', () => {
      let distanceService: ShippingDistanceService;

      beforeEach(async () => {
        distanceService = new ShippingDistanceService();
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            ShippingCalculatorService,
            { provide: StorePrismaService, useValue: mockPrisma },
            { provide: SettingsService, useValue: mockSettings },
            { provide: ShippingTaxService, useValue: mockShippingTax },
            { provide: ShippingDistanceService, useValue: distanceService },
          ],
        }).compile();
        service = module.get<ShippingCalculatorService>(
          ShippingCalculatorService,
        );
      });

      const distanceRate = (overrides: any = {}) => ({
        id: 103,
        shipping_zone_id: 10,
        shipping_method_id: 5,
        name: 'Envío por distancia',
        type: shipping_rate_type_enum.flat,
        base_cost: 8000,
        free_shipping_threshold: null,
        is_active: true,
        distance_tiers: [
          { from_km: 0, to_km: 5, price: 3000 },
          { from_km: 5, to_km: null, price: 6000 },
        ],
        shipping_method: {
          id: 5,
          name: 'Envío por distancia',
          type: 'own_fleet',
          is_active: true,
          display_order: 1,
          distance_pricing_enabled: true,
          origin_latitude: 4.65,
          origin_longitude: -74.1,
        },
        ...overrides,
      });

      it('tarifa por distancia con dirección con coordenadas ⇒ cobra el precio del tramo', async () => {
        jest.spyOn(distanceService, 'resolveDistanceKm').mockResolvedValue(7);
        mockPrisma.shipping_zones.findMany.mockResolvedValue([riohachaZone]);
        mockPrisma.shipping_rates.findMany.mockResolvedValue([
          distanceRate(),
        ]);

        const cost = await service.quoteRateGross(
          1,
          103,
          [{ product_id: 1, quantity: 1, price: 10000 }],
          { ...address, latitude: 4.711, longitude: -74.0721 },
        );

        expect(cost).toBe(6000);
      });

      // Cambio de negocio 2026-09-27: sin coords del comprador Y sin poder
      // geocodificar su dirección, la tarifa YA NO degrada a precio de zona
      // — se EXCLUYE de las opciones (igual que "fuera de todos los
      // tramos"), así que `quoteRateGross` devuelve `null` (la tarifa no
      // aparece entre las opciones calculadas). Reemplaza el test
      // "adaptado" anterior, que documentaba el fail-open ahora revertido.
      it('sin lat/lng del comprador y sin poder geocodificar ⇒ se EXCLUYE (null), YA NO degrada a zona', async () => {
        mockPrisma.shipping_zones.findMany.mockResolvedValue([riohachaZone]);
        mockPrisma.shipping_rates.findMany.mockResolvedValue([
          distanceRate(),
        ]);
        // La tarifa (única opción) queda excluida ⇒ `calculateRates` cae al
        // fallback de retiro en tienda, que consulta direcciones pickup.
        mockPrisma.addresses.findMany.mockResolvedValue([]);

        const cost = await service.quoteRateGross(
          1,
          103,
          [{ product_id: 1, quantity: 1, price: 10000 }],
          address, // sin latitude/longitude ni address_line1 ⇒ resolveBuyerCoords no puede
        );

        expect(cost).toBeNull();
      });

      it('con GeocodingService disponible pero el forward geocode falla ⇒ también se excluye (null)', async () => {
        const geocoding = {
          forward: jest.fn().mockRejectedValue(new Error('provider down')),
        } as any;
        const distanceWithGeocoding = new ShippingDistanceService(
          undefined,
          geocoding,
        );
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            ShippingCalculatorService,
            { provide: StorePrismaService, useValue: mockPrisma },
            { provide: SettingsService, useValue: mockSettings },
            { provide: ShippingTaxService, useValue: mockShippingTax },
            {
              provide: ShippingDistanceService,
              useValue: distanceWithGeocoding,
            },
          ],
        }).compile();
        const serviceWithGeocoding = module.get<ShippingCalculatorService>(
          ShippingCalculatorService,
        );

        mockPrisma.shipping_zones.findMany.mockResolvedValue([riohachaZone]);
        mockPrisma.shipping_rates.findMany.mockResolvedValue([
          distanceRate(),
        ]);
        mockPrisma.addresses.findMany.mockResolvedValue([]);

        const cost = await serviceWithGeocoding.quoteRateGross(
          1,
          103,
          [{ product_id: 1, quantity: 1, price: 10000 }],
          { ...address, address_line1: 'Cra 7 # 1-2' },
        );

        expect(cost).toBeNull();
        expect(geocoding.forward).toHaveBeenCalled();
      });

      it('motor de ruteo caído (buyer SÍ resuelto) ⇒ sigue degradando a precio de zona (infraestructura, sin cambio)', async () => {
        jest
          .spyOn(distanceService, 'resolveDistanceKm')
          .mockRejectedValue(new Error('routing down'));
        mockPrisma.shipping_zones.findMany.mockResolvedValue([riohachaZone]);
        mockPrisma.shipping_rates.findMany.mockResolvedValue([
          distanceRate(),
        ]);

        const cost = await service.quoteRateGross(
          1,
          103,
          [{ product_id: 1, quantity: 1, price: 10000 }],
          { ...address, latitude: 4.711, longitude: -74.0721 },
        );

        expect(cost).toBe(8000); // base_cost de la tarifa (zona)
      });

      it('sin ORIGEN del método (infraestructura) ⇒ sigue degradando a precio de zona, sin cambio', async () => {
        mockPrisma.shipping_zones.findMany.mockResolvedValue([riohachaZone]);
        mockPrisma.shipping_rates.findMany.mockResolvedValue([
          distanceRate({
            shipping_method: {
              id: 5,
              name: 'Envío por distancia',
              type: 'own_fleet',
              is_active: true,
              display_order: 1,
              distance_pricing_enabled: true,
              origin_latitude: null,
              origin_longitude: null,
            },
          }),
        ]);

        const cost = await service.quoteRateGross(
          1,
          103,
          [{ product_id: 1, quantity: 1, price: 10000 }],
          { ...address, latitude: 4.711, longitude: -74.0721 },
        );

        expect(cost).toBe(8000); // base_cost de la tarifa (zona)
      });
    });
  });
});
