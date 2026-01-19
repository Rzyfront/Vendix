import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { ResponseService } from '../../../common/responses/response.service';
import { CreateCurrencyDto, UpdateCurrencyDto, CurrencyQueryDto, currency_state_enum } from './dto';

@Injectable()
export class CurrenciesService {
  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly responseService: ResponseService,
  ) {}

  async create(createCurrencyDto: CreateCurrencyDto) {
    // Check if currency code already exists
    const existing = await this.globalPrisma.currencies.findUnique({
      where: { code: createCurrencyDto.code },
    });

    if (existing) {
      throw new ConflictException(`Currency with code ${createCurrencyDto.code} already exists`);
    }

    const currency = await this.globalPrisma.currencies.create({
      data: {
        code: createCurrencyDto.code,
        name: createCurrencyDto.name,
        symbol: createCurrencyDto.symbol,
        decimal_places: createCurrencyDto.decimal_places,
        state: createCurrencyDto.state || currency_state_enum.ACTIVE,
      },
    });

    return this.responseService.success(currency, 'Currency created successfully');
  }

  async findAll(query: CurrencyQueryDto) {
    const { page = 1, limit = 10, search, state } = query;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (search) {
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (state) {
      where.state = state;
    }

    const [data, total] = await Promise.all([
      this.globalPrisma.currencies.findMany({
        where,
        skip,
        take: limit,
        orderBy: { code: 'asc' },
      }),
      this.globalPrisma.currencies.count({ where }),
    ]);

    return this.responseService.paginated(data, total, page, limit);
  }

  async findOne(code: string) {
    const currency = await this.globalPrisma.currencies.findUnique({
      where: { code },
    });

    if (!currency) {
      throw new NotFoundException(`Currency with code ${code} not found`);
    }

    return this.responseService.success(currency, 'Currency retrieved successfully');
  }

  async update(code: string, updateCurrencyDto: UpdateCurrencyDto) {
    const currency = await this.globalPrisma.currencies.findUnique({
      where: { code },
    });

    if (!currency) {
      throw new NotFoundException(`Currency with code ${code} not found`);
    }

    // Check if name is being changed and if it conflicts with existing currency
    if (updateCurrencyDto.name && updateCurrencyDto.name !== currency.name) {
      const existing = await this.globalPrisma.currencies.findFirst({
        where: {
          name: updateCurrencyDto.name,
          code: { not: code },
        },
      });

      if (existing) {
        throw new ConflictException(`Currency with name ${updateCurrencyDto.name} already exists`);
      }
    }

    const updated = await this.globalPrisma.currencies.update({
      where: { code },
      data: updateCurrencyDto,
    });

    return this.responseService.success(updated, 'Currency updated successfully');
  }

  async remove(code: string) {
    const currency = await this.globalPrisma.currencies.findUnique({
      where: { code },
    });

    if (!currency) {
      throw new NotFoundException(`Currency with code ${code} not found`);
    }

    if (currency.state === currency_state_enum.ACTIVE) {
      throw new BadRequestException('Cannot delete active currency. Please deactivate it first.');
    }

    // Check usage count
    const [ordersCount, paymentsCount] = await Promise.all([
      this.globalPrisma.orders.count({ where: { currency: code } }),
      this.globalPrisma.payments.count({ where: { currency: code } }),
    ]);

    if (ordersCount > 0 || paymentsCount > 0) {
      throw new BadRequestException(
        `Cannot delete currency that is in use. It is referenced in ${ordersCount} orders and ${paymentsCount} payments.`,
      );
    }

    await this.globalPrisma.currencies.delete({
      where: { code },
    });

    return this.responseService.success(null, 'Currency deleted successfully');
  }

  async activate(code: string) {
    const currency = await this.globalPrisma.currencies.findUnique({
      where: { code },
    });

    if (!currency) {
      throw new NotFoundException(`Currency with code ${code} not found`);
    }

    const updated = await this.globalPrisma.currencies.update({
      where: { code },
      data: { state: currency_state_enum.ACTIVE },
    });

    return this.responseService.success(updated, 'Currency activated successfully');
  }

  async deactivate(code: string) {
    const currency = await this.globalPrisma.currencies.findUnique({
      where: { code },
    });

    if (!currency) {
      throw new NotFoundException(`Currency with code ${code} not found`);
    }

    const updated = await this.globalPrisma.currencies.update({
      where: { code },
      data: { state: currency_state_enum.INACTIVE },
    });

    return this.responseService.success(updated, 'Currency deactivated successfully');
  }

  async deprecate(code: string) {
    const currency = await this.globalPrisma.currencies.findUnique({
      where: { code },
    });

    if (!currency) {
      throw new NotFoundException(`Currency with code ${code} not found`);
    }

    const updated = await this.globalPrisma.currencies.update({
      where: { code },
      data: { state: currency_state_enum.DEPRECATED },
    });

    return this.responseService.success(updated, 'Currency deprecated successfully');
  }

  async getDashboardStats() {
    const [total, active, inactive, deprecated] = await Promise.all([
      this.globalPrisma.currencies.count(),
      this.globalPrisma.currencies.count({ where: { state: currency_state_enum.ACTIVE } }),
      this.globalPrisma.currencies.count({ where: { state: currency_state_enum.INACTIVE } }),
      this.globalPrisma.currencies.count({ where: { state: currency_state_enum.DEPRECATED } }),
    ]);

    const stats = {
      total_currencies: total,
      active_currencies: active,
      inactive_currencies: inactive,
      deprecated_currencies: deprecated,
    };

    return this.responseService.success(stats, 'Dashboard stats retrieved successfully');
  }
}
