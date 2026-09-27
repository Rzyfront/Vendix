import { Module } from '@nestjs/common';
import { GeocodingController } from './geocoding.controller';
import { GeocodingService } from './geocoding.service';
import { GoogleGeocodingProvider } from './google-geocoding.provider';
import { PrismaModule } from '../../../prisma/prisma.module';

/**
 * GeocodingModule — public reverse/forward-geocoding proxy for the ecommerce
 * storefront checkout (GPS/map → normalized address, free-text → coordinate).
 *
 *   - REDIS_CLIENT is provided by the @Global() RedisModule.
 *   - JwtAuthGuard is a global APP_GUARD (its only dep, Reflector, is a
 *     global core provider), so `@UseGuards(JwtAuthGuard)` resolves without
 *     an auth-module import — same as the sibling EcommerceTablesModule.
 *   - GoogleGeocodingProvider is the paid fallback the forward cascade tries
 *     only when the free OSM cascade lands on null/'street'/'area'.
 *   - PrismaModule is imported ONLY so the controller can read (best-effort,
 *     read-only, failures ignored) a store's first shipping-method origin
 *     coords to use as a forward-geocode `bias` when no city is known — the
 *     service itself still has no Prisma dependency.
 */
@Module({
  imports: [PrismaModule],
  controllers: [GeocodingController],
  providers: [GeocodingService, GoogleGeocodingProvider],
  // Exported so other domains (e.g. store/dispatch-routes map view) can
  // forward-geocode addresses through the same Redis-cached, tenant-agnostic
  // service. GeocodingService only depends on the @Global() REDIS_CLIENT, so
  // importers do not need to wire any extra providers.
  exports: [GeocodingService],
})
export class GeocodingModule {}
