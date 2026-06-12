/**
 * Stage 03 — Inventory
 *
 * Seeds stock_levels, inventory_transactions (initial stock), inventory_movements
 * (warehouse → showroom), inventory_adjustments (damage, theft, count variance),
 * inventory_batches, inventory_serial_numbers, stock_reservations,
 * inventory_cost_layers (FIFO), and inventory_valuation_snapshots.
 *
 * All stock is dated historically (2025-11-15 onwards) so the data ages
 * realistically by stage 12.
 */

import { Prisma } from '@prisma/client';
import type { Stage, StageContext } from './context';
import { randomDateInWindow, monthlyPeriods, TODAY } from '../lib/dates';

const INITIAL_STOCK_DATE = new Date('2025-11-15T10:00:00Z');

export const stage03Inventory: Stage = {
  id: '03',
  name: 'Inventory',
  description: 'Locations (already), stock_levels, transactions, movements, adjustments, batches, serials, reservations, cost_layers, snapshots',
  run: async (ctx: StageContext) => {
    const { prisma, data, rng, log: out } = ctx;

    // Recover org and store from DB if running standalone
    let org = data.organization;
    let store = data.store;
    if (!org) {
      org = await prisma.organizations.findUnique({ where: { slug: 'roku' } });
      if (org) data.organization = org;
    }
    if (!store && org) {
      store = await prisma.stores.findFirst({ where: { organization_id: org.id, slug: 'roku' } });
      if (store) data.store = store;
    }
    if (!org || !store) throw new Error('Roku org/store not found. Run stage 01 first.');

    const orgId = org.id;
    const storeId = store.id;
    const products = data.products;
    const variants = data.variants;
    const user = data.adminUser;

    // Fallback: recover warehouse and showroom from DB if not in ctx
    let warehouse = data.defaultLocation;
    let showroom = data.showroomLocation;
    if (!warehouse) {
      warehouse = await prisma.inventory_locations.findFirst({
        where: { organization_id: orgId, store_id: storeId, code: 'ROKU-BOD-01' },
      });
      if (warehouse) data.defaultLocation = warehouse;
    }
    if (!showroom) {
      showroom = await prisma.inventory_locations.findFirst({
        where: { organization_id: orgId, store_id: storeId, code: 'ROKU-SHO-01' },
      });
      if (showroom) data.showroomLocation = showroom;
    }
    if (!warehouse) throw new Error('Stage 01 must run first (no warehouse location).');
    if (!products?.length) throw new Error('Stage 02 must run first (no products).');

    const counts: Record<string, number> = {};

    out('  · Creating initial stock levels (warehouse + showroom split)');
    let stockLevels = 0;
    let transactions = 0;
    let movements = 0;
    let adjustments = 0;
    let batches = 0;
    let serials = 0;
    let reservations = 0;
    let costLayers = 0;
    let snapshots = 0;

    // === 1. Initial stock per variant in warehouse ===
    //    Then distribute ~30% to showroom.
    for (const v of variants) {
      const product = products.find((p) => p.id === v.product_id);
      if (!product) continue;
      // Higher-priced products get less stock. Rango generoso (10-60):
      // stage 06 ahora genera ~60-70 órdenes que decrementan estas cantidades;
      // con el rango anterior (2-20) el stock quedaba en negativo.
      const baseStock = Math.max(10, Math.round(60 - (Number(v.price_override ?? product.base_price) / 200000)));
      const inShowroom = Math.min(Math.floor(baseStock * 0.3), 4);
      const inWarehouse = baseStock - inShowroom;

      // Stock level in warehouse
      const slWarehouse = await prisma.stock_levels.upsert({
        where: {
          product_id_product_variant_id_location_id: {
            product_id: v.product_id,
            product_variant_id: v.id,
            location_id: warehouse.id,
          } as any,
        },
        update: {},
        create: {
          product_id: v.product_id,
          product_variant_id: v.id,
          location_id: warehouse.id,
          quantity_on_hand: inWarehouse,
          quantity_reserved: 0,
          quantity_available: inWarehouse,
          reorder_point: 3,
          max_stock: 50,
          cost_per_unit: new Prisma.Decimal(Number(product.cost_price ?? 0)),
        } as any,
      }).catch(() =>
        prisma.stock_levels.updateMany({
          where: { product_id: v.product_id, product_variant_id: v.id, location_id: warehouse.id } as any,
          data: {
            quantity_on_hand: inWarehouse,
            quantity_available: inWarehouse,
            cost_per_unit: new Prisma.Decimal(Number(product.cost_price ?? 0)),
          },
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; }),
      );
      if (slWarehouse) stockLevels++;

      // Initial inventory transaction (warehouse)
      const txWarehouse = await prisma.inventory_transactions.create({
        data: {
          organization_id: orgId,
          product_id: v.product_id,
          product_variant_id: v.id,
          type: 'initial' as any,
          quantity_change: inWarehouse,
          notes: 'Carga inicial desde script de demo Roku',
          transaction_date: INITIAL_STOCK_DATE,
          user_id: user?.id,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (txWarehouse) transactions++;

      // Cost layer (FIFO)
      const costLayer = await prisma.inventory_cost_layers.create({
        data: {
          organization_id: orgId,
          product_id: v.product_id,
          product_variant_id: v.id,
          location_id: warehouse.id,
          quantity_remaining: inWarehouse,
          unit_cost: new Prisma.Decimal(Number(product.cost_price ?? 0)),
          received_at: INITIAL_STOCK_DATE,
          batch_number: `BATCH-${INITIAL_STOCK_DATE.getUTCFullYear()}-${String(v.id).padStart(4, '0')}`,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (costLayer) costLayers++;

      // Stock level in showroom (if exists)
      if (showroom && inShowroom > 0) {
        const slShowroom = await prisma.stock_levels.upsert({
          where: {
            product_id_product_variant_id_location_id: {
              product_id: v.product_id,
              product_variant_id: v.id,
              location_id: showroom.id,
            } as any,
          },
          update: {},
          create: {
            product_id: v.product_id,
            product_variant_id: v.id,
            location_id: showroom.id,
            quantity_on_hand: inShowroom,
            quantity_reserved: 0,
            quantity_available: inShowroom,
            reorder_point: 1,
            max_stock: 10,
            cost_per_unit: new Prisma.Decimal(Number(product.cost_price ?? 0)),
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (slShowroom) stockLevels++;

        // Inventory movement: warehouse → showroom
        const moveDate = randomDateInWindow(rng,
          new Date('2025-11-20T00:00:00Z'),
          new Date('2025-12-15T00:00:00Z'),
        );
        const movement = await prisma.inventory_movements.create({
          data: {
            organization_id: orgId,
            product_id: v.product_id,
            product_variant_id: v.id,
            from_location_id: warehouse.id,
            to_location_id: showroom.id,
            quantity: inShowroom,
            movement_type: 'transfer' as any,
            source_module: 'inventory' as any,
            reason: 'Reposición inicial al showroom',
            notes: `Movimiento inicial desde Bodega Central a Showroom Norte`,
            created_at: moveDate,
            user_id: user?.id,
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (movement) movements++;
      }

      // Update product total stock
      await prisma.products.update({
        where: { id: v.product_id },
        data: { stock_quantity: inWarehouse + (showroom ? inShowroom : 0) },
      });
    }

    // === 2. Adjustments (damage + theft + count variance) ===
    out('  · Creating 6 inventory adjustments');
    const adjustReasons: Array<{ type: any; reason: string; code: string }> = [
      { type: 'damage', reason: 'Daño en bodega por humedad', code: 'HUMEDAD' },
      { type: 'theft', reason: 'Pérdida por robo — investigación interna', code: 'ROBO' },
      { type: 'expiration', reason: 'Vencimiento de producto con batch', code: 'VENCIMIENTO' },
      { type: 'count_variance', reason: 'Diferencia en conteo cíclico', code: 'CONTEO' },
      { type: 'damage', reason: 'Rotura en transporte al showroom', code: 'TRANSPORTE' },
      { type: 'manual_correction', reason: 'Corrección manual por error de registro', code: 'CORRECCION' },
    ];
    for (const adj of adjustReasons) {
      // Pick 2 random variants
      const targets = rng.pickMany(variants, 2);
      for (const t of targets) {
        const product = products.find((p) => p.id === t.product_id);
        if (!product) continue;
        const qty = -rng.int(1, 3);
        const adjDate = randomDateInWindow(rng,
          new Date('2025-12-01T00:00:00Z'),
          new Date('2026-05-15T00:00:00Z'),
        );
        const adjustment = await prisma.inventory_adjustments.create({
          data: {
            organization_id: orgId,
            product_id: t.product_id,
            product_variant_id: t.id,
            location_id: warehouse.id,
            adjustment_type: adj.type as any,
            quantity_before: 10,
            quantity_after: 10 + qty,
            quantity_change: qty,
            reason_code: adj.code,
            description: adj.reason,
            created_by_user_id: user?.id,
            approved_by_user_id: user?.id,
            approved_at: adjDate,
            created_at: adjDate,
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (adjustment) adjustments++;
      }
    }

    // === 3. Inventory batches (3 batches) ===
    out('  · Creating 3 inventory batches');
    const batchProducts = rng.pickMany(products.filter((p) => p.requires_batch_tracking), 3);
    for (const bp of batchProducts) {
      const mfg = new Date('2025-10-15T00:00:00Z');
      const exp = new Date('2027-10-15T00:00:00Z');
      const batch = await prisma.inventory_batches.upsert({
        where: {
          product_id_batch_number: {
            product_id: bp.id,
            batch_number: `BATCH-${bp.sku}-2025-Q4`,
          } as any,
        },
        update: {},
        create: {
          product_id: bp.id,
          location_id: warehouse.id,
          batch_number: `BATCH-${bp.sku}-2025-Q4`,
          quantity: 30,
          quantity_used: 0,
          manufacturing_date: mfg,
          expiration_date: exp,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (batch) batches++;
    }

    // === 4. Serial numbers for serial-required products ===
    out('  · Creating 8 serial numbers for serial-required products');
    const serialProducts = products.filter((p) => p.requires_serial_numbers).slice(0, 8);
    for (const sp of serialProducts) {
      const v = variants.find((vv) => vv.product_id === sp.id);
      if (!v) continue;
      const sn = `${sp.sku}-SN${String(rng.int(10000, 99999))}`;
      const serial = await prisma.inventory_serial_numbers.upsert({
        where: { serial_number: sn },
        update: {},
        create: {
          serial_number: sn,
          product_id: sp.id,
          product_variant_id: v.id,
          location_id: warehouse.id,
          status: 'in_stock' as any,
          cost: new Prisma.Decimal(Number(sp.cost_price ?? 0)),
          notes: 'Serial demo',
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (serial) serials++;
    }

    // === 5. Stock reservations (2: 1 active, 1 expired) ===
    out('  · Creating 2 stock reservations');
    const reservProducts = rng.pickMany(products, 2);
    for (let i = 0; i < reservProducts.length; i++) {
      const rp = reservProducts[i];
      const v = variants.find((vv) => vv.product_id === rp.id);
      if (!v) continue;
      const isExpired = i === 1;
      const reservation = await prisma.stock_reservations.create({
        data: {
          organization_id: orgId,
          product_id: rp.id,
          product_variant_id: v.id,
          location_id: warehouse.id,
          quantity: 1,
          reserved_for_type: 'order' as any,
          reserved_for_id: 9000 + i,
          expires_at: isExpired
            ? new Date('2026-01-15T00:00:00Z')
            : new Date('2026-07-15T00:00:00Z'),
          status: (isExpired ? 'expired' : 'active') as any,
          user_id: user?.id,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (reservation) reservations++;
    }

    // === 6. Inventory valuation snapshots (one per fiscal period close) ===
    out('  · Creating 6 inventory valuation snapshots');
    const periods = monthlyPeriods(ctx.options.monthsBack + 1);
    for (const p of periods) {
      // Skip current (open) period
      if (p.end >= TODAY) continue;
      const period = data.fiscalPeriodByLabel?.get(p.label);
      if (!period) continue;
      // Sample 10 products per snapshot
      const sampled = rng.pickMany(products, 10);
      for (const sp of sampled) {
        const v = variants.find((vv) => vv.product_id === sp.id);
        if (!v) continue;
        const totalOnHand = await prisma.stock_levels.aggregate({
          where: { product_id: sp.id, product_variant_id: v.id },
          _sum: { quantity_on_hand: true },
        });
        const qty = totalOnHand._sum.quantity_on_hand ?? 0;
        const unitCost = Number(sp.cost_price ?? 0);
        const totalValue = qty * unitCost;
        const snapshot = await prisma.inventory_valuation_snapshots.create({
          data: {
            organization_id: orgId,
            store_id: storeId,
            accounting_entity_id: data.accountingEntity?.id ?? null,
            location_id: warehouse.id,
            product_id: sp.id,
            product_variant_id: v.id,
            snapshot_at: p.end,
            quantity_on_hand: qty,
            quantity_reserved: 0,
            quantity_available: qty,
            unit_cost: new Prisma.Decimal(unitCost),
            total_value: new Prisma.Decimal(totalValue),
            costing_method: 'fifo' as any,
            operating_scope: 'STORE' as any,
            source_type: 'fiscal_period',
            source_id: period.id,
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (snapshot) snapshots++;
      }
    }

    counts.stockLevels = stockLevels;
    counts.inventoryTransactions = transactions;
    counts.inventoryMovements = movements;
    counts.inventoryAdjustments = adjustments;
    counts.inventoryBatches = batches;
    counts.inventorySerialNumbers = serials;
    counts.stockReservations = reservations;
    counts.inventoryCostLayers = costLayers;
    counts.inventoryValuationSnapshots = snapshots;

    out(`  ✓ Stage 03: ${JSON.stringify(counts)}`);
    return counts;
  },
};
