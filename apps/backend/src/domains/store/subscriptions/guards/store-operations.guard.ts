import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { SubscriptionAccessService } from '../services/subscription-access.service';
import { SKIP_SUBSCRIPTION_GATE } from '../decorators/skip-subscription-gate.decorator';

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const STORE_PATH_PREFIX = '/api/store/';
const SUBSCRIPTIONS_PATH_PREFIX = '/api/store/subscriptions/';

/**
 * Global guard that blocks write operations under `/api/store/**` for stores
 * whose subscription is `suspended`, `blocked`, `cancelled`, `expired`, or
 * missing entirely.
 *
 * Behavior summary:
 *   - Read methods (GET/HEAD/OPTIONS) → pass-through.
 *   - Non-store paths → pass-through (other guards handle).
 *   - `/api/store/subscriptions/**` → pass-through (subscription management
 *     must remain reachable while blocked).
 *   - `@SkipSubscriptionGate()` on handler or class → pass-through.
 *   - No `storeId` in context → pass-through (auth/context guards handle it).
 *   - `mode='warn'` (grace_soft / grace_hard) → set `X-Subscription-Warning`
 *     header and pass.
 *   - `mode='block'` →
 *       * STORE_GATE_ENFORCE / AI_GATE_ENFORCE = 'true' → throw
 *         VendixHttpException with the mapped SUBSCRIPTION_* code.
 *       * otherwise → log structured `STORE_GATE_OBSERVATION` and pass.
 */
@Injectable()
export class StoreOperationsGuard implements CanActivate {
  private readonly logger = new Logger(StoreOperationsGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly access: SubscriptionAccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // 1. Class/handler-level bypass.
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_SUBSCRIPTION_GATE,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (skip) return true;

    // 2. HTTP-only guard.
    const httpCtx = ctx.switchToHttp();
    const req = httpCtx.getRequest<Request>();
    if (!req || typeof req.method !== 'string') return true;

    const method = req.method.toUpperCase();
    if (!WRITE_METHODS.has(method)) return true;

    const path = req.path ?? req.originalUrl ?? req.url ?? '';
    if (!path.startsWith(STORE_PATH_PREFIX)) return true;
    if (path.startsWith(SUBSCRIPTIONS_PATH_PREFIX)) return true;

    // 3. Need a store in context. Read from req.user (populated by JwtAuthGuard
    // which runs before this guard) — not from RequestContextService, because
    // the AsyncLocalStorage interceptor runs AFTER guards, so getStoreId() is
    // undefined here. Fall back to the AsyncLocalStorage in case a future
    // refactor populates it earlier.
    const reqUser = (req as Request & { user?: { store_id?: number | null } }).user;
    const storeId = reqUser?.store_id ?? RequestContextService.getStoreId();
    if (!storeId) return true;

    const result = await this.access.canUseModule(storeId, 'store-operations');

    if (result.mode === 'warn') {
      try {
        const res = httpCtx.getResponse<Response>();
        if (res && typeof res.setHeader === 'function') {
          res.setHeader('X-Subscription-Warning', result.subscription_state);
        }
      } catch {
        // Non-HTTP response (SSE / worker) — skip silently.
      }
      return true;
    }

    if (result.mode === 'block') {
      const enforce = this.isEnforceMode();
      this.logger.warn(
        JSON.stringify({
          event: 'STORE_GATE_OBSERVATION',
          storeId,
          path,
          method,
          reason: result.reason,
          state: result.subscription_state,
          enforce,
        }),
      );
      if (enforce) {
        const key =
          (result.reason as keyof typeof ErrorCodes) ?? 'SUBSCRIPTION_004';
        const entry = ErrorCodes[key] ?? ErrorCodes.SUBSCRIPTION_004;
        throw new VendixHttpException(entry);
      }
    }

    return true;
  }

  private isEnforceMode(): boolean {
    return (
      process.env.STORE_GATE_ENFORCE === 'true' ||
      process.env.AI_GATE_ENFORCE === 'true'
    );
  }
}
