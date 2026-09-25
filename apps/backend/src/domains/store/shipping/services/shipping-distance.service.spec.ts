import { ShippingDistanceService } from './shipping-distance.service';

describe('ShippingDistanceService', () => {
  const tiers = [
    { from_km: 0, to_km: 5, price: 8000 },
    { from_km: 5, to_km: 10, price: 12000 },
    { from_km: 10, to_km: null, price: 18000 },
  ];

  describe('matchTier (puro)', () => {
    it('matchea el primer tramo cuando d == from_km', () => {
      expect(ShippingDistanceService.matchTier(tiers, 0)?.price).toBe(8000);
      expect(ShippingDistanceService.matchTier(tiers, 3.2)?.price).toBe(8000);
    });

    it('el límite to_km pertenece al tramo siguiente (d < to_km)', () => {
      expect(ShippingDistanceService.matchTier(tiers, 5)?.price).toBe(12000);
      expect(ShippingDistanceService.matchTier(tiers, 10)?.price).toBe(18000);
    });

    it('el tramo abierto (to_km null) cubre cualquier distancia mayor', () => {
      expect(ShippingDistanceService.matchTier(tiers, 250)?.price).toBe(18000);
    });

    it('fuera de todos los rangos devuelve null', () => {
      const closed = tiers.slice(0, 2);
      expect(ShippingDistanceService.matchTier(closed, 10)).toBeNull();
      expect(ShippingDistanceService.matchTier(closed, 99)).toBeNull();
    });

    it('distancia negativa no matchea', () => {
      expect(ShippingDistanceService.matchTier(tiers, -1)).toBeNull();
    });
  });

  describe('parseTiers', () => {
    it('null/undefined/vacío/no-array → null (rige zona)', () => {
      expect(ShippingDistanceService.parseTiers(null)).toBeNull();
      expect(ShippingDistanceService.parseTiers(undefined)).toBeNull();
      expect(ShippingDistanceService.parseTiers([])).toBeNull();
      expect(ShippingDistanceService.parseTiers({})).toBeNull();
    });

    it('ordena por from_km', () => {
      const parsed = ShippingDistanceService.parseTiers([
        { from_km: 10, to_km: null, price: 18000 },
        { from_km: 0, to_km: 10, price: 8000 },
      ]);
      expect(parsed?.map((t) => t.from_km)).toEqual([0, 10]);
    });

    it('escala corrupta → null (fail-open a zona)', () => {
      expect(
        ShippingDistanceService.parseTiers([{ from_km: -1, price: 5 }]),
      ).toBeNull();
      expect(
        ShippingDistanceService.parseTiers([{ from_km: 0, price: -5 }]),
      ).toBeNull();
      expect(
        ShippingDistanceService.parseTiers([
          { from_km: 5, to_km: 5, price: 5 },
        ]),
      ).toBeNull();
      expect(
        ShippingDistanceService.parseTiers([{ from_km: 'x', price: 5 }]),
      ).toBeNull();
      expect(ShippingDistanceService.parseTiers([null])).toBeNull();
    });

    it('acepta números en string (JSON externo)', () => {
      const parsed = ShippingDistanceService.parseTiers([
        { from_km: '0', to_km: '5', price: '8000' },
      ]);
      expect(parsed).toEqual([{ from_km: 0, to_km: 5, price: 8000 }]);
    });
  });

  describe('toCoords', () => {
    it('acepta Decimal/string/number dentro de rangos WGS84', () => {
      expect(ShippingDistanceService.toCoords('4.71', '-74.07')).toEqual({
        latitude: 4.71,
        longitude: -74.07,
      });
    });

    it('null/vacío/fuera de rango → null', () => {
      expect(ShippingDistanceService.toCoords(null, -74)).toBeNull();
      expect(ShippingDistanceService.toCoords(4, null)).toBeNull();
      expect(ShippingDistanceService.toCoords('', '')).toBeNull();
      expect(ShippingDistanceService.toCoords(91, 0)).toBeNull();
      expect(ShippingDistanceService.toCoords(0, 181)).toBeNull();
      expect(ShippingDistanceService.toCoords('x', 0)).toBeNull();
    });
  });

  describe('resolveDistanceKm', () => {
    const origin = { latitude: 4.71, longitude: -74.07 };
    const buyer = { latitude: 4.72, longitude: -74.06 };

    it('convierte distance_m del motor a km', async () => {
      const routing = {
        directions: jest.fn().mockResolvedValue({ distance_m: 8500 }),
      } as any;
      const service = new ShippingDistanceService(routing);
      await expect(service.resolveDistanceKm(origin, buyer)).resolves.toBe(
        8.5,
      );
      expect(routing.directions).toHaveBeenCalledWith(
        '-74.07,4.71;-74.06,4.72',
      );
    });

    it('motor caído → null (se cobra zona)', async () => {
      const routing = {
        directions: jest.fn().mockRejectedValue(new Error('down')),
      } as any;
      const service = new ShippingDistanceService(routing);
      await expect(service.resolveDistanceKm(origin, buyer)).resolves.toBeNull();
    });

    it('respuesta inválida → null', async () => {
      const routing = {
        directions: jest.fn().mockResolvedValue({ distance_m: NaN }),
      } as any;
      const service = new ShippingDistanceService(routing);
      await expect(service.resolveDistanceKm(origin, buyer)).resolves.toBeNull();
    });

    it('sin RoutingService (specs legacy) → null', async () => {
      const service = new ShippingDistanceService(undefined);
      await expect(service.resolveDistanceKm(origin, buyer)).resolves.toBeNull();
    });
  });

  describe('resolveRatePrice', () => {
    const service = new ShippingDistanceService(undefined);

    it('distancia + escala → precio del tramo', () => {
      expect(service.resolveRatePrice(tiers, 3)).toEqual({ price: 8000 });
    });

    it('fuera de rangos → excluded', () => {
      expect(service.resolveRatePrice(tiers.slice(0, 2), 50)).toEqual({
        excluded: true,
      });
    });

    it('sin distancia o sin escala → null (rige zona)', () => {
      expect(service.resolveRatePrice(tiers, null)).toBeNull();
      expect(service.resolveRatePrice(null, 3)).toBeNull();
      expect(service.resolveRatePrice([], 3)).toBeNull();
    });
  });
});
