import { Injectable, NotFoundException } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import {
    CreateShippingMethodDto,
    UpdateShippingMethodDto,
    CreateShippingZoneDto,
    UpdateShippingZoneDto,
    CreateShippingRateDto,
    UpdateShippingRateDto,
} from './dto/shipping.dto';

@Injectable()
export class ShippingService {
    constructor(private prisma: StorePrismaService) { }

    // --- METHODS ---
    async getMethods(storeId: number) {
        return this.prisma.shipping_methods.findMany({
            where: { store_id: storeId },
            orderBy: { display_order: 'asc' },
        });
    }

    async createMethod(storeId: number, dto: CreateShippingMethodDto) {
        return this.prisma.shipping_methods.create({
            data: {
                ...dto,
                store_id: storeId,
            },
        });
    }

    async updateMethod(storeId: number, id: number, dto: UpdateShippingMethodDto) {
        await this.verifyMethodOwnership(storeId, id);
        return this.prisma.shipping_methods.update({
            where: { id },
            data: dto,
        });
    }

    async deleteMethod(storeId: number, id: number) {
        await this.verifyMethodOwnership(storeId, id);
        return this.prisma.shipping_methods.delete({
            where: { id },
        });
    }

    private async verifyMethodOwnership(storeId: number, methodId: number) {
        const method = await this.prisma.shipping_methods.findFirst({
            where: { id: methodId, store_id: storeId },
        });
        if (!method) throw new NotFoundException('Shipping method not found');
    }

    // --- ZONES ---
    async getZones(storeId: number) {
        return this.prisma.shipping_zones.findMany({
            where: { store_id: storeId },
            include: {
                shipping_rates: {
                    include: {
                        shipping_method: true
                    }
                }
            }
        });
    }

    async createZone(storeId: number, dto: CreateShippingZoneDto) {
        return this.prisma.shipping_zones.create({
            data: {
                ...dto,
                store_id: storeId,
            },
        });
    }

    async updateZone(storeId: number, id: number, dto: UpdateShippingZoneDto) {
        await this.verifyZoneOwnership(storeId, id);
        return this.prisma.shipping_zones.update({
            where: { id },
            data: dto,
        });
    }

    async deleteZone(storeId: number, id: number) {
        await this.verifyZoneOwnership(storeId, id);
        return this.prisma.shipping_zones.delete({
            where: { id },
        });
    }

    private async verifyZoneOwnership(storeId: number, zoneId: number) {
        const zone = await this.prisma.shipping_zones.findFirst({
            where: { id: zoneId, store_id: storeId },
        });
        if (!zone) throw new NotFoundException('Shipping zone not found');
    }

    // --- RATES ---
    async getRates(storeId: number, zoneId: number) {
        await this.verifyZoneOwnership(storeId, zoneId);
        return this.prisma.shipping_rates.findMany({
            where: { shipping_zone_id: zoneId },
            include: { shipping_method: true },
        });
    }

    async createRate(storeId: number, dto: CreateShippingRateDto) {
        // Verify Zone Ownership
        await this.verifyZoneOwnership(storeId, dto.shipping_zone_id);
        // Verify Method Ownership
        await this.verifyMethodOwnership(storeId, dto.shipping_method_id);

        return this.prisma.shipping_rates.create({
            data: dto,
        });
    }

    async updateRate(storeId: number, rateId: number, dto: UpdateShippingRateDto) {
        const rate = await this.prisma.shipping_rates.findUnique({ where: { id: rateId }, include: { shipping_zone: true } });
        if (!rate || rate.shipping_zone.store_id !== storeId) {
            throw new NotFoundException('Rate not found');
        }

        return this.prisma.shipping_rates.update({
            where: { id: rateId },
            data: dto
        })
    }

    async deleteRate(storeId: number, rateId: number) {
        const rate = await this.prisma.shipping_rates.findUnique({ where: { id: rateId }, include: { shipping_zone: true } });
        if (!rate || rate.shipping_zone.store_id !== storeId) {
            throw new NotFoundException('Rate not found');
        }

        return this.prisma.shipping_rates.delete({
            where: { id: rateId }
        })
    }
}
