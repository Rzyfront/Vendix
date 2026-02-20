---
name: vendix-prisma-scopes
description: >
  Multi-tenant Prisma scoping system: BasePrismaService, domain-specific scoped services,
  model registration, and withoutScope() usage rules.
  Trigger: When working with Prisma scoped services, adding models to scopes, or debugging
  Forbidden/Unauthorized errors in database queries.
metadata:
  author: vendix
  version: "2.0"
  scope: [root, backend]
  auto_invoke:
    - "Working with Prisma scoped services"
    - "Adding new models to domain scopes"
    - "Debugging Forbidden errors in Prisma queries"
---

# Vendix Prisma Scopes

> **Multi-Tenant Data Isolation** - Automatic query filtering via Prisma Client Extensions per domain.

## Core Architecture

Vendix implements automatic multi-tenant data isolation through **4 domain-specific Prisma services**, each built on a shared `BasePrismaService`. Every service uses **Prisma Client Extensions** to intercept queries and inject security filters transparently.

```
apps/backend/src/prisma/
├── base/
│   └── base-prisma.service.ts          # Abstract base (PrismaClient + withoutScope)
├── services/
│   ├── global-prisma.service.ts        # No scoping (superadmin)
│   ├── organization-prisma.service.ts  # organization_id scoping
│   ├── store-prisma.service.ts         # store_id + org_id scoping
│   └── ecommerce-prisma.service.ts     # store_id + user_id scoping
├── prisma.module.ts                    # Global module registration
└── README.md
```

---

## BasePrismaService

**File:** `base/base-prisma.service.ts`

Abstract base that all domain services extend. Provides the raw `PrismaClient` and the `withoutScope()` escape hatch.

```typescript
@Injectable()
export abstract class BasePrismaService implements OnModuleInit {
  protected readonly baseClient: PrismaClient;

  constructor() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
    const adapter = new PrismaPg(pool);
    this.baseClient = new PrismaClient({ adapter, log: ['error', 'warn'] });
  }

  async onModuleInit() {
    await this.baseClient.$connect();
  }

  /**
   * Escape hatch: raw PrismaClient sin scope.
   * SOLO para jobs, seeders, migraciones. NUNCA en request handlers.
   */
  withoutScope() {
    return this.baseClient;
  }
}
```

---

## The 4 Domain Scoped Services

### 1. GlobalPrismaService (No Scoping)

**Use:** Superadmin operations, cross-tenant access.

- All getters return `this.baseClient.model` directly (no filtering).
- No context validation - allows unrestricted access.

```typescript
constructor(private readonly prisma: GlobalPrismaService) {}

// Returns ALL users across ALL organizations
async getAllUsers() {
  return this.prisma.users.findMany();
}
```

### 2. OrganizationPrismaService (organization_id Scope)

**Use:** Organization admin panel (`ORG_ADMIN`), managing users/stores/suppliers within an org.

**Scoped models:** `users`, `stores`, `suppliers`, `addresses`, `audit_logs`, `roles`, `organization_settings`, `domain_settings`, `inventory_locations`, `inventory_movements`, `inventory_adjustments`, `stock_reservations`, `purchase_orders`, `sales_orders`, `stock_transfers`, `return_orders`, `organization_payment_policies`

**Special case:** `roles` uses `OR` filter to include both org-specific roles AND system roles (`organization_id = null`).

```typescript
constructor(private readonly prisma: OrganizationPrismaService) {}

// Automatically filtered by organization_id
async getOrgUsers() {
  return this.prisma.users.findMany(); // WHERE organization_id = ctx.organization_id
}
```

### 3. StorePrismaService (store_id + org_id Scope)

**Use:** Store admin panel (`STORE_ADMIN`), POS, inventory, orders.

This is the **most complex** service with 3 levels of scoping:

#### a) Store-Scoped Models (direct `store_id` filter)
`store_users`, `store_settings`, `inventory_locations`, `categories`, `tax_categories`, `products`, `tax_rates`, `orders`, `store_payment_methods`, `addresses`, `domain_settings`, `shipping_zones`, `shipping_methods`, `expenses`

#### b) Relational-Scoped Models (filter via parent relation)
`stock_levels` → via `inventory_locations.store_id`
`inventory_batches` → via `inventory_locations.store_id`
`product_variants` → via `products.store_id`
`order_items` → via `orders.store_id`
`payments` → via `orders.store_id`
`product_images` → via `products.store_id`
`shipping_rates` → via `shipping_zone.store_id`
`product_tax_assignments` → via `products.store_id`
`sales_order_items` → via `sales_orders.organization_id` (org scope)
`refunds` → via `orders.store_id`
`inventory_adjustments` → via `inventory_locations.store_id`
`stock_reservations` → via `inventory_locations.store_id`
`purchase_orders` → via `location.store_id`
`inventory_movements` → via `OR` on `products`, `from_location`, `to_location`
`inventory_transactions` → via `products.store_id`

#### c) Org-Scoped Models (filter via `organization_id`)
`suppliers`, `stock_transfers`, `sales_orders`, `return_orders`, `expense_categories`

#### d) Global Models (no scoping, via `baseClient`)
`organizations`, `brands`, `product_categories`, `system_payment_methods`, `users`, `stores`, `audit_logs`, `default_templates`

```typescript
constructor(private readonly prisma: StorePrismaService) {}

// Automatically filtered by store_id
async getProducts() {
  return this.prisma.products.findMany(); // WHERE store_id = ctx.store_id
}
```

### 4. EcommercePrismaService (store_id + user_id Scope)

**Use:** Customer-facing e-commerce (`STORE_ECOMMERCE`).

#### a) Store-Only Models
`products`, `categories`, `store_payment_methods`, `store_settings`, `inventory_locations`, `tax_categories`, `tax_rates`, `legal_documents`

#### b) Store + User Models (adds `user_id` or `customer_id`)
`carts`, `wishlists`, `orders` (uses `customer_id`), `addresses`

#### c) Customer-Only Models (no `store_id`, inherits via relation)
`payments` (uses `customer_id`)

```typescript
constructor(private readonly prisma: EcommercePrismaService) {}

// Filtered by store_id AND customer_id
async getMyOrders() {
  return this.prisma.orders.findMany(); // WHERE store_id = ? AND customer_id = ?
}
```

---

## How Scoping Works Internally

Each service uses **Prisma Client Extensions** to intercept ALL queries on registered models:

```typescript
private setupStoreScoping() {
  const extensions = this.createStoreQueryExtensions();
  this.scoped_client = this.baseClient.$extends({ query: extensions });
}
```

Operations intercepted: `findUnique`, `findFirst`, `findMany`, `count`, `update`, `updateMany`, `delete`, `deleteMany`, `create`, `createMany`.

- **Read/Update/Delete**: Adds filter to `where` clause.
- **Create/CreateMany**: Injects `store_id`/`organization_id` into `data`.
- **Getters**: Scoped models return `this.scoped_client.model`, global models return `this.baseClient.model`.

---

## Module Registration

**File:** `prisma.module.ts`

```typescript
@Module({
  providers: [
    GlobalPrismaService,
    OrganizationPrismaService,
    StorePrismaService,
    EcommercePrismaService,
    RequestContextService,
    AccessValidationService,
  ],
  exports: [
    GlobalPrismaService,
    OrganizationPrismaService,
    StorePrismaService,
    EcommercePrismaService,
    RequestContextService,
    AccessValidationService,
  ],
})
export class PrismaModule {}
```

**Note:** `PrismaModule` is NOT `@Global()`. Import it in each domain module that needs it.

---

## Which Service to Use per Domain

| Backend Domain | Prisma Service | Scope Level |
|---|---|---|
| `domains/superadmin/` | `GlobalPrismaService` | None (full access) |
| `domains/organization/` | `OrganizationPrismaService` | `organization_id` |
| `domains/store/` | `StorePrismaService` | `store_id` + `organization_id` |
| `domains/ecommerce/` | `EcommercePrismaService` | `store_id` + `user_id` |
| `domains/public/` | `GlobalPrismaService` | None (read-only public) |
| Background jobs / Seeders | Any service + `withoutScope()` | None |

---

## CRITICAL RULE: Model Registration Plan

When adding a new Prisma model or needing database access in a domain, you **MUST** plan model registration in the corresponding scoped Prisma service **BEFORE** writing service logic.

### The Checklist

1. **Identify the domain** where the model will be used (store, organization, ecommerce, global).
2. **Determine the scope type**:
   - Does the model have `store_id`? → Register in `store_scoped_models` array.
   - Does the model have `organization_id`? → Register in `org_scoped_models` array.
   - Does the model relate to a scoped parent without its own `store_id`/`org_id`? → Register in `relational_scopes` with the correct parent filter.
   - Is it global? → Expose via `baseClient` getter only.
3. **Add getter** in the scoped service (scoped or global depending on step 2).
4. **Verify Create operations**: If the model has `store_id`, `create`/`createMany` will auto-inject it. If not, ensure the relation chain provides isolation.
5. **Test** that queries return only tenant-scoped data.

### Example: Adding a `coupons` model to StorePrismaService

```typescript
// Step 1: coupons has store_id → add to store_scoped_models array
private readonly store_scoped_models = [
  'store_users',
  'store_settings',
  // ... existing models ...
  'coupons',  // ← NEW
];

// Step 2: Also add to all_scoped_models in createStoreQueryExtensions
const all_scoped_models = [
  ...this.store_scoped_models,
  // ... existing relational models ...
];

// Step 3: Add getter
get coupons() {
  return this.scoped_client.coupons;
}
```

### Example: Adding a `coupon_usages` model (relational, no store_id)

```typescript
// Step 1: coupon_usages has NO store_id, but relates to coupons.store_id
// Add to all_scoped_models AND relational_scopes

const all_scoped_models = [
  ...this.store_scoped_models,
  'coupon_usages',  // ← NEW (relational)
];

// Step 2: Define relational scope
const relational_scopes: Record<string, any> = {
  // ... existing ...
  coupon_usages: { coupons: { store_id: context.store_id } },  // ← NEW
};

// Step 3: Add getter
get coupon_usages() {
  return this.scoped_client.coupon_usages;
}
```

### Anti-Pattern: Using withoutScope() to Bypass Missing Registration

```typescript
// ❌ WRONG: Model not registered, bypassing scope
async findCoupons() {
  return this.prisma.withoutScope().coupons.findMany({
    where: { store_id: context.store_id },
  });
}

// ✅ CORRECT: Register model in scope, then use naturally
async findCoupons() {
  return this.prisma.coupons.findMany(); // Scope auto-applied
}
```

**`withoutScope()` is ONLY acceptable for (requires user approval):**
- Background jobs / cron tasks (no request context)
- Database seeders and migrations
- Cross-tenant analytics (superadmin)
- One-time scripts

**The agent MUST ask the user before using `withoutScope()`** - scoped access is always the default and mandatory approach.

---

## MANDATORY: Scopes Are Required

Scoped Prisma services are **mandatory** for all database operations within a domain. The agent MUST:

1. **Always use the scoped service** matching the domain (StorePrismaService for store, etc.).
2. **Always register new models** in the scoped service before using them.
3. **NEVER use `withoutScope()`** unless strictly necessary AND explicitly approved by the user.
4. If `withoutScope()` seems needed, **ask the user first** before implementing it.

### withoutScope() Rules

`withoutScope()` bypasses ALL tenant isolation. It is a **security escape hatch** that requires user approval.

```typescript
// ❌ NEVER in request handlers - FORBIDDEN
async handleRequest() {
  return this.prisma.withoutScope().products.findMany(); // DATA LEAK RISK
}

// ⚠️ REQUIRES USER APPROVAL - Ask before implementing
async cronJob() {
  // Only if no request context exists AND user approved
  const allProducts = await this.prisma.withoutScope().products.findMany();
}

// ✅ Better alternative for cross-tenant access: use GlobalPrismaService
constructor(private readonly prisma: GlobalPrismaService) {}
async adminOperation() {
  return this.prisma.products.findMany(); // No scope, but semantically correct
}
```

**When the agent encounters a situation where `withoutScope()` seems necessary:**
1. Stop and explain WHY scope can't be used.
2. Propose alternatives (GlobalPrismaService, model registration, etc.).
3. Only proceed with `withoutScope()` if the user explicitly approves.

---

## Best Practices

### 1. Always Use the Correct Scoped Service

```typescript
// ✅ Store domain → StorePrismaService
constructor(private readonly prisma: StorePrismaService) {}

// ❌ Store domain using Organization service
constructor(private readonly prisma: OrganizationPrismaService) {}

// ❌ Using GlobalPrismaService in a tenant context
constructor(private readonly prisma: GlobalPrismaService) {}
```

### 2. Never Mix Scoped Services in One Module

```typescript
// ❌ WRONG: Two scoped services in one service
constructor(
  private readonly storePrisma: StorePrismaService,
  private readonly orgPrisma: OrganizationPrismaService,
) {}

// ✅ CORRECT: One scoped service per domain service
constructor(private readonly prisma: StorePrismaService) {}
```

### 3. Trust the Scope - Don't Double Filter

```typescript
// ❌ WRONG: Redundant manual filtering
async findProducts() {
  const context = RequestContextService.getContext();
  return this.prisma.products.findMany({
    where: { store_id: context.store_id },  // Already applied by scope!
  });
}

// ✅ CORRECT: Let the scope handle it
async findProducts() {
  return this.prisma.products.findMany(); // store_id auto-injected
}
```

### 4. Use organizationWhere / storeWhere for Manual Queries

When you need to compose custom where clauses on unscoped models:

```typescript
// For models accessed via baseClient that need manual filtering
const context_filter = this.prisma.storeWhere; // { organization_id, store_id }
```

---

## Troubleshooting

### ForbiddenException: "Access denied - store context required"

1. Model is registered in scope but no `store_id` in context.
2. Check that `DomainResolverMiddleware` resolved the domain.
3. Check `x-store-id` header (dev) or hostname (prod).

### UnauthorizedException: "Unauthorized access - no request context"

1. No `AsyncLocalStorage` context. Background job?
2. Use `withoutScope()` or `GlobalPrismaService`.

### Model Not Filtered (data leak)

1. Model not registered in `store_scoped_models` or `all_scoped_models`.
2. No getter returning `this.scoped_client.model`.
3. Getter accidentally returns `this.baseClient.model`.

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `base/base-prisma.service.ts` | Abstract base with `withoutScope()` |
| `services/global-prisma.service.ts` | Superadmin (no scope) |
| `services/organization-prisma.service.ts` | Org-level scope |
| `services/store-prisma.service.ts` | Store-level scope (most complex) |
| `services/ecommerce-prisma.service.ts` | Ecommerce scope (store + user) |
| `prisma.module.ts` | Module registration |

## Related Skills

- `vendix-multi-tenant-context` - How context flows from Middleware → AsyncLocalStorage
- `vendix-prisma-schema` - Schema editing patterns
- `vendix-prisma` - ORM basics (migrations, seeding, client)
- `vendix-backend-domain` - Hexagonal domain architecture
- `vendix-naming-conventions` - Naming conventions (CRITICAL)
