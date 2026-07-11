import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { EcommerceTablesService } from './ecommerce-tables.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OptionalAuth } from '@common/decorators/optional-auth.decorator';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { AddItemsToTableSessionDto } from '../../store/tables/dto';

/**
 * EcommerceTablesController
 *
 * QR-por-mesa — Pasos 6 + 8.
 *
 * Public-facing endpoints that a diner reaches after scanning a table
 * QR code. The QR URL carries `?mesa=<public_token>`; the frontend
 * calls `GET /ecommerce/tables/resolve?token=<public_token>` to resolve
 * the table and learn the store's configured scan behavior.
 *
 * Auth model:
 *   - `resolve` and `order` use `@OptionalAuth()` — anonymous diners
 *     can scan and self-order without a customer account.
 *   - `confirm` requires an authenticated JWT (mesero) — no
 *     `@OptionalAuth()`, so `JwtAuthGuard` enforces a valid token.
 *
 * Tenant context: `store_id` is resolved from the ecommerce domain by
 * `DomainResolverMiddleware` and populated in `RequestContextService`.
 */
@Controller('ecommerce/tables')
@UseGuards(JwtAuthGuard)
export class EcommerceTablesController {
  constructor(private readonly service: EcommerceTablesService) {}

  /**
   * Step 6 — Resolve a table by its public QR token.
   *
   * Returns the table's basic info, the store's configured scan behavior
   * (`menu_only` / `mark_occupied` / `open_tab` / `require_staff`),
   * `auto_fire` flag, and — for `open_tab` mode — the active
   * `session_id` so the frontend can subscribe to the live check.
   */
  @Get('resolve')
  @OptionalAuth()
  async resolve(@Query('token') token: string) {
    const data = await this.service.resolveByToken(token);
    return { success: true, data };
  }

  /**
   * Step 8 — Auto-pedido a la cuenta.
   *
   * Appends items to the draft order backing the table's active session.
   * Only allowed in `open_tab` and `require_staff` (post-confirmation)
   * modes; `menu_only` and `mark_occupied` reject with 409.
   *
   * If `qr_auto_fire` is true, the `prepared` items are fired to the
   * kitchen immediately (auto-fire).
   */
  @Post(':token/order')
  @OptionalAuth()
  async addOrderItems(
    @Param('token') token: string,
    @Body() dto: AddItemsToTableSessionDto,
  ) {
    const data = await this.service.addOrderItems(token, dto);
    return { success: true, data };
  }

  /**
   * Step 8 — Mesero confirms a `require_staff` QR scan.
   *
   * Requires an authenticated JWT (no `@OptionalAuth`). Opens a table
   * session with `opened_by = <mesero userId>` so the check is
   * attributed to the server who confirmed.
   */
  @Post(':token/confirm')
  async confirmStaff(@Param('token') token: string) {
    const userId = RequestContextService.getUserId();
    if (!userId) {
      throw new VendixHttpException(ErrorCodes.AUTH_CONTEXT_001);
    }
    const data = await this.service.confirmStaff(token, userId);
    return { success: true, data };
  }
}