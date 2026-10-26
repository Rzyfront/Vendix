# Scoped Prisma service caveats

Verified against `apps/backend/src/prisma/services/*.ts`; re-check the getter before relying on it.

`OrganizationPrismaService`:

- Scopes read/update/delete/count/group/aggregate/upsert operations.
- Does not scope `create`/`createMany`.
- `roles` includes org roles plus system roles where `organization_id = null`.
- Some getters return `scoped_client` but are not registered in org model lists; inspect source before assuming scope.
- `organization_payment_policies` is registered but getter currently returns `baseClient`.

`StorePrismaService`:

- Scopes reads/updates/deletes and injects `store_id` on create only for `store_scoped_models`.
- Has direct store models, relational scopes, and org-scoped model lists.
- Several getters intentionally return `baseClient` and require manual scoping, including examples like `users`, `stores`, `audit_logs`, `product_categories`, `customer_queue`, and `invoice_data_requests`.

`EcommercePrismaService`:

- Requires `store_id`; throws if missing.
- Injects `store_id` and user/customer fields on create when model type supports it.
- Some getters return `scoped_client` for models not registered in all model lists; inspect source before relying on automatic scope.
- `review_votes` and `review_reports` currently return `baseClient`.

## Scoped unique operations example

```ts
// Avoid in scoped services when the extension may add tenant filters.
await prisma.store_settings.findUnique({ where: { store_id } });
await prisma.domain_settings.update({ where: { id }, data });

// Prefer scope-safe shapes.
await prisma.store_settings.findFirst({ where: { store_id } });
await prisma.domain_settings.updateMany({
  where: { id, store_id, domain_type: 'ecommerce' },
  data,
});
```

