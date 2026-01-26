import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import {
  CreateSystemShippingMethodDto,
  UpdateSystemShippingMethodDto,
  CreateSystemShippingZoneDto,
  UpdateSystemShippingZoneDto,
  CreateSystemShippingRateDto,
  UpdateSystemShippingRateDto,
} from '../dto/shipping.dto';

@Injectable()
export class ShippingService {
  constructor(private readonly globalPrisma: GlobalPrismaService) {}

  // ==========================================
  // SYSTEM SHIPPING METHODS
  // ==========================================

  async getMethods() {
    return this.globalPrisma.shipping_methods.findMany({
      orderBy: {
        name: 'asc',
      },
    });
  }

  async getMethod(id: number) {
    if (!id || isNaN(id)) {
      throw new NotFoundException('Invalid shipping method ID');
    }

    const method = await this.globalPrisma.shipping_methods.findFirst({
      where: {
        id,
      },
      include: {
        _count: {
          select: { shipping_rates: true },
        },
      },
    });

    if (!method) {
      throw new NotFoundException('System shipping method not found');
    }

    return method;
  }

  async createMethod(createDto: CreateSystemShippingMethodDto) {
    return this.globalPrisma.shipping_methods.create({
      data: {
        ...createDto,
        is_active: createDto.is_active ?? true,
      } as any,
    });
  }

  async updateMethod(id: number, updateDto: UpdateSystemShippingMethodDto) {
    await this.getMethod(id);

    return this.globalPrisma.shipping_methods.update({
      where: { id },
      data: updateDto,
    });
  }

  async deleteMethod(id: number) {
    const method = await this.getMethod(id);

    if ((method as any)._count?.shipping_rates > 0) {
      throw new ConflictException(
        `Cannot delete shipping method because it is being used by ${(method as any)._count.shipping_rates} rate(s)`,
      );
    }

    return this.globalPrisma.shipping_methods.delete({
      where: { id },
    });
  }

  async getMethodStats() {
    const [total, active, inactive] = await Promise.all([
      this.globalPrisma.shipping_methods.count(),
      this.globalPrisma.shipping_methods.count({
        where: { is_active: true },
      }),
      this.globalPrisma.shipping_methods.count({
        where: { is_active: false },
      }),
    ]);

    return {
      total_methods: total,
      active_methods: active,
      inactive_methods: inactive,
    };
  }

  // ==========================================
  // SYSTEM SHIPPING ZONES
  // ==========================================

  async getZones() {
    return this.globalPrisma.shipping_zones.findMany({
      include: {
        shipping_rates: {
          include: {
            shipping_methods: true,
          },
        },
        _count: {
          select: { shipping_rates: true },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  async getZone(id: number) {
    if (!id || isNaN(id)) {
      throw new NotFoundException('Invalid shipping zone ID');
    }

    const zone = await this.globalPrisma.shipping_zones.findFirst({
      where: {
        id,
      },
      include: {
        shipping_rates: {
          include: {
            shipping_methods: true,
          },
        },
        _count: {
          select: { shipping_rates: true },
        },
      },
    });

    if (!zone) {
      throw new NotFoundException('System shipping zone not found');
    }

    return zone;
  }

  async createZone(createDto: CreateSystemShippingZoneDto) {
    return this.globalPrisma.shipping_zones.create({
      data: {
        ...createDto,
        is_active: createDto.is_active ?? true,
      } as any,
    });
  }

  async updateZone(id: number, updateDto: UpdateSystemShippingZoneDto) {
    await this.getZone(id);

    return this.globalPrisma.shipping_zones.update({
      where: { id },
      data: updateDto,
    });
  }

  async deleteZone(id: number) {
    const zone = await this.getZone(id);

    if ((zone as any)._count?.shipping_rates > 0) {
      throw new ConflictException(
        `Cannot delete shipping zone because it has ${(zone as any)._count.shipping_rates} rate(s)`,
      );
    }

    return this.globalPrisma.shipping_zones.delete({
      where: { id },
    });
  }

  async getZoneStats() {
    const [total, active, inactive] = await Promise.all([
      this.globalPrisma.shipping_zones.count(),
      this.globalPrisma.shipping_zones.count({
        where: { is_active: true },
      }),
      this.globalPrisma.shipping_zones.count({
        where: { is_active: false },
      }),
    ]);

    return {
      total_zones: total,
      active_zones: active,
      inactive_zones: inactive,
    };
  }

  // ==========================================
  // SYSTEM SHIPPING RATES
  // ==========================================

  async getRates(zoneId: number) {
    // Verify zone exists and is system
    await this.getZone(zoneId);

    return this.globalPrisma.shipping_rates.findMany({
      where: {
        shipping_zone_id: zoneId,
      },
      include: {
        shipping_methods: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  async getRate(id: number) {
    if (!id || isNaN(id)) {
      throw new NotFoundException('Invalid shipping rate ID');
    }

    const rate = await this.globalPrisma.shipping_rates.findFirst({
      where: {
        id,
      },
      include: {
        shipping_methods: true,
        shipping_zones: true,
      },
    });

    if (!rate) {
      throw new NotFoundException('System shipping rate not found');
    }

    return rate;
  }

  async createRate(createDto: CreateSystemShippingRateDto) {
    // Verify zone exists and is system
    const zone = await this.globalPrisma.shipping_zones.findFirst({
      where: {
        id: createDto.shipping_zone_id,
      },
    });

    if (!zone) {
      throw new NotFoundException('System shipping zone not found');
    }

    // Verify method exists and is system
    const method = await this.globalPrisma.shipping_methods.findFirst({
      where: {
        id: createDto.shipping_method_id,
      },
    });

    if (!method) {
      throw new NotFoundException('System shipping method not found');
    }

    return this.globalPrisma.shipping_rates.create({
      data: {
        ...createDto,
        is_active: createDto.is_active ?? true,
      },
    });
  }

  async updateRate(id: number, updateDto: UpdateSystemShippingRateDto) {
    await this.getRate(id);

    // If updating zone_id, verify new zone is system
    if (updateDto.shipping_zone_id) {
      const zone = await this.globalPrisma.shipping_zones.findFirst({
        where: {
          id: updateDto.shipping_zone_id,
        },
      });

      if (!zone) {
        throw new NotFoundException('System shipping zone not found');
      }
    }

    // If updating method_id, verify new method is system
    if (updateDto.shipping_method_id) {
      const method = await this.globalPrisma.shipping_methods.findFirst({
        where: {
          id: updateDto.shipping_method_id,
        },
      });

      if (!method) {
        throw new NotFoundException('System shipping method not found');
      }
    }

    return this.globalPrisma.shipping_rates.update({
      where: { id },
      data: updateDto,
    });
  }

  async deleteRate(id: number) {
    await this.getRate(id);

    return this.globalPrisma.shipping_rates.delete({
      where: { id },
    });
  }
}
