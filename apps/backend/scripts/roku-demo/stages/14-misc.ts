/**
 * Stage 14 — Misc
 *
 * Creates notifications, notification_subscriptions, reviews, carts,
 * wishlists, audit_logs, push_subscriptions, and a few residential
 * addresses. Closes the visual gaps so the UI shows non-empty dropdowns.
 */

import { Prisma } from '@prisma/client';
import type { Stage, StageContext } from './context';
import { randomDateInWindow, addDays, TODAY } from '../lib/dates';

export const stage14Misc: Stage = {
  id: '14',
  name: 'Misc',
  description: 'Notifications, reviews, carts, wishlists, audit_logs, push_subscriptions',
  run: async (ctx: StageContext) => {
    const { prisma, data, rng, log: out } = ctx;
    const orgId = data.organization.id;
    const storeId = data.store.id;
    const user = data.adminUser;
    const products = data.products;
    const customers = data.customers;
    const orders = data.orders || [];
    const counts: Record<string, number> = {
      notifications: 0,
      notificationSubscriptions: 0,
      reviews: 0,
      reviewResponses: 0,
      carts: 0,
      cartItems: 0,
      wishlists: 0,
      wishlistItems: 0,
      auditLogs: 0,
      pushSubscriptions: 0,
      addresses: 0,
    };

    out('  · Creating 12 notifications + subscriptions');
    // notifications.type is notification_type_enum and the content field is `body`
    // (no user_id/read_at/action_url/metadata columns on the model)
    const notifTypes = [
      { type: 'new_order' as any, title: 'Orden confirmada', severity: 'info' as any, message: 'Tu orden #ROKU-XXX ha sido confirmada' },
      { type: 'order_status_change' as any, title: 'Orden despachada', severity: 'info' as any, message: 'Tu pedido está en camino' },
      { type: 'low_stock' as any, title: 'Stock bajo', severity: 'warning' as any, message: 'Quedan pocas unidades de este producto' },
      { type: 'payment_received' as any, title: 'Factura aceptada por DIAN', severity: 'info' as any, message: 'La factura electrónica fue aceptada' },
      { type: 'fiscal_scope_changed' as any, title: 'Recordatorio de IVA', severity: 'warning' as any, message: 'Tienes 5 días para presentar la declaración' },
      { type: 'fiscal_scope_changed' as any, title: 'Error en transmisión DIAN', severity: 'critical' as any, message: 'La transmisión falló — revisar' },
      { type: 'payroll_rules_update' as any, title: 'Nómina aprobada', severity: 'info' as any, message: 'La nómina de este mes ha sido aprobada' },
      { type: 'subscription_promo_applied' as any, title: 'Nueva promoción', severity: 'info' as any, message: 'Cyber Monday 15% en Electrodomésticos' },
      { type: 'low_stock' as any, title: 'Transferencia de inventario', severity: 'info' as any, message: 'Movimiento de bodega a showroom' },
      { type: 'payment_received' as any, title: 'Caja abierta', severity: 'info' as any, message: 'La caja registradora se abrió' },
      { type: 'payment_received' as any, title: 'Caja cerrada', severity: 'info' as any, message: 'Cierre de caja con diferencia de $0' },
      { type: 'payment_received' as any, title: 'Conciliación bancaria', severity: 'info' as any, message: 'Conciliación completada' },
    ];
    for (let n = 0; n < notifTypes.length; n++) {
      const nt = notifTypes[n]!;
      const notif = await prisma.notifications.create({
        data: {
          store_id: storeId,
          type: nt.type,
          title: nt.title,
          body: nt.message,
          severity: nt.severity,
          is_read: rng.chance(0.4),
          data: { source: 'demo', audience: 'customer' } as any,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (notif) counts.notifications++;
      // Also a notification for the admin
      if (user) {
        const adminNotif = await prisma.notifications.create({
          data: {
            store_id: storeId,
            type: nt.type,
            title: nt.title,
            body: nt.message,
            severity: nt.severity,
            is_read: rng.chance(0.3),
            data: { source: 'demo', audience: 'admin' } as any,
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (adminNotif) counts.notifications++;
      }
    }

    // Notification subscriptions (type is notification_type_enum; channels are booleans)
    for (const c of customers.slice(0, 5)) {
      for (const type of ['new_order', 'order_status_change', 'payment_received'] as const) {
        const sub = await prisma.notification_subscriptions.upsert({
          where: { store_id_user_id_type: { store_id: storeId, user_id: c.id, type: type as any } },
          update: {},
          create: {
            store_id: storeId,
            user_id: c.id,
            type: type as any,
            in_app: true,
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (sub) counts.notificationSubscriptions++;
      }
    }

    out('  · Creating 5 reviews with responses');
    const orderCustomers = orders.filter((o: any) => o.status === 'completed').slice(0, 5);
    for (let r = 0; r < orderCustomers.length; r++) {
      const o = orderCustomers[r];
      const product = data.products[o.lines[0]?.productIdx ?? 0];
      if (!product) continue;
      const review = await prisma.reviews.upsert({
        where: { user_id_product_id: { user_id: o.customer.id, product_id: product.id } },
        update: {},
        create: {
          store_id: storeId,
          product_id: product.id,
          user_id: o.customer.id,
          rating: rng.int(3, 5),
          title: ['Excelente producto', 'Muy buen servicio', 'Recomendado', 'Cumple expectativas', 'Lo volvería a comprar'][r] ?? 'Recomendado',
          comment: 'El producto llegó en perfectas condiciones y el servicio al cliente fue muy atento. Volveré a comprar.',
          state: 'approved' as any,
          verified_purchase: true,
          helpful_count: rng.int(0, 20),
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (review) {
        counts.reviews++;
        const response = await prisma.review_responses.upsert({
          where: { review_id: review.id },
          update: {},
          create: {
            review_id: review.id,
            user_id: user?.id,
            content: '¡Gracias por tu compra! Esperamos verte de nuevo pronto.',
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        if (response) counts.reviewResponses++;
      }
    }

    out('  · Creating 3 abandoned carts + 3 wishlists');
    for (let c = 0; c < 3; c++) {
      const customer = customers[c] ?? customers[0]!;
      const product1 = data.products[c] ?? data.products[0];
      const product2 = data.products[(c + 5) % data.products.length]!;
      // carts has no expires_at/metadata; unique (store_id, user_id)
      const cart = await prisma.carts.upsert({
        where: { store_id_user_id: { store_id: storeId, user_id: customer.id } },
        update: {},
        create: {
          store_id: storeId,
          user_id: customer.id,
          currency: 'COP',
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (cart) {
        counts.carts++;
        for (const p of [product1, product2]) {
          const variant = data.variants.find((v) => v.product_id === p.id);
          // cart_items uses product_variant_id (no product_name/variant_sku columns)
          const existingItem = await prisma.cart_items.findFirst({
            where: { cart_id: cart.id, product_id: p.id, product_variant_id: variant?.id ?? null },
          });
          const item = existingItem ?? await prisma.cart_items.create({
            data: {
              cart_id: cart.id,
              product_id: p.id,
              product_variant_id: variant?.id,
              quantity: 1,
              unit_price: new Prisma.Decimal(Number(p.base_price)),
            } as any,
          }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
          if (item) counts.cartItems++;
        }
      }
      // wishlists has only store_id/user_id; unique (store_id, user_id)
      const wishlist = await prisma.wishlists.upsert({
        where: { store_id_user_id: { store_id: storeId, user_id: customer.id } },
        update: {},
        create: {
          store_id: storeId,
          user_id: customer.id,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (wishlist) {
        counts.wishlists++;
        for (const p of [product1, product2]) {
          const variant = data.variants.find((v) => v.product_id === p.id);
          // wishlist_items uses product_variant_id and has no quantity column
          const existingWItem = await prisma.wishlist_items.findFirst({
            where: { wishlist_id: wishlist.id, product_id: p.id, product_variant_id: variant?.id ?? null },
          });
          const wItem = existingWItem ?? await prisma.wishlist_items.create({
            data: {
              wishlist_id: wishlist.id,
              product_id: p.id,
              product_variant_id: variant?.id,
            } as any,
          }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
          if (wItem) counts.wishlistItems++;
        }
      }
    }

    out('  · Creating 6 audit_logs + 1 push_subscription');
    for (let a = 0; a < 6; a++) {
      const auditLog = await prisma.audit_logs.create({
        data: {
          organization_id: orgId,
          store_id: storeId,
          user_id: user?.id,
          action: rng.pick(['create', 'update', 'delete', 'login', 'export', 'approve']),
          resource: rng.pick(['product', 'order', 'invoice', 'payroll_run', 'bank_account', 'user']),
          resource_id: rng.int(1, 1000),
          new_values: { source: 'demo' } as any,
          ip_address: '127.0.0.1',
          user_agent: 'roku-demo-script/1.0',
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (auditLog) counts.auditLogs++;
    }
    if (customers[0]) {
      // unique (store_id, user_id, endpoint) → upsert for re-runs
      const pushSub = await prisma.push_subscriptions.upsert({
        where: {
          store_id_user_id_endpoint: {
            store_id: storeId,
            user_id: customers[0].id,
            endpoint: 'https://fcm.googleapis.com/fcm/send/demo-endpoint',
          },
        },
        update: {},
        create: {
          store_id: storeId,
          user_id: customers[0].id,
          endpoint: 'https://fcm.googleapis.com/fcm/send/demo-endpoint',
          p256dh: 'demo-p256dh-key',
          auth: 'demo-auth-secret',
          user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (pushSub) counts.pushSubscriptions++;
    }

    out('  · Creating 5 residential addresses');
    for (let a = 0; a < 5; a++) {
      const customer = customers[a] ?? customers[0]!;
      const address = await prisma.addresses.create({
        data: {
          user_id: customer.id,
          type: 'home' as any,
          address_line1: `Carrera ${rng.int(7, 100)} #${rng.int(45, 199)}-${rng.int(10, 99)}`,
          address_line2: `Apto ${rng.int(101, 999)}`,
          city: rng.pick(['Bogotá', 'Medellín', 'Cali', 'Barranquilla']),
          state_province: rng.pick(['Bogotá D.C.', 'Antioquia', 'Valle del Cauca', 'Atlántico']),
          country_code: 'CO',
          postal_code: '110111',
          municipality_code: '11001',
          phone_number: customer.phone ?? '+57-3000000000',
          is_primary: false,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      if (address) counts.addresses++;
    }

    out(`  ✓ Stage 14: ${JSON.stringify(counts)}`);
    return counts;
  },
};
