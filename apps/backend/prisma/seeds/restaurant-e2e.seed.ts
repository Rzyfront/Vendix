import { PrismaClient } from '@prisma/client';
import { getPrismaClient, disconnectPrisma } from './shared/client';
import * as bcrypt from 'bcrypt';

/**
 * QUI-727 — Fixture E2E de restaurante (CP cierre, steps 3 y 4).
 *
 * CREATE-ONLY e IDEMPOTENTE: cada recurso se busca por su clave natural antes
 * de crearlo (findFirst/findUnique + create). Ninguna corrida borra, trunca
 * ni pisa datos existentes ajenos a este fixture. La única excepción es el
 * merge no-destructivo de `store_settings.settings.pos.allow_alias_sales`
 * (punto C), que solo AGREGA esa clave preservando el resto del JSON tal
 * cual estaba.
 *
 * DEPENDENCIES: asume que ya existen (verificado por psql, no se re-crean
 * aquí):
 *   - La organización `roku` (id=6 en el entorno de referencia).
 *   - La tienda `roku` (id=10), con `industries` incluyendo 'restaurant'.
 *   - Los roles de sistema `mesero` y `cocina`
 *     (`permissions-roles.seed.ts`, QUI-727 A.1/F.1).
 *   - Una ubicación de inventario por defecto para la tienda (`stores.default_location_id`).
 *
 * Password para ambos usuarios E2E: '1125634q' (mismo hash bcrypt(10) que
 * `users.seed.ts`).
 */

export interface SeedRestaurantE2EResult {
  organizationId: number;
  storeId: number;
  ingredients: {
    polloCrudoId: number;
    especiasArabesId: number;
  };
  preparedProductId: number;
  variants: {
    picanteId: number;
    noPicanteId: number;
  };
  recipeId: number;
  bankAccounts: {
    organizationLevelId: number;
    storeLevelId: number;
  };
  users: {
    meseroId: number;
    cocinaId: number;
  };
  posAliasSalesEnabled: boolean;
  created: number;
  skipped: number;
}

const DEFAULT_STOCK_QTY = 1000;

export async function seedRestaurantE2E(
  prisma?: PrismaClient,
): Promise<SeedRestaurantE2EResult> {
  const client = prisma || getPrismaClient();

  let created = 0;
  let skipped = 0;

  // ============================================================
  // 0. Resolver organización/tienda/ubicación por defecto (Roku)
  // ============================================================
  const organization = await client.organizations.findUnique({
    where: { slug: 'roku' },
  });
  if (!organization) {
    throw new Error(
      "seedRestaurantE2E: organización 'roku' no encontrada. Corre organizations-stores.seed.ts primero.",
    );
  }

  const store = await client.stores.findUnique({
    where: {
      organization_id_slug: {
        organization_id: organization.id,
        slug: 'roku',
      },
    },
  });
  if (!store) {
    throw new Error(
      "seedRestaurantE2E: tienda 'roku' no encontrada. Corre organizations-stores.seed.ts primero.",
    );
  }
  if (!store.default_location_id) {
    throw new Error(
      `seedRestaurantE2E: la tienda ${store.id} no tiene default_location_id. Corre inventory-locations.seed.ts primero.`,
    );
  }
  const locationId = store.default_location_id;

  // ============================================================
  // A. Fixture de producto: insumos + plato preparado + variantes + receta
  // ============================================================

  // --- A.1 Insumos simples propios del fixture (sin variantes) ---
  async function ensureIngredient(
    slug: string,
    name: string,
  ): Promise<number> {
    let product = await client.products.findFirst({
      where: { store_id: store!.id, slug },
    });
    if (product) {
      console.log(`   ⏭  Skipped ingredient "${name}" (already exists, id=${product.id})`);
      skipped++;
      return product.id;
    }
    product = await client.products.create({
      data: {
        store_id: store!.id,
        name,
        slug,
        description: `Insumo fixture E2E (QUI-727) — ${name}`,
        base_price: 0,
        product_type: 'physical' as any,
        is_sellable: false,
        is_ingredient: true,
        track_inventory: true,
        state: 'active' as any,
      },
    });
    console.log(`   ✅ Created ingredient "${name}" (id=${product.id})`);
    created++;
    return product.id;
  }

  const polloCrudoId = await ensureIngredient('e2e-pollo-crudo', 'E2E Pollo Crudo');
  const especiasArabesId = await ensureIngredient(
    'e2e-especias-arabes',
    'E2E Especias Árabes',
  );

  // --- A.1b Stock inicial de los insumos en la ubicación por defecto ---
  async function ensureStockLevel(productId: number, name: string): Promise<void> {
    // NOTA: `product_variant_id` es nullable y forma parte del @@unique
    // compuesto; Prisma tipa el selector de `findUnique` como no-nulo para
    // ese campo (mismo caso ya documentado para `user_roles`/`roles`), así
    // que usamos `findFirst` con el where explícito — igual que
    // `StockLevelManager.getOrCreateStockLevel` hace internamente.
    const existing = await client.stock_levels.findFirst({
      where: {
        product_id: productId,
        product_variant_id: null,
        location_id: locationId,
      },
    });
    if (existing) {
      console.log(
        `   ⏭  Skipped stock_levels for "${name}" (already exists, id=${existing.id})`,
      );
      skipped++;
      return;
    }
    await client.stock_levels.create({
      data: {
        product_id: productId,
        product_variant_id: null,
        location_id: locationId,
        quantity_on_hand: DEFAULT_STOCK_QTY,
        quantity_reserved: 0,
        quantity_available: DEFAULT_STOCK_QTY,
      },
    });
    // Denormalized mirror — matches the pattern used by other product seeds
    // (products-categories.seed.ts sets stock_quantity directly at seed time;
    // this fixture is CREATE-ONLY so it only writes it once, at creation).
    await client.products.update({
      where: { id: productId },
      data: { stock_quantity: DEFAULT_STOCK_QTY },
    });
    console.log(
      `   ✅ Created stock_levels for "${name}" (qty=${DEFAULT_STOCK_QTY} @ location ${locationId})`,
    );
    created++;
  }

  await ensureStockLevel(polloCrudoId, 'E2E Pollo Crudo');
  await ensureStockLevel(especiasArabesId, 'E2E Especias Árabes');

  // --- A.2 Producto vendible 'prepared' (nombre debe contener 'Pollo') ---
  const preparedSlug = 'pollo-arabe-e2e';
  let preparedProduct = await client.products.findFirst({
    where: { store_id: store.id, slug: preparedSlug },
  });
  if (preparedProduct) {
    console.log(
      `   ⏭  Skipped prepared product "Pollo Árabe E2E" (already exists, id=${preparedProduct.id})`,
    );
    skipped++;
  } else {
    preparedProduct = await client.products.create({
      data: {
        store_id: store.id,
        name: 'Pollo Árabe E2E',
        slug: preparedSlug,
        description: 'Plato preparado fixture E2E (QUI-727) — pollo árabe con receta.',
        base_price: 28000,
        product_type: 'prepared' as any,
        is_sellable: true,
        is_ingredient: false,
        // Los productos 'prepared' consumen inventario vía explosión de
        // receta al disparar a cocina (fire-to-kitchen), no vía su propio
        // stock — track_inventory=false replica el patrón de los demás
        // productos 'prepared' ya sembrados en esta tienda.
        track_inventory: false,
        state: 'active' as any,
      },
    });
    console.log(
      `   ✅ Created prepared product "Pollo Árabe E2E" (id=${preparedProduct.id})`,
    );
    created++;
  }
  const preparedProductId = preparedProduct.id;

  // --- A.3 Exactamente 2 product_variants: Picante / No Picante ---
  async function ensureVariant(
    sku: string,
    name: string,
    attributes: Record<string, string>,
  ): Promise<number> {
    let variant = await client.product_variants.findFirst({
      where: { product_id: preparedProductId, sku },
    });
    if (variant) {
      console.log(`   ⏭  Skipped variant "${name}" (already exists, id=${variant.id})`);
      skipped++;
      return variant.id;
    }
    variant = await client.product_variants.create({
      data: {
        product_id: preparedProductId,
        sku,
        name,
        attributes,
        // price_override=null ⇒ hereda base_price del producto (mismo precio
        // para ambas variantes; solo cambia el picante).
      },
    });
    console.log(`   ✅ Created variant "${name}" (id=${variant.id})`);
    created++;
    return variant.id;
  }

  const picanteId = await ensureVariant('POLLO-ARABE-E2E-PICANTE', 'Picante', {
    spice: 'picante',
  });
  const noPicanteId = await ensureVariant(
    'POLLO-ARABE-E2E-NOPICANTE',
    'No Picante',
    { spice: 'no_picante' },
  );

  // --- A.4 Receta activa + recipe_items (SOLO insumos, sin variantes — ADR-1) ---
  let recipe = await client.recipes.findUnique({
    where: { product_id: preparedProductId },
  });
  if (recipe) {
    console.log(`   ⏭  Skipped recipe for "Pollo Árabe E2E" (already exists, id=${recipe.id})`);
    skipped++;
  } else {
    recipe = await client.recipes.create({
      data: {
        store_id: store.id,
        product_id: preparedProductId,
        yield_quantity: 1,
        yield_unit: 'unit',
        waste_percent: 0,
        is_active: true,
        preparation_notes: 'Receta fixture E2E (QUI-727) — no editar manualmente.',
      },
    });
    console.log(`   ✅ Created recipe for "Pollo Árabe E2E" (id=${recipe.id})`);
    created++;
  }
  const recipeId = recipe.id;

  async function ensureRecipeItem(
    componentProductId: number,
    quantity: number,
    label: string,
  ): Promise<void> {
    const existing = await client.recipe_items.findUnique({
      where: {
        recipe_id_component_product_id: {
          recipe_id: recipeId,
          component_product_id: componentProductId,
        },
      },
    });
    if (existing) {
      console.log(`   ⏭  Skipped recipe_item "${label}" (already exists, id=${existing.id})`);
      skipped++;
      return;
    }
    const item = await client.recipe_items.create({
      data: {
        recipe_id: recipeId,
        component_product_id: componentProductId,
        quantity,
        waste_percent: 0,
      },
    });
    console.log(`   ✅ Created recipe_item "${label}" (id=${item.id})`);
    created++;
  }

  // ADR-1 invariant: los componentes del BOM NUNCA llevan variante — solo el
  // yield (el producto 'prepared') puede tenerlas. component_product_id
  // apunta a los insumos simples (sin variantes) creados arriba.
  await ensureRecipeItem(polloCrudoId, 300, 'E2E Pollo Crudo (300g)');
  await ensureRecipeItem(especiasArabesId, 10, 'E2E Especias Árabes (10g)');

  // ============================================================
  // B. Cuentas bancarias — 2 nuevas en la organización (total activas = 3)
  // ============================================================
  async function ensureBankAccount(
    accountNumber: string,
    name: string,
    storeId: number | null,
  ): Promise<number> {
    const existing = await client.bank_accounts.findUnique({
      where: {
        organization_id_account_number: {
          organization_id: organization!.id,
          account_number: accountNumber,
        },
      },
    });
    if (existing) {
      console.log(`   ⏭  Skipped bank_account "${name}" (already exists, id=${existing.id})`);
      skipped++;
      return existing.id;
    }
    const account = await client.bank_accounts.create({
      data: {
        organization_id: organization!.id,
        store_id: storeId,
        name,
        account_number: accountNumber,
        bank_name: 'Bancolombia',
        currency: 'COP',
        status: 'active' as any,
      },
    });
    console.log(`   ✅ Created bank_account "${name}" (id=${account.id})`);
    created++;
    return account.id;
  }

  const organizationLevelAccountId = await ensureBankAccount(
    '900-100200-01',
    'E2E Cuenta Organización Roku',
    null,
  );
  const storeLevelAccountId = await ensureBankAccount(
    '900-100200-02',
    'E2E Cuenta Tienda Roku',
    store.id,
  );

  // ============================================================
  // C. Settings del POS — merge no-destructivo de allow_alias_sales
  // ============================================================
  const storeSettings = await client.store_settings.findUnique({
    where: { store_id: store.id },
  });
  let posAliasSalesEnabled = false;
  if (!storeSettings) {
    console.log(
      `   ⚠️  store_settings not found for store ${store.id} — skipping allow_alias_sales merge (no destructive create attempted).`,
    );
  } else {
    const currentSettings = (storeSettings.settings as Record<string, any>) || {};
    const currentPos = currentSettings.pos || {};
    if (currentPos.allow_alias_sales === true) {
      console.log('   ⏭  Skipped settings.pos.allow_alias_sales (already true)');
      skipped++;
      posAliasSalesEnabled = true;
    } else {
      const mergedSettings = {
        ...currentSettings,
        pos: {
          ...currentPos,
          allow_alias_sales: true,
        },
      };
      await client.store_settings.update({
        where: { store_id: store.id },
        data: { settings: mergedSettings },
      });
      console.log('   ✅ Set settings.pos.allow_alias_sales = true (rest of JSON untouched)');
      created++;
      posAliasSalesEnabled = true;
    }
  }

  // ============================================================
  // D. Usuarios E2E — mesero / cocina, asignados a la tienda 10
  // ============================================================
  const hashedPassword = await bcrypt.hash('1125634q', 10);

  const meseroRole = await client.roles.findFirst({
    // QUI-730b — renombrado a `waiter`. Si la migración no se aplicó todavía,
    // este findFirst devuelve null y el seed lanza con la guía de re-correrla.
    where: { name: 'waiter', organization_id: null, store_id: null },
  });
  const cocinaRole = await client.roles.findFirst({
    // QUI-730b — renombrado a `kitchen`.
    where: { name: 'kitchen', organization_id: null, store_id: null },
  });
  if (!meseroRole || !cocinaRole) {
    throw new Error(
      // QUI-730b — mensaje de error actualizado con los nombres nuevos.
      "seedRestaurantE2E: roles de sistema 'waiter'/'kitchen' no encontrados. Aplica la migración QUI-730b y corre permissions-roles.seed.ts primero.",
    );
  }

  async function ensureE2EUser(
    username: string,
    email: string,
    firstName: string,
    lastName: string,
    roleId: number,
    roleLabel: string,
  ): Promise<number> {
    let user = await client.users.findUnique({ where: { username } });
    if (user) {
      console.log(`   ⏭  Skipped user "${email}" (already exists, id=${user.id})`);
      skipped++;
    } else {
      user = await client.users.create({
        data: {
          email,
          username,
          password: hashedPassword,
          first_name: firstName,
          last_name: lastName,
          email_verified: true,
          state: 'active' as any,
          organization_id: organization!.id,
          // CRÍTICO para el login: `auth.service.ts:login()` resuelve la
          // tienda de arranque vía main_store_id (Estrategia 1) cuando el
          // usuario no es high-privilege. Sin esto el login con
          // organization_slug termina en AUTH_PERM_001 (huérfano sin tienda
          // resoluble).
          main_store_id: store!.id,
        },
      });
      console.log(`   ✅ Created user "${email}" (id=${user.id})`);
      created++;
    }

    // user_settings — requerido por login() (AUTH_FIND_001 si falta).
    const existingSettings = await client.user_settings.findUnique({
      where: { user_id: user.id },
    });
    if (!existingSettings) {
      await client.user_settings.create({
        data: {
          user_id: user.id,
          app_type: 'STORE_ADMIN' as any,
          config: {
            // QUI-730 — el fixture debe reflejar lo que produce el flujo real
            // de creación de usuarios (`users.service.ts` → `generatePanelUI`),
            // cuyo fallback ya trae `restaurant_ops*` en true. Hardcodear
            // `{dashboard, pos}` dejaba al mesero sin acceso al módulo Mesas,
            // que es justamente donde vive su vista móvil (QUI-735), y eso se
            // leyó como un defecto de producto que no existe fuera del fixture.
            panel_ui: {
              STORE_ADMIN: {
                pos: true,
                dashboard: true,
                restaurant_ops: true,
                restaurant_ops_tables: true,
              },
            },
            preferences: { language: 'es', theme: 'default' },
          },
        },
      });
      console.log(`   ✅ Created user_settings for "${email}"`);
      created++;
    } else {
      console.log(`   ⏭  Skipped user_settings for "${email}" (already exists)`);
      skipped++;
    }

    // store_users — requerido por login() para validar acceso a la tienda
    // (has_access check bajo Estrategia 1 de resolución de main_store_id).
    const existingStoreUser = await client.store_users.findUnique({
      where: {
        store_id_user_id: {
          store_id: store!.id,
          user_id: user.id,
        },
      },
    });
    if (!existingStoreUser) {
      await client.store_users.create({
        data: { store_id: store!.id, user_id: user.id },
      });
      console.log(`   ✅ Linked store_users for "${email}" (store ${store!.id})`);
      created++;
    } else {
      console.log(`   ⏭  Skipped store_users for "${email}" (already linked)`);
      skipped++;
    }

    // user_roles — asignación de rol de OPERACIÓN DE TIENDA (store_id
    // explícito = 10), NO org-wide, siguiendo el patrón QUI-72.
    const existingRoleAssignment = await client.user_roles.findFirst({
      where: { user_id: user.id, role_id: roleId, store_id: store!.id },
    });
    if (!existingRoleAssignment) {
      await client.user_roles.create({
        data: { user_id: user.id, role_id: roleId, store_id: store!.id },
      });
      console.log(`   ✅ Assigned role "${roleLabel}" to "${email}" @ store ${store!.id}`);
      created++;
    } else {
      console.log(`   ⏭  Skipped role assignment "${roleLabel}" for "${email}" (already exists)`);
      skipped++;
    }

    return user.id;
  }

  const meseroId = await ensureE2EUser(
    'mesero.e2e.roku',
    'mesero.e2e@roku.test',
    // QUI-730b — renombrado a `waiter`. El email del usuario seed se conserva
    // para no romper dependencias de tests E2E que referencian este correo.
    'Mesero',
    'E2E',
    meseroRole.id,
    'waiter',
  );
  const cocinaId = await ensureE2EUser(
    'cocina.e2e.roku',
    'cocina.e2e@roku.test',
    // QUI-730b — renombrado a `kitchen`.
    'Cocina',
    'E2E',
    cocinaRole.id,
    'kitchen',
  );

  return {
    organizationId: organization.id,
    storeId: store.id,
    ingredients: { polloCrudoId, especiasArabesId },
    preparedProductId,
    variants: { picanteId, noPicanteId },
    recipeId,
    bankAccounts: {
      organizationLevelId: organizationLevelAccountId,
      storeLevelId: storeLevelAccountId,
    },
    users: { meseroId, cocinaId },
    posAliasSalesEnabled,
    created,
    skipped,
  };
}

// Allow running standalone: NODE_OPTIONS="--max-old-space-size=3072" npx
// ts-node --transpile-only prisma/seeds/restaurant-e2e.seed.ts
if (require.main === module) {
  seedRestaurantE2E()
    .then(async (result) => {
      console.log('✅ Restaurant E2E fixture seed completed');
      console.log(JSON.stringify(result, null, 2));
      await disconnectPrisma();
      process.exit(0);
    })
    .catch(async (e) => {
      console.error('❌ Restaurant E2E fixture seed failed:', e);
      await disconnectPrisma();
      process.exit(1);
    });
}
