/**
 * Stage 04 — Parties
 *
 * Creates 10 customers (5 final + 5 B2B) and 5 suppliers with addresses.
 * Each supplier is linked to 4-6 products with `supplier_products` and a
 * cost_per_unit slightly lower than the product's base_price.
 */

import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { Stage, StageContext } from './context';
import { BOGOTA, CURRENCY } from '../lib/fiscal-co';
import { customerCode, supplierCode } from '../lib/ids';
import { randomDateInWindow } from '../lib/dates';

const DEFAULT_PASSWORD = 'RokuDemo2026!';

const CUSTOMERS_FINAL = [
  { first_name: 'Sofía', last_name: 'Hernández', document: '52345678', type: 'CC', email: 'sofia.hernandez@roku-demo.vendix.local' },
  { first_name: 'Daniel', last_name: 'López', document: '79123456', type: 'CC', email: 'daniel.lopez@roku-demo.vendix.local' },
  { first_name: 'Valentina', last_name: 'Gómez', document: '1023456789', type: 'CC', email: 'valentina.gomez@roku-demo.vendix.local' },
  { first_name: 'Sebastián', last_name: 'Ramírez', document: '80123456', type: 'CC', email: 'sebastian.ramirez@roku-demo.vendix.local' },
  { first_name: 'Camila', last_name: 'Torres', document: '52123456', type: 'CC', email: 'camila.torres@roku-demo.vendix.local' },
];

const CUSTOMERS_B2B = [
  { name: 'Innovatech S.A.S.', tax_id: '900456789-1', contact: 'Roberto Mejía', email: 'compras@innovatech-demo.vendix.local' },
  { name: 'Soluciones Digitales Colombia Ltda.', tax_id: '800567890-2', contact: 'Adriana Salazar', email: 'contabilidad@soldigital-demo.vendix.local' },
  { name: 'Grupo Empresarial Andino S.A.', tax_id: '830678901-3', contact: 'Fernando Castaño', email: 'finanzas@geandino-demo.vendix.local' },
  { name: 'Distribuidora Eléctricos del Valle', tax_id: '805789012-4', contact: 'Patricia Restrepo', email: 'compras@edisvalle-demo.vendix.local' },
  { name: 'Comercializadora del Norte S.A.S.', tax_id: '900890123-5', contact: 'Mauricio Vélez', email: 'compras@cnorte-demo.vendix.local' },
];

const SUPPLIERS = [
  { name: 'Samsung Electronics Colombia S.A.', tax_id: '860002523-1', contact: 'Carlos Martínez', email: 'ventas.b2b@samsung-demo.vendix.local', code: 'SAM' },
  { name: 'LG Electronics Colombia S.A.S.', tax_id: '830025124-2', contact: 'Diana Ortiz', email: 'mayorista@lg-demo.vendix.local', code: 'LGE' },
  { name: 'Sony Colombia S.A.S.', tax_id: '800123456-3', contact: 'Andrés Castaño', email: 'b2b@sony-demo.vendix.local', code: 'SON' },
  { name: 'Apple Colombia S.A.S.', tax_id: '900234567-4', contact: 'Mónica Pérez', email: 'b2b@apple-demo.vendix.local', code: 'APP' },
  { name: 'Xiaomi Technology Colombia', tax_id: '901345678-5', contact: 'Juan Esteban Rivera', email: 'b2b@xiaomi-demo.vendix.local', code: 'XIA' },
];

export const stage04Parties: Stage = {
  id: '04',
  name: 'Parties',
  description: 'Customers (5 final + 5 B2B), suppliers (5), addresses, supplier_products',
  run: async (ctx: StageContext) => {
    const { prisma, data, rng, log: out } = ctx;
    const orgId = data.organization.id;
    const storeId = data.store.id;
    const customerRole = await prisma.roles.findUnique({ where: { name: 'customer' } });
    if (!customerRole) throw new Error('Customer role not found.');

    const counts: Record<string, number> = {
      customers: 0,
      customersB2B: 0,
      suppliers: 0,
      addresses: 0,
      supplierProducts: 0,
    };

    const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    const createdCustomers: any[] = [];
    const createdSuppliers: any[] = [];

    // === Customers (final consumers) ===
    out('  · Creating 5 final consumers');
    for (let i = 0; i < CUSTOMERS_FINAL.length; i++) {
      const c = CUSTOMERS_FINAL[i]!;
      const code = customerCode('roku', i + 1);
      const username = `roku_cli_${String(i + 1).padStart(3, '0')}`;
      let user = await prisma.users.findUnique({ where: { username } });
      if (!user) {
        user = await prisma.users.create({
          data: {
            email: c.email,
            password: hashedPassword,
            first_name: c.first_name,
            last_name: c.last_name,
            username,
            email_verified: true,
            state: 'active',
            organization_id: orgId,
            main_store_id: storeId,
            document_type: c.type as any,
            document_number: c.document,
            phone: `+57-3${rng.int(1000000, 8999999)}`,
            tax_regime: 'simplified' as any,
            person_type: 'NATURAL' as any,
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      }
      if (!user) continue;
      await prisma.user_roles.createMany({
        data: { user_id: user.id, role_id: customerRole.id },
        skipDuplicates: true,
      });
      await prisma.store_users.upsert({
        where: { store_id_user_id: { store_id: storeId, user_id: user.id } },
        update: {},
        create: { user_id: user.id, store_id: storeId },
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      await prisma.user_settings.upsert({
        where: { user_id: user.id },
        update: {},
        create: {
          user_id: user.id,
          app_type: 'STORE_ECOMMERCE' as any,
          config: {
            panel_ui: { STORE_ECOMMERCE: { profile: true, history: true, dashboard: true, favorites: true, orders: true, settings: true } },
            preferences: { language: 'es', theme: 'default' },
          } as any,
        },
      });
      // Address
      await prisma.addresses.create({
        data: {
          user_id: user.id,
          type: 'home' as any,
          address_line1: `Calle ${rng.int(100, 199)} #${rng.int(45, 99)}-${rng.int(10, 99)}`,
          city: BOGOTA.city,
          state_province: BOGOTA.state_province,
          country_code: BOGOTA.country_code,
          postal_code: BOGOTA.postal_code,
          municipality_code: BOGOTA.municipality_code,
          phone_number: user.phone,
          is_primary: true,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      counts.addresses++;
      createdCustomers.push({ ...user, _code: code });
      counts.customers++;
    }

    // === Customers (B2B) ===
    out('  · Creating 5 B2B customers');
    for (let i = 0; i < CUSTOMERS_B2B.length; i++) {
      const c = CUSTOMERS_B2B[i]!;
      const [first, ...rest] = c.contact.split(' ');
      const last = rest.join(' ');
      const username = `roku_b2b_${String(i + 1).padStart(3, '0')}`;
      let user = await prisma.users.findUnique({ where: { username } });
      if (!user) {
        user = await prisma.users.create({
          data: {
            email: c.email,
            password: hashedPassword,
            first_name: first!,
            last_name: last || c.name,
            username,
            email_verified: true,
            state: 'active',
            organization_id: orgId,
            main_store_id: storeId,
            document_type: 'NIT' as any,
            document_number: c.tax_id.split('-')[0]!,
            phone: `+57-1-${rng.int(4000000, 5999999)}`,
            tax_regime: 'common' as any,
            person_type: 'JURIDICA' as any,
            is_withholding_agent: rng.chance(0.4),
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      }
      if (!user) continue;
      await prisma.user_roles.createMany({
        data: { user_id: user.id, role_id: customerRole.id },
        skipDuplicates: true,
      });
      await prisma.store_users.upsert({
        where: { store_id_user_id: { store_id: storeId, user_id: user.id } },
        update: {},
        create: { user_id: user.id, store_id: storeId },
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      await prisma.addresses.create({
        data: {
          user_id: user.id,
          type: 'business' as any,
          address_line1: `Carrera ${rng.int(7, 100)} #${rng.int(72, 199)}-${rng.int(10, 99)}`,
          address_line2: `Edificio ${c.name.split(' ')[0]}`,
          city: BOGOTA.city,
          state_province: BOGOTA.state_province,
          country_code: BOGOTA.country_code,
          postal_code: BOGOTA.postal_code,
          municipality_code: BOGOTA.municipality_code,
          phone_number: user.phone,
          is_primary: true,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
      counts.addresses++;
      createdCustomers.push({ ...user, _code: customerCode('roku', 100 + i), _isB2B: true });
      counts.customersB2B++;
    }
    data.customers = createdCustomers;

    // === Suppliers ===
    out('  · Creating 5 suppliers');
    for (let i = 0; i < SUPPLIERS.length; i++) {
      const s = SUPPLIERS[i];
      const code = supplierCode('roku', i + 1);
      const supplier = await prisma.suppliers.upsert({
        where: { id: -1 } as any,
        update: {},
        create: {
          organization_id: orgId,
          store_id: storeId,
          name: s.name,
          code,
          contact_person: s.contact,
          email: s.email,
          phone: `+57-1-${rng.int(5000000, 7999999)}`,
          tax_id: s.tax_id.split('-')[0],
          tax_regime: 'common' as any,
          person_type: 'JURIDICA' as any,
          is_self_withholder: false,
          document_type: 'NIT' as any,
          verification_digit: s.tax_id.split('-')[1],
          payment_terms: '30 días',
          currency: CURRENCY,
          lead_time_days: rng.int(5, 21),
          is_active: true,
        } as any,
      }).catch(async () => {
        const existing = await prisma.suppliers.findFirst({
          where: { organization_id: orgId, tax_id: s.tax_id.split('-')[0] },
        });
        if (existing) return existing;
        return prisma.suppliers.create({
          data: {
            organization_id: orgId,
            store_id: storeId,
            name: s.name,
            code,
            contact_person: s.contact,
            email: s.email,
            phone: `+57-1-${rng.int(5000000, 7999999)}`,
            tax_id: s.tax_id.split('-')[0],
            tax_regime: 'common' as any,
            person_type: 'JURIDICA' as any,
            is_self_withholder: false,
            document_type: 'NIT' as any,
            verification_digit: s.tax_id.split('-')[1],
            payment_terms: '30 días',
            currency: CURRENCY,
            lead_time_days: rng.int(5, 21),
            is_active: true,
          },
        });
      });
      createdSuppliers.push(supplier);

      // Supplier address
      await prisma.addresses.create({
        data: {
          organization_id: orgId,
          type: 'commercial' as any,
          address_line1: `Avenida ${rng.int(15, 68)} #${rng.int(45, 99)}-${rng.int(10, 99)}`,
          city: BOGOTA.city,
          state_province: BOGOTA.state_province,
          country_code: BOGOTA.country_code,
          postal_code: BOGOTA.postal_code,
          municipality_code: BOGOTA.municipality_code,
          phone_number: supplier.phone,
          is_primary: false,
        } as any,
      }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });

      counts.suppliers++;
    }
    data.suppliers = createdSuppliers;

    // === Supplier products (4-6 per supplier) ===
    out('  · Linking suppliers to products (4-6 each)');
    for (const supplier of createdSuppliers) {
      const supplierProducts = rng.pickMany(data.products, rng.int(4, 6));
      for (const sp of supplierProducts) {
        const costPerUnit = Number(sp.cost_price ?? 0) * rng.decimal(0.95, 1.05);
        await prisma.supplier_products.upsert({
          where: { supplier_id_product_id: { supplier_id: supplier.id, product_id: sp.id } },
          update: {},
          create: {
            supplier_id: supplier.id,
            product_id: sp.id,
            supplier_sku: `SUP-${supplier.code}-${sp.sku}`,
            cost_per_unit: new Prisma.Decimal(Math.round(costPerUnit)),
            min_order_qty: 5,
            lead_time_days: supplier.lead_time_days,
            is_preferred: rng.chance(0.5),
          } as any,
        }).catch((e: any) => { console.log('    !! ' + String((e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)); return null; });
        counts.supplierProducts++;
      }
    }

    out(`  ✓ Stage 04: ${JSON.stringify(counts)}`);
    return counts;
  },
};
