import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
  OrganizationQueryDto,
} from './dto';
import { Prisma } from '@prisma/client';
import slugify from 'slugify';

@Injectable()
export class OrganizationsService {
  constructor(private prisma: PrismaService) {}

  async create(createOrganizationDto: CreateOrganizationDto) {
    const slug = slugify(createOrganizationDto.name, { lower: true, strict: true });

    const existingOrg = await this.prisma.organizations.findFirst({
      where: { OR: [{ slug }, { tax_id: createOrganizationDto.tax_id }] },
    });

    if (existingOrg) {
      throw new ConflictException('Organization with this slug or tax ID already exists');
    }

    return this.prisma.organizations.create({
      data: {
        ...createOrganizationDto,
        slug,
        updated_at: new Date(),
      },
      include: {
        stores: true,
        addresses: true,
        users: true,
      },
    });
  }

  async findAll(query: OrganizationQueryDto) {
    const { page = 1, limit = 10, search, state } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.organizationsWhereInput = {
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { legal_name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(state && { state }),
    };

    const [organizations, total] = await Promise.all([
      this.prisma.organizations.findMany({
        where,
        skip,
        take: limit,
        include: {
          stores: { select: { id: true, name: true, is_active: true } },
          addresses: { where: { is_primary: true } },
          _count: { select: { stores: true, users: true } },
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.organizations.count({ where }),
    ]);

    return {
      data: organizations,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: number) {
    const organization = await this.prisma.organizations.findUnique({
      where: { id },
      include: {
        stores: { include: { _count: { select: { products: true, orders: true } } } },
        addresses: true,
        users: { select: { id: true, first_name: true, last_name: true, email: true } },
        _count: { select: { stores: true, users: true } },
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }
    return organization;
  }

  async findBySlug(slug: string) {
    const organization = await this.prisma.organizations.findUnique({
      where: { slug },
      include: { stores: true, addresses: true },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }
    return organization;
  }

  async update(id: number, updateOrganizationDto: UpdateOrganizationDto) {
    await this.findOne(id);
    return this.prisma.organizations.update({
      where: { id },
      data: { ...updateOrganizationDto, updated_at: new Date() },
      include: { stores: true, addresses: true, users: true },
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    const activeStores = await this.prisma.stores.count({
      where: { organization_id: id, is_active: true },
    });

    if (activeStores > 0) {
      throw new BadRequestException('Cannot delete organization with active stores');
    }

    return this.prisma.organizations.delete({ where: { id } });
  }
}