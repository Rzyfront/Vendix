import { BadRequestException } from '@nestjs/common';

import {
  listTransferAdvancedOptions,
  listTransferBatches,
  listTransferLocationStock,
  listTransferLocationStockPage,
  lookupTransferCode,
  shippingMethodScope,
} from './transfer-advanced-options';
import {
  parseIdList,
  parseOptionalId,
  parseRequiredId,
} from './transfer-query-params';
import {
  resolveLineBatch,
  resolveStoreSurfaceNoteStoreId,
  resolveTransferDriver,
  transferStaffUserWhere,
} from './transfer-transport';

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
      // M1: solo personal (rol distinto de `customer`) que aplique a la
      // organización completa o a la tienda de origen.
      expect(client.users.findMany.mock.calls[0][0].where).toEqual({
        organization_id: 1,
        state: 'active',
        user_roles: {
          some: {
            OR: [{ store_id: null }, { store_id: 3 }],
            roles: { name: { not: 'customer' } },
          },
        },
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
      // Bodega central: cualquier rol de personal de la organización.
      expect(client.users.findMany.mock.calls[0][0].where).toEqual({
        organization_id: 1,
        state: 'active',
        user_roles: { some: { roles: { name: { not: 'customer' } } } },
      });
    });
  });

  describe('M1 — transportador: solo personal, sin clientes del ecommerce', () => {
    const users = [
      // Personal de la tienda 3.
      {
        id: 1,
        organization_id: 1,
        state: 'active',
        roles: [{ name: 'Cajero', store_id: 3 }],
      },
      // Administrador de toda la organización (rol sin tienda).
      {
        id: 2,
        organization_id: 1,
        state: 'active',
        roles: [{ name: 'admin', store_id: null }],
      },
      // Cliente del ecommerce: solo rol customer.
      {
        id: 3,
        organization_id: 1,
        state: 'active',
        roles: [{ name: 'customer', store_id: null }],
      },
      // Personal de otra tienda que aquí solo es cliente.
      {
        id: 4,
        organization_id: 1,
        state: 'active',
        roles: [
          { name: 'Cajero', store_id: 30 },
          { name: 'customer', store_id: null },
        ],
      },
      // Sin roles.
      { id: 5, organization_id: 1, state: 'active', roles: [] },
      // Personal de otra organización.
      {
        id: 6,
        organization_id: 2,
        state: 'active',
        roles: [{ name: 'admin', store_id: null }],
      },
    ];

    /** Evalúa el `where` de Prisma que arma `transferStaffUserWhere`. */
    function matches(user: (typeof users)[number], where: any) {
      if (where.id !== undefined && user.id !== where.id) return false;
      if (user.organization_id !== where.organization_id) return false;
      if (user.state !== where.state) return false;
      const some = where.user_roles.some;
      return user.roles.some(
        (role) =>
          role.name !== some.roles.name.not &&
          (!some.OR ||
            some.OR.some((alt: any) => alt.store_id === role.store_id)),
      );
    }

    function staffClient() {
      return {
        users: {
          findMany: jest.fn(async ({ where }: any) =>
            users
              .filter((u) => matches(u, where))
              .map((u) => ({
                id: u.id,
                first_name: `U${u.id}`,
                last_name: '',
              })),
          ),
          findFirst: jest.fn(
            async ({ where }: any) =>
              users
                .filter((u) => matches(u, where))
                .map((u) => ({
                  id: u.id,
                  first_name: `U${u.id}`,
                  last_name: '',
                }))[0] ?? null,
          ),
        },
      };
    }

    it('con origen en tienda lista al personal de esa tienda y al de la organización', async () => {
      const client: any = { ...buildClient(), ...staffClient() };
      const result = await listTransferAdvancedOptions(client, {
        organization_id: 1,
        from_store_id: 3,
      });
      expect(result.drivers.map((d) => d.id)).toEqual([1, 2]);
    });

    it('con bodega central lista a todo el personal de la organización', async () => {
      const client: any = { ...buildClient(), ...staffClient() };
      const result = await listTransferAdvancedOptions(client, {
        organization_id: 1,
        from_store_id: null,
      });
      expect(result.drivers.map((d) => d.id)).toEqual([1, 2, 4]);
    });

    it('la validación del despacho acepta y rechaza lo mismo que el listado', async () => {
      const client = staffClient();
      await expect(resolveTransferDriver(client, 1, 1, 3)).resolves.toEqual(
        expect.objectContaining({ id: 1 }),
      );
      await expect(resolveTransferDriver(client, 1, 2, 3)).resolves.toEqual(
        expect.objectContaining({ id: 2 }),
      );
      for (const id of [3, 4, 5, 6]) {
        await expect(resolveTransferDriver(client, 1, id, 3)).rejects.toThrow(
          BadRequestException,
        );
      }
      expect(client.users.findFirst.mock.calls[0][0].where).toEqual({
        id: 1,
        ...transferStaffUserWhere(1, 3),
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
        organization_id: 1,
        location_id: 7,
        product_ids: [1, 1, 0, -2],
      });

      const args = client.inventory_batches.findMany.mock.calls[0][0];
      expect(args.where).toEqual({
        product_id: { in: [1] },
        OR: [{ location_id: 7 }, { location_id: null }],
        products: { stores: { organization_id: 1 } },
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
        await listTransferBatches(client, {
          organization_id: 1,
          location_id: 7,
          product_ids: [],
        }),
      ).toEqual([]);
      expect(client.inventory_batches.findMany).not.toHaveBeenCalled();
    });

    it('B1: ids de productos de otra organización no devuelven sus lotes', async () => {
      // Lotes sin bodega (location_id null) de dos organizaciones; el producto
      // 2 es de una tienda de la organización 2.
      const batches = [
        {
          id: 10,
          product_id: 1,
          org: 1,
          location_id: null,
          batch_number: 'PROPIO',
        },
        {
          id: 20,
          product_id: 2,
          org: 2,
          location_id: null,
          batch_number: 'AJENO',
        },
      ];
      const client = buildClient();
      client.inventory_batches.findMany.mockImplementation(
        async ({ where }: any) =>
          batches
            .filter(
              (b) =>
                where.product_id.in.includes(b.product_id) &&
                where.OR.some(
                  (alt: any) => alt.location_id === b.location_id,
                ) &&
                (where.products?.stores?.organization_id === undefined ||
                  where.products.stores.organization_id === b.org),
            )
            .map((b) => ({
              ...b,
              product_variant_id: null,
              expiration_date: null,
              quantity: 5,
              quantity_used: 0,
            })),
      );

      const result = await listTransferBatches(client, {
        organization_id: 1,
        location_id: 7,
        product_ids: [1, 2],
      });
      expect(result.map((b) => b.batch_number)).toEqual(['PROPIO']);
    });

    it('B1: resolveLineBatch en organización filtra el lote elegido y el FEFO', async () => {
      const tx = {
        inventory_batches: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
        },
      };
      await expect(
        resolveLineBatch(tx, { product_id: 2 }, 7, 20, { organizationId: 1 }),
      ).rejects.toThrow(/El lote #20 no existe/);
      expect(tx.inventory_batches.findFirst.mock.calls[0][0].where).toEqual({
        id: 20,
        products: { stores: { organization_id: 1 } },
      });

      await resolveLineBatch(tx, { product_id: 2 }, 7, null, {
        defaultToFefo: true,
        organizationId: 1,
      });
      expect(tx.inventory_batches.findMany.mock.calls[0][0].where).toEqual(
        expect.objectContaining({
          products: { stores: { organization_id: 1 } },
        }),
      );

      // Superficie de tienda (sin organización): el predicado no cambia.
      await resolveLineBatch(tx, { product_id: 2 }, 7, null, {
        defaultToFefo: true,
      });
      expect(
        tx.inventory_batches.findMany.mock.calls[1][0].where.products,
      ).toBeUndefined();
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

    it('m4: avisa has_more cuando la bodega supera el tope', async () => {
      const row = (id: number) => ({
        product_id: id,
        product_variant_id: null,
        location_id: 7,
        quantity_on_hand: 1,
        quantity_reserved: 0,
        quantity_available: 1,
        products: { id, name: `P${id}`, sku: null },
        product_variants: null,
      });
      const client = buildClient();
      client.stock_levels.findMany.mockResolvedValueOnce([
        row(1),
        row(2),
        row(3),
      ]);
      const page = await listTransferLocationStockPage(client, {
        from_location_id: 7,
        limit: 2,
      });
      expect(client.stock_levels.findMany.mock.calls[0][0].take).toBe(3);
      expect(page.has_more).toBe(true);
      expect(page.limit).toBe(2);
      expect(page.rows.map((r) => r.product_id)).toEqual([1, 2]);

      const exact = buildClient();
      exact.stock_levels.findMany.mockResolvedValueOnce([row(1), row(2)]);
      const full = await listTransferLocationStockPage(exact, {
        from_location_id: 7,
        limit: 2,
      });
      expect(full.has_more).toBe(false);
      expect(full.rows).toHaveLength(2);
    });

    it('m2: con product_ids refresca solo esos productos, aunque estén en cero', async () => {
      const client = buildClient();
      await listTransferLocationStockPage(client, {
        from_location_id: 7,
        to_location_id: 9,
        product_ids: [3, 3, 5, 0],
      });
      const where = client.stock_levels.findMany.mock.calls[0][0].where;
      expect(where.product_id).toEqual({ in: [3, 5] });
      expect(where.quantity_available).toBeUndefined();
    });
  });

  describe('M2 — lookupTransferCode (escáner y pegar lista)', () => {
    const level = (
      productId: number,
      variant: {
        id: number;
        name: string;
        sku: string;
        barcode?: string | null;
      } | null,
      productSku = 'CAM',
    ) => ({
      product_id: productId,
      product_variant_id: variant?.id ?? null,
      location_id: 7,
      quantity_on_hand: 4,
      quantity_reserved: 0,
      quantity_available: 4,
      products: {
        id: productId,
        name: 'Camisa',
        sku: productSku,
        barcode: null,
      },
      product_variants: variant,
    });

    it('busca exacto por SKU y código de barras del producto y de la variante, acotado a la organización', async () => {
      const client = buildClient();
      client.stock_levels.findMany.mockResolvedValueOnce([
        level(1, {
          id: 11,
          name: 'Talla M',
          sku: 'CAM-M',
          barcode: '7701234567890',
        }),
      ]);
      const rows = await lookupTransferCode(client, {
        organization_id: 1,
        code: ' 7701234567890 ',
        from_location_id: 7,
      });

      const args = client.stock_levels.findMany.mock.calls[0][0];
      const equals = { equals: '7701234567890', mode: 'insensitive' };
      expect(args.where).toEqual({
        location_id: 7,
        products: {
          state: { not: 'archived' },
          stores: { organization_id: 1 },
        },
        OR: [
          { products: { sku: equals } },
          { products: { barcode: equals } },
          { product_variants: { sku: equals } },
          { product_variants: { barcode: equals } },
        ],
      });
      // Sin destino no consulta el destino.
      expect(client.stock_levels.findMany).toHaveBeenCalledTimes(1);
      expect(rows).toEqual([
        expect.objectContaining({
          product_id: 1,
          product_variant_id: 11,
          variant_name: 'Talla M',
          sku: 'CAM-M',
        }),
      ]);
    });

    it('con destino trae el disponible del destino', async () => {
      const client = buildClient();
      client.stock_levels.findMany
        .mockResolvedValueOnce([level(1, null)])
        .mockResolvedValueOnce([
          {
            product_id: 1,
            product_variant_id: null,
            location_id: 9,
            quantity_on_hand: 3,
            quantity_reserved: 0,
            quantity_available: 3,
          },
        ]);
      const rows = await lookupTransferCode(client, {
        organization_id: 1,
        code: 'CAM',
        from_location_id: 7,
        to_location_id: 9,
      });
      expect(rows[0].stock_at_destination.quantity_available).toBe(3);
    });

    it('m10 — escapa `_` y descarta las filas que ILIKE trae por comodín', async () => {
      const client = buildClient();
      // Lo que devolvería un ILIKE con `_` sin escapar: el SKU exacto y otro
      // parecido.
      client.stock_levels.findMany.mockResolvedValueOnce([
        level(1, null, 'CAM-ROJA-M'),
        level(2, null, 'cam_roja_m'),
      ]);
      const rows = await lookupTransferCode(client, {
        organization_id: 1,
        code: 'CAM_ROJA_M',
        from_location_id: 7,
      });

      const where = client.stock_levels.findMany.mock.calls[0][0].where;
      expect(where.OR[0]).toEqual({
        products: {
          sku: { equals: 'CAM\\_ROJA\\_M', mode: 'insensitive' },
        },
      });
      expect(rows.map((r: any) => r.product_id)).toEqual([2]);
    });

    it('m10 — con solo una fila parecida no agrega otro producto', async () => {
      const client = buildClient();
      client.stock_levels.findMany.mockResolvedValueOnce([
        level(1, null, 'CAM-ROJA-M'),
      ]);
      expect(
        await lookupTransferCode(client, {
          organization_id: 1,
          code: 'CAM_ROJA_M',
          from_location_id: 7,
        }),
      ).toEqual([]);
    });

    it('m10 — escapa `%` y `\\`; un `%` suelto no devuelve nada', async () => {
      const client = buildClient();
      client.stock_levels.findMany.mockResolvedValueOnce([
        level(1, null, 'CAM'),
        level(2, { id: 21, name: 'Talla S', sku: 'POL-S' }, 'POL'),
      ]);
      const rows = await lookupTransferCode(client, {
        organization_id: 1,
        code: '%',
        from_location_id: 7,
      });
      const where = client.stock_levels.findMany.mock.calls[0][0].where;
      expect(where.OR[1]).toEqual({
        products: { barcode: { equals: '\\%', mode: 'insensitive' } },
      });
      expect(rows).toEqual([]);

      const client2 = buildClient();
      await lookupTransferCode(client2, {
        organization_id: 1,
        code: 'A\\B%C',
        from_location_id: 7,
      });
      expect(
        client2.stock_levels.findMany.mock.calls[0][0].where.OR[2],
      ).toEqual({
        product_variants: {
          sku: { equals: 'A\\\\B\\%C', mode: 'insensitive' },
        },
      });
    });

    it('m10 — conserva el match exacto sin distinguir mayúsculas en código de barras de variante', async () => {
      const client = buildClient();
      client.stock_levels.findMany.mockResolvedValueOnce([
        level(1, { id: 11, name: 'Talla M', sku: 'X', barcode: 'abc_1' }),
      ]);
      const rows = await lookupTransferCode(client, {
        organization_id: 1,
        code: 'ABC_1',
        from_location_id: 7,
      });
      expect(rows.map((r: any) => r.product_variant_id)).toEqual([11]);
    });

    it('un código vacío no consulta', async () => {
      const client = buildClient();
      expect(
        await lookupTransferCode(client, {
          organization_id: 1,
          code: '   ',
          from_location_id: 7,
        }),
      ).toEqual([]);
      expect(client.stock_levels.findMany).not.toHaveBeenCalled();
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
