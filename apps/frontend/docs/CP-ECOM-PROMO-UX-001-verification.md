# CP-ECOM-PROMO-UX-001 — Verification Document

**Plan:** `CP-ECOM-PROMO-UX-001` (Promotion UX polish + observability)
**Branch:** `dev`
**Checkpoint:** `checkpoint/parallel-cp-ecom-promo-ux-001`
**Date:** 2026-08-20
**Phases covered:** A.1 → F.2 (9 commits) + G.1+G.2 (this commit) = **10 commits**
**Final commit:** `feat(frontend): analytics events on promotion-stack + E2E verification doc (CP-ECOM-PROMO-UX-001 G.1-G.2)`

> Note: the plan brief refers to "11 commits" because G.1 and G.2 were
> scoped as two sub-steps; in practice they ship as a single commit on
> `dev` (this one). The remaining 9 are the historical A→F series.

---

## 1. Commits in the plan (10 total)

| # | SHA | Message |
|---|-----|---------|
| 1 | `1c651c30d` | `feat(promotions): expose full tier ladder on ActiveProductPromotion (CP-ECOM-PROMO-UX-001 A.1)` |
| 2 | `4d8a267c2` | `feat(promotion-engine): add getTierLaddersForQuote for per-product tier ladder (CP-ECOM-PROMO-UX-001 A.2-engine)` |
| 3 | `f6563c7d1` | `feat(cart): emit per_product_tier_ladder on cart + cart-summary (CP-ECOM-PROMO-UX-001 A.2-cart)` |
| 4 | `3aa7a655d` | `feat(ecommerce-promotions): strict-typed ActiveStorePromotion with quantity_tiers + promotion_type_label (CP-ECOM-PROMO-UX-001 A.3)` |
| 5 | `1543aa7f5` | `feat(frontend): add app-promotion-stack shared component with 3 modes (CP-ECOM-PROMO-UX-001 B.1-B.4)` |
| 6 | `f3d596284` | `feat(frontend): add catalog promo banner + multi-tier pills on product card (CP-ECOM-PROMO-UX-001 C.1-C.2)` |
| 7 | `7113ec51f` | `feat(frontend): detail page tier ladder + frontend interface extends for tiers (CP-ECOM-PROMO-UX-001 D + C-fix)` |
| 8 | `465d01ec9` | `feat(frontend): wrap cart-promotions to promotion-stack + per-item tier progress bar (CP-ECOM-PROMO-UX-001 E.1-E.2)` |
| 9 | `af23b17eb` | `feat(frontend): checkout total = promotional_subtotal + scope icons + Cart.per_product_tier_ladder (CP-ECOM-PROMO-UX-001 F.1-F.2 + E-fix)` |
| 10 | `<this-commit>` | `feat(frontend): analytics events on promotion-stack + E2E verification doc (CP-ECOM-PROMO-UX-001 G.1-G.2)` |

---

## 2. Files modified by phase

### A — Backend contracts (typed promotion ladder)
- `apps/backend/src/domains/store/promotions/dto/promotion-quote.interface.ts` (A.1)
- `apps/backend/src/domains/store/promotions/promotion-engine/promotion-engine.service.ts` (A.1, A.2-engine)
- `apps/backend/src/domains/ecommerce/cart/cart.service.ts` (A.2-cart)
- `apps/backend/src/domains/ecommerce/promotions/ecommerce-promotions.controller.ts` (A.3)
- `apps/backend/src/domains/ecommerce/promotions/ecommerce-promotions.service.ts` (A.3)

### B — Shared presentation component
- `apps/frontend/src/app/shared/components/index.ts` (B.1 export)
- `apps/frontend/src/app/shared/components/promotion-stack/promotion-stack.component.ts` (B.1-B.4 + G.1)
- `apps/frontend/src/app/shared/components/promotion-stack/promotion-stack.component.html` (B.1-B.4 + G.1)
- `apps/frontend/src/app/shared/components/promotion-stack/promotion-stack.component.scss` (B.1-B.4)

### C — Catalog + product card
- `apps/frontend/src/app/private/modules/ecommerce/pages/catalog/catalog.component.ts` (C.1)
- `apps/frontend/src/app/private/modules/ecommerce/pages/catalog/catalog.component.html` (C.1)
- `apps/frontend/src/app/private/modules/ecommerce/pages/catalog/catalog.component.scss` (C.1)
- `apps/frontend/src/app/private/modules/ecommerce/components/product-card/product-card.component.ts` (C.2)

### D — PDP tier ladder
- `apps/frontend/src/app/private/modules/ecommerce/pages/product-detail/product-detail.component.ts` (D)
- `apps/frontend/src/app/private/modules/ecommerce/services/catalog.service.ts` (D + C-fix)

### E — Cart + per-item tier progress
- `apps/frontend/src/app/private/modules/ecommerce/components/cart-promotions/cart-promotions.component.ts` (E.1)
- `apps/frontend/src/app/private/modules/ecommerce/components/cart-item-card/cart-item-card.component.ts` (E.2)

### F — Checkout total + scope icons
- `apps/frontend/src/app/private/modules/ecommerce/pages/checkout/checkout.component.ts` (F.1)
- `apps/frontend/src/app/private/modules/ecommerce/pages/checkout/checkout.component.html` (F.1)
- `apps/frontend/src/app/private/modules/ecommerce/services/cart.service.ts` (F.2 + E-fix)

### G.1 — Analytics events on promotion-stack (this commit)
- `apps/frontend/src/app/shared/components/promotion-stack/promotion-stack.component.ts` (added `output()`s, `IntersectionObserver`, `effect()`-based tier crossing)
- `apps/frontend/src/app/shared/components/promotion-stack/promotion-stack.component.html` (added `data-promo-idx` for IO targets)

### G.2 — E2E verification document (this commit)
- `apps/frontend/docs/CP-ECOM-PROMO-UX-001-verification.md` (this file)

---

## 3. Backend contract verification — curl commands

> The backend is NOT running in this sandbox. Commands below target the
> local vhost `https://vendix.com`. **Do not run them in this session**;
> run them from a developer machine with the local dev stack up and
> authenticated, then compare against the expected output.

### FB-01 — Catalog tier ladder (catalog `has_discount=true`)

```bash
curl -s 'https://vendix.com/ecommerce/catalog?has_discount=true' \
  | jq '.data.products[0].active_promotion | keys'
```

**Expected output** (subset of keys, exact set depends on schema):

```json
[
  "id",
  "scope",
  "promotion_type_label",
  "is_quantity_tiered",
  "preview_min_discount",
  "quantity_tiers"
]
```

**Source of truth:**
- `apps/backend/src/domains/store/promotions/promotion-engine/promotion-engine.service.ts`
  (around lines 1425-1427: `is_quantity_tiered`, `preview_min_discount`,
  `quantity_tiers`).
- `apps/backend/src/domains/ecommerce/catalog/catalog.service.ts:1040`
  attaches `active_promotion` per product.

### FB-03 — Active promotions typed (public endpoint)

```bash
curl -s 'https://vendix.com/ecommerce/promotions/active' \
  | jq '.data[0] | {scope, promotion_type_label, quantity_tiers: (.quantity_tiers | length)}'
```

**Expected output (shape):**

```json
{
  "scope": "order",
  "promotion_type_label": "-10% en pedidos",
  "quantity_tiers": 0
}
```

Acceptable `scope` values: `"order"`, `"product"`, `"category"`.
`promotion_type_label` is always non-empty (built by
`buildPromotionTypeLabel` in `ecommerce-promotions.service.ts`).
`quantity_tiers.length` is `0` for flat promos and `≥1` for tiered ones.

**Source of truth:**
- `apps/backend/src/domains/ecommerce/promotions/ecommerce-promotions.controller.ts:19-21`
- `apps/backend/src/domains/ecommerce/promotions/ecommerce-promotions.service.ts:76-83`

### FB-04 — Cart per-product tier ladder (authenticated)

> Requires customer auth — document but do not execute in this session.

```bash
# 1. Login (store-scoped) to obtain httpOnly cookie
curl -c /tmp/vx.jar -s -X POST \
  'https://vendix.com/ecommerce/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"<demo-customer>","password":"<demo-pass>","store_slug":"<demo>"}'

# 2. Fetch cart (cookie auth)
curl -b /tmp/vx.jar -s 'https://vendix.com/ecommerce/cart' \
  | jq '.data | {items_count: (.items | length), per_product_tier_ladder_present: (.per_product_tier_ladder != null)}'
```

**Expected output:**

```json
{
  "items_count": 1,
  "per_product_tier_ladder_present": true
}
```

**Source of truth:**
- `apps/backend/src/domains/ecommerce/cart/cart.service.ts:105,124`
  emits `per_product_tier_ladder` on the cart and cart-summary.

---

## 4. Typecheck (frontend)

```bash
cd /Users/rzy/Documents/Organizations/Quickss/Vendix/apps/frontend && \
  npx tsc --noEmit -p tsconfig.app.json 2>&1 \
    | grep -E '(promotion-stack|catalog\.component|product-card|product-detail|cart-promotions|cart-item-card|checkout\.component|cart\.service|catalog\.service)'
```

**Expected output (this PR):**

```
(empty)
```

No typecheck errors in promotion-stack, catalog, product-card,
product-detail, cart-promotions, cart-item-card, checkout, cart.service,
catalog.service.

**Known pre-existing errors (out of scope):**

```
src/app/private/modules/store/pos/services/pos-cart.service.spec.ts(63,5):
  error TS2322: Type 'PosProductService' is not assignable to type 'SpyObj<PosProductService>'.
```

This is a pre-existing error in `apps/frontend/src/app/private/modules/store/pos/services/pos-cart.service.spec.ts`,
unrelated to CP-ECOM-PROMO-UX-001. Confirmed by `git stash`-ing the
PR diff and re-running — same error.

---

## 5. Backend tests (promotion-engine)

```bash
cd /Users/rzy/Documents/Organizations/Quickss/Vendix/apps/backend && \
  npm run test -- promotion-engine.service.spec 2>&1 | tail -10
```

**Expected output (last lines):**

```
Tests:       N passed, N total
Test Suites: 1 passed, 1 total
Snapshots:   0 total
Time:        <Xs>
Ran all test suites matching /promotion-engine.service.spec/i.
```

The spec covers `getTierLaddersForQuote` (A.2-engine) and the per-product
tier ladder shape. No regressions expected from this PR because G.1/G.2
only touch frontend code.

---

## 6. G.1 acceptance details

The component now exposes two new outputs in the signal-output API:

```ts
readonly promotionViewed = output<{
  promotion_id: string | number;
  mode: PromotionStackMode;
}>();

readonly promotionIntent = output<{
  promotion_id: string | number;
  tier_index: number;
  quantity: number;
}>();
```

### `promotionViewed` — IntersectionObserver (NOT `effect()`)

- Mounted via `afterNextRender` so the `<div #scroller>` and its
  `<article>` children exist in the DOM before observation starts.
- Watches each `.promotion-stack__card` inside the scroller with
  `root: scroller` and `threshold: [0.25, 0.5, 0.75, 1]`.
- Each `<article>` carries `data-promo-idx` so the observer can map a
  visibility event back to a `scrollBatchItems()[i]` row.
- When the most-visible entry crosses `ratio >= 0.5` AND its id differs
  from `lastViewedPromotionId()`, emit `promotionViewed`.
- Disconnected on `DestroyRef.onDestroy()`.
- **Does not apply** in `compact-pills` (all items visible at once) or
  `expanded-cards` (tier semantics, not visibility).

### `promotionIntent` — `effect()` for side-effects only

- Single `effect()` registered in the constructor.
- Reads `mode()`, `currentTier()`, `currentQuantity()`. When `mode` is
  `expanded-cards` AND the active tier id differs from
  `lastEmittedTierId()`, emit `promotionIntent` with the new
  `tier_index` and the `quantity` that triggered the crossing.
- `effect()` is documented and explicitly allowed by
  `vendix-zoneless-signals` because the work is a pure side-effect
  (emit analytics output), not a re-render driver. The template already
  re-renders natively via `currentTier()` / `currentQuantity()` signals.

### Zoneless compliance

- No new `markForCheck()`, `detectChanges()`, `NgZone.run()`, or
  `@HostListener`.
- No `EventEmitter` — outputs use the signal `output()` API.
- `setInterval` and `IntersectionObserver` are cleaned up via
  `DestroyRef.onDestroy()`.

---

## 7. Acceptance summary

| Phase | Scope | % done |
|-------|-------|--------|
| A.1   | Backend tier ladder on `ActiveProductPromotion` | 100% |
| A.2-engine | `getTierLaddersForQuote` in promotion-engine | 100% |
| A.2-cart | Cart emits `per_product_tier_ladder` | 100% |
| A.3   | Strict-typed `ActiveStorePromotion` (closed union, `quantity_tiers`, `promotion_type_label`) | 100% |
| B.1-B.4 | `app-promotion-stack` shared component (3 modes) | 100% |
| C.1-C.2 | Catalog banner + product-card tier pills | 100% |
| D     | PDP tier ladder + interface extends for tiers | 100% |
| E.1-E.2 | Cart-promotions wraps promotion-stack + per-item tier progress bar | 100% |
| F.1-F.2 | Checkout total uses `promotional_subtotal` + scope icons | 100% |
| G.1   | Analytics outputs on promotion-stack (this commit) | 100% |
| G.2   | E2E verification doc (this commit) | 100% |

**Overall:** 10/10 phases shipped on `dev`. Each phase has a commit on
the current branch with a self-contained message and an obvious
file-scope diff.

---

## 8. Known limitations

1. **Backend global build is unrelated to this plan.** The typecheck
   error in `apps/frontend/src/app/private/modules/store/pos/services/pos-cart.service.spec.ts`
   exists on `dev` independently of CP-ECOM-PROMO-UX-001. It is
   excluded from this plan's verification.

2. **IntersectionObserver does not fire under `display:none` ancestors.**
   Per the codebase-wide convention (see
   `vendix-restaurant-table-qr` skill notes), the observer will silently
   skip emitting `promotionViewed` if the scroll-batch is mounted under
   a hidden parent. This is expected browser behavior — consumers that
   hide the stack should defer mounting until visible.

3. **Tier-crossing emit is one-shot per tier id.** Once a tier has
   emitted `promotionIntent`, the same tier will not emit again until
   the user moves to a different tier and back. This is intentional —
   re-emitting the same crossing on every `effect()` flush would
   inflate analytics. A future "re-emit on quantity increase within
   same tier" semantic would require a separate `quantity_threshold`
   output and is out of scope here.

4. **No analytics sink is wired yet.** The outputs emit on the
   component boundary; the host page (e.g. catalog, cart, PDP) is
   responsible for calling its analytics sink. This PR does NOT modify
   any consumer to subscribe — that is a follow-up for whichever page
   needs the data first.

5. **E2E happy/sad/brute-force flows were not run from this sandbox.**
   This is a documentation PR — verification commands are listed in
   §3–§5 for a developer with local stack + auth to execute.

---

## 9. Next steps (handoff)

- Wire one analytics consumer (recommend: `apps/frontend/src/app/private/modules/ecommerce/pages/catalog/catalog.component.ts`)
  to subscribe to `(promotionViewed)` and forward to the
  store-scoped analytics facade.
- Wire the cart page
  (`apps/frontend/src/app/private/modules/ecommerce/components/cart-promotions/cart-promotions.component.ts`)
  to subscribe to `(promotionIntent)` for "user is 2 units away from
  next tier" funnel analytics.
- Open PR to `dev` per `git-workflow` RULE 8 (80% PR review gate).
