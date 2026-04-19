import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { CreateProviderDto } from './dto/create-provider.dto';
import { UpdateProviderDto } from './dto/update-provider.dto';

@Injectable()
export class ProvidersService {
  constructor(private readonly prisma: StorePrismaService) {}

  private get storeId(): number {
    const context = RequestContextService.getContext();
    return context!.store_id!;
  }

  private readonly PROVIDER_INCLUDE = {
    employee: {
      select: { id: true, first_name: true, last_name: true, position: true, status: true },
    },
    services: {
      include: {
        product: {
          select: { id: true, name: true, base_price: true, service_duration_minutes: true, buffer_minutes: true, booking_mode: true },
        },
      },
    },
  };

  async findAll() {
    return this.prisma.service_providers.findMany({
      where: { store_id: this.storeId },
      include: this.PROVIDER_INCLUDE,
      orderBy: [{ sort_order: 'asc' }, { display_name: 'asc' }],
    });
  }

  async findOne(id: number) {
    const provider = await this.prisma.service_providers.findFirst({
      where: { id, store_id: this.storeId },
      include: {
        ...this.PROVIDER_INCLUDE,
        schedules: { orderBy: { day_of_week: 'asc' } },
        exceptions: { orderBy: { date: 'asc' } },
      },
    });

    if (!provider) {
      throw new NotFoundException(`Proveedor #${id} no encontrado`);
    }

    return provider;
  }

  async create(dto: CreateProviderDto) {
    // Verify employee exists and belongs to store
    const employee = await this.prisma.employees.findFirst({
      where: {
        id: dto.employee_id,
        employee_stores: {
          some: { store_id: this.storeId, status: 'active' },
        },
      },
    });

    if (!employee) {
      throw new NotFoundException(`Empleado #${dto.employee_id} no encontrado en esta tienda`);
    }

    // Check if provider already exists for this employee
    const existing = await this.prisma.service_providers.findFirst({
      where: { store_id: this.storeId, employee_id: dto.employee_id },
    });

    if (existing) {
      throw new ConflictException(`El empleado ya es un proveedor de servicios`);
    }

    return this.prisma.service_providers.create({
      data: {
        store_id: this.storeId,
        employee_id: dto.employee_id,
        display_name: dto.display_name || `${employee.first_name} ${employee.last_name}`,
        avatar_url: dto.avatar_url,
        bio: dto.bio,
      },
      include: this.PROVIDER_INCLUDE,
    });
  }

  async update(id: number, dto: UpdateProviderDto) {
    await this.findOne(id); // validate exists

    return this.prisma.service_providers.update({
      where: { id },
      data: {
        ...(dto.display_name !== undefined && { display_name: dto.display_name }),
        ...(dto.avatar_url !== undefined && { avatar_url: dto.avatar_url }),
        ...(dto.bio !== undefined && { bio: dto.bio }),
        ...(dto.is_active !== undefined && { is_active: dto.is_active }),
        ...(dto.sort_order !== undefined && { sort_order: dto.sort_order }),
        updated_at: new Date(),
      },
      include: this.PROVIDER_INCLUDE,
    });
  }

  async assignService(providerId: number, productId: number) {
    await this.findOne(providerId);

    // Verify product exists in the store.
    // Intentionally do NOT require `requires_booking = true`: provider assignment is
    // configuration and may happen before the flag is toggled (progressive setup).
    const product = await this.prisma.products.findFirst({
      where: { id: productId, store_id: this.storeId },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundException(`Servicio #${productId} no encontrado`);
    }

    const existing = await this.prisma.provider_services.findFirst({
      where: { provider_id: providerId, product_id: productId },
    });

    if (existing) {
      throw new ConflictException(`El proveedor ya tiene asignado este servicio`);
    }

    return this.prisma.provider_services.create({
      data: { provider_id: providerId, product_id: productId },
      include: { product: { select: { id: true, name: true } } },
    });
  }

  async removeService(providerId: number, productId: number) {
    await this.findOne(providerId);

    const assignment = await this.prisma.provider_services.findFirst({
      where: { provider_id: providerId, product_id: productId },
    });

    if (!assignment) {
      throw new NotFoundException(`Asignacion no encontrada`);
    }

    await this.prisma.provider_services.delete({ where: { id: assignment.id } });
  }

  async getProvidersForService(productId: number) {
    return this.prisma.service_providers.findMany({
      where: {
        store_id: this.storeId,
        is_active: true,
        services: { some: { product_id: productId } },
      },
      include: {
        employee: {
          select: { id: true, first_name: true, last_name: true },
        },
      },
      orderBy: [{ sort_order: 'asc' }, { display_name: 'asc' }],
    });
  }

  async getAvailableEmployees() {
    // Get employees NOT yet linked as providers
    const existingProviderEmployeeIds = await this.prisma.service_providers.findMany({
      where: { store_id: this.storeId },
      select: { employee_id: true },
    });

    const linkedIds = existingProviderEmployeeIds.map(p => p.employee_id);

    // employees is org-scoped automatically by StorePrismaService middleware.
    // Filter by store assignment via employee_stores junction table.
    return this.prisma.employees.findMany({
      where: {
        status: 'active',
        employee_stores: {
          some: { store_id: this.storeId, status: 'active' },
        },
        ...(linkedIds.length > 0 && { id: { notIn: linkedIds } }),
      },
      select: { id: true, first_name: true, last_name: true, position: true },
      orderBy: { first_name: 'asc' },
    });
  }
}
