import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../errors';
import {
  generateUniqueUsername,
  isUsernameFormatValid,
  isUsernameUniqueViolation,
  normalizeUsername,
} from '../utils/username.util';

export interface UsernameAvailability {
  available: boolean;
  reason?: 'taken' | 'invalid';
}

interface UsernameLookupOptions {
  excludeUserId?: number;
  client?: Prisma.TransactionClient;
}

/**
 * Global `users.username` uniqueness for the panels that create or edit users
 * (store users management, organization users, superadmin users).
 *
 * Uses `GlobalPrismaService.withoutScope()` on purpose: the unique index spans
 * every tenant, so a tenant-scoped lookup would miss the real collision.
 * Comparison is case-insensitive over the trimmed value.
 */
@Injectable()
export class UsernameService {
  constructor(private readonly prismaService: GlobalPrismaService) {}

  async isTaken(
    username: string,
    opts?: UsernameLookupOptions,
  ): Promise<boolean> {
    const db: any = opts?.client ?? this.prismaService.withoutScope();
    const match = await db.users.findFirst({
      where: {
        username: { equals: normalizeUsername(username), mode: 'insensitive' },
        ...(opts?.excludeUserId ? { id: { not: opts.excludeUserId } } : {}),
      },
      select: { id: true },
    });
    return !!match;
  }

  /** Throws 409 USER_USERNAME_TAKEN when another user already owns it. */
  async assertAvailable(
    username: string,
    opts?: UsernameLookupOptions,
  ): Promise<void> {
    if (await this.isTaken(username, opts)) {
      throw new VendixHttpException(ErrorCodes.USER_USERNAME_TAKEN);
    }
  }

  /**
   * Availability answer for the panels' live check. Only a boolean (and the
   * reason) leaves: nothing about the user that owns the username.
   */
  async checkAvailability(
    raw: string,
    opts?: { excludeUserId?: number; pattern?: RegExp },
  ): Promise<UsernameAvailability> {
    const username = normalizeUsername(raw);
    if (!isUsernameFormatValid(username, opts?.pattern)) {
      return { available: false, reason: 'invalid' };
    }
    const taken = await this.isTaken(username, {
      excludeUserId: opts?.excludeUserId,
    });
    return taken ? { available: false, reason: 'taken' } : { available: true };
  }

  /** Unique username (≤ 50 chars) derived from `base`. */
  generateUnique(base: string, fallbackBase?: string): Promise<string> {
    return generateUniqueUsername(
      base,
      (candidate) => this.isTaken(candidate),
      fallbackBase,
    );
  }

  /**
   * Race safety net: a P2002 on `users.username` becomes the same readable
   * 409; any other error is rethrown untouched.
   */
  rethrowAsConflict(error: unknown): never {
    if (isUsernameUniqueViolation(error)) {
      throw new VendixHttpException(ErrorCodes.USER_USERNAME_TAKEN);
    }
    throw error;
  }
}
