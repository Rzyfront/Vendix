# Restaurant Suite Movement Types

The restaurant suite adds two `movement_type` values to `updateStock()`:

| `movement_type` | Sign of `quantity_change` | Emitted from | Meaning |
| --- | --- | --- | --- |
| `production` | `+` | `production-orders.service.ts` (`complete()`) | A finished sub-recipe lot is added to the `is_batch_produced` product's stock. |
| `consumption` | `−` | `kitchen-fire.service.ts` (`fireOrderItems`) and `production-orders.service.ts` | Leaf ingredients are consumed (fire-to-kitchen, or ingredients burned during a production order). |

Key fact: `calculateAndConsumeMovementCost` (the FIFO/CPP engine) branches by the **sign** of `params.quantity_change`, **not** by the `movement_type` enum value. A positive change resolves the receipt cost (`movement_unit_cost ?? unit_cost ?? cost_per_unit`); a negative change walks `inventory_cost_layers` (FIFO `received_at ASC`). So `production` (+) and `consumption` (−) flow through the **existing** costing machinery automatically — no new costing branch was added. The transaction-type mapper still maps both to `stock_in` for `inventory_transactions` audit-type compliance; the real cost direction is decided by the sign, not that label.

See `vendix-restaurant-ops` for the recipe explosion (`RecipesService.explodeBom`), the fire-to-kitchen seam, and the `inventory_consumed_at_fire` anti-double-discount guard.
