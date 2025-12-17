import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SupplierQueryDto } from './dto/supplier-query.dto';
import { RequestContextService } from '@common/context/request-context.service';
import { BadRequestException } from '@nestjs/common';

@Injectable()
export class SuppliersService {
  constructor(private prisma: StorePrismaService) { }

  create(createSupplierDto: CreateSupplierDto) {
    const context = RequestContextService.getContext();
    if (!context?.organization_id) {
      throw new BadRequestException('Organization context is missing');
    }

    return this.prisma.suppliers.create({
      data: {
        ...createSupplierDto,
        organization_id: context.organization_id,
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
    const where: any = {
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

  findOne(id: number) {
    return this.prisma.suppliers.findUnique({
      where: { id },
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
        addresses: true,
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
