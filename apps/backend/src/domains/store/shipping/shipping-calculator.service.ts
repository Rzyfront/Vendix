import { Injectable, NotFoundException } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { shipping_rate_type_enum } from '@prisma/client';
import { SettingsService } from '../settings/settings.service';

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
    price: number;   // Total price for this line item
}

export interface ShippingOption {
    id: number; // Unique identifier (rate_id)
    method_id: number;
    method_name: string;
    method_type: string; // 'pickup' | 'own_fleet' | 'carrier' | etc.
    cost: number;
    currency: string;
    estimated_days?: { min: number; max: number };
}

@Injectable()
export class ShippingCalculatorService {
    constructor(
        private prisma: StorePrismaService,
        private settingsService: SettingsService,
    ) { }

    /**
     * Main entry point to calculate shipping rates for a cart and address
     */
    async calculateRates(storeId: number, items: CartItemDTO[], address: AddressDTO): Promise<ShippingOption[]> {
        // 1. Resolve Zone
        const zone = await this.resolveZone(storeId, address);
        if (!zone) {
            return []; // No delivery to this zone
        }

        // 2. Fetch available methods and rates for this zone
        const rates = await this.prisma.shipping_rates.findMany({
            where: {
                shipping_zone_id: zone.id,
                is_active: true,
                shipping_method: {
                    is_active: true
                }
            },
            include: {
                shipping_method: true
            }
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
                    if (this.isInRange(cartTotals.totalWeight, Number(rate.min_val), Number(rate.max_val))) {
                        isApplicable = true;
                        cost = Number(rate.base_cost) + (Number(rate.per_unit_cost || 0) * cartTotals.totalWeight);
                    }
                    break;

                case shipping_rate_type_enum.price_based:
                    // Check if cart price is within range
                    if (this.isInRange(cartTotals.totalPrice, Number(rate.min_val), Number(rate.max_val))) {
                        isApplicable = true;
                        cost = Number(rate.base_cost); // Usually base cost for price tier
                    }
                    break;

                case shipping_rate_type_enum.free:
                    // Free shipping usually applies if criteria met, often used as override. 
                    // For now, simple implementation logic can be: always applicable if in zone? 
                    // Or maybe it has conditions in min_val (price)?
                    // Let's assume it checks min price (min_val)
                    if (this.isInRange(cartTotals.totalPrice, Number(rate.min_val), Number(rate.max_val))) {
                        isApplicable = true;
                        cost = 0;
                    }
                    break;
            }

            // Free shipping threshold override (common in flat/weight strategies)
            if (isApplicable && rate.free_shipping_threshold && cartTotals.totalPrice >= Number(rate.free_shipping_threshold)) {
                cost = 0;
            }

            if (isApplicable) {
                options.push({
                    id: rate.id,
                    method_id: rate.shipping_method_id,
                    method_name: rate.name || rate.shipping_method.name,
                    method_type: rate.shipping_method.type, // 'pickup' | 'own_fleet' | 'carrier' | etc.
                    cost: cost,
                    currency: storeCurrency,
                    estimated_days: {
                        min: rate.shipping_method.min_days || 0,
                        max: rate.shipping_method.max_days || 0
                    }
                });
            }
        }

        return options;
    }

    /**
     * Finds the most specific matching zone for an address
     */
    async resolveZone(storeId: number, address: AddressDTO) {
        // Fetch all active zones for the store
        const zones = await this.prisma.shipping_zones.findMany({
            where: { store_id: storeId, is_active: true }
        });

        // Priority Logic:
        // 1. Exact Zip Code Match
        // 2. City Match
        // 3. Region/State Match
        // 4. Country Match
        // 5. "Rest of World" (if specific wildcards used - not implemented yet)

        // Filter zones that match the address
        const candidates = zones.filter(zone => {
            // Check Country (Mandatory match if zone has countries defined)
            if (zone.countries && zone.countries.length > 0) {
                if (!zone.countries.includes(address.country_code)) return false;
            }

            // Check State/Region
            if (zone.regions && zone.regions.length > 0 && address.state_province) {
                // If zone defines regions, address must match one
                // Implementation detail: Are regions codes or names? Assuming codes/strings match
                if (!zone.regions.includes(address.state_province)) {
                    // If regions are defined but don't match, check if it's purely city based within country?
                    // Usually strict hierarchy: Country > Region > City
                    // If region doesn't match, zone is invalid
                    return false;
                }
            }

            // Check City
            if (zone.cities && zone.cities.length > 0 && address.city) {
                if (!zone.cities.includes(address.city)) return false;
            }

            // Check Zip
            if (zone.zip_codes && zone.zip_codes.length > 0 && address.postal_code) {
                if (!zone.zip_codes.includes(address.postal_code)) return false;
            }

            return true;
        });

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
        return items.reduce((acc, item) => {
            return {
                totalWeight: acc.totalWeight + (item.weight || 0),
                totalPrice: acc.totalPrice + (item.price)
            };
        }, { totalWeight: 0, totalPrice: 0 });
    }

    private isInRange(value: number, min: number | null, max: number | null): boolean {
        // If min is defined, value must be >= min
        if (min !== null && min !== undefined && value < min) return false;
        // If max is defined, value must be <= max
        // If max is 0 or null, it often means "no upper limit" in some systems, 
        // OR it means strict 0. In Vendix schema, nullable Decimal.
        // Let's assume null/undefined means infinity. 
        if (max !== null && max !== undefined && max > 0 && value > max) return false;

        return true;
    }
}
