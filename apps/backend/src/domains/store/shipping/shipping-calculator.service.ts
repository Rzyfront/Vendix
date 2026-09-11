import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { address_type_enum, shipping_rate_type_enum } from '@prisma/client';
import { SettingsService } from '../settings/settings.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  countryCodeInList,
  geoNameInList,
  isUsableGeoName,
  normalizeGeoName,
  postalCodeInList,
} from 'src/common/utils/geo-name.util';

export interface AddressDTO {
  country_code: string;
  state_province?: string;
  city?: string;
  postal_code?: string;
}

export interface CartItemDTO {
  product_id: number;
  quantity: number;
  weight?: number; // Total weight for this line item (unit_weight * quantity)
  price: number; // Total price for this line item
  product_type?: string; // 'physical' | 'service'
}

export interface ShippingOption {
  id: number; // Unique identifier (rate_id)
  rate_id: number; // Explicit alias of `id` for consumers that prefer semantic naming
  method_id: number;
  method_name: string;
  method_type: string; // 'pickup' | 'own_fleet' | 'carrier' | etc.
  cost: number;
  currency: string;
  estimated_days?: { min: number; max: number };
  /** Zona que originó la opción. Null cuando viene del fallback de retiro. */
  zone_id?: number | null;
  /**
   * `true` cuando la opción NO proviene de una zona que cubra la dirección,
   * sino del fallback de retiro en tienda. El storefront debe avisarle al
   * comprador que no hay despacho a su dirección antes de que confirme.
   */
  is_fallback?: boolean;
  /**
   * `true` cuando la zona que originó la opción coincide exactamente con el
   * código postal de la dirección del comprador.
   */
  postal_code_match?: boolean;
}

@Injectable()
export class ShippingCalculatorService {
  private readonly logger = new Logger(ShippingCalculatorService.name);

  /**
   * Tipos de dirección que representan un punto físico donde la tienda opera y,
   * por lo tanto, donde un comprador puede retirar su pedido. Sale del enum
   * `address_type_enum`; no hay ninguna ubicación fija acá.
   */
  private static readonly PICKUP_CAPABLE_ADDRESS_TYPES: address_type_enum[] = [
    address_type_enum.store_physical,
    address_type_enum.pickup,
    address_type_enum.headquarters,
    address_type_enum.branch_office,
  ];

  constructor(
    private prisma: StorePrismaService,
    private settingsService: SettingsService,
  ) {}

  /**
   * Main entry point to calculate shipping rates for a cart and address
   */
  async calculateRates(
    storeId: number,
    items: CartItemDTO[],
    address: AddressDTO,
  ): Promise<ShippingOption[]> {
    // 1. Resolve Matching Zones (ADR-01)
    const matchingZones = await this.resolveMatchingZones(storeId, address);
    if (matchingZones.length === 0) {
      this.logger.warn(
        `Sin zonas coincidentes para store ${storeId} en dirección ` +
          `${JSON.stringify({
            country_code: address.country_code,
            state_province: address.state_province,
            city: address.city,
            postal_code: address.postal_code,
          })}. Evaluando retiro en tienda.`,
      );
      return this.getPickupFallbackOptions(storeId, address);
    }

    const matchingZoneIds = matchingZones.map((z) => z.id);
    const zoneSpecificity = new Map<number, number>();
    const zoneZipMatch = new Map<number, boolean>();
    for (const zone of matchingZones) {
      zoneSpecificity.set(zone.id, this.getSpecificityScore(zone, address));
      const hasZipMatch = Boolean(
        address.postal_code &&
          zone.zip_codes &&
          zone.zip_codes.length > 0 &&
          postalCodeInList(address.postal_code, zone.zip_codes),
      );
      zoneZipMatch.set(zone.id, hasZipMatch);
    }

    // 2. Fetch available methods and rates for all matching zones.
    //    El `orderBy` es obligatorio para orden determinístico.
    const rates = await this.prisma.shipping_rates.findMany({
      where: {
        shipping_zone_id: { in: matchingZoneIds },
        is_active: true,
        shipping_method: {
          is_active: true,
        },
      },
      include: {
        shipping_method: true,
        shipping_zone: true,
      },
      orderBy: [
        { shipping_method: { display_order: 'asc' } },
        { shipping_method_id: 'asc' },
        { id: 'asc' },
      ],
    });

    const cartTotals = this.getCartTotals(items);
    const storeCurrency = await this.settingsService.getStoreCurrency();

    // Determinar la máxima especificidad territorial para cada método de envío.
    // Si una zona de nivel ciudad (score >= 100) ya define tarifas para un método,
    // se descarta la tarifa genérica nacional (score < 100) para ese mismo método.
    const maxScoreByMethod = new Map<number, number>();
    for (const rate of rates) {
      const score = zoneSpecificity.get(rate.shipping_zone_id) ?? 0;
      const prev = maxScoreByMethod.get(rate.shipping_method_id) ?? -1;
      if (score > prev) {
        maxScoreByMethod.set(rate.shipping_method_id, score);
      }
    }

    const options: ShippingOption[] = [];

    // 3. Process rates. Todas las tarifas aplicables del municipio se presentan,
    //    priorizando las que coincidan exactamente con el código postal.
    for (const rate of rates) {
      let cost = 0;
      let isApplicable = false;

      switch (rate.type) {
        case shipping_rate_type_enum.flat:
          isApplicable = true;
          cost = Number(rate.base_cost);
          break;

        case shipping_rate_type_enum.weight_based:
          if (
            this.isInRange(
              cartTotals.totalWeight,
              Number(rate.min_val),
              Number(rate.max_val),
            )
          ) {
            isApplicable = true;
            cost =
              Number(rate.base_cost) +
              Number(rate.per_unit_cost || 0) * cartTotals.totalWeight;
          }
          break;

        case shipping_rate_type_enum.price_based:
          if (
            this.isInRange(
              cartTotals.totalPrice,
              Number(rate.min_val),
              Number(rate.max_val),
            )
          ) {
            isApplicable = true;
            cost = Number(rate.base_cost);
          }
          break;

        case shipping_rate_type_enum.free:
          if (
            this.isInRange(
              cartTotals.totalPrice,
              Number(rate.min_val),
              Number(rate.max_val),
            )
          ) {
            isApplicable = true;
            cost = 0;
          }
          break;

        default:
          this.logger.warn(
            `Tarifa ${rate.id} (zona ${rate.shipping_zone_id}) usa tipo '${rate.type}', ` +
              'no soportado actualmente.',
          );
          break;
      }

      // ADR-04 (F-008): threshold 0 = envío gratis deliberado de la tienda.
      // Comparación explícita `>= 0`, nunca truthiness: el campo Prisma es
      // `Decimal` (objeto truthy incluso en 0), así que `if (threshold)` no
      // distingue "gratis intencional" de "sin umbral". `null` = sin umbral;
      // negativo legacy = sin gratis (inventariar pre-release con
      // `SELECT id FROM shipping_rates WHERE free_shipping_threshold <= 0
      // AND is_active` antes del release).
      if (
        isApplicable &&
        rate.free_shipping_threshold != null &&
        Number(rate.free_shipping_threshold) >= 0 &&
        cartTotals.totalPrice >= Number(rate.free_shipping_threshold)
      ) {
        cost = 0;
      }

      if (isApplicable) {
        const rateZoneScore = zoneSpecificity.get(rate.shipping_zone_id) ?? 0;
        const maxScoreForMethod =
          maxScoreByMethod.get(rate.shipping_method_id) ?? 0;

        // Si una zona de nivel ciudad ya define tarifas para este método,
        // se descarta la tarifa genérica nacional para ese mismo método.
        if (rateZoneScore < 100 && maxScoreForMethod >= 100) {
          continue;
        }

        const isPostalMatch = zoneZipMatch.get(rate.shipping_zone_id) ?? false;
        const optionName =
          (rate.name && rate.name.trim().length > 0)
            ? rate.name.trim()
            : (rate.shipping_zone?.display_name?.trim() ||
               rate.shipping_zone?.name?.trim() ||
               rate.shipping_method.name);

        options.push({
          id: rate.id,
          rate_id: rate.id,
          method_id: rate.shipping_method_id,
          method_name: optionName,
          method_type: rate.shipping_method.type,
          cost: cost,
          currency: storeCurrency,
          estimated_days: {
            min: rate.shipping_method.min_days || 0,
            max: rate.shipping_method.max_days || 0,
          },
          zone_id: rate.shipping_zone_id,
          is_fallback: false,
          postal_code_match: isPostalMatch,
        });
      }
    }

    // Ordenar opciones:
    // 1. Coincidencia exacta de código postal primero.
    // 2. Mayor especificidad de zona.
    // 3. Menor costo.
    // 4. ID determinístico.
    options.sort((a, b) => {
      if (a.postal_code_match && !b.postal_code_match) return -1;
      if (!a.postal_code_match && b.postal_code_match) return 1;

      const scoreA = zoneSpecificity.get(a.zone_id ?? 0) ?? 0;
      const scoreB = zoneSpecificity.get(b.zone_id ?? 0) ?? 0;
      if (scoreA !== scoreB) return scoreB - scoreA;

      if (a.cost !== b.cost) return a.cost - b.cost;
      return a.id - b.id;
    });

    if (options.length === 0) {
      this.logger.warn(
        `${matchingZones.length} zonas coinciden para store ${storeId} pero ninguna ` +
          `de sus ${rates.length} tarifas resultó aplicable al carrito.`,
      );
      return this.getPickupFallbackOptions(storeId, address);
    }

    this.logger.log(
      `Cotización store ${storeId}: ${matchingZones.length} zonas coincidentes ` +
        `([${matchingZones.map((z) => z.name).join(', ')}]), ${options.length} opciones calculadas.`,
    );

    return options;
  }

  /**
   * Opciones de retiro en tienda cuando ninguna zona cubre la dirección.
   *
   * Regla de negocio: sólo tiene sentido ofrecer "recoger en tienda" si la
   * tienda **opera físicamente en la ciudad del comprador**. Eso se deriva de
   * las direcciones de la tienda (`addresses.store_id`), no de una constante:
   * cada tenant define dónde está.
   *
   * Devuelve tarifas `pickup` reales (con su `rate_id`), de modo que la
   * creación de la orden siga validando `shipping_rate_id` como siempre. No
   * hace falta ningún flag que saltee validaciones.
   */
  private async getPickupFallbackOptions(
    storeId: number,
    address: AddressDTO,
  ): Promise<ShippingOption[]> {
    if (!isUsableGeoName(address.city)) {
      this.logger.warn(
        `Sin zona para store ${storeId} y la dirección no trae una ciudad ` +
          `utilizable (recibido: ${JSON.stringify(address.city)}). No se ` +
          'puede evaluar el retiro en tienda.',
      );
      return [];
    }

    const storeAddresses = await this.prisma.addresses.findMany({
      where: {
        type: { in: ShippingCalculatorService.PICKUP_CAPABLE_ADDRESS_TYPES },
      },
      select: { id: true, city: true, state_province: true, type: true },
    });

    const pickupCities = storeAddresses
      .map((a) => a.city)
      .filter((city) => isUsableGeoName(city));

    if (pickupCities.length === 0) {
      this.logger.warn(
        `Store ${storeId} no tiene ninguna dirección física con ciudad ` +
          'utilizable, así que no se puede ofrecer retiro en tienda como ' +
          'alternativa a la falta de cobertura.',
      );
      return [];
    }

    if (!geoNameInList(address.city, pickupCities)) {
      // La tienda existe, pero no en la ciudad del comprador: retirar no es
      // una alternativa real. El storefront muestra el mensaje de sin cobertura.
      return [];
    }

    const pickupRates = await this.prisma.shipping_rates.findMany({
      where: {
        is_active: true,
        shipping_method: { is_active: true, type: 'pickup' },
        shipping_zone: { store_id: storeId, is_active: true },
      },
      include: { shipping_method: true },
      orderBy: [
        { shipping_method: { display_order: 'asc' } },
        { shipping_method_id: 'asc' },
        { id: 'asc' },
      ],
    });

    if (pickupRates.length === 0) {
      this.logger.warn(
        `Store ${storeId} opera en ${normalizeGeoName(address.city)} pero no ` +
          'tiene ninguna tarifa de retiro en tienda activa para ofrecer.',
      );
      return [];
    }

    const storeCurrency = await this.settingsService.getStoreCurrency();
    const seenMethods = new Set<number>();
    const options: ShippingOption[] = [];

    for (const rate of pickupRates) {
      if (seenMethods.has(rate.shipping_method_id)) continue;
      seenMethods.add(rate.shipping_method_id);

      const optionName =
        (rate.name && rate.name.trim().length > 0)
          ? rate.name.trim()
          : (rate.shipping_zone?.display_name?.trim() ||
             rate.shipping_zone?.name?.trim() ||
             rate.shipping_method.name);

      options.push({
        id: rate.id,
        rate_id: rate.id,
        method_id: rate.shipping_method_id,
        method_name: optionName,
        method_type: rate.shipping_method.type,
        cost: rate.type === shipping_rate_type_enum.free ? 0 : Number(rate.base_cost),
        currency: storeCurrency,
        estimated_days: {
          min: rate.shipping_method.min_days || 0,
          max: rate.shipping_method.max_days || 0,
        },
        zone_id: rate.shipping_zone_id,
        is_fallback: true,
      });
    }

    return options;
  }

  /**
   * Resuelve todas las zonas activas que cubren la dirección, ordenadas por
   * especificidad descendente (ADR-01).
   */
  async resolveMatchingZones(storeId: number, address: AddressDTO) {
    const zones = await this.prisma.shipping_zones.findMany({
      where: { store_id: storeId, is_active: true },
    });

    const candidates = zones.filter((zone) => {
      // 1. País (obligatorio si la zona restringe países)
      if (zone.countries && zone.countries.length > 0) {
        if (!countryCodeInList(address.country_code, zone.countries)) {
          return false;
        }
      }

      // 2. Prevalencia de coincidencia de Ciudad (ADR-02 / F-002):
      // Si la zona restringe por ciudades específicas, la ciudad es la restricción
      // más granular. Si la ciudad coincide explícitamente, dicha coincidencia
      // prevalece sobre discrepancias o ausencia en el departamento.
      const hasCityConstraint = Boolean(zone.cities && zone.cities.length > 0);
      const cityMatches =
        hasCityConstraint && geoNameInList(address.city, zone.cities);

      if (hasCityConstraint) {
        if (!cityMatches) return false;
        // Si la zona también define regiones, sólo descartamos si la dirección
        // trae un departamento utilizable que pertenezca explícitamente a otra
        // región distinta (evita descartar por IDs numéricos como "19" o nombres vacíos).
        if (
          zone.regions &&
          zone.regions.length > 0 &&
          isUsableGeoName(address.state_province) &&
          !geoNameInList(address.state_province, zone.regions)
        ) {
          return false;
        }
      } else {
        // Zona sin ciudades: jerarquía por departamento/región estricta
        if (zone.regions && zone.regions.length > 0) {
          if (!geoNameInList(address.state_province, zone.regions)) return false;
        }
      }

      // 3. Código Postal:
      // Si la zona coincide explícitamente por municipio/ciudad (hasCityConstraint && cityMatches),
      // el código postal NO descarta la zona: todas las tarifas del municipio
      // aplican y se presentan al comprador. El código postal se utiliza para
      // priorizar y preseleccionar la tarifa exacta.
      // Si la zona NO tiene restricción de ciudad pero sí de código postal,
      // ahí sí el código postal es filtro excluyente.
      if (
        !hasCityConstraint &&
        zone.zip_codes &&
        zone.zip_codes.length > 0 &&
        address.postal_code
      ) {
        if (!postalCodeInList(address.postal_code, zone.zip_codes)) {
          return false;
        }
      }

      return true;
    });

    candidates.sort((a, b) => {
      const scoreA = this.getSpecificityScore(a, address);
      const scoreB = this.getSpecificityScore(b, address);
      return scoreB - scoreA; // Descendente por especificidad
    });

    return candidates;
  }

  /**
   * Encuentra la zona más específica coincidente para una dirección (compatibilidad histórica).
   */
  async resolveZone(storeId: number, address: AddressDTO) {
    const candidates = await this.resolveMatchingZones(storeId, address);

    if (candidates.length === 0) {
      this.logger.warn(
        `Ninguna zona activa de la tienda ${storeId} cubre la dirección ` +
          `${JSON.stringify({
            country_code: address.country_code,
            state_province: address.state_province,
            city: address.city,
            postal_code: address.postal_code,
          })}.`,
      );
    }

    return candidates.length > 0 ? candidates[0] : null;
  }

  private getSpecificityScore(zone: any, address?: AddressDTO): number {
    let score = 0;
    const hasExactZipMatch = Boolean(
      address?.postal_code &&
        zone.zip_codes &&
        zone.zip_codes.length > 0 &&
        postalCodeInList(address.postal_code, zone.zip_codes),
    );
    if (hasExactZipMatch) score += 1000;
    if (zone.cities && zone.cities.length > 0) score += 100;
    if (zone.regions && zone.regions.length > 0) score += 10;
    if (zone.countries && zone.countries.length > 0) score += 1;
    return score;
  }

  private getCartTotals(items: CartItemDTO[]) {
    return items.reduce(
      (acc, item) => {
        const isPhysical =
          !item.product_type || item.product_type === 'physical';
        return {
          totalWeight: acc.totalWeight + (isPhysical ? item.weight || 0 : 0),
          totalPrice: acc.totalPrice + item.price,
          hasPhysicalItems: acc.hasPhysicalItems || isPhysical,
        };
      },
      { totalWeight: 0, totalPrice: 0, hasPhysicalItems: false },
    );
  }

  private isInRange(
    value: number,
    min: number | null,
    max: number | null,
  ): boolean {
    // If min is defined, value must be >= min
    if (min !== null && min !== undefined && value < min) return false;
    // If max is defined, value must be <= max
    // If max is 0 or null, it often means "no upper limit" in some systems,
    // OR it means strict 0. In Vendix schema, nullable Decimal.
    // Let's assume null/undefined means infinity.
    if (max !== null && max !== undefined && max > 0 && value > max)
      return false;

    return true;
  }
}
