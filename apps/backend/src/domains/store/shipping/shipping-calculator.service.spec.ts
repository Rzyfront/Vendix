import { Test, TestingModule } from '@nestjs/testing';
import { ShippingCalculatorService } from './shipping-calculator.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { SettingsService } from '../settings/settings.service';
import { shipping_rate_type_enum } from '@prisma/client';

describe('ShippingCalculatorService', () => {
  let service: ShippingCalculatorService;
  let mockPrisma: any;
  let mockSettings: any;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShippingCalculatorService,
        { provide: StorePrismaService, useValue: mockPrisma },
        { provide: SettingsService, useValue: mockSettings },
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
});
