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
})
export class GeocodingModule {}
