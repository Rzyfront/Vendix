/**
 * Stage 06 — Sales
 *
 * Creates 24 orders distributed across 6 months with various channels (POS,
 * ecommerce, whatsapp), statuses (completed, shipped, invoiced, cancelled),
 * payments, refunds, installments, promotions, coupons, quotations (with
 * various states), dispatch_notes, bookings, layaway_plans, and payment_links.
 *
 * Each completed order decrements stock_levels, creates an `orders` row with
 * items, taxes, payments, and (if from POS) cash_register_movements.
 */

import { Prisma } from '@prisma/client';
import type { Stage, StageContext } from './context';
import { orderNumber, quotationNumber, dispatchNumber, bookingNumber, layawayNumber, transactionRef } from '../lib/ids';
import { randomDateInWindow, monthlyPeriods, addDays, TODAY } from '../lib/dates';
import { IVA_RATES } from '../lib/fiscal-co';

interface OrderLineSpec {
  productIdx: number;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  taxAmount: number;
}

export const stage06Sales: Stage = {
  id: '06',
  name: 'Sales',
  description: 'Orders, items, taxes, payments, refunds, installments, promotions, coupons, quotations, dispatches, bookings, layaway, payment_links',
  run: async (ctx: StageContext) => {
    const { prisma, data, rng, log: out } = ctx;

    // Recover org/store/customers/products from DB if running standalone
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
    const user = data.adminUser;
    const posUser = data.posCashier;
    const warehouse = data.defaultLocation;
    let products = data.products;
    let variants = data.variants;
    let customers = data.customers;
    if (!products?.length) {
      products = await prisma.products.findMany({
        where: { store_id: storeId },
        include: { product_categories: { include: { categories: true } } },
      });
      // Map relations to a flat `category` slug for convenience (used by bookings etc.)
      for (const p of products) {
        const cat = p.product_categories?.[0]?.categories;
        (p as any).category = cat?.slug;
      }
      data.products = products;
    }
    if (!variants?.length) {
      variants = await prisma.product_variants.findMany({
        where: { product_id: { in: products.map(p => p.id) } },
      });
      data.variants = variants;
    }
    if (!customers?.length) {
      // Pick any user assigned to this store with role 'customer'
      const customerRole = await prisma.roles.findUnique({ where: { name: 'customer' } });
      if (customerRole) {
        const customerUsers = await prisma.users.findMany({
          where: { user_roles: { some: { role_id: customerRole.id } }, store_users: { some: { store_id: storeId } } },
          take: 10,
        });
        customers = customerUsers.map(u => ({ ...u, _isB2B: u.person_type === 'JURIDICA' }));
        data.customers = customers;
      }
    }
    const fiscalPeriodByLabel = data.fiscalPeriodByLabel;
    if (!products?.length || !customers?.length) {
      throw new Error('Stages 02 and 04 must run first.');
    }
    const counts: Record<string, number> = {
      orders: 0,
      orderItems: 0,
      orderItemTaxes: 0,
      payments: 0,
      refunds: 0,
      orderInstallments: 0,
      promotions: 0,
      coupons: 0,
      couponUses: 0,
      quotations: 0,
      quotationItems: 0,
      dispatchNotes: 0,
      dispatchNoteItems: 0,
      bookings: 0,
      layawayPlans: 0,
      layawayInstallments: 0,
      paymentLinks: 0,
    };

    // === Promotions (2) ===
    out('  · Creating 2 promotions');
    const promotions: any[] = [];
    const prom1 = await prisma.promotions.upsert({
      where: { store_id_code: { store_id: storeId, code: 'BLACKFRI10' } } as any,
      update: {},
      create: {
        store_id: storeId,
        name: 'Black Friday 10% descuento',
        description: 'Descuento automático del 10% en todo el catálogo durante Black Friday',
        code: 'BLACKFRI10',
        type: 'percentage' as any,
        value: new Prisma.Decimal(10),
        scope: 'order' as any,
        min_purchase_amount: 0,
        usage_limit: 200,
        usage_count: 0,
        per_customer_limit: 1,
        start_date: new Date('2025-11-20T00:00:00Z'),
        end_date: new Date('2025-11-30T23:59:59Z'),
        state: 'expired' as any,
        is_auto_apply: true,
        priority: 10,
      } as any,
    }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
    const prom2 = await prisma.promotions.upsert({
      where: { store_id_code: { store_id: storeId, code: 'CYBER15' } } as any,
      update: {},
      create: {
        store_id: storeId,
        name: 'Cyber Monday Electrodomésticos',
        description: '15% de descuento en categoría Electrodomésticos',
        code: 'CYBER15',
        type: 'percentage' as any,
        value: new Prisma.Decimal(15),
        scope: 'category' as any,
        min_purchase_amount: 1000000,
        usage_limit: 100,
        usage_count: 0,
        per_customer_limit: 1,
        start_date: new Date('2025-12-01T00:00:00Z'),
        end_date: new Date('2025-12-05T23:59:59Z'),
        state: 'expired' as any,
        is_auto_apply: true,
        priority: 20,
      } as any,
    }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
    if (prom1) {
      promotions.push(prom1);
      counts.promotions++;
    }
    if (prom2) {
      promotions.push(prom2);
      // Link to "electrodomesticos" category
      const cat = data.categories.find((c) => c.slug === 'electrodomesticos');
      if (cat) {
        await prisma.promotion_categories.upsert({
          where: { promotion_id_category_id: { promotion_id: prom2.id, category_id: cat.id } },
          update: {},
          create: { promotion_id: prom2.id, category_id: cat.id },
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      }
      counts.promotions++;
    }

    // === Coupons (2) ===
    out('  · Creating 2 coupons');
    const coupons: any[] = [];
    const c1 = await prisma.coupons.upsert({
      where: { store_id_code: { store_id: storeId, code: 'ROKUBIENVENIDO' } } as any,
      update: {},
      create: {
        store_id: storeId,
        code: 'ROKUBIENVENIDO',
        name: 'Cupón de bienvenida',
        description: 'COP 50.000 de descuento en la primera compra',
        discount_type: 'FIXED_AMOUNT' as any,
        discount_value: new Prisma.Decimal(50000),
        min_purchase_amount: 300000,
        max_uses: 200,
        max_uses_per_customer: 1,
        current_uses: 0,
        valid_from: new Date('2025-12-01T00:00:00Z'),
        valid_until: new Date('2027-12-31T23:59:59Z'),
        is_active: true,
        applies_to: 'ALL_PRODUCTS' as any,
      } as any,
    }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
    if (c1) {
      coupons.push(c1);
      counts.coupons++;
    }

    // === Orders (growth ramp: ~6/mo at the oldest month -> ~14/mo today) ===
    const periods = monthlyPeriods(ctx.options.monthsBack);
    out(`  · Creating orders across ${periods.length} months (ramp 6→14/mo)`);
    const createdOrders: any[] = [];
    let orderCounter = 0;
    for (let pi = 0; pi < periods.length; pi++) {
      const period = periods[pi]!;
      // Older months sell less; volume grows toward the present.
      const perMonth =
        6 + Math.round((pi / Math.max(1, periods.length - 1)) * 6) + rng.int(0, 2);
      for (let oi = 0; oi < perMonth; oi++) {
        orderCounter++;
        const orderDate = randomDateInWindow(rng, period.start, period.end);
        const channel = rng.pick(['pos', 'ecommerce', 'whatsapp', 'pos'] as const);
        const isCancelled = rng.chance(0.05);
        const customer = rng.pick(customers.filter((c) => c._isB2B) as any[]).length > 0 && rng.chance(0.4)
          ? rng.pick(customers.filter((c: any) => c._isB2B))
          : rng.pick(customers);

        // 1-3 line items
        const itemCount = rng.int(1, 3);
        const chosen = rng.pickMany(products, itemCount);
        const orderLines: OrderLineSpec[] = [];
        let subtotal = 0;
        let taxTotal = 0;
        for (const product of chosen) {
          const variant = variants.find((v) => v.product_id === product.id);
          const qty = rng.int(1, 3);
          const unitPrice = Number(variant?.price_override ?? product.base_price);
          const lineSubtotal = unitPrice * qty;
          const taxAmount = lineSubtotal * IVA_RATES.GENERAL;
          orderLines.push({
            productIdx: products.indexOf(product),
            quantity: qty,
            unitPrice,
            totalPrice: lineSubtotal,
            taxAmount,
          });
          subtotal += lineSubtotal;
          taxTotal += taxAmount;
        }
        const grandTotal = subtotal + taxTotal;
        const status: any = isCancelled
          ? 'cancelled'
          : orderDate < new Date(Date.now() - 7 * 24 * 3600 * 1000) ? 'completed' : 'pending';
        // Map the local status to real order_state_enum values
        const dbState: any = status === 'completed' ? 'finished' : status === 'pending' ? 'processing' : 'cancelled';

        const orderNum = orderNumber(orderDate, orderCounter);
        const order = await prisma.orders.upsert({
          where: { store_id_order_number: { store_id: storeId, order_number: orderNum } } as any,
          update: {},
          create: {
            store_id: storeId,
            order_number: orderNum,
            customer_id: customer?.id,
            currency: 'COP',
            subtotal_amount: new Prisma.Decimal(subtotal),
            discount_amount: new Prisma.Decimal(0),
            tax_amount: new Prisma.Decimal(taxTotal),
            shipping_cost: new Prisma.Decimal(0),
            grand_total: new Prisma.Decimal(grandTotal),
            total_paid: new Prisma.Decimal(isCancelled ? 0 : grandTotal),
            remaining_balance: new Prisma.Decimal(isCancelled ? 0 : 0),
            state: dbState,
            channel: channel as any,
            delivery_type: channel === 'ecommerce' ? 'home_delivery' : 'pickup',
            placed_at: orderDate,
            completed_at: status === 'completed' ? addDays(orderDate, 1) : null,
            // Backdate created_at: listados y dashboards filtran por esta
            // columna, no por placed_at — sin esto toda la historia "ocurre hoy"
            created_at: orderDate,
            updated_at: status === 'completed' ? addDays(orderDate, 1) : orderDate,
            payment_form: orderCounter === 12 ? '2' : '1', // DIAN: 1=contado, 2=crédito
            credit_type: null,
            internal_notes: `Orden demo Roku #${orderCounter} (${channel})`,
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (!order) continue;
        createdOrders.push({ ...order, lines: orderLines, customer, channel, status });
        counts.orders++;

        // Items + taxes
        for (const l of orderLines) {
          const product = products[l.productIdx];
          const variant = variants.find((v) => v.product_id === product.id);
          const orderItem = await prisma.order_items.create({
            data: {
              order_id: order.id,
              product_id: product.id,
              product_variant_id: variant?.id,
              product_name: product.name,
              variant_sku: variant?.sku,
              variant_attributes: variant?.attributes ? JSON.stringify(variant.attributes) : null,
              quantity: l.quantity,
              unit_price: new Prisma.Decimal(l.unitPrice),
              total_price: new Prisma.Decimal(l.totalPrice),
              tax_rate: new Prisma.Decimal(IVA_RATES.GENERAL),
              tax_amount_item: new Prisma.Decimal(l.taxAmount),
              cost_price: new Prisma.Decimal(product.cost_price ?? 0),
              description: product.description?.slice(0, 200),
              item_type: 'product' as any,
              created_at: orderDate,
            } as any,
          }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
          if (orderItem) counts.orderItems++;

          // Tax line (IVA General)
          if (orderItem) {
            const itemTax = await prisma.order_item_taxes.create({
              data: {
                order_item_id: orderItem.id,
                tax_name: 'IVA General 19%',
                tax_rate: new Prisma.Decimal(IVA_RATES.GENERAL),
                tax_amount: new Prisma.Decimal(l.taxAmount),
                is_compound: false,
                tax_type: 'iva' as any,
              } as any,
            }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
            if (itemTax) counts.orderItemTaxes++;
          }

          // Decrement stock (solo bodega: sin el filtro de location el
          // updateMany restaba también en showroom, duplicando la salida)
          if (status === 'completed' || status === 'pending') {
            await prisma.stock_levels.updateMany({
              where: { product_id: product.id, product_variant_id: variant?.id, location_id: warehouse?.id } as any,
              data: {
                quantity_on_hand: { decrement: l.quantity },
                quantity_available: { decrement: l.quantity },
              },
            }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
          }
        }

        // Payment (1 per order, succeeded unless cancelled)
        if (!isCancelled) {
          const paymentMethods = ['cash', 'card', 'transfer', 'wompi_link', 'nequi'];
          const txRef = transactionRef(rng);
          const gwRef = transactionRef(rng);
          const payment = await prisma.payments.upsert({
            where: { transaction_id: txRef },
            update: {},
            create: {
              order_id: order.id,
              customer_id: customer?.id,
              amount: new Prisma.Decimal(grandTotal),
              currency: 'COP',
              state: 'succeeded' as any,
              transaction_id: txRef,
              gateway_reference: gwRef,
              paid_at: orderDate,
              created_at: orderDate,
            } as any,
          }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
          if (payment) counts.payments++;
        }

        // Refund on a few historical orders (~1 each 23)
        if (status === 'completed' && orderCounter % 23 === 7) {
          const refundRef = transactionRef(rng);
          const refund = await prisma.refunds.upsert({
            where: { refund_transaction_id: refundRef },
            update: {},
            create: {
              order_id: order.id,
              amount: new Prisma.Decimal(orderLines[0]!.totalPrice + orderLines[0]!.taxAmount),
              subtotal_refund: new Prisma.Decimal(orderLines[0]!.totalPrice),
              tax_refund: new Prisma.Decimal(orderLines[0]!.taxAmount),
              currency: 'COP',
              reason: 'Devolución por defecto de fábrica',
              state: 'completed' as any,
              refund_method: 'original',
              refund_transaction_id: refundRef,
              processed_by_user_id: user?.id,
              processed_at: addDays(orderDate, 5),
              created_at: addDays(orderDate, 5),
            } as any,
          }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
          if (refund) counts.refunds++;
        }

        // Installments (1 credit sale)
        if (orderCounter === 12) {
          for (let inst = 0; inst < 3; inst++) {
            const installment = await prisma.order_installments.create({
              data: {
                order_id: order.id,
                installment_number: inst + 1,
                amount: new Prisma.Decimal(grandTotal / 3),
                capital_amount: new Prisma.Decimal(grandTotal / 3),
                interest_amount: new Prisma.Decimal(0),
                due_date: addDays(orderDate, 30 * (inst + 1)),
                state: inst === 0 ? 'paid' : 'pending' as any,
                amount_paid: inst === 0 ? new Prisma.Decimal(grandTotal / 3) : 0,
                remaining_balance: inst === 0 ? new Prisma.Decimal(0) : new Prisma.Decimal(grandTotal / 3),
                paid_at: inst === 0 ? addDays(orderDate, 5) : null,
              } as any,
            }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
            if (installment) counts.orderInstallments++;
          }
        }
      }
    }

    // Clamp: la demo nunca debe mostrar inventario negativo aunque el RNG
    // concentre ventas en una variante de poco stock.
    const storeLocations = await prisma.inventory_locations.findMany({
      where: { store_id: storeId },
      select: { id: true },
    });
    await prisma.stock_levels.updateMany({
      where: { quantity_on_hand: { lt: 0 }, location_id: { in: storeLocations.map((l) => l.id) } },
      data: { quantity_on_hand: 5, quantity_available: 5 },
    }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
    await prisma.stock_levels.updateMany({
      where: { quantity_available: { lt: 0 }, location_id: { in: storeLocations.map((l) => l.id) } },
      data: { quantity_available: 0 },
    }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });

    // === Quotations (5) ===
    out('  · Creating 5 quotations');
    const quotationStatuses = ['draft', 'sent', 'accepted', 'converted', 'expired'] as const;
    for (let q = 0; q < 5; q++) {
      const customer = customers[q] ?? customers[0];
      const qDate = randomDateInWindow(rng, addDays(TODAY, -120), addDays(TODAY, -7));
      const status = quotationStatuses[q];
      const chosen = rng.pickMany(products, rng.int(1, 3));
      const lines = chosen.map((p) => {
        const v = variants.find((vv) => vv.product_id === p.id);
        const unitPrice = Number(v?.price_override ?? p.base_price);
        const qty = rng.int(1, 2);
        const subtotal = unitPrice * qty;
        const tax = subtotal * IVA_RATES.GENERAL;
        return { product: p, variant: v, quantity: qty, unitPrice, totalPrice: subtotal, taxAmount: tax };
      });
      const subtotal = lines.reduce((a, l) => a + l.totalPrice, 0);
      const taxTotal = lines.reduce((a, l) => a + l.taxAmount, 0);
      const grandTotal = subtotal + taxTotal;
      const quotationNum = quotationNumber(qDate, q + 1);
      const quotation = await prisma.quotations.upsert({
        where: { store_id_quotation_number: { store_id: storeId, quotation_number: quotationNum } } as any,
        update: {},
        create: {
          store_id: storeId,
          quotation_number: quotationNum,
          customer_id: customer?.id,
          created_by_user_id: user?.id,
          status: status as any,
          channel: 'pos' as any,
          subtotal_amount: new Prisma.Decimal(subtotal),
          discount_amount: 0,
          tax_amount: new Prisma.Decimal(taxTotal),
          shipping_cost: 0,
          grand_total: new Prisma.Decimal(grandTotal),
          valid_until: addDays(qDate, 15),
          created_at: qDate,
          notes: `Cotización demo Roku #${q + 1}`,
          terms_and_conditions: 'Precios incluyen IVA. Vigencia 15 días.',
          sent_at: status === 'draft' ? null : qDate,
          accepted_at: status === 'accepted' || status === 'converted' ? addDays(qDate, 2) : null,
          rejected_at: null,
          converted_at: status === 'converted' ? addDays(qDate, 4) : null,
          converted_order_id: status === 'converted' ? null : null,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (!quotation) continue;
      counts.quotations++;
      for (const l of lines) {
        const quotationItem = await prisma.quotation_items.create({
          data: {
            quotation_id: quotation.id,
            product_id: l.product.id,
            product_variant_id: l.variant?.id,
            product_name: l.product.name,
            variant_sku: l.variant?.sku,
            quantity: l.quantity,
            unit_price: new Prisma.Decimal(l.unitPrice),
            discount_amount: 0,
            tax_rate: new Prisma.Decimal(IVA_RATES.GENERAL),
            tax_amount_item: new Prisma.Decimal(l.taxAmount),
            total_price: new Prisma.Decimal(l.totalPrice),
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (quotationItem) counts.quotationItems++;
      }
    }

    // === Dispatch notes (8, muestreadas a lo largo de la historia) ===
    out('  · Creating 8 dispatch notes');
    const completedOrders = createdOrders
      .filter((o) => o.status === 'completed')
      .filter((_, i) => i % 4 === 0)
      .slice(0, 8);
    for (let di = 0; di < completedOrders.length; di++) {
      const o = completedOrders[di]!;
      const dDate = addDays(o.placed_at, rng.int(1, 3));
      const dispatchNum = dispatchNumber(dDate, di + 1);
      const dispatch = await prisma.dispatch_notes.upsert({
        where: { store_id_dispatch_number: { store_id: storeId, dispatch_number: dispatchNum } },
        update: {},
        create: {
          store_id: storeId,
          dispatch_number: dispatchNum,
          status: di === 0 ? 'invoiced' : (di < 3 ? 'delivered' : 'confirmed') as any,
          customer_id: o.customer?.id,
          customer_name: `${o.customer?.first_name ?? ''} ${o.customer?.last_name ?? ''}`,
          customer_tax_id: o.customer?.document_number,
          customer_address: { street: `Calle 100 #15-${rng.int(10, 99)}`, city: 'Bogotá' } as any,
          emission_date: dDate,
          created_at: dDate,
          agreed_delivery_date: addDays(dDate, 2),
          actual_delivery_date: di < 2 ? addDays(dDate, 2) : null,
          dispatch_location_id: warehouse.id,
          subtotal_amount: new Prisma.Decimal(Number(o.subtotal_amount)),
          discount_amount: new Prisma.Decimal(0),
          tax_amount: new Prisma.Decimal(Number(o.tax_amount)),
          grand_total: new Prisma.Decimal(Number(o.grand_total)),
          notes: 'Despacho demo',
          created_by_user_id: user?.id,
          confirmed_by_user_id: user?.id,
          delivered_by_user_id: di < 2 ? user?.id : null,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (!dispatch) continue;
      counts.dispatchNotes++;
      for (const li of o.lines) {
        const product = products[li.productIdx]!;
        const variant = variants.find((v) => v.product_id === product.id);
        const dispatchItem = await prisma.dispatch_note_items.create({
          data: {
            dispatch_note_id: dispatch.id,
            product_id: product.id,
            product_variant_id: variant?.id,
            ordered_quantity: li.quantity,
            dispatched_quantity: li.quantity,
            unit_price: new Prisma.Decimal(li.unitPrice),
            discount_amount: 0,
            tax_amount: new Prisma.Decimal(li.taxAmount),
            total_price: new Prisma.Decimal(li.totalPrice),
            cost_price: new Prisma.Decimal(product.cost_price ?? 0),
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (dispatchItem) counts.dispatchNoteItems++;
      }
    }

    // === Bookings (5) ===
    out('  · Creating 5 bookings (service appointments)');
    for (let b = 0; b < 5; b++) {
      const customer = customers[b] ?? customers[0]!;
      const bDate = randomDateInWindow(rng, addDays(TODAY, -90), addDays(TODAY, 7));
      const bProduct = rng.pick(products.filter((p) => p.category === 'electrodomesticos') as any[]);
      const variant = variants.find((v) => v.product_id === bProduct.id);
      const bookingNum = bookingNumber(bDate, b + 1);
      const booking = await prisma.bookings.upsert({
        where: { store_id_booking_number: { store_id: storeId, booking_number: bookingNum } },
        update: {},
        create: {
          store_id: storeId,
          booking_number: bookingNum,
          customer_id: customer.id,
          product_id: bProduct.id,
          product_variant_id: variant?.id,
          date: bDate,
          start_time: '09:00',
          end_time: '10:00',
          status: b < 3 ? 'completed' : (b === 3 ? 'confirmed' : 'pending') as any,
          channel: 'whatsapp' as any,
          notes: 'Instalación de electrodoméstico',
          created_by_user_id: user?.id,
          created_at: addDays(bDate, -3),
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (booking) counts.bookings++;
    }

    // === Layaway plans (2) ===
    out('  · Creating 2 layaway plans');
    for (let l = 0; l < 2; l++) {
      const customer = customers[l + 5] ?? customers[0]!;
      const lDate = randomDateInWindow(rng, addDays(TODAY, -90), addDays(TODAY, -10));
      const lProduct = rng.pick(products.filter((p) => Number(p.base_price) > 1000000) as any[]);
      const variant = variants.find((v) => v.product_id === lProduct.id);
      const total = Number(lProduct.base_price) * 1.19;
      const down = total * 0.3;
      const numInst = 3;
      const instAmt = (total - down) / numInst;
      const planNumber = layawayNumber(lDate, l + 1);
      const plan = await prisma.layaway_plans.upsert({
        where: { store_id_plan_number: { store_id: storeId, plan_number: planNumber } } as any,
        update: {},
        create: {
          store_id: storeId,
          plan_number: planNumber,
          state: l === 0 ? 'active' : 'completed' as any,
          total_amount: new Prisma.Decimal(total),
          down_payment_amount: new Prisma.Decimal(down),
          paid_amount: new Prisma.Decimal(l === 0 ? down : total),
          remaining_amount: new Prisma.Decimal(l === 0 ? total - down : 0),
          currency: 'COP',
          num_installments: numInst,
          customer_id: customer.id,
          created_by_user_id: user?.id,
          started_at: lDate,
          completed_at: l === 1 ? addDays(lDate, 90) : null,
          created_at: lDate,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (!plan) continue;
      counts.layawayPlans++;
      await prisma.layaway_items.create({
        data: {
          layaway_plan_id: plan.id,
          product_id: lProduct.id,
          product_variant_id: variant?.id,
          product_name: lProduct.name,
          variant_name: variant?.name,
          sku: lProduct.sku ?? '',
          quantity: 1,
          unit_price: new Prisma.Decimal(Number(lProduct.base_price)),
          discount_amount: 0,
          tax_amount: new Prisma.Decimal(Number(lProduct.base_price) * 0.19),
          subtotal: new Prisma.Decimal(Number(lProduct.base_price) * 1.19),
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      for (let i = 0; i < numInst; i++) {
        const layawayInstallment = await prisma.layaway_installments.upsert({
          where: { layaway_plan_id_installment_number: { layaway_plan_id: plan.id, installment_number: i + 1 } } as any,
          update: {},
          create: {
            layaway_plan_id: plan.id,
            installment_number: i + 1,
            amount: new Prisma.Decimal(instAmt),
            due_date: addDays(lDate, 30 * (i + 1)),
            state: l === 1 || (l === 0 && i === 0) ? 'paid' : 'pending' as any,
            paid_at: l === 1 || (l === 0 && i === 0) ? addDays(lDate, 30 * (i + 1)) : null,
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (layawayInstallment) counts.layawayInstallments++;
      }
    }

    // === Payment links (3 Wompi) ===
    out('  · Creating 3 Wompi payment links');
    const linkStatuses = ['paid', 'active', 'expired'] as const;
    for (let pl = 0; pl < 3; pl++) {
      const customer = customers[pl] ?? customers[0]!;
      const product = products[pl] ?? products[0]!;
      const lDate = randomDateInWindow(rng, addDays(TODAY, -60), addDays(TODAY, -1));
      const total = Number(product.base_price) * 1.19;
      // Deterministic id so the upsert is idempotent across runs (VarChar(20))
      const wompiLinkId = `WL-ROKU-${pl + 1}`;
      const paymentLink = await prisma.payment_links.upsert({
        where: { wompi_link_id: wompiLinkId },
        update: {},
        create: {
          store_id: storeId,
          wompi_link_id: wompiLinkId,
          name: `Pago ${product.name.slice(0, 30)}`,
          description: `Link de pago para ${product.name}`,
          amount_in_cents: Math.round(total * 100),
          currency: 'COP',
          single_use: true,
          collect_shipping: false,
          checkout_url: `https://checkout.wompi.co/l/${wompiLinkId}`,
          status: linkStatuses[pl] as any,
          expires_at: addDays(lDate, 30),
          created_at: lDate,
          sku: product.sku ?? undefined,
          paid_at: linkStatuses[pl] === 'paid' ? addDays(lDate, 2) : null,
          transaction_id: linkStatuses[pl] === 'paid' ? transactionRef(rng) : null,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (paymentLink) counts.paymentLinks++;
    }

    data.orders = createdOrders;
    out(`  ✓ Stage 06: ${JSON.stringify(counts)}`);
    return counts;
  },
};
