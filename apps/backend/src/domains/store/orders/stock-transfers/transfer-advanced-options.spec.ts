import { BadRequestException } from '@nestjs/common';

import {
  listTransferAdvancedOptions,
  listTransferBatches,
  listTransferLocationStock,
  shippingMethodScope,
} from './transfer-advanced-options';
import {
  parseIdList,
  parseOptionalId,
  parseRequiredId,
} from './transfer-query-params';
import { resolveStoreSurfaceNoteStoreId } from './transfer-transport';

function buildClient() {
  return {
    vehicles: { findMany: jest.fn().mockResolvedValue([]) },
    users: { findMany: jest.fn().mockResolvedValue([]) },
    shipping_methods: { findMany: jest.fn().mockResolvedValue([]) },
    categories: { findMany: jest.fn().mockResolvedValue([]) },
    inventory_batches: { findMany: jest.fn().mockResolvedValue([]) },
    stock_levels: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('transfer-advanced-options (P3)', () => {
  describe('listTransferAdvancedOptions', () => {
    it('filtra vehículos, métodos y categorías por la tienda de origen', async () => {
      const client = buildClient();
      client.vehicles.findMany.mockResolvedValue([
        {
          id: 1,
          plate: 'ABC123',
          type: 'truck',
          brand: null,
          model_name: null,
          primary_driver_id: 9,
        },
      ]);
      client.users.findMany.mockResolvedValue([
        { id: 9, first_name: 'Ana', last_name: 'Ruiz' },
        { id: 10, first_name: null, last_name: null },
      ]);
      client.shipping_methods.findMany.mockResolvedValue([
        { id: 3, name: 'Flota propia', type: 'own_fleet', provider_name: null },
        {
          id: 4,
          name: 'Servientrega',
          type: 'carrier',
          provider_name: 'servientrega',
        },
      ]);

      const result = await listTransferAdvancedOptions(client, {
        organization_id: 1,
        from_store_id: 3,
      });

      expect(client.vehicles.findMany.mock.calls[0][0].where).toEqual({
        is_active: true,
        store_id: 3,
      });
      expect(client.users.findMany.mock.calls[0][0].where).toEqual({
        organization_id: 1,
        state: 'active',
      });
      expect(
        client.shipping_methods.findMany.mock.calls[0][0].where.OR,
      ).toEqual([{ store_id: null }, { store_id: 3 }]);
      expect(client.categories.findMany.mock.calls[0][0].where).toEqual({
        state: 'active',
        store_id: 3,
      });
      expect(result.drivers).toEqual([
        { id: 9, name: 'Ana Ruiz' },
        { id: 10, name: 'Usuario #10' },
      ]);
      expect(result.shipping_methods.map((m) => m.scope)).toEqual([
        'internal',
        'external',
      ]);
      expect(result.vehicles[0]).toEqual(
        expect.objectContaining({
          id: 1,
          plate: 'ABC123',
          primary_driver_id: 9,
        }),
      );
    });

    it('con bodega central usa las tiendas de la organización', async () => {
      const client = buildClient();
      await listTransferAdvancedOptions(client, {
        organization_id: 1,
        from_store_id: null,
      });
      expect(client.vehicles.findMany.mock.calls[0][0].where).toEqual({
        is_active: true,
        store: { organization_id: 1 },
      });
      expect(client.categories.findMany.mock.calls[0][0].where).toEqual({
        state: 'active',
        stores: { organization_id: 1 },
      });
    });
  });

  it('shippingMethodScope separa transportadoras de envíos propios', () => {
    expect(shippingMethodScope('carrier')).toBe('external');
    expect(shippingMethodScope('third_party_provider')).toBe('external');
    expect(shippingMethodScope('own_fleet')).toBe('internal');
    expect(shippingMethodScope('pickup')).toBe('internal');
    expect(shippingMethodScope(null)).toBe('internal');
  });

  describe('listTransferBatches', () => {
    it('ordena en FEFO como el despacho y calcula el saldo', async () => {
      const client = buildClient();
      client.inventory_batches.findMany.mockResolvedValue([
        {
          id: 5,
          product_id: 1,
          product_variant_id: null,
          batch_number: 'L1',
          expiration_date: null,
          quantity: 10,
          quantity_used: 4,
        },
        {
          id: 6,
          product_id: 1,
          product_variant_id: null,
          batch_number: 'L2',
          expiration_date: null,
          quantity: 2,
          quantity_used: 5,
        },
      ]);

      const result = await listTransferBatches(client, {
        location_id: 7,
        product_ids: [1, 1, 0, -2],
      });

      const args = client.inventory_batches.findMany.mock.calls[0][0];
      expect(args.where).toEqual({
        product_id: { in: [1] },
        OR: [{ location_id: 7 }, { location_id: null }],
      });
      expect(args.orderBy).toEqual([
        { expiration_date: 'asc' },
        { created_at: 'asc' },
      ]);
      expect(result.map((b) => b.available)).toEqual([6, 0]);
    });

    it('sin productos no consulta', async () => {
      const client = buildClient();
      expect(
        await listTransferBatches(client, { location_id: 7, product_ids: [] }),
      ).toEqual([]);
      expect(client.inventory_batches.findMany).not.toHaveBeenCalled();
    });
  });

  describe('listTransferLocationStock', () => {
    it('devuelve filas del picker con disponible y filtra por categoría', async () => {
      const client = buildClient();
      client.stock_levels.findMany
        .mockResolvedValueOnce([
          {
            product_id: 1,
            product_variant_id: null,
            location_id: 7,
            quantity_on_hand: 5,
            quantity_reserved: 0,
            quantity_available: 5,
            products: { id: 1, name: 'Café', sku: 'CAF' },
            product_variants: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            product_id: 1,
            product_variant_id: null,
            location_id: 9,
            quantity_on_hand: 2,
            quantity_reserved: 0,
            quantity_available: 2,
          },
        ]);

      const rows = await listTransferLocationStock(client, {
        from_location_id: 7,
        to_location_id: 9,
        category_id: 4,
      });

      const where = client.stock_levels.findMany.mock.calls[0][0].where;
      expect(where.quantity_available).toEqual({ gt: 0 });
      expect(where.products.product_categories).toEqual({
        some: { category_id: 4 },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(
        expect.objectContaining({
          product_id: 1,
          sku: 'CAF',
          stock_at_origin: expect.objectContaining({ quantity_available: 5 }),
          stock_at_destination: expect.objectContaining({
            quantity_available: 2,
          }),
        }),
      );
    });

    it('sin destino (salida externa) no consulta el destino', async () => {
      const client = buildClient();
      client.stock_levels.findMany.mockResolvedValueOnce([
        {
          product_id: 1,
          product_variant_id: null,
          location_id: 7,
          quantity_on_hand: 1,
          quantity_reserved: 0,
          quantity_available: 1,
          products: { id: 1, name: 'Café', sku: null },
          product_variants: null,
        },
      ]);
      const rows = await listTransferLocationStock(client, {
        from_location_id: 7,
      });
      expect(client.stock_levels.findMany).toHaveBeenCalledTimes(1);
      expect(rows[0].stock_at_destination.quantity_available).toBe(0);
    });
  });

  describe('lectura de ids de la URL', () => {
    it('parsea ids opcionales, obligatorios y listas', () => {
      expect(parseOptionalId(undefined)).toBeNull();
      expect(parseOptionalId('')).toBeNull();
      expect(parseOptionalId('12')).toBe(12);
      expect(() => parseOptionalId('abc')).toThrow(BadRequestException);
      expect(() => parseRequiredId(undefined, 'from_location_id')).toThrow(
        /from_location_id/,
      );
      expect(parseIdList('1, 2,x,,3')).toEqual([1, 2, 3]);
      expect(parseIdList(undefined)).toEqual([]);
    });
  });

  describe('R3-1 — tienda de la remisión en la superficie de tienda', () => {
    it('acepta la tienda de origen o la de destino', () => {
      expect(
        resolveStoreSurfaceNoteStoreId(3, { from_store_id: 3, to_store_id: 4 }),
      ).toBe(3);
      expect(
        resolveStoreSurfaceNoteStoreId(4, { from_store_id: 3, to_store_id: 4 }),
      ).toBe(4);
    });

    it('rechaza una tienda ajena a la transferencia con un mensaje claro', () => {
      expect(() =>
        resolveStoreSurfaceNoteStoreId(5, { from_store_id: 3, to_store_id: 4 }),
      ).toThrow(/tienda de origen o la de destino/);
    });

    it('en una salida externa solo vale la tienda de origen', () => {
      expect(() =>
        resolveStoreSurfaceNoteStoreId(4, {
          from_store_id: 3,
          to_store_id: null,
        }),
      ).toThrow(BadRequestException);
    });

    it('sin tienda en el contexto pide elegirla', () => {
      expect(() =>
        resolveStoreSurfaceNoteStoreId(undefined, {
          from_store_id: 3,
          to_store_id: 4,
        }),
      ).toThrow(/Elige la tienda/);
    });
  });
});
