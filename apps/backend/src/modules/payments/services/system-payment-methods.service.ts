import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateSystemPaymentMethodDto,
  UpdateSystemPaymentMethodDto,
} from '../dto';

@Injectable()
export class SystemPaymentMethodsService {
  constructor(private prisma: PrismaService) { }

  /**
   * Get all system payment methods
   * Only super_admin can see all, others see only active ones
   */
  async findAll(user: any) {
    const where: any = {};

    if (!user.roles?.includes('super_admin')) {
      where.is_active = true;
    }

    return this.prisma.system_payment_methods.findMany({
      where,
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Get single system payment method by ID
   */
  async findOne(id: number, user: any) {
    const where: any = { id };

    if (!user.roles?.includes('super_admin')) {
      where.is_active = true;
    }

    const method = await this.prisma.system_payment_methods.findFirst({
      where,
      include: {
        _count: {
          select: { store_payment_methods: true },
        },
      },
    });

    if (!method) {
      throw new NotFoundException('System payment method not found');
    }

    return method;
  }

  /**
   * Create new system payment method
   * Only super_admin
   */
  async create(createDto: CreateSystemPaymentMethodDto, user: any) {
    if (!user.roles?.includes('super_admin')) {
      throw new ForbiddenException(
        'Only super admins can create system payment methods',
      );
    }

    // Check if name already exists
    const existing = await this.prisma.system_payment_methods.findUnique({
      where: { name: createDto.name },
    });

    if (existing) {
      throw new BadRequestException(
        `System payment method with name '${createDto.name}' already exists`,
      );
    }

    return this.prisma.system_payment_methods.create({
      data: {
        ...createDto,
        is_active: true,
      },
    });
  }

  /**
   * Update system payment method
   * Only super_admin
   */
  async update(id: number, updateDto: UpdateSystemPaymentMethodDto, user: any) {
    if (!user.roles?.includes('super_admin')) {
      throw new ForbiddenException(
        'Only super admins can update system payment methods',
      );
    }

    const method = await this.prisma.system_payment_methods.findUnique({
      where: { id },
    });

    if (!method) {
      throw new NotFoundException('System payment method not found');
    }

    return this.prisma.system_payment_methods.update({
      where: { id },
      data: updateDto,
    });
  }

  /**
   * Toggle active status
   * Only super_admin
   */
  async toggleActive(id: number, user: any) {
    if (!user.roles?.includes('super_admin')) {
      throw new ForbiddenException(
        'Only super admins can toggle system payment methods',
      );
    }

    const method = await this.prisma.system_payment_methods.findUnique({
      where: { id },
    });

    if (!method) {
      throw new NotFoundException('System payment method not found');
    }

    return this.prisma.system_payment_methods.update({
      where: { id },
      data: { is_active: !method.is_active },
    });
  }

  /**
   * Delete system payment method
   * Only super_admin
   * Only if not used by any store
   */
  async remove(id: number, user: any) {
    if (!user.roles?.includes('super_admin')) {
      throw new ForbiddenException(
        'Only super admins can delete system payment methods',
      );
    }

    const method = await this.prisma.system_payment_methods.findUnique({
      where: { id },
      include: {
        _count: {
          select: { store_payment_methods: true },
        },
      },
    });

    if (!method) {
      throw new NotFoundException('System payment method not found');
    }

    if (method._count.store_payment_methods > 0) {
      throw new BadRequestException(
        `Cannot delete system payment method '${method.name}' because it is being used by ${method._count.store_payment_methods} store(s)`,
      );
    }

    await this.prisma.system_payment_methods.delete({
      where: { id },
    });

    return { success: true, message: 'System payment method deleted' };
  }
}
