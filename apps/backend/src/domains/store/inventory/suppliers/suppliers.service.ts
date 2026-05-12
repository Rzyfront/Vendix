import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { CreateInventorySupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SupplierQueryDto } from './dto/supplier-query.dto';
import { RequestContextService } from '@common/context/request-context.service';
import { BadRequestException } from '@nestjs/common';
import { OperatingScopeService } from '@common/services/operating-scope.service';

@Injectable()
export class SuppliersService {
  constructor(
    private prisma: StorePrismaService,
    private readonly operatingScopeService: OperatingScopeService,
  ) {}

  private async getSupplierScopeWhere() {
    const context = RequestContextService.getContext();
    if (!context?.organization_id) {
      throw new BadRequestException('Organization context is missing');
    }

    const scope = await this.operatingScopeService.getOperatingScope(
      context.organization_id,
    );

    if (scope === 'ORGANIZATION') {
      return { organization_id: context.organization_id, store_id: null };
    }

    if (!context.store_id) {
      throw new BadRequestException('Store context is required for suppliers');
    }

    return { organization_id: context.organization_id, store_id: context.store_id };
  }

  async create(createSupplierDto: CreateInventorySupplierDto) {
    const context = RequestContextService.getContext();
    if (!context?.organization_id) {
      throw new BadRequestException('Organization context is missing');
    }
    const scopeWhere = await this.getSupplierScopeWhere();

    return this.prisma.suppliers.create({
      data: {
        ...createSupplierDto,
        organization_id: context.organization_id,
        store_id: scopeWhere.store_id,
      },
      include: {
        addresses: true,
        supplier_products: {
          include: {
            products: true,
          },
        },
      },
    });
  }

  async findAll(query: SupplierQueryDto) {
    const scopeWhere = await this.getSupplierScopeWhere();
    const where: any = {
      ...scopeWhere,
      is_active: query.is_active,
      email: query.email,
      phone: query.phone,
    };

    // Add search filter
    if (query.search) {
      where.OR = [
        { name: { contains: query.search } },
        { contact_person: { contains: query.search } },
        { email: { contains: query.search } },
        { phone: { contains: query.search } },
        { mobile: { contains: query.search } },
        { website: { contains: query.search } },
        { tax_id: { contains: query.search } },
        { notes: { contains: query.search } },
      ];
    }

    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.suppliers.findMany({
        where,
        include: {
          addresses: true,
          supplier_products: {
            include: {
              products: true,
            },
          },
        },
        orderBy: {
          name: 'asc',
        },
        skip,
        take: limit,
      }),
      this.prisma.suppliers.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  findActive(query: SupplierQueryDto) {
    return this.findAll({
      ...query,
      is_active: true,
    });
  }

  async findOne(id: number) {
    const scopeWhere = await this.getSupplierScopeWhere();
    return this.prisma.suppliers.findFirst({
      where: { id, ...scopeWhere },
      include: {
        addresses: true,
        supplier_products: {
          include: {
            products: true,
          },
        },
      },
    });
  }

  async findSupplierProducts(supplierId: number) {
    const scopeWhere = await this.getSupplierScopeWhere();
    return this.prisma.supplier_products.findMany({
      where: {
        supplier_id: supplierId,
        suppliers: { is: scopeWhere },
      },
      include: {
        products: true,
        suppliers: true,
      },
      orderBy: {
        created_at: 'desc',
      },
    });
  }

  async update(id: number, updateSupplierDto: UpdateSupplierDto) {
    await this.findOne(id);
    return this.prisma.suppliers.update({
      where: { id },
      data: updateSupplierDto,
      include: {
        addresses: true,
        supplier_products: {
          include: {
            products: true,
          },
        },
      },
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.suppliers.update({
      where: { id },
      data: { is_active: false },
    });
  }

  async addProductToSupplier(supplierId: number, productId: number, data: any) {
    await this.findOne(supplierId);
    return this.prisma.supplier_products.create({
      data: {
        supplier_id: supplierId,
        product_id: productId,
        ...data,
      },
      include: {
        products: true,
        suppliers: true,
      },
    });
  }

  async removeProductFromSupplier(supplierId: number, productId: number) {
    return this.prisma.supplier_products.delete({
      where: {
        supplier_id_product_id: {
          supplier_id: supplierId,
          product_id: productId,
        },
      },
    });
  }
}
