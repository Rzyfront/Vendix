import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Logger,
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
import { MunicipalityCenterDto } from './dto/municipality-center.dto';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * Narrow, hand-typed view of the `shipping_methods` scoped delegate.
 * `StorePrismaService.shipping_methods` returns the `any`-typed
 * `scoped_client` getter (see `store-prisma.service.ts`) like every other
 * scoped model accessor in that service — this local interface is just
 * enough shape for the read-only lookup below, cast once at the call site
 * instead of leaving `any` unsafe-call/member-access lint errors scattered
 * through the method body.
 */
interface ShippingMethodOriginRow {
  origin_latitude: unknown;
  origin_longitude: unknown;
}
interface ShippingMethodsOriginDelegate {
  findFirst(args: unknown): Promise<ShippingMethodOriginRow | null>;
}

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
  private readonly logger = new Logger(GeocodingController.name);

  constructor(
    private readonly geocodingService: GeocodingService,
    private readonly storePrisma: StorePrismaService,
  ) {}

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
   * `GET /ecommerce/geocoding/forward?q={address}&city={city}&state={state}&municipality_code={5 digits}`
   *
   * Free-text address → coordinate (Colombia-biased cascade: rural/manzana
   * area search, DANE intersection with plate interpolation, structured
   * search, free-text search, and a paid Google fallback — see
   * `GeocodingService.forward`), used when the customer types the address
   * manually so the map can center on it, or a shipping quote needs a
   * distance-accurate point. `city`/`state`/`municipality_code` are optional
   * and backward-compatible: today's frontend sends only `q`, and the
   * service parses city/state out of it when absent.
   *
   * When `city` is NOT given and the `x-store-id` header IS present, a
   * best-effort `bias` is resolved from that store's first active shipping
   * method with origin coordinates — this is a read-only lookup wrapped in
   * an isolated request context (never touches/leaks the caller's real auth
   * context) and ANY failure (bad header, no such store, no method with
   * coords, Prisma error) is silently ignored; the endpoint stays public and
   * never 500s because of it.
   *
   * Returns `{ lat: null, lng: null }` when nothing matched (not an error —
   * the service never throws for a cascade that comes up empty).
   * Too-short/too-long `q` or a malformed `municipality_code` → 400 via the DTO.
   */
  @Get('forward')
  @OptionalAuth()
  async forward(
    @Query() query: ForwardGeocodeDto,
    @Headers('x-store-id') storeIdHeader?: string,
  ): Promise<ForwardGeocodeResult> {
    const bias = await this.resolveShippingOriginBias(
      storeIdHeader,
      query.city,
    );
    return this.geocodingService.forward(query.q, query.city, query.state, {
      municipalityCode: query.municipality_code,
      bias,
    });
  }

  /**
   * `GET /ecommerce/geocoding/municipality-center?city={city}&state={state}`
   *
   * Center of the municipality bounding box, ONLY for visually framing the
   * map. It is never a delivery location: callers must not use it as pin,
   * coordinates or for shipping quotes. Returns `{ lat: null, lng: null }`
   * when the municipality cannot be resolved.
   */
  @Get('municipality-center')
  @OptionalAuth()
  async municipalityCenter(
    @Query() query: MunicipalityCenterDto,
  ): Promise<{ lat: number | null; lng: number | null }> {
    const center = await this.geocodingService.municipalityCenter(
      query.city,
      query.state,
    );
    return center ?? { lat: null, lng: null };
  }

  /**
   * Best-effort bias resolution — see the `forward()` doc above for the full
   * policy. Runs the Prisma lookup under an ISOLATED request context (never
   * mutates the real ALS context of this request) so a public/anonymous
   * caller can still exercise the store-scoped `shipping_methods` getter.
   */
  private async resolveShippingOriginBias(
    storeIdHeader: string | undefined,
    city: string | undefined,
  ): Promise<{ lat: number; lng: number } | undefined> {
    if (city || !storeIdHeader) return undefined;
    const storeId = Number(storeIdHeader);
    if (!Number.isFinite(storeId) || storeId <= 0) return undefined;

    try {
      return await RequestContextService.runIsolated(
        { store_id: storeId, is_super_admin: false, is_owner: false },
        async () => {
          const shippingMethods = this.storePrisma
            .shipping_methods as unknown as ShippingMethodsOriginDelegate;
          const method = await shippingMethods.findFirst({
            where: {
              store_id: storeId,
              is_active: true,
              origin_latitude: { not: null },
              origin_longitude: { not: null },
            },
            orderBy: { display_order: 'asc' },
            select: { origin_latitude: true, origin_longitude: true },
          });
          if (!method?.origin_latitude || !method?.origin_longitude) {
            return undefined;
          }
          return {
            lat: Number(method.origin_latitude),
            lng: Number(method.origin_longitude),
          };
        },
      );
    } catch (err) {
      this.logger.warn(
        `Shipping-origin bias lookup failed for store ${storeIdHeader}, continuing without bias: ${err}`,
      );
      return undefined;
    }
  }
}
