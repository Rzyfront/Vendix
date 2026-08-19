import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, UpdateUserDto, UserQueryDto } from './dto';
import { Prisma, user_state_enum } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    try {
      // Verificar que el username sea único
      const existingUsername = await this.prisma.users.findUnique({
        where: { username: createUserDto.username },
      });

      if (existingUsername) {
        throw new ConflictException('El nombre de usuario ya existe');
      }

      // Verificar que el email sea único
      const existingEmail = await this.prisma.users.findUnique({
        where: { email: createUserDto.email },
      });

      if (existingEmail) {
        throw new ConflictException('El email ya está registrado');
      }

      // Hashear la contraseña
      const hashedPassword = await bcrypt.hash(createUserDto.password, 12);

      return await this.prisma.users.create({
        data: {
          ...createUserDto,
          password: hashedPassword,
          updated_at: new Date(),
        },
        select: {
          id: true,
          first_name: true,
          last_name: true,
          username: true,
          email: true,
          state: true,
          email_verified: true,
          two_factor_enabled: true,
          last_login: true,
          created_at: true,
          updated_at: true,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('El usuario ya existe');
        }
      }
      throw error;
    }
  }

  async findAll(query: UserQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      state,
      sort,
      include_inactive,
      email_verified,
      two_factor_enabled,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.usersWhereInput = {
      ...(search && {
        OR: [
          { first_name: { contains: search, mode: 'insensitive' } },
          { last_name: { contains: search, mode: 'insensitive' } },
          { username: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(state && { state }),
      ...(email_verified !== undefined && { email_verified }),
      ...(two_factor_enabled !== undefined && { two_factor_enabled }),
      ...(!include_inactive && {
        state: {
          not: user_state_enum.inactive,
        },
      }),
    };

    const orderBy: Prisma.usersOrderByWithRelationInput = {};
    if (sort) {
      const [field, direction] = sort.split(':');
      orderBy[field] = direction === 'desc' ? 'desc' : 'asc';
    } else {
      orderBy.created_at = 'desc';
    }

    const [users, total] = await Promise.all([
      this.prisma.users.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: {
          id: true,
          first_name: true,
          last_name: true,
          username: true,
          email: true,
          state: true,
          email_verified: true,
          two_factor_enabled: true,
          last_login: true,
          failed_login_attempts: true,
          locked_until: true,
          created_at: true,
          updated_at: true,
          user_roles: {
            include: {
              roles: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                },
              },
            },
          },
          organization_users: {
            include: {
              organizations: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                },
              },
              roles: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.users.count({ where }),
    ]);

    return {
      data: users,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number, options?: { includeInactive?: boolean }) {
    const where: Prisma.usersWhereInput = {
      id,
      ...(!options?.includeInactive && {
        state: {
          not: user_state_enum.inactive,
        },
      }),
    };

    const user = await this.prisma.users.findFirst({
      where,
      select: {
        id: true,
        first_name: true,
        last_name: true,
        username: true,
        email: true,
        state: true,
        email_verified: true,
        two_factor_enabled: true,
        last_login: true,
        failed_login_attempts: true,
        locked_until: true,
        created_at: true,
        updated_at: true,
        user_roles: {
          include: {
            roles: {
              select: {
                id: true,
                name: true,
                description: true,
                role_permissions: {
                  include: {
                    permissions: {
                      select: {
                        id: true,
                        name: true,
                        description: true,
                        path: true,
                        method: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        organization_users: {
          include: {
            organizations: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
            roles: {
              select: {
                id: true,
                name: true,
                description: true,
              },
            },
          },
        },
        store_staff: {
          include: {
            stores: {
              select: {
                id: true,
                name: true,
                store_code: true,
              },
            },
            roles: {
              select: {
                id: true,
                name: true,
                description: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    return user;
  }

  async findByEmail(email: string, options?: { includeInactive?: boolean }) {
    const where: Prisma.usersWhereInput = {
      email,
      ...(!options?.includeInactive && {
        state: {
          not: user_state_enum.inactive,
        },
      }),
    };

    return this.prisma.users.findFirst({
      where,
      select: {
        id: true,
        first_name: true,
        last_name: true,
        username: true,
        email: true,
        state: true,
        email_verified: true,
        two_factor_enabled: true,
        last_login: true,
        created_at: true,
        updated_at: true,
      },
    });
  }

  async findByUsername(
    username: string,
    options?: { includeInactive?: boolean },
  ) {
    const where: Prisma.usersWhereInput = {
      username,
      ...(!options?.includeInactive && {
        state: {
          not: user_state_enum.inactive,
        },
      }),
    };

    return this.prisma.users.findFirst({
      where,
      select: {
        id: true,
        first_name: true,
        last_name: true,
        username: true,
        email: true,
        state: true,
        email_verified: true,
        two_factor_enabled: true,
        last_login: true,
        created_at: true,
        updated_at: true,
      },
    });
  }

  async update(id: number, updateUserDto: UpdateUserDto) {
    try {
      // Verificar que el usuario existe
      const existingUser = await this.findOne(id, { includeInactive: true });

      // Si se actualiza el password, hashearlo
      if (updateUserDto.password) {
        updateUserDto.password = await bcrypt.hash(updateUserDto.password, 12);
      }

      // Si se actualiza el username, verificar que sea único
      if (
        updateUserDto.username &&
        updateUserDto.username !== existingUser.username
      ) {
        const existingUsername = await this.prisma.users.findUnique({
          where: { username: updateUserDto.username },
        });

        if (existingUsername) {
          throw new ConflictException('El nombre de usuario ya existe');
        }
      }

      // Si se actualiza el email, verificar que sea único
      if (updateUserDto.email && updateUserDto.email !== existingUser.email) {
        const existingEmail = await this.prisma.users.findUnique({
          where: { email: updateUserDto.email },
        });

        if (existingEmail) {
          throw new ConflictException('El email ya está registrado');
        }
      }

      return await this.prisma.users.update({
        where: { id },
        data: {
          ...updateUserDto,
          updated_at: new Date(),
        },
        select: {
          id: true,
          first_name: true,
          last_name: true,
          username: true,
          email: true,
          state: true,
          email_verified: true,
          two_factor_enabled: true,
          last_login: true,
          created_at: true,
          updated_at: true,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('Los datos del usuario ya existen');
        }
        if (error.code === 'P2025') {
          throw new NotFoundException('Usuario no encontrado');
        }
      }
      throw error;
    }
  }

  async activate(id: number) {
    try {
      return await this.prisma.users.update({
        where: { id },
        data: {
          state: user_state_enum.active,
          updated_at: new Date(),
        },
        select: {
          id: true,
          first_name: true,
          last_name: true,
          username: true,
          email: true,
          state: true,
          updated_at: true,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Usuario no encontrado');
      }
      throw error;
    }
  }

  async deactivate(id: number) {
    try {
      return await this.prisma.users.update({
        where: { id },
        data: {
          state: user_state_enum.inactive,
          updated_at: new Date(),
        },
        select: {
          id: true,
          first_name: true,
          last_name: true,
          username: true,
          email: true,
          state: true,
          updated_at: true,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Usuario no encontrado');
      }
      throw error;
    }
  }

  async verifyEmail(id: number) {
    try {
      return await this.prisma.users.update({
        where: { id },
        data: {
          email_verified: true,
          state: user_state_enum.active, // Al verificar email, activar usuario
          updated_at: new Date(),
        },
        select: {
          id: true,
          first_name: true,
          last_name: true,
          username: true,
          email: true,
          email_verified: true,
          state: true,
          updated_at: true,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Usuario no encontrado');
      }
      throw error;
    }
  }

  async lockUser(id: number, lockUntil: Date) {
    try {
      return await this.prisma.users.update({
        where: { id },
        data: {
          locked_until: lockUntil,
          updated_at: new Date(),
        },
        select: {
          id: true,
          first_name: true,
          last_name: true,
          username: true,
          email: true,
          locked_until: true,
          updated_at: true,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Usuario no encontrado');
      }
      throw error;
    }
  }

  async unlockUser(id: number) {
    try {
      return await this.prisma.users.update({
        where: { id },
        data: {
          locked_until: null,
          failed_login_attempts: 0,
          updated_at: new Date(),
        },
        select: {
          id: true,
          first_name: true,
          last_name: true,
          username: true,
          email: true,
          locked_until: true,
          failed_login_attempts: true,
          updated_at: true,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Usuario no encontrado');
      }
      throw error;
    }
  }

  async remove(id: number) {
    try {
      // Verificar que el usuario existe
      await this.findOne(id, { includeInactive: true });

      // Eliminar usuario (esto debería hacerse con cuidado debido a las relaciones)
      return await this.prisma.users.delete({
        where: { id },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new NotFoundException('Usuario no encontrado');
        }
        if (error.code === 'P2003') {
          throw new BadRequestException(
            'No se puede eliminar el usuario porque tiene datos relacionados',
          );
        }
      }
      throw error;
    }
  }

  // Métodos para compatibilidad con el sistema de autenticación existente
  async findAllUsers() {
    return this.findAll({});
  }

  async findUserById(id: number) {
    return this.findOne(id);
  }

  async createUser(userData: any) {
    return this.create(userData);
  }
}
