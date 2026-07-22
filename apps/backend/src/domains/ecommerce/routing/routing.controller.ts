import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OptionalAuth } from '@common/decorators/optional-auth.decorator';
import { DirectionsResult, RoutingService } from './routing.service';
import { GetDirectionsDto } from './dto/get-directions.dto';

/**
 * RoutingController
 *
 * Street-routing proxy for the ecommerce/carrier apps. The Repartos (carrier)
 * driver map calls this endpoint so it NEVER talks to OSRM directly (User-Agent
 * policy + caching live on the backend), and draws the REAL route along roads
 * instead of a straight line.
 *
 * Auth model: `@OptionalAuth()` — mirrors the sibling GeocodingController. The
 * class-level `JwtAuthGuard` populates the user when a token is present and
 * allows anonymous requests otherwise. This is what makes the endpoint
 * reachable by a carrier token (`app_type = STORE_DELIVERY`): the
 * `DomainScopeGuard` confines STORE_DELIVERY to `/store/carrier/*` but does NOT
 * block `/ecommerce/*`, so — exactly like geocoding — routing lives under
 * `/ecommerce`.
 *
 * Tenant context: none required — routing is coordinate-only and does not touch
 * scoped Prisma, so no store resolution is needed.
 */
@Controller('ecommerce/routing')
@UseGuards(JwtAuthGuard)
export class RoutingController {
  constructor(private readonly routingService: RoutingService) {}

  /**
   * `GET /ecommerce/routing/directions?coords=<lng>,<lat>;<lng>,<lat>;...`
   *
   * Returns the street-following geometry, total distance (m) and ETA (s) for
   * the ordered waypoints. Malformed/out-of-range coords → 400 (via the DTO and
   * service range check). Provider failure/timeout/no-route → 503; the frontend
   * falls back to a straight line on any error.
   */
  @Get('directions')
  @OptionalAuth()
  async directions(
    @Query() query: GetDirectionsDto,
  ): Promise<DirectionsResult> {
    return this.routingService.directions(query.coords);
  }
}
