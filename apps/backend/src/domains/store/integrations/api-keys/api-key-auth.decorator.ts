import { applyDecorators, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../../common/decorators/public.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { API_KEY_THROTTLE } from './api-key.constants';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeyThrottlerGuard } from './api-key-throttler.guard';

/**
 * Marks a controller as an API-key surface (`/api/v1/*`). One decorator so the
 * three pieces cannot drift apart:
 *  - `@Public()`: the global JWT guard steps aside (a JWT never authenticates here);
 *  - `ApiKeyGuard`: the only authentication;
 *  - `ApiKeyThrottlerGuard`: 120 requests/min per key;
 *  - `PermissionsGuard`: each route's `@Permissions(...)` against the effective set.
 */
export const ApiKeyAuth = () =>
  applyDecorators(
    Public(),
    Throttle({
      default: { limit: API_KEY_THROTTLE.limit, ttl: API_KEY_THROTTLE.ttl },
    }),
    UseGuards(ApiKeyGuard, ApiKeyThrottlerGuard, PermissionsGuard),
  );
