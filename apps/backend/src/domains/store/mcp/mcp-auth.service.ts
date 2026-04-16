import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';

export interface McpTokenPayload {
  user_id: number;
  organization_id: number;
  store_id: number;
  roles: string[];
  permissions: string[];
  type: 'mcp';
}

@Injectable()
export class McpAuthService {
  private readonly logger = new Logger(McpAuthService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: GlobalPrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async validateToken(token: string): Promise<McpTokenPayload> {
    if (!token) {
      throw new VendixHttpException(ErrorCodes.AI_MCP_001, 'No token provided');
    }

    try {
      // For MVP: accept the same JWT tokens used by the regular API
      // In production: implement OAuth 2.1 with separate MCP client credentials
      const secret = this.configService.get<string>('JWT_SECRET');
      if (!secret) {
        throw new VendixHttpException(ErrorCodes.AI_MCP_001, 'JWT_SECRET not configured');
      }
      const decoded = jwt.verify(token, secret) as any;

      const userId = decoded.user_id || decoded.sub;

      // Fetch roles and permissions from DB (same as JwtStrategy)
      const user = await this.prismaService.users.findUnique({
        where: { id: parseInt(userId.toString()) },
        include: {
          user_roles: {
            include: {
              roles: {
                include: {
                  role_permissions: {
                    include: {
                      permissions: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      const roles = user?.user_roles?.map((ur) => ur.roles?.name || '') || [];
      const permissions =
        user?.user_roles?.flatMap(
          (ur) =>
            ur.roles?.role_permissions?.map((rp) => rp.permissions?.name || '') || [],
        ) || [];

      return {
        user_id: userId,
        organization_id: decoded.organization_id,
        store_id: decoded.store_id,
        roles,
        permissions,
        type: 'mcp',
      };
    } catch (error: any) {
      if (error instanceof VendixHttpException) throw error;
      this.logger.warn(`MCP token validation failed: ${error.message}`);
      throw new VendixHttpException(
        ErrorCodes.AI_MCP_001,
        'Invalid or expired token',
      );
    }
  }

  async checkRateLimit(storeId: number): Promise<void> {
    const key = `mcp:ratelimit:${storeId}`;
    const maxRequests = 100; // per minute
    const windowSeconds = 60;

    const current = await this.redis.incr(key);
    if (current === 1) {
      await this.redis.expire(key, windowSeconds);
    }

    if (current > maxRequests) {
      throw new VendixHttpException(ErrorCodes.AI_MCP_003);
    }
  }
}
