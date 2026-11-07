import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';
import { extractClientIp } from '../../../../common/utils/client-ip.util';
import { SubscriptionAccessService } from '../../subscriptions/services/subscription-access.service';
import { SubscriptionGateConfig } from '../../subscriptions/config/subscription-gate.config';
import { ApiKeyAuthService, ApiKeyPrincipal } from './api-key-auth.service';
import { extractApiKey } from './api-key.util';

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * The ONLY authentication for `/api/v1/*` (routes are `@Public()` so the global
 * JWT guard steps aside; see `ApiKeyAuth`). Reads `Authorization: Bearer
 * vdx_live_…` or `X-Api-Key`, resolves the key, and exposes the acting user as
 * `req.user` so the shared `PermissionsGuard` and `RequestContextInterceptor`
 * work unchanged. `req.user.permissions` is already the effective set
 * (acting user ∩ key scopes).
 *
 * `StoreOperationsGuard` only watches `/api/store/*`, so the same subscription
 * rule for writes is applied here.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    private readonly auth: ApiKeyAuthService,
    private readonly subscriptionAccess: SubscriptionAccessService,
    private readonly gateConfig: SubscriptionGateConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<
      Request & { user?: unknown; apiKey?: ApiKeyPrincipal }
    >();

    // Never trust a user attached by anything before this guard.
    delete req.user;
    delete req.apiKey;

    const secret = extractApiKey(req.headers as Record<string, unknown>);
    if (!secret) throw new VendixHttpException(ErrorCodes.API_KEY_INVALID);

    const principal = await this.auth.authenticate(
      secret,
      extractClientIp(req),
    );

    if (WRITE_METHODS.has((req.method ?? '').toUpperCase())) {
      await this.assertStoreCanOperate(
        principal.store_id,
        http.getResponse<Response>(),
      );
    }

    req.apiKey = principal;
    req.user = {
      id: principal.user_id,
      user_id: principal.user_id,
      organization_id: principal.organization_id,
      store_id: principal.store_id,
      app_type: 'STORE_ADMIN',
      roles: [] as string[],
      // Row shape `PermissionsGuard` expects; `path`/`method` are blank so a
      // path match can never grant anything: only the named permissions count.
      permissions: principal.permissions.map((name) => ({
        name,
        path: '',
        method: '',
        status: 'active',
      })),
      is_super_admin: false,
      is_owner: false,
      auth_source: 'api_key',
      api_key_id: principal.api_key_id,
    };
    return true;
  }

  /** Mirrors `StoreOperationsGuard` for writes. */
  private async assertStoreCanOperate(
    storeId: number,
    res: Response,
  ): Promise<void> {
    const result = await this.subscriptionAccess.canUseModule(
      storeId,
      'store-operations',
    );
    if (result.mode === 'warn') {
      try {
        if (res && typeof res.setHeader === 'function') {
          res.setHeader('X-Subscription-Warning', result.subscription_state);
        }
      } catch {
        // ignore: non-HTTP response
      }
      return;
    }
    if (result.mode === 'block') {
      const enforce = this.gateConfig.isEnforce();
      this.logger.warn(
        JSON.stringify({
          event: 'STORE_GATE_OBSERVATION',
          storeId,
          surface: 'api_key',
          reason: result.reason,
          state: result.subscription_state,
          enforce,
        }),
      );
      if (enforce) {
        const key =
          (result.reason as keyof typeof ErrorCodes) ?? 'SUBSCRIPTION_004';
        const entry = ErrorCodes[key] ?? ErrorCodes.SUBSCRIPTION_004;
        throw new VendixHttpException(entry, undefined, {
          subscription_state: result.subscription_state,
          plan_id: result.plan_id ?? null,
          has_record: result.has_record,
        });
      }
    }
  }
}
