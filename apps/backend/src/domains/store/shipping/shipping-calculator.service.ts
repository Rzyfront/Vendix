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
    // 1. Resolve Zone
    const zone = await this.resolveZone(storeId, address);
    if (!zone) {
      // Sin zona que cubra la dirección. Antes esto devolvía `[]` a secas y el
      // checkout quedaba sin salida. Ahora ofrecemos retiro en tienda si —y
      // sólo si— la tienda tiene un punto físico en la misma ciudad.
      return this.getPickupFallbackOptions(storeId, address);
    }

    // 2. Fetch available methods and rates for this zone.
    //    El `orderBy` es obligatorio: el storefront auto-selecciona la primera
    //    opción, y sin orden estable esa elección cambiaba entre requests
    //    (y con ella los métodos de pago ofrecidos, que se filtran por el
    //    tipo del método de envío elegido).
    const rates = await this.prisma.shipping_rates.findMany({
      where: {
        shipping_zone_id: zone.id,
        is_active: true,
        shipping_method: {
          is_active: true,
        },
      },
      include: {
        shipping_method: true,
      },
      orderBy: [
        { shipping_method: { display_order: 'asc' } },
        { shipping_method_id: 'asc' },
        { id: 'asc' },
      ],
    });

    const options: ShippingOption[] = [];
    const cartTotals = this.getCartTotals(items);
    const storeCurrency = await this.settingsService.getStoreCurrency();

    // 3. Process rates
    for (const rate of rates) {
      let cost = 0;
      let isApplicable = false;

      switch (rate.type) {
        case shipping_rate_type_enum.flat:
          isApplicable = true;
          cost = Number(rate.base_cost);
          break;

        case shipping_rate_type_enum.weight_based:
          // Check if cart weight is within range
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
          // Check if cart price is within range
          if (
            this.isInRange(
              cartTotals.totalPrice,
              Number(rate.min_val),
              Number(rate.max_val),
            )
          ) {
            isApplicable = true;
            cost = Number(rate.base_cost); // Usually base cost for price tier
          }
          break;

        case shipping_rate_type_enum.free:
          // Free shipping usually applies if criteria met, often used as override.
          // For now, simple implementation logic can be: always applicable if in zone?
          // Or maybe it has conditions in min_val (price)?
          // Let's assume it checks min price (min_val)
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
          // `carrier_calculated` (y cualquier tipo futuro) cae acá. Antes se
          // descartaba en silencio con `isApplicable = false`, dejando al
          // comprador sin opciones y sin rastro en los logs.
          this.logger.warn(
            `Tarifa ${rate.id} (zona ${zone.id}) usa el tipo '${rate.type}', ` +
              'que el calculador todavía no sabe cotizar: se omite de las ' +
              'opciones de envío.',
          );
          break;
      }

      // Free shipping threshold override (common in flat/weight strategies)
      if (
        isApplicable &&
        rate.free_shipping_threshold &&
        cartTotals.totalPrice >= Number(rate.free_shipping_threshold)
      ) {
        cost = 0;
      }

      if (isApplicable) {
        options.push({
          id: rate.id,
          rate_id: rate.id,
          method_id: rate.shipping_method_id,
          method_name: rate.name || rate.shipping_method.name,
          method_type: rate.shipping_method.type, // 'pickup' | 'own_fleet' | 'carrier' | etc.
          cost: cost,
          currency: storeCurrency,
          estimated_days: {
            min: rate.shipping_method.min_days || 0,
            max: rate.shipping_method.max_days || 0,
          },
          zone_id: zone.id,
          is_fallback: false,
        });
      }
    }

    if (options.length === 0) {
      // La zona cubre la dirección pero ninguna tarifa resultó aplicable
      // (rangos de peso/precio, tipos no soportados, todas inactivas). Para el
      // comprador es indistinguible de "no hay cobertura", así que le damos la
      // misma salida.
      this.logger.warn(
        `Zona ${zone.id} cubre la dirección pero ninguna de sus ${rates.length} ` +
          'tarifas resultó aplicable al carrito.',
      );
      return this.getPickupFallbackOptions(storeId, address);
    }

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

      options.push({
        id: rate.id,
        rate_id: rate.id,
        method_id: rate.shipping_method_id,
        method_name: rate.name || rate.shipping_method.name,
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
   * Finds the most specific matching zone for an address
   */
  async resolveZone(storeId: number, address: AddressDTO) {
    // Fetch all active zones for the store
    const zones = await this.prisma.shipping_zones.findMany({
      where: { store_id: storeId, is_active: true },
    });

    // Priority Logic:
    // 1. Exact Zip Code Match
    // 2. City Match
    // 3. Region/State Match
    // 4. Country Match
    // 5. Cobertura amplia: una zona sin `regions`/`cities`/`zip_codes` cubre
    //    todo el país. No es un caso especial en el código — cae solo, con el
    //    menor puntaje de especificidad, así que cualquier zona más precisa le
    //    gana. Es la forma de configurar "resto del país".
    //
    // Todas las comparaciones son por forma NORMALIZADA (sin tildes, sin
    // mayúsculas, sin espacios de más, sin sufijos administrativos). Compararlas
    // crudas hacía que `"Bogotá D.C."` no matcheara una zona escrita `"Bogotá"`
    // y el comprador quedara sin ninguna opción de envío.
    const candidates = zones.filter((zone) => {
      // Check Country (Mandatory match if zone has countries defined)
      if (zone.countries && zone.countries.length > 0) {
        if (!countryCodeInList(address.country_code, zone.countries)) {
          return false;
        }
      }

      // Check State/Region. Jerarquía estricta: si la zona restringe por
      // región y la dirección no trae una región utilizable, la zona NO aplica.
      // Antes la restricción se omitía y la zona matcheaba de más.
      if (zone.regions && zone.regions.length > 0) {
        if (!geoNameInList(address.state_province, zone.regions)) return false;
      }

      // Check City — misma regla estricta que la región.
      if (zone.cities && zone.cities.length > 0) {
        if (!geoNameInList(address.city, zone.cities)) return false;
      }

      // Check Zip — el código postal es opcional en la mayoría de las
      // direcciones colombianas, así que sólo descarta cuando la dirección
      // efectivamente trae uno y no coincide.
      if (zone.zip_codes && zone.zip_codes.length > 0 && address.postal_code) {
        if (!postalCodeInList(address.postal_code, zone.zip_codes)) {
          return false;
        }
      }

      return true;
    });

    if (candidates.length === 0 && zones.length > 0) {
      this.logger.warn(
        `Ninguna de las ${zones.length} zonas activas de la tienda ${storeId} ` +
          `cubre la dirección ${JSON.stringify({
            country_code: address.country_code,
            state_province: address.state_province,
            city: address.city,
          })}.`,
      );
    }

    // Sort candidates by specificity (more constraints = more specific)
    candidates.sort((a, b) => {
      const scoreA = this.getSpecificityScore(a);
      const scoreB = this.getSpecificityScore(b);
      return scoreB - scoreA; // Descending score
    });

    return candidates.length > 0 ? candidates[0] : null;
  }

  private getSpecificityScore(zone: any): number {
    let score = 0;
    if (zone.zip_codes && zone.zip_codes.length > 0) score += 1000;
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
