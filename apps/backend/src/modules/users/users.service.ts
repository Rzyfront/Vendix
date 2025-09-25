import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto, UpdateUserDto, UserQueryDto } from './dto';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { EmailService } from '../../email/email.service';
import * as crypto from 'crypto';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  async create(createUserDto: CreateUserDto) {
    const { organization_id, email, password, ...rest } = createUserDto;

    const existingUser = await this.prisma.users.findFirst({
      where: { email, organization_id },
    });
    if (existingUser) {
      throw new ConflictException('User with this email already exists in this organization');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await this.prisma.users.create({
      data: {
        ...rest,
        email,
        password: hashedPassword,
        organizations: {
          connect: { id: organization_id },
        },
        updated_at: new Date(),
      },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        username: true,
        email: true,
        state: true,
      },
    });

    // Generate email verification token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await this.prisma.email_verification_tokens.create({
      data: {
        user_id: user.id,
        token,
        expires_at: expiresAt,
      },
    });

    // Send verification email after user creation
    const fullName = `${user.first_name} ${user.last_name}`.trim();
    await this.emailService.sendVerificationEmail(user.email, token, fullName);

    return user;
  }

  async findAll(query: UserQueryDto) {
    const { page = 1, limit = 10, search, state, organization_id } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.usersWhereInput = {
      // Excluir usuarios suspended y archived por defecto
      state: { notIn: ['suspended', 'archived'] },
      ...(search && {
        OR: [
          { first_name: { contains: search, mode: 'insensitive' } },
          { last_name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(state && { state }),
      ...(organization_id && { organization_id }),
    };

    const [users, total] = await Promise.all([
      this.prisma.users.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          first_name: true,
          last_name: true,
          email: true,
          state: true,
          organizations: { select: { id: true, name: true } },
          user_roles: {
            include: {
              roles: true,
            },
          },
        },
      }),
      this.prisma.users.count({ where }),
    ]);

    return {
      data: users,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: number, includeSuspended = false) {
    const where: Prisma.usersWhereInput = { id };

    if (!includeSuspended) {
      where.state = { notIn: ['suspended', 'archived'] };
    }

    const user = await this.prisma.users.findFirst({
      where,
      include: {
        organizations: true,
        user_roles: { include: { roles: true } },
        store_users: { include: { store: true } },
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async update(id: number, updateUserDto: UpdateUserDto) {
    await this.findOne(id);
    if (updateUserDto.password) {
        updateUserDto.password = await bcrypt.hash(updateUserDto.password, 10);
    }
    return this.prisma.users.update({
      where: { id },
      data: { ...updateUserDto, updated_at: new Date() },
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.users.update({
      where: { id },
      data: {
        state: 'suspended',
        updated_at: new Date()
      },
    });
  }

  async archive(id: number) {
    await this.findOne(id);
    return this.prisma.users.update({
      where: { id },
      data: {
        state: 'archived',
        updated_at: new Date()
      },
    });
  }

  async reactivate(id: number) {
    const user = await this.prisma.users.findUnique({
      where: { id },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.state !== 'suspended' && user.state !== 'archived') {
      throw new ConflictException('User is not suspended or archived');
    }
    return this.prisma.users.update({
      where: { id },
      data: {
        state: 'active',
        updated_at: new Date()
      },
    });
  }
}