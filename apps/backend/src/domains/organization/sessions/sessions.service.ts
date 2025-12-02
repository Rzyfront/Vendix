import { Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { UserSessionsQueryDto } from './dto';

@Injectable()
export class SessionsService {
  constructor(private prisma: OrganizationPrismaService) {}

  async findAll(query: UserSessionsQueryDto) {
    const { page = 1, limit = 10, user_id, status } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (user_id) where.user_id = user_id;
    if (status) where.is_active = status === 'active';

    const [sessions, total] = await Promise.all([
      this.prisma.user_sessions.findMany({
        where,
        include: {
          users: {
            select: {
              id: true,
              email: true,
              first_name: true,
              last_name: true,
            },
          },
        },
        orderBy: { last_activity: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.user_sessions.count({ where }),
    ]);

    return {
      data: sessions,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const session = await this.prisma.user_sessions.findUnique({
      where: { id },
      include: {
        users: {
          select: { id: true, email: true, first_name: true, last_name: true },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('User session not found');
    }

    return session;
  }

  async terminateSession(id: number) {
    const session = await this.prisma.user_sessions.findUnique({
      where: { id },
    });

    if (!session) {
      throw new NotFoundException('User session not found');
    }

    return this.prisma.user_sessions.update({
      where: { id },
      data: {
        is_active: false,
        last_activity: new Date(),
      },
    });
  }

  async terminateUserSessions(userId: number) {
    return this.prisma.user_sessions.updateMany({
      where: { user_id: userId },
      data: {
        is_active: false,
        last_activity: new Date(),
      },
    });
  }
}
