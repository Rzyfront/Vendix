import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { KitchenFireModule } from '../kitchen-fire/kitchen-fire.module';
import { TablesController } from './tables.controller';
import { TablesService } from './tables.service';
import { TableSessionsController } from './table-sessions.controller';
import { TableSessionsService } from './table-sessions.service';
import { SplitOrderController } from './split-order.controller';
import { SplitOrderService } from './split-order.service';

/**
 * TablesModule — Restaurant Suite Fase E
 *
 * Owns the "open check" lifecycle for the table-based service flow:
 *
 *   tables (CRUD + floor map)
 *   ├── table_sessions (open / add-items / close)
 *   └── split-order (split-by-items / split-by-amount on a draft order)
 *
 * Cross-module wiring:
 *   - The split service is exposed here because it acts on the draft
 *     order that backs a table session, but it is exported so the
 *     upcoming POS module (Fase H) can re-use the split endpoint for
 *     non-table orders (e.g. take-away split with friends).
 *
 * Does NOT import OrdersModule: the session flow creates a draft order
 * directly via the scoped `prisma.orders.create` (no need for the full
 * retail `OrdersService.create` machinery — the kitchen-fire / payments
 * flows that depend on it run later, after the session is open).
 */
@Module({
  imports: [ResponseModule, PrismaModule, SettingsModule, KitchenFireModule],
  controllers: [
    TablesController,
    TableSessionsController,
    SplitOrderController,
  ],
  providers: [
    TablesService,
    TableSessionsService,
    SplitOrderService,
  ],
  exports: [
    TablesService,
    TableSessionsService,
    SplitOrderService,
  ],
})
export class TablesModule {}
