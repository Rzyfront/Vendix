import { Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { getPrismaClient, disconnectPrisma } from './shared/client';
import { seedDefaultPuc } from './default-puc.seed';

/**
 * Manufactura (MVP) — tienda demo "Fábrica de mesas".
 *
 * CREATE-ONLY e IDEMPOTENTE: cada recurso se busca por su clave natural
 * (slug, sku, order_number, key...) antes de crearlo. Nunca borra, trunca ni
 * pisa datos existentes.
 *
 * DEPENDENCIES: roles de sistema `owner`
 * (`permissions-roles.seed.ts`). Crea su propia organización y tienda demo
 * (industria `manufacturing`), una bodega por defecto con stock de insumos,
 * la fórmula FOR-MESA-01, la configuración de planta, el consecutivo `OP-` y
 * una orden de producción en borrador (OP-000001).
 *
 * Login demo: owner@fabrica-mesas.co / 1125634q (mismo password que los demás
 * usuarios de demo).
 *
 * Ejecutar standalone (desde apps/backend):
 *   npx ts-node --transpile-only prisma/seeds/manufacturing-demo.seed.ts
 */

export interface SeedManufacturingDemoResult {
  organizationId: number;
  storeId: number;
  locationId: number;
  rawMaterialIds: { maderaId: number; tornillosId: number; barnizId: number };
  finishedProductId: number;
  recipeId: number;
  productionOrderId: number;
  ownerUserId: number;
  created: number;
  skipped: number;
}

const ORG_SLUG = 'fabrica-de-mesas';
const STORE_SLUG = 'fabrica-de-mesas';
const OWNER_EMAIL = 'owner@fabrica-mesas.co';
const OWNER_USERNAME = 'owner.fabrica.mesas';
const FORMULA_CODE = 'FOR-MESA-01';
const PLANNED_QTY = 10;

export async function seedManufacturingDemo(
  prisma?: PrismaClient,
): Promise<SeedManufacturingDemoResult> {
  const client = prisma || getPrismaClient();
  let created = 0;
  let skipped = 0;
  const ok = (msg: string) => {
    console.log(`   ✅ ${msg}`);
    created++;
  };
  const skip = (msg: string) => {
    console.log(`   ⏭  ${msg}`);
    skipped++;
  };

  // 1. Organización
  let organization = await client.organizations.findUnique({
    where: { slug: ORG_SLUG },
  });
  if (!organization) {
    organization = await client.organizations.create({
      data: {
        name: 'Fábrica de mesas',
        slug: ORG_SLUG,
        legal_name: 'Fábrica de mesas S.A.S.',
        email: 'contacto@fabrica-mesas.co',
        description: 'Organización demo de manufactura (muebles).',
        state: 'active' as any,
        // Demo lista para usar: sin esto el owner cae en /admin/onboarding.
        onboarding: true,
      },
    });
    ok(`Created organization "Fábrica de mesas" (id=${organization.id})`);
  } else if (!organization.onboarding) {
    organization = await client.organizations.update({
      where: { id: organization.id },
      data: { onboarding: true },
    });
    ok(`Marked organization onboarding as completed (id=${organization.id})`);
  } else {
    skip(`Skipped organization (already exists, id=${organization.id})`);
  }

  // 2. Tienda con industria manufacturing
  let store = await client.stores.findUnique({
    where: {
      organization_id_slug: {
        organization_id: organization.id,
        slug: STORE_SLUG,
      },
    },
  });
  if (!store) {
    store = await client.stores.create({
      data: {
        name: 'Fábrica de mesas',
        slug: STORE_SLUG,
        organization_id: organization.id,
        store_code: 'FAB-MESAS',
        store_type: 'physical' as any,
        industries: ['manufacturing'] as any,
        timezone: 'America/Bogota',
        is_active: true,
        onboarding: true,
      },
    });
    ok(`Created store "Fábrica de mesas" (id=${store.id})`);
  } else {
    skip(`Skipped store (already exists, id=${store.id})`);
  }
  const storeId = store.id;

  // 2b. store_settings.general.industries: el menú del frontend lee la
  // industria de aquí; sin la fila asume `retail` y oculta Manufactura.
  // Solo se crea la fila o se agrega `manufacturing` a la lista existente.
  const storeSettings = await client.store_settings.findUnique({
    where: { store_id: storeId },
  });
  const currentSettings =
    (storeSettings?.settings as Record<string, any> | null) ?? {};
  const currentGeneral: Record<string, any> = currentSettings.general ?? {};
  const currentIndustries: string[] = Array.isArray(currentGeneral.industries)
    ? currentGeneral.industries
    : [];
  if (currentIndustries.includes('manufacturing')) {
    skip('Skipped store_settings (industria manufacturing ya configurada)');
  } else {
    const nextSettings = {
      ...currentSettings,
      general: {
        timezone: 'America/Bogota',
        currency: 'COP',
        language: 'es',
        tax_included: false,
        ...currentGeneral,
        industries: [...currentIndustries, 'manufacturing'],
      },
    };
    await client.store_settings.upsert({
      where: { store_id: storeId },
      update: { settings: nextSettings, updated_at: new Date() },
      create: { store_id: storeId, settings: nextSettings },
    });
    ok('Configured store_settings.general.industries = manufacturing');
  }

  // 3. Bodega por defecto
  let location = await client.inventory_locations.findFirst({
    where: { organization_id: organization.id, store_id: storeId, code: 'BOD-PLANTA' },
  });
  if (!location) {
    location = await client.inventory_locations.create({
      data: {
        organization_id: organization.id,
        store_id: storeId,
        name: 'Bodega de planta',
        code: 'BOD-PLANTA',
        type: 'warehouse' as any,
        is_default: true,
        is_active: true,
      },
    });
    ok(`Created location "Bodega de planta" (id=${location.id})`);
  } else {
    skip(`Skipped location (already exists, id=${location.id})`);
  }
  const locationId = location.id;
  if (!store.default_location_id) {
    await client.stores.update({
      where: { id: storeId },
      data: { default_location_id: locationId },
    });
    ok('Linked default_location_id on store');
  }

  // 4. Insumos con stock y costo
  async function ensureProduct(
    slug: string,
    sku: string,
    name: string,
    opts: {
      productType: string;
      isIngredient: boolean;
      isSellable: boolean;
      cost: number;
      price: number;
      stock?: number;
    },
  ): Promise<number> {
    let product = await client.products.findFirst({
      where: { store_id: storeId, slug },
    });
    if (product) {
      skip(`Skipped product "${name}" (already exists, id=${product.id})`);
    } else {
      product = await client.products.create({
        data: {
          store_id: storeId,
          name,
          slug,
          sku,
          description: `Demo de manufactura — ${name}`,
          base_price: opts.price,
          cost_price: opts.cost,
          product_type: opts.productType as any,
          is_sellable: opts.isSellable,
          is_ingredient: opts.isIngredient,
          track_inventory: true,
          state: 'active' as any,
        },
      });
      ok(`Created product "${name}" (id=${product.id})`);
    }
    if (opts.stock !== undefined) {
      const level = await client.stock_levels.findFirst({
        where: {
          product_id: product.id,
          product_variant_id: null,
          location_id: locationId,
        },
      });
      if (level) {
        skip(`Skipped stock_levels for "${name}" (already exists)`);
      } else {
        await client.stock_levels.create({
          data: {
            product_id: product.id,
            product_variant_id: null,
            location_id: locationId,
            quantity_on_hand: opts.stock,
            quantity_reserved: 0,
            quantity_available: opts.stock,
            cost_per_unit: opts.cost,
          },
        });
        await client.products.update({
          where: { id: product.id },
          data: { stock_quantity: opts.stock },
        });
        ok(`Created stock_levels for "${name}" (qty=${opts.stock}, costo=${opts.cost})`);
      }
    }
    return product.id;
  }

  const maderaId = await ensureProduct('madera-pino', 'MP-MADERA', 'Madera de pino (tabla)', {
    productType: 'physical',
    isIngredient: true,
    isSellable: false,
    cost: 45000,
    price: 0,
    stock: 100,
  });
  const tornillosId = await ensureProduct('tornillos', 'MP-TORNILLO', 'Tornillos', {
    productType: 'physical',
    isIngredient: true,
    isSellable: false,
    cost: 150,
    price: 0,
    stock: 2000,
  });
  const barnizId = await ensureProduct('barniz', 'MP-BARNIZ', 'Barniz (litro)', {
    productType: 'physical',
    isIngredient: true,
    isSellable: false,
    cost: 28000,
    price: 0,
    stock: 50,
  });

  // 5. Producto terminado (sin stock inicial: lo produce la OP)
  const mesaId = await ensureProduct('mesa-comedor', 'PT-MESA-COMEDOR', 'Mesa comedor', {
    productType: 'manufactured',
    isIngredient: false,
    isSellable: true,
    cost: 0,
    price: 650000,
  });

  // 6. Fórmula FOR-MESA-01 v1 activa (3 componentes con merma)
  let recipe = await client.recipes.findFirst({
    where: { store_id: storeId, product_id: mesaId, product_variant_id: null },
  });
  if (!recipe) {
    recipe = await client.recipes.create({
      data: {
        store_id: storeId,
        product_id: mesaId,
        yield_quantity: 1,
        yield_unit: 'unit',
        waste_percent: 0,
        is_active: true,
        code: FORMULA_CODE,
        version: 1,
        status: 'active',
        preparation_notes: 'Fórmula demo de manufactura — mesa de comedor.',
      },
    });
    ok(`Created formula ${FORMULA_CODE} (id=${recipe.id})`);
  } else {
    skip(`Skipped formula (already exists, id=${recipe.id})`);
  }
  const recipeId = recipe.id;

  const components: Array<[number, number, number, string]> = [
    [maderaId, 4, 5, 'Madera'],
    [tornillosId, 24, 2, 'Tornillos'],
    [barnizId, 0.5, 10, 'Barniz'],
  ];
  for (const [componentId, quantity, waste, label] of components) {
    const item = await client.recipe_items.findUnique({
      where: {
        recipe_id_component_product_id: {
          recipe_id: recipeId,
          component_product_id: componentId,
        },
      },
    });
    if (item) {
      skip(`Skipped recipe_item "${label}" (already exists)`);
      continue;
    }
    await client.recipe_items.create({
      data: {
        recipe_id: recipeId,
        component_product_id: componentId,
        quantity,
        waste_percent: waste,
      },
    });
    ok(`Created recipe_item "${label}" (${quantity}, merma ${waste}%)`);
  }

  // 6b. PUC: el asiento automático de production.completed necesita las
  // cuentas (p. ej. 1435) de la organización. seedDefaultPuc es idempotente.
  const puc = await seedDefaultPuc(organization.id, client);
  console.log(`   ✅ PUC sincronizado (${JSON.stringify(puc)})`);

  // 7. Configuración de planta
  const settings = await client.manufacturing_settings.findUnique({
    where: { store_id: storeId },
  });
  if (settings) {
    skip('Skipped manufacturing_settings (already exists)');
  } else {
    await client.manufacturing_settings.create({
      data: {
        store_id: storeId,
        default_input_location_id: locationId,
        default_output_location_id: locationId,
        cost_method: 'fifo',
        lot_required: false,
      },
    });
    ok('Created manufacturing_settings');
  }

  // 7b. Suscripción de prueba: sin ella el StoreOperationsGuard bloquea las
  // escrituras (crear/lanzar/completar OP) de la tienda demo. Solo se crea si
  // la tienda no tiene registro; nunca se pisa una suscripción existente.
  const subscription = await client.store_subscriptions.findUnique({
    where: { store_id: storeId },
  });
  if (subscription) {
    skip('Skipped store_subscriptions (already exists)');
  } else {
    const trialPlan = await client.subscription_plans.findFirst({
      where: { code: 'trial-default' },
    });
    if (!trialPlan) {
      skip('Skipped store_subscriptions (plan trial-default no existe)');
    } else {
      const now = new Date();
      const trialEnds = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      await client.store_subscriptions.create({
        data: {
          store_id: storeId,
          plan_id: trialPlan.id,
          state: 'trial',
          started_at: now,
          trial_ends_at: trialEnds,
          current_period_start: now,
          current_period_end: trialEnds,
          next_billing_at: trialEnds,
          effective_price: 0,
          vendix_base_price: 0,
          currency: trialPlan.currency,
          auto_renew: true,
          // Mismo contrato que SubscriptionTrialService.createTrialForStore.
          resolved_features:
            (trialPlan.ai_feature_flags as Prisma.InputJsonValue) ??
            Prisma.JsonNull,
          resolved_at: now,
        },
      });
      ok('Created store_subscriptions (trial 30 días)');
    }
  }

  // 8. Consecutivo OP- (next_number solo se fija al crear; la app lo avanza)
  const orderNumber = 'OP-000001';
  let order = await client.production_orders.findUnique({
    where: { store_id_order_number: { store_id: storeId, order_number: orderNumber } },
  });
  const sequence = await client.store_sequences.findUnique({
    where: { store_id_key: { store_id: storeId, key: 'production_order' } },
  });
  if (sequence) {
    skip('Skipped store_sequences production_order (already exists)');
  } else {
    await client.store_sequences.create({
      data: {
        store_id: storeId,
        key: 'production_order',
        prefix: 'OP-',
        next_number: 2,
      },
    });
    ok('Created store_sequences production_order (prefix OP-)');
  }

  // 9. Usuario owner de la tienda demo
  const ownerRole = await client.roles.findFirst({
    where: { name: 'owner', organization_id: null },
  });
  if (!ownerRole) {
    throw new Error(
      "seedManufacturingDemo: rol de sistema 'owner' no encontrado. Corre permissions-roles.seed.ts primero.",
    );
  }
  let owner = await client.users.findUnique({ where: { username: OWNER_USERNAME } });
  if (!owner) {
    owner = await client.users.create({
      data: {
        email: OWNER_EMAIL,
        username: OWNER_USERNAME,
        password: await bcrypt.hash('1125634q', 10),
        first_name: 'Jefe',
        last_name: 'Planta',
        email_verified: true,
        state: 'active' as any,
        organization_id: organization.id,
        main_store_id: storeId,
      },
    });
    ok(`Created user "${OWNER_EMAIL}" (id=${owner.id})`);
  } else {
    skip(`Skipped user "${OWNER_EMAIL}" (already exists, id=${owner.id})`);
  }
  const ownerId = owner.id;

  const userSettings = await client.user_settings.findUnique({
    where: { user_id: ownerId },
  });
  if (!userSettings) {
    await client.user_settings.create({
      data: {
        user_id: ownerId,
        app_type: 'STORE_ADMIN' as any,
        config: {
          panel_ui: {
            STORE_ADMIN: {
              dashboard: true,
              products: true,
              products_list: true,
              inventory: true,
              inventory_locations: true,
              inventory_movements: true,
              manufacturing: true,
              manufacturing_formulas: true,
              manufacturing_orders: true,
              manufacturing_settings: true,
            },
          },
          preferences: { language: 'es', theme: 'default' },
        },
      },
    });
    ok('Created user_settings (panel_ui con Manufactura)');
  } else {
    skip('Skipped user_settings (already exists)');
  }

  const storeUser = await client.store_users.findUnique({
    where: { store_id_user_id: { store_id: storeId, user_id: ownerId } },
  });
  if (!storeUser) {
    await client.store_users.create({ data: { store_id: storeId, user_id: ownerId } });
    ok('Linked store_users');
  } else {
    skip('Skipped store_users (already linked)');
  }

  const roleAssignment = await client.user_roles.findFirst({
    where: { user_id: ownerId, role_id: ownerRole.id },
  });
  if (!roleAssignment) {
    await client.user_roles.create({
      data: { user_id: ownerId, role_id: ownerRole.id },
    });
    ok('Assigned role "owner"');
  } else {
    skip('Skipped role assignment (already exists)');
  }

  // 10. Orden de producción en borrador OP-000001 con líneas planificadas
  if (!order) {
    order = await client.production_orders.create({
      data: {
        store_id: storeId,
        product_id: mesaId,
        recipe_id: recipeId,
        planned_qty: PLANNED_QTY,
        status: 'draft' as any,
        order_number: orderNumber,
        priority: 'normal',
        source: 'manual',
        location_id: locationId,
        created_by: ownerId,
        notes: 'Orden demo de manufactura.',
      },
    });
    ok(`Created production order ${orderNumber} (id=${order.id})`);
  } else {
    skip(`Skipped production order ${orderNumber} (already exists, id=${order.id})`);
  }

  // Cantidad planificada = cantidad × (1 + merma) × (unidades / rendimiento)
  let sortOrder = 0;
  for (const [componentId, quantity, waste, label] of components) {
    sortOrder++;
    const line = await client.production_order_lines.findFirst({
      where: { order_id: order.id, component_product_id: componentId },
    });
    if (line) {
      skip(`Skipped order line "${label}" (already exists)`);
      continue;
    }
    const planned = +(quantity * (1 + waste / 100) * PLANNED_QTY).toFixed(4);
    await client.production_order_lines.create({
      data: {
        order_id: order.id,
        component_product_id: componentId,
        planned_qty: planned,
        consumed_qty: 0,
        sort_order: sortOrder,
      },
    });
    ok(`Created order line "${label}" (planificado=${planned})`);
  }

  return {
    organizationId: organization.id,
    storeId,
    locationId,
    rawMaterialIds: { maderaId, tornillosId, barnizId },
    finishedProductId: mesaId,
    recipeId,
    productionOrderId: order.id,
    ownerUserId: ownerId,
    created,
    skipped,
  };
}

// Standalone: npx ts-node --transpile-only prisma/seeds/manufacturing-demo.seed.ts
if (require.main === module) {
  seedManufacturingDemo()
    .then(async (result) => {
      console.log('✅ Manufacturing demo seed completed');
      console.log(JSON.stringify(result, null, 2));
      await disconnectPrisma();
      process.exit(0);
    })
    .catch(async (e) => {
      console.error('❌ Manufacturing demo seed failed:', e);
      await disconnectPrisma();
      process.exit(1);
    });
}
