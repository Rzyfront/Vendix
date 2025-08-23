import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStoreDto, UpdateStoreDto, StoreQueryDto, AddStaffToStoreDto, UpdateStoreSettingsDto } from './dto';
import { Prisma } from '@prisma/client';
import { generateSlug } from '../../common/utils/slug.util';

@Injectable()
export class StoresService {
  constructor(private prisma: PrismaService) {}

  async create(createStoreDto: CreateStoreDto) {
    try {
      // Verificar que la organización existe
      const organization = await this.prisma.organizations.findUnique({
        where: { id: createStoreDto.organization_id }
      });

      if (!organization) {
        throw new BadRequestException('Organización no encontrada');
      }

      // Generar slug si no se proporciona
      if (!createStoreDto.slug) {
        createStoreDto.slug = this.generateSlug(createStoreDto.name);
      }

      // Verificar que el slug sea único dentro de la organización
      const existingStore = await this.prisma.stores.findFirst({
        where: {
          organization_id: createStoreDto.organization_id,
          slug: createStoreDto.slug
        }
      });

      if (existingStore) {
        throw new ConflictException('El slug de la tienda ya existe en esta organización');
      }

      // Verificar que el store_code sea único si se proporciona
      if (createStoreDto.store_code) {
        const existingStoreCode = await this.prisma.stores.findUnique({
          where: { store_code: createStoreDto.store_code }
        });

        if (existingStoreCode) {
          throw new ConflictException('El código de tienda ya está en uso');
        }
      }      return await this.prisma.stores.create({
        data: {
          ...createStoreDto,
          slug: createStoreDto.slug || generateSlug(createStoreDto.name),
          updated_at: new Date(),
        },
        include: {
          organizations: {
            select: {
              id: true,
              name: true,
              slug: true,
            }
          },
          manager: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
            }
          },
          addresses: true,
          store_settings: true,
          _count: {
            select: {
              products: true,
              orders: true,
              customers: true,
              store_staff: true,
            }
          }
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('La tienda ya existe');
        }
        if (error.code === 'P2003') {
          throw new BadRequestException('Organización o usuario manager no válido');
        }
      }
      throw error;
    }
  }

  async findAll(query: StoreQueryDto) {
    const { page = 1, limit = 10, search, store_type, is_active, organization_id } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.storesWhereInput = {
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { store_code: { contains: search, mode: 'insensitive' } },
          { domain: { contains: search, mode: 'insensitive' } },
        ]
      }),
      ...(store_type && { store_type }),
      ...(is_active !== undefined && { is_active }),
      ...(organization_id && { organization_id }),
    };

    const [stores, total] = await Promise.all([
      this.prisma.stores.findMany({
        where,
        skip,
        take: limit,
        include: {
          organizations: {
            select: {
              id: true,
              name: true,
              slug: true,
            }
          },
          manager: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
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
              products: true,
              orders: true,
              customers: true,
              store_staff: true,
            }
          }
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.stores.count({ where }),
    ]);

    return {
      data: stores,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const store = await this.prisma.stores.findUnique({
      where: { id },
      include: {
        organizations: {
          select: {
            id: true,
            name: true,
            slug: true,
            email: true,
            phone: true,
          }
        },
        manager: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
            username: true,
          }
        },
        addresses: true,
        store_settings: true,
        store_staff: {
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
        },
        _count: {
          select: {
            products: true,
            orders: true,
            customers: true,
            categories: true,
            store_staff: true,
          }
        }
      },
    });

    if (!store) {
      throw new NotFoundException('Tienda no encontrada');
    }

    return store;
  }

  async findBySlug(organizationId: number, slug: string) {
    const store = await this.prisma.stores.findFirst({
      where: { 
        organization_id: organizationId,
        slug 
      },
      include: {
        organizations: true,
        manager: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
          }
        },
        addresses: true,
        store_settings: true,
      },
    });

    if (!store) {
      throw new NotFoundException('Tienda no encontrada');
    }

    return store;
  }

  async update(id: number, updateStoreDto: UpdateStoreDto) {
    try {
      // Verificar que la tienda existe
      const existingStore = await this.findOne(id);

      // Si se actualiza el slug, verificar que sea único dentro de la organización
      if (updateStoreDto.slug) {
        const existingStoreWithSlug = await this.prisma.stores.findFirst({
          where: {
            organization_id: existingStore.organization_id,
            slug: updateStoreDto.slug,
            NOT: { id },
          }
        });

        if (existingStoreWithSlug) {
          throw new ConflictException('El slug ya está en uso en esta organización');
        }
      }

      // Si se actualiza el store_code, verificar que sea único
      if (updateStoreDto.store_code) {
        const existingStoreCode = await this.prisma.stores.findFirst({
          where: {
            store_code: updateStoreDto.store_code,
            NOT: { id },
          }
        });

        if (existingStoreCode) {
          throw new ConflictException('El código de tienda ya está en uso');
        }
      }

      return await this.prisma.stores.update({
        where: { id },
        data: {
          ...updateStoreDto,
          updated_at: new Date(),
        },
        include: {
          organizations: {
            select: {
              id: true,
              name: true,
              slug: true,
            }
          },
          manager: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
            }
          },
          addresses: true,
          store_settings: true,
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('Conflicto de datos únicos');
        }
        if (error.code === 'P2003') {
          throw new BadRequestException('Usuario manager no válido');
        }
      }
      throw error;
    }
  }

  async remove(id: number) {
    try {
      // Verificar que la tienda existe
      await this.findOne(id);

      // Verificar si tiene pedidos activos
      const activeOrders = await this.prisma.orders.count({
        where: {
          store_id: id,
          state: {
            in: ['created', 'pending_payment', 'processing', 'shipped']
          }
        }
      });

      if (activeOrders > 0) {
        throw new BadRequestException(
          'No se puede eliminar la tienda porque tiene pedidos activos'
        );
      }

      return await this.prisma.stores.delete({
        where: { id },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2003') {
          throw new BadRequestException(
            'No se puede eliminar la tienda porque tiene datos relacionados'
          );
        }
      }
      throw error;
    }
  }

  // Métodos para gestión de personal de tienda
  async addStaffToStore(storeId: number, staffData: AddStaffToStoreDto) {
    try {
      // Verificar que la tienda existe
      await this.findOne(storeId);

      // Verificar que el usuario no esté ya asignado con el mismo rol
      const existingAssignment = await this.prisma.store_staff.findUnique({
        where: {
          user_id_role_id_store_id: {
            user_id: staffData.user_id,
            role_id: staffData.role_id,
            store_id: storeId,
          }
        }
      });

      if (existingAssignment) {
        throw new ConflictException('El usuario ya tiene este rol en la tienda');
      }

      return await this.prisma.store_staff.create({
        data: {
          store_id: storeId,
          user_id: staffData.user_id,
          role_id: staffData.role_id,
          permissions: staffData.permissions,
          hire_date: staffData.hire_date ? new Date(staffData.hire_date) : undefined,
          is_active: staffData.is_active,
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
          throw new ConflictException('El usuario ya está asignado a esta tienda con este rol');
        }
        if (error.code === 'P2003') {
          throw new BadRequestException('Usuario o rol no válido');
        }
      }
      throw error;
    }
  }

  async removeStaffFromStore(storeId: number, userId: number, roleId: number) {
    const assignment = await this.prisma.store_staff.findUnique({
      where: {
        user_id_role_id_store_id: {
          user_id: userId,
          role_id: roleId,
          store_id: storeId,
        }
      }
    });

    if (!assignment) {
      throw new NotFoundException('Asignación no encontrada');
    }

    return await this.prisma.store_staff.delete({
      where: {
        user_id_role_id_store_id: {
          user_id: userId,
          role_id: roleId,
          store_id: storeId,
        }
      }
    });
  }

  async getStoreStaff(storeId: number) {
    await this.findOne(storeId); // Verificar que existe

    return await this.prisma.store_staff.findMany({
      where: { store_id: storeId },
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
      orderBy: { assigned_at: 'desc' },
    });
  }

  // Gestión de configuraciones de tienda
  async updateStoreSettings(storeId: number, settingsDto: UpdateStoreSettingsDto) {
    // Verificar que la tienda existe
    await this.findOne(storeId);

    return await this.prisma.store_settings.upsert({
      where: { store_id: storeId },
      update: {
        settings: settingsDto.settings,
        updated_at: new Date(),
      },
      create: {
        store_id: storeId,
        settings: settingsDto.settings,
      },
    });
  }

  async getStoreSettings(storeId: number) {
    // Verificar que la tienda existe
    await this.findOne(storeId);

    return await this.prisma.store_settings.findUnique({
      where: { store_id: storeId },
    });
  }

  // Obtener tiendas por organización
  async getStoresByOrganization(organizationId: number) {
    return await this.prisma.stores.findMany({
      where: { organization_id: organizationId },
      include: {
        manager: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
          }
        },
        addresses: {
          where: { is_primary: true },
        },
        _count: {
          select: {
            products: true,
            orders: true,
            customers: true,
          }
        }
      },
      orderBy: { created_at: 'desc' },
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
