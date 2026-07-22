import { Module } from '@nestjs/common';
import { RoutingController } from './routing.controller';
import { RoutingService } from './routing.service';

/**
 * RoutingModule — street-routing proxy (OSRM) for the ecommerce/carrier apps
 * (waypoints → real driving polyline + distance + ETA).
 *
 * No imports needed:
 *   - REDIS_CLIENT is provided by the @Global() RedisModule.
 *   - JwtAuthGuard is a global APP_GUARD (its only dep, Reflector, is a global
 *     core provider), so `@UseGuards(JwtAuthGuard)` resolves without an
 *     auth-module import — same as the sibling GeocodingModule.
 *   - No Prisma: the service is coordinate-only and tenant-agnostic.
 *
 * Exported so other domains (e.g. store/dispatch-routes map view) can reuse the
 * same Redis-cached, tenant-agnostic routing through this service.
 */
@Module({
  controllers: [RoutingController],
  providers: [RoutingService],
  exports: [RoutingService],
})
export class RoutingModule {}
