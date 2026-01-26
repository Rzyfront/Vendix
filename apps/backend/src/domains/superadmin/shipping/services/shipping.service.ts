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
      where: {
        is_system: true,
      },
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
        is_system: true,
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
        is_system: true,
        store_id: null,
        is_active: createDto.is_active ?? true,
      },
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

    if (method._count.shipping_rates > 0) {
      throw new ConflictException(
        `Cannot delete shipping method because it is being used by ${method._count.shipping_rates} rate(s)`,
      );
    }

    return this.globalPrisma.shipping_methods.delete({
      where: { id },
    });
  }

  async getMethodStats() {
    const [total, active, inactive] = await Promise.all([
      this.globalPrisma.shipping_methods.count({
        where: { is_system: true },
      }),
      this.globalPrisma.shipping_methods.count({
        where: { is_system: true, is_active: true },
      }),
      this.globalPrisma.shipping_methods.count({
        where: { is_system: true, is_active: false },
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
      where: {
        is_system: true,
      },
      include: {
        shipping_rates: {
          include: {
            shipping_method: true,
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
        is_system: true,
      },
      include: {
        shipping_rates: {
          include: {
            shipping_method: true,
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
        is_system: true,
        store_id: null,
        is_active: createDto.is_active ?? true,
      },
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

    if (zone._count.shipping_rates > 0) {
      throw new ConflictException(
        `Cannot delete shipping zone because it has ${zone._count.shipping_rates} rate(s)`,
      );
    }

    return this.globalPrisma.shipping_zones.delete({
      where: { id },
    });
  }

  async getZoneStats() {
    const [total, active, inactive] = await Promise.all([
      this.globalPrisma.shipping_zones.count({
        where: { is_system: true },
      }),
      this.globalPrisma.shipping_zones.count({
        where: { is_system: true, is_active: true },
      }),
      this.globalPrisma.shipping_zones.count({
        where: { is_system: true, is_active: false },
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
        shipping_zone: {
          is_system: true,
        },
      },
      include: {
        shipping_method: true,
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
        shipping_zone: {
          is_system: true,
        },
      },
      include: {
        shipping_method: true,
        shipping_zone: true,
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
        is_system: true,
      },
    });

    if (!zone) {
      throw new NotFoundException('System shipping zone not found');
    }

    // Verify method exists and is system
    const method = await this.globalPrisma.shipping_methods.findFirst({
      where: {
        id: createDto.shipping_method_id,
        is_system: true,
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
          is_system: true,
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
          is_system: true,
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
