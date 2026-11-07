import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';
import { extractClientIp } from '../../../../common/utils/client-ip.util';

/**
 * Per-key throttle for `/api/v1`. Runs after `ApiKeyGuard`, so the key id is
 * known; the limit comes from the `@Throttle` decorator in `ApiKeyAuth`.
 * Falls back to the client IP if the key is somehow missing (fail closed on
 * the shared bucket, never unlimited).
 */
@Injectable()
export class ApiKeyThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const id = req?.apiKey?.api_key_id;
    return typeof id === 'number'
      ? `api_key:${id}`
      : `api_key_ip:${extractClientIp(req as any)}`;
  }

  protected async throwThrottlingException(
    _context: ExecutionContext,
  ): Promise<void> {
    throw new VendixHttpException(ErrorCodes.API_KEY_RATE_LIMITED);
  }
}
