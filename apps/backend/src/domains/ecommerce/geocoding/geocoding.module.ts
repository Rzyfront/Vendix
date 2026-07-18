import { Module } from '@nestjs/common';
import { GeocodingController } from './geocoding.controller';
import { GeocodingService } from './geocoding.service';

/**
 * GeocodingModule — public reverse-geocoding proxy for the ecommerce
 * storefront checkout (GPS/map → normalized address).
 *
 * No imports needed:
 *   - REDIS_CLIENT is provided by the @Global() RedisModule.
 *   - JwtAuthGuard is a global APP_GUARD (its only dep, Reflector, is a
 *     global core provider), so `@UseGuards(JwtAuthGuard)` resolves without
 *     an auth-module import — same as the sibling EcommerceTablesModule.
 *   - No Prisma: the service is coordinate-only and tenant-agnostic.
 */
@Module({
  controllers: [GeocodingController],
  providers: [GeocodingService],
  // Exported so other domains (e.g. store/dispatch-routes map view) can
  // forward-geocode addresses through the same Redis-cached, tenant-agnostic
  // service. GeocodingService only depends on the @Global() REDIS_CLIENT, so
  // importers do not need to wire any extra providers.
  exports: [GeocodingService],
})
export class GeocodingModule {}
