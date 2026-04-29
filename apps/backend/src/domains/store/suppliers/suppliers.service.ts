import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SupplierQueryDto } from './dto/supplier-query.dto';

@Injectable()
export class SuppliersService {
  constructor(private prisma: StorePrismaService) {}

  create(createSupplierDto: CreateSupplierDto) {
    const { organization_id, ...data } = createSupplierDto;
    const orgId = organization_id || RequestContextService.getOrganizationId();
    if (!orgId) throw new Error('Organization ID required');
    return this.prisma.suppliers.create({
      data: { organization_id: orgId, ...data },
      include: {
        supplier_products: {
          include: {
            products: true,
          },
        },
      },
    });
  }

  async findAll(query: SupplierQueryDto) {
    const { page = 1, limit = 10, search } = query;
    const skip = (page - 1) * limit;
    const where: any = {
      is_active: query.is_active,
      email: query.email,
      phone: query.phone,
    };

    // Add search filter
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { contact_person: { contains: search } },
        { email: { contains: search } },
        { phone: { contains: search } },
        { mobile: { contains: search } },
        { website: { contains: search } },
        { tax_id: { contains: search } },
        { notes: { contains: search } },
      ];
    }

    const [suppliers, total] = await Promise.all([
      this.prisma.suppliers.findMany({
        where,
        include: {
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
      data: suppliers,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  findActive(query: SupplierQueryDto) {
    return this.findAll({
      ...query,
      is_active: true,
    });
  }

  findOne(id: number) {
    return this.prisma.suppliers.findUnique({
      where: { id },
      include: {
        supplier_products: {
          include: {
            products: true,
          },
        },
      },
    });
  }

  findSupplierProducts(supplierId: number) {
    return this.prisma.supplier_products.findMany({
      where: {
        supplier_id: supplierId,
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

  update(id: number, updateSupplierDto: UpdateSupplierDto) {
    return this.prisma.suppliers.update({
      where: { id },
      data: updateSupplierDto,
      include: {
        supplier_products: {
          include: {
            products: true,
          },
        },
      },
    });
  }

  remove(id: number) {
    return this.prisma.suppliers.update({
      where: { id },
      data: { is_active: false },
    });
  }

  async addProductToSupplier(supplierId: number, productId: number, data: any) {
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
