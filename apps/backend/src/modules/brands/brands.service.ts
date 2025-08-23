import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateBrandDto,
  UpdateBrandDto,
  BrandQueryDto,
} from './dto';

@Injectable()
export class BrandsService {
  constructor(private prisma: PrismaService) {}
  async create(createBrandDto: CreateBrandDto, user: any) {
    try {
      return await this.prisma.brands.create({
        data: {
          name: createBrandDto.name,
          description: createBrandDto.description,
          logo_url: createBrandDto.logo_url,
        },
      });
    } catch (error) {
      if (error.code === 'P2002') {
        throw new ConflictException('Brand name already exists');
      }
      throw error;
    }
  }

  async findAll(query: BrandQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sort_by = 'name',
      sort_order = 'asc',
    } = query;

    const skip = (page - 1) * limit;

    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [brands, total] = await Promise.all([
      this.prisma.brands.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: {
          _count: {
            select: { products: true },
          },
        },
      }),
      this.prisma.brands.count({ where }),
    ]);

    return {
      data: brands,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findByStore(storeId: number, query: BrandQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sort_by = 'name',
      sort_order = 'asc',
    } = query;

    const skip = (page - 1) * limit;

    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Add store-specific filtering via products
    where.products = {
      some: {
        store_id: storeId,
      }
    };

    const [brands, total] = await Promise.all([
      this.prisma.brands.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: {
          _count: {
            select: { products: true },
          },
        },
      }),
      this.prisma.brands.count({ where }),
    ]);

    return {
      data: brands,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number, options?: { includeInactive?: boolean }) {
    const brand = await this.prisma.brands.findFirst({
      where: { id },
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    if (!brand) {
      throw new NotFoundException('Brand not found');
    }

    return brand;
  }

  async findBySlug(slug: string, storeId: number, options?: { includeInactive?: boolean }) {
    // Since brands don't have slugs in the schema, we'll treat slug as name for now
    const brand = await this.prisma.brands.findFirst({
      where: { 
        name: { contains: slug, mode: 'insensitive' },
        products: {
          some: {
            store_id: storeId,
          }
        }
      },
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    if (!brand) {
      throw new NotFoundException('Brand not found');
    }

    return brand;
  }

  async activate(id: number, user: any) {
    const brand = await this.findOne(id);
    
    // Since brands don't have a status field in the schema, we'll just return the brand
    // In a real implementation, you might want to add a status field to the schema
    return brand;
  }

  async deactivate(id: number, user: any) {
    const brand = await this.findOne(id);
    
    // Since brands don't have a status field in the schema, we'll just return the brand
    // In a real implementation, you might want to add a status field to the schema
    return brand;
  }

  async update(id: number, updateBrandDto: UpdateBrandDto, user: any) {
    const brand = await this.findOne(id);

    // Build update data
    const updateData: any = {};
    
    if (updateBrandDto.name) {
      updateData.name = updateBrandDto.name;
    }
    
    if (updateBrandDto.description !== undefined) {
      updateData.description = updateBrandDto.description;
    }
    
    if (updateBrandDto.logo_url !== undefined) {
      updateData.logo_url = updateBrandDto.logo_url;
    }

    try {
      return await this.prisma.brands.update({
        where: { id },
        data: updateData,
        include: {
          _count: {
            select: { products: true },
          },
        },
      });
    } catch (error) {
      if (error.code === 'P2002') {
        throw new ConflictException('Brand name already exists');
      }
      throw error;
    }
  }

  async remove(id: number, user: any) {
    const brand = await this.findOne(id);

    // Check if brand has products
    const productCount = await this.prisma.products.count({
      where: { brand_id: id },
    });

    if (productCount > 0) {
      throw new BadRequestException(
        'Cannot delete brand with assigned products',
      );
    }

    await this.prisma.brands.delete({ where: { id } });
  }
  private async validateUniqueName(name: string, excludeId?: number) {
    const where: any = { name };
    if (excludeId) {
      where.id = { not: excludeId };
    }

    const existing = await this.prisma.brands.findFirst({ where });
    if (existing) {
      throw new ConflictException('Brand name already exists');
    }
  }
}
