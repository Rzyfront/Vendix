import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrganizationDto, UpdateOrganizationDto, OrganizationQueryDto } from './dto';
import { Prisma } from '@prisma/client';
import { generateSlug } from '../../common/utils/slug.util';

@Injectable()
export class OrganizationsService {
  constructor(private prisma: PrismaService) {}

  async create(createOrganizationDto: CreateOrganizationDto) {
    try {
      // Generar slug si no se proporciona
      if (!createOrganizationDto.slug) {
        createOrganizationDto.slug = this.generateSlug(createOrganizationDto.name);
      }

      // Verificar que el slug sea único
      const existingOrg = await this.prisma.organizations.findUnique({
        where: { slug: createOrganizationDto.slug }
      });

      if (existingOrg) {
        throw new ConflictException('El slug de la organización ya existe');
      }

      // Verificar que el tax_id sea único si se proporciona
      if (createOrganizationDto.tax_id) {
        const existingTaxId = await this.prisma.organizations.findUnique({
          where: { tax_id: createOrganizationDto.tax_id }
        });

        if (existingTaxId) {
          throw new ConflictException('El ID fiscal ya está registrado');
        }
      }      return await this.prisma.organizations.create({
        data: {
          ...createOrganizationDto,
          slug: createOrganizationDto.slug || generateSlug(createOrganizationDto.name),
          updated_at: new Date(),
        },
        include: {
          stores: true,
          addresses: true,
          organization_users: {
            include: {
              users: {
                select: {
                  id: true,
                  first_name: true,
                  last_name: true,
                  email: true,
                  username: true,
                }
              },
              roles: true,
            }
          }
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('La organización ya existe');
        }
      }
      throw error;
    }
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
        ]
      }),
      ...(state && { state }),
    };

    const [organizations, total] = await Promise.all([
      this.prisma.organizations.findMany({
        where,
        skip,
        take: limit,
        include: {
          stores: {
            select: {
              id: true,
              name: true,
              store_code: true,
              store_type: true,
              is_active: true,
            }
          },
          addresses: {
            where: { is_primary: true },
            select: {
              id: true,
              address_line1: true,
              city: true,
              state_province: true,
              country_code: true,
              type: true,
            }
          },
          _count: {
            select: {
              stores: true,
              organization_users: true,
            }
          }
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.organizations.count({ where }),
    ]);

    return {
      data: organizations,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const organization = await this.prisma.organizations.findUnique({
      where: { id },
      include: {
        stores: {
          include: {
            _count: {
              select: {
                products: true,
                orders: true,
                customers: true,
              }
            }
          }
        },
        addresses: true,
        organization_users: {
          include: {
            users: {
              select: {
                id: true,
                first_name: true,
                last_name: true,
                email: true,
                username: true,
                state: true,
              }
            },
            roles: true,
          }
        },
        _count: {
          select: {
            stores: true,
            organization_users: true,
          }
        }
      },
    });

    if (!organization) {
      throw new NotFoundException('Organización no encontrada');
    }

    return organization;
  }

  async findBySlug(slug: string) {
    const organization = await this.prisma.organizations.findUnique({
      where: { slug },
      include: {
        stores: true,
        addresses: true,
      },
    });

    if (!organization) {
      throw new NotFoundException('Organización no encontrada');
    }

    return organization;
  }

  async update(id: number, updateOrganizationDto: UpdateOrganizationDto) {
    try {
      // Verificar que la organización existe
      await this.findOne(id);

      // Si se actualiza el slug, verificar que sea único
      if (updateOrganizationDto.slug) {
        const existingOrg = await this.prisma.organizations.findFirst({
          where: {
            slug: updateOrganizationDto.slug,
            NOT: { id },
          }
        });

        if (existingOrg) {
          throw new ConflictException('El slug ya está en uso');
        }
      }

      // Si se actualiza el tax_id, verificar que sea único
      if (updateOrganizationDto.tax_id) {
        const existingTaxId = await this.prisma.organizations.findFirst({
          where: {
            tax_id: updateOrganizationDto.tax_id,
            NOT: { id },
          }
        });

        if (existingTaxId) {
          throw new ConflictException('El ID fiscal ya está registrado');
        }
      }

      return await this.prisma.organizations.update({
        where: { id },
        data: {
          ...updateOrganizationDto,
          updated_at: new Date(),
        },
        include: {
          stores: true,
          addresses: true,
          organization_users: {
            include: {
              users: {
                select: {
                  id: true,
                  first_name: true,
                  last_name: true,
                  email: true,
                  username: true,
                }
              },
              roles: true,
            }
          }
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('Conflicto de datos únicos');
        }
      }
      throw error;
    }
  }

  async remove(id: number) {
    try {
      // Verificar que la organización existe
      await this.findOne(id);

      // Verificar si tiene tiendas activas
      const activeStores = await this.prisma.stores.count({
        where: {
          organization_id: id,
          is_active: true,
        }
      });

      if (activeStores > 0) {
        throw new BadRequestException(
          'No se puede eliminar la organización porque tiene tiendas activas'
        );
      }

      return await this.prisma.organizations.delete({
        where: { id },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2003') {
          throw new BadRequestException(
            'No se puede eliminar la organización porque tiene datos relacionados'
          );
        }
      }
      throw error;
    }
  }

  // Métodos para gestión de usuarios en organizaciones
  async addUserToOrganization(organizationId: number, userId: number, roleId: number, permissions?: any) {
    try {
      // Verificar que la organización existe
      await this.findOne(organizationId);

      // Verificar que el usuario no esté ya asignado con el mismo rol
      const existingAssignment = await this.prisma.organization_users.findUnique({
        where: {
          user_id_role_id_organization_id: {
            user_id: userId,
            role_id: roleId,
            organization_id: organizationId,
          }
        }
      });

      if (existingAssignment) {
        throw new ConflictException('El usuario ya tiene este rol en la organización');
      }

      return await this.prisma.organization_users.create({
        data: {
          organization_id: organizationId,
          user_id: userId,
          role_id: roleId,
          permissions,
          is_active: true,
        },
        include: {
          users: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
              username: true,
            }
          },
          roles: true,
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('El usuario ya está asignado a esta organización con este rol');
        }
        if (error.code === 'P2003') {
          throw new BadRequestException('Usuario o rol no válido');
        }
      }
      throw error;
    }
  }

  async removeUserFromOrganization(organizationId: number, userId: number, roleId: number) {
    const assignment = await this.prisma.organization_users.findUnique({
      where: {
        user_id_role_id_organization_id: {
          user_id: userId,
          role_id: roleId,
          organization_id: organizationId,
        }
      }
    });

    if (!assignment) {
      throw new NotFoundException('Asignación no encontrada');
    }

    return await this.prisma.organization_users.delete({
      where: {
        user_id_role_id_organization_id: {
          user_id: userId,
          role_id: roleId,
          organization_id: organizationId,
        }
      }
    });
  }

  async getOrganizationUsers(organizationId: number) {
    await this.findOne(organizationId); // Verificar que existe

    return await this.prisma.organization_users.findMany({
      where: { organization_id: organizationId },
      include: {
        users: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
            username: true,
            state: true,
          }
        },
        roles: true,
      },
      orderBy: { joined_at: 'desc' },
    });
  }

  // Método auxiliar para generar slug
  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9 -]/g, '') // Remover caracteres especiales
      .replace(/\s+/g, '-') // Reemplazar espacios con guiones
      .replace(/-+/g, '-') // Remover guiones múltiples
      .trim();
  }
}
