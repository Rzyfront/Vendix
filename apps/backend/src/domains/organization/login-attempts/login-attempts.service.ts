import { Injectable } from '@nestjs/common';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { LoginAttemptsQueryDto } from './dto';

@Injectable()
export class LoginAttemptsService {
  constructor(private prisma: OrganizationPrismaService) {}

  async findAll(query: LoginAttemptsQueryDto) {
    const { page = 1, limit = 10, email, success, store_id } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (email) where.email = { contains: email, mode: 'insensitive' };
    if (success !== undefined) where.success = success;
    if (store_id) where.store_id = store_id;

    const [attempts, total] = await Promise.all([
      this.prisma.login_attempts.findMany({
        where,
        include: {
          stores: {
            select: { id: true, name: true, slug: true },
          },
        },
        orderBy: { attempted_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.login_attempts.count({ where }),
    ]);

    return {
      data: attempts,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getStats() {
    const [totalAttempts, successfulAttempts, failedAttempts] =
      await Promise.all([
        this.prisma.login_attempts.count(),
        this.prisma.login_attempts.count({ where: { success: true } }),
        this.prisma.login_attempts.count({ where: { success: false } }),
      ]);

    return {
      total_attempts: totalAttempts,
      successful_attempts: successfulAttempts,
      failed_attempts: failedAttempts,
      success_rate:
        totalAttempts > 0 ? (successfulAttempts / totalAttempts) * 100 : 0,
    };
  }
}
