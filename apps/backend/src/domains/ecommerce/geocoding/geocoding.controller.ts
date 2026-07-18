import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OptionalAuth } from '@common/decorators/optional-auth.decorator';
import {
  ForwardGeocodeResult,
  GeocodingService,
  NormalizedAddress,
} from './geocoding.service';
import { ReverseGeocodeDto } from './dto/reverse-geocode.dto';
import { ForwardGeocodeDto } from './dto/forward-geocode.dto';

/**
 * GeocodingController
 *
 * Public reverse-geocoding proxy for the ecommerce storefront. The frontend
 * captures GPS/map coordinates during checkout and calls this endpoint so it
 * NEVER talks to Nominatim directly (User-Agent policy + caching live on the
 * backend).
 *
 * Auth model: `@OptionalAuth()` — anonymous shoppers can geocode without a
 * customer account. The class-level `JwtAuthGuard` mirrors the sibling
 * ecommerce controllers; combined with `@OptionalAuth()` it populates the
 * user when a token is present and allows anonymous requests otherwise.
 *
 * Tenant context: none required — reverse geocoding is coordinate-only and
 * does not touch scoped Prisma, so no store resolution is needed.
 */
@Controller('ecommerce/geocoding')
@UseGuards(JwtAuthGuard)
export class GeocodingController {
  constructor(private readonly geocodingService: GeocodingService) {}

  /**
   * `GET /ecommerce/geocoding/reverse?lat={number}&lng={number}`
   *
   * Returns the normalized address for the coordinate. Out-of-range or
   * non-numeric coordinates → 400. Provider failure → 503.
   */
  @Get('reverse')
  @OptionalAuth()
  async reverse(@Query() query: ReverseGeocodeDto): Promise<NormalizedAddress> {
    const { lat, lng } = query;

    // Defense-in-depth range/NaN check (DTO already enforces the range and
    // returns 400 via ValidationPipe; this guards any bypass path).
    if (
      typeof lat !== 'number' ||
      Number.isNaN(lat) ||
      typeof lng !== 'number' ||
      Number.isNaN(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      throw new BadRequestException(
        'lat must be in [-90, 90] and lng in [-180, 180]',
      );
    }

    return this.geocodingService.reverse(lat, lng);
  }

  /**
   * `GET /ecommerce/geocoding/forward?q={address}`
   *
   * Free-text address → coordinate (Colombia-biased), used when the customer
   * types the address manually so the map can center on it. Returns
   * `{ lat: null, lng: null }` when nothing matched (not an error). Provider
   * failure → 503; too-short/too-long `q` → 400 via the DTO.
   */
  @Get('forward')
  @OptionalAuth()
  async forward(
    @Query() query: ForwardGeocodeDto,
  ): Promise<ForwardGeocodeResult> {
    return this.geocodingService.forward(query.q);
  }
}
