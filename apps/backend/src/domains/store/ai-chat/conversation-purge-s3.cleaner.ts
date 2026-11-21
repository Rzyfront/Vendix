import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import {
  S3Service,
  isS3NotFoundError,
} from '../../../common/services/s3.service';

/** Tras este número de intentos fallidos la constancia deja de reintentarse. */
export const MAX_S3_PURGE_ATTEMPTS = 8;

/**
 * Borra de S3 los objetos pendientes de una constancia de borrado
 * (`ai_conversation_purges.pending_s3_keys`). Corre sin contexto de tienda
 * (post-commit del borrado y job de reintento), por eso usa el cliente global
 * y filtra por la propia fila. Nunca lanza.
 */
@Injectable()
export class ConversationPurgeS3Cleaner {
  private readonly logger = new Logger(ConversationPurgeS3Cleaner.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly s3: S3Service,
  ) {}

  /** Intenta borrar los pendientes de una constancia. `true` si quedó vacía. */
  async clean(purgeId: number): Promise<boolean> {
    try {
      const row = await this.prisma.ai_conversation_purges.findFirst({
        where: { id: purgeId, s3_completed_at: null },
      });
      if (!row) return true;
      const keys = Array.isArray(row.pending_s3_keys)
        ? (row.pending_s3_keys as unknown[]).filter(
            (k): k is string => typeof k === 'string',
          )
        : [];

      const failed: string[] = [];
      for (const key of keys) {
        try {
          // Borrar un objeto que ya no existe cuenta como éxito.
          await this.s3.deleteFile(key);
        } catch (error) {
          if (!isS3NotFoundError(error)) {
            failed.push(key);
            this.logger.warn(
              `purge ${purgeId}: no se pudo borrar un objeto S3: ${(error as Error)?.message}`,
            );
          }
        }
      }

      const done = failed.length === 0;
      await this.prisma.ai_conversation_purges.update({
        where: { id: purgeId },
        data: {
          pending_s3_keys: failed as unknown as Prisma.InputJsonValue,
          s3_attempts: { increment: 1 },
          s3_completed_at: done ? new Date() : null,
        },
      });
      if (!done && row.s3_attempts + 1 >= MAX_S3_PURGE_ATTEMPTS) {
        this.logger.error(
          `purge ${purgeId}: ${failed.length} objeto(s) S3 sin borrar tras ${MAX_S3_PURGE_ATTEMPTS} intentos; requiere revisión manual`,
        );
      }
      return done;
    } catch (error) {
      this.logger.error(
        `purge ${purgeId}: fallo al limpiar S3: ${(error as Error)?.message}`,
      );
      return false;
    }
  }

  /** Reintenta las constancias con objetos pendientes. Devuelve las completadas. */
  async retryPending(limit = 50): Promise<number> {
    const rows = await this.prisma.ai_conversation_purges.findMany({
      where: {
        s3_completed_at: null,
        s3_attempts: { lt: MAX_S3_PURGE_ATTEMPTS },
      },
      orderBy: { id: 'asc' },
      take: limit,
      select: { id: true },
    });
    let completed = 0;
    for (const row of rows) {
      if (await this.clean(row.id)) completed++;
    }
    return completed;
  }
}
