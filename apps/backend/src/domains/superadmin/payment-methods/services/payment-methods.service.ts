import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { S3Service } from '@common/services/s3.service';
import { CreatePaymentMethodDto, UpdatePaymentMethodDto } from '../dto';

@Injectable()
export class PaymentMethodsService {
  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly s3Service: S3Service,
  ) {}

  async create(createPaymentMethodDto: CreatePaymentMethodDto) {
    const { name } = createPaymentMethodDto;

    const existingMethod =
      await this.globalPrisma.system_payment_methods.findUnique({
        where: { name },
      });

    if (existingMethod) {
      throw new ConflictException(`Payment method '${name}' already exists`);
    }

    return this.globalPrisma.system_payment_methods.create({
      data: {
        ...createPaymentMethodDto,
        is_active: true,
      },
    });
  }

  async findAll() {
    const methods = await this.globalPrisma.system_payment_methods.findMany({
      orderBy: { name: 'asc' },
    });

    return Promise.all(
      methods.map(async (method) => ({
        ...method,
        logo_url: method.logo_url
          ? await this.s3Service.signUrl(method.logo_url)
          : null,
      })),
    );
  }

  async findOne(id: number) {
    if (!id || isNaN(id)) {
      throw new NotFoundException('Invalid payment method ID');
    }

    const method = await this.globalPrisma.system_payment_methods.findUnique({
      where: { id },
      include: {
        _count: {
          select: { store_payment_methods: true },
        },
      },
    });

    if (!method) {
      throw new NotFoundException('Payment method not found');
    }

    return {
      ...method,
      logo_url: method.logo_url
        ? await this.s3Service.signUrl(method.logo_url)
        : null,
    };
  }

  async update(id: number, updatePaymentMethodDto: UpdatePaymentMethodDto) {
    await this.findOne(id);

    return this.globalPrisma.system_payment_methods.update({
      where: { id },
      data: updatePaymentMethodDto,
    });
  }

  async remove(id: number) {
    const method = await this.findOne(id);

    if (method._count.store_payment_methods > 0) {
      throw new ConflictException(
        `Cannot delete payment method because it is being used by ${method._count.store_payment_methods} store(s)`,
      );
    }

    return this.globalPrisma.system_payment_methods.delete({
      where: { id },
    });
  }

  async toggleActive(id: number) {
    const method = await this.findOne(id);

    return this.globalPrisma.system_payment_methods.update({
      where: { id },
      data: { is_active: !method.is_active },
    });
  }

  async getStats() {
    const [total, active, inactive, requiringConfig] = await Promise.all([
      this.globalPrisma.system_payment_methods.count(),
      this.globalPrisma.system_payment_methods.count({
        where: { is_active: true },
      }),
      this.globalPrisma.system_payment_methods.count({
        where: { is_active: false },
      }),
      this.globalPrisma.system_payment_methods.count({
        where: { requires_config: true },
      }),
    ]);

    const storesUsingMethods =
      await this.globalPrisma.store_payment_methods.groupBy({
        by: ['store_id'],
      });

    return {
      total_methods: total,
      active_methods: active,
      inactive_methods: inactive,
      methods_requiring_config: requiringConfig,
      total_stores_using_methods: storesUsingMethods.length,
    };
  }
}
