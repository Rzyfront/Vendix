import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import {
  DEFAULT_STORE_TIMEZONE,
  resolveLocalDateRange,
  resolveStoreTimezone,
} from '../../../common/utils/store-timezone.util';
import {
  BulkUploadCounts,
  BulkUploadDuplicateInfo,
  BulkUploadFileRef,
  BulkUploadPageResult,
  BulkUploadType,
  BULK_FILE_HASH_PATTERN,
  resolveBulkUploadStatus,
} from './bulk-upload-log.types';
import {
  computeBulkFileFingerprint,
  normalizeUploadFileName,
} from './bulk-file-fingerprint.util';
import {
  QueryBulkUploadLogsDto,
  RegisterBulkUploadDto,
} from './dto/bulk-upload-log.dto';

const USER_SELECT = {
  select: { first_name: true, last_name: true, username: true },
} as const;

type UserNameParts = {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
} | null;

function displayUserName(user: UserNameParts): string | null {
  if (!user) return null;
  const full = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
  return full || user.username || null;
}

function toCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * QUI-1004 — registro liviano de cargas masivas.
 *
 * AISLAMIENTO POR TIENDA: toda lectura y escritura pasa por
 * `StorePrismaService.bulk_upload_logs`, registrado en `store_scoped_models`:
 * `create` inyecta el `store_id` del contexto y cada `where` recibe el filtro
 * de tienda. Ningún método acepta un `store_id` del cliente ni usa
 * `withoutScope()`. Una tienda nunca ve, cuenta ni recibe avisos de cargas de
 * otra.
 *
 * Los métodos `track*` los llaman las cargas existentes DESPUÉS de procesar:
 * registrar es un efecto accesorio y nunca debe tumbar una carga que ya
 * escribió sus filas, así que esos métodos registran el fallo y siguen.
 */
@Injectable()
export class BulkUploadLogsService {
  private readonly logger = new Logger(BulkUploadLogsService.name);

  constructor(private readonly prisma: StorePrismaService) {}

  /** Carga anterior más reciente de la MISMA tienda, tipo y huella. */
  async findDuplicate(
    upload_type: BulkUploadType,
    file_hash: string,
  ): Promise<BulkUploadDuplicateInfo | null> {
    if (!BULK_FILE_HASH_PATTERN.test(file_hash ?? '')) return null;
    const previous = await this.prisma.bulk_upload_logs.findFirst({
      where: { upload_type, file_hash },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        created_at: true,
        file_name: true,
        status: true,
        result_reference: true,
        user: USER_SELECT,
      },
    });
    if (!previous) return null;
    return {
      id: previous.id,
      created_at: previous.created_at,
      user_name: displayUserName(previous.user),
      file_name: previous.file_name,
      status: previous.status,
      result_reference: previous.result_reference ?? null,
    };
  }

  /**
   * Para el analyze de las cargas que suben el archivo: nombre limpio, huella
   * y la carga anterior de esta tienda con la misma huella (si la hay). El
   * cliente devuelve `file_name` y `file_hash` en el commit.
   */
  async describeFile(
    upload_type: BulkUploadType,
    buffer: Buffer,
    original_name?: string,
  ): Promise<{
    file_name: string;
    file_hash: string;
    duplicate_of: BulkUploadDuplicateInfo | null;
  }> {
    const file_name = normalizeUploadFileName(original_name);
    const file_hash = computeBulkFileFingerprint(buffer, file_name);
    const duplicate_of = await this.findDuplicateSafe(upload_type, file_hash);
    return { file_name, file_hash, duplicate_of };
  }

  /** Igual que `findDuplicate`, pero un fallo de lectura no tumba el analyze. */
  async findDuplicateSafe(
    upload_type: BulkUploadType,
    file_hash: string,
  ): Promise<BulkUploadDuplicateInfo | null> {
    try {
      return await this.findDuplicate(upload_type, file_hash);
    } catch (error: any) {
      this.logger.warn(
        `No se pudo consultar cargas repetidas (${upload_type}): ${error?.message ?? error}`,
      );
      return null;
    }
  }

  /** Registra una carga ya terminada (una sola llamada). */
  async record(input: {
    upload_type: BulkUploadType;
    file_name: string;
    file_hash: string;
    counts: BulkUploadCounts;
    accessory_step_failed?: boolean;
    result_reference?: string | null;
  }) {
    const counts = this.normalizeCounts(input.counts);
    return this.prisma.bulk_upload_logs.create({
      data: {
        user_id: RequestContextService.getUserId() ?? null,
        upload_type: input.upload_type,
        file_name: normalizeUploadFileName(input.file_name),
        file_hash: input.file_hash,
        ...counts,
        status: resolveBulkUploadStatus(counts, input.accessory_step_failed),
        result_reference: input.result_reference?.slice(0, 120) || null,
      },
    });
  }

  /** Registro desde el navegador (cargas que el servidor no ve). */
  async register(dto: RegisterBulkUploadDto) {
    return this.record({
      upload_type: dto.upload_type,
      file_name: dto.file_name,
      file_hash: dto.file_hash,
      counts: dto,
      accessory_step_failed: dto.accessory_step_failed === true,
      result_reference: dto.result_reference,
    });
  }

  /** `record` para las cargas existentes: un fallo se registra y se sigue. */
  async trackUpload(
    upload_type: BulkUploadType,
    file: { file_name?: string | null; file_hash?: string | null },
    result: BulkUploadPageResult,
  ): Promise<void> {
    if (!BULK_FILE_HASH_PATTERN.test(file.file_hash ?? '')) return;
    try {
      await this.record({
        upload_type,
        file_name: file.file_name ?? '',
        file_hash: file.file_hash as string,
        counts: this.countsFromResult(result),
      });
    } catch (error: any) {
      this.logger.warn(
        `No se pudo registrar la carga masiva (${upload_type}): ${error?.message ?? error}`,
      );
    }
  }

  /**
   * Carga paginada (productos, empleados, ajustes, imágenes): la primera
   * página crea la fila de la sesión y las siguientes suman sus conteos. El
   * total del archivo lo trae cada página (`total`).
   */
  async trackSessionPage(
    upload_type: BulkUploadType,
    session_id: string,
    file: BulkUploadFileRef,
    page: BulkUploadPageResult,
  ): Promise<void> {
    if (!session_id || !BULK_FILE_HASH_PATTERN.test(file.file_hash ?? '')) {
      return;
    }
    try {
      const pageCounts = this.countsFromResult(page);
      const existing = await this.prisma.bulk_upload_logs.findFirst({
        where: { upload_type, session_id },
        select: {
          id: true,
          successful_rows: true,
          created_rows: true,
          failed_rows: true,
          skipped_rows: true,
        },
      });
      if (!existing) {
        await this.prisma.bulk_upload_logs.create({
          data: {
            user_id: RequestContextService.getUserId() ?? null,
            upload_type,
            session_id: session_id.slice(0, 64),
            file_name: normalizeUploadFileName(file.file_name),
            file_hash: file.file_hash as string,
            ...pageCounts,
            status: resolveBulkUploadStatus(pageCounts),
          },
        });
        return;
      }
      const merged = this.normalizeCounts({
        total_rows: pageCounts.total_rows,
        successful_rows: existing.successful_rows + pageCounts.successful_rows,
        created_rows:
          existing.created_rows == null && pageCounts.created_rows == null
            ? null
            : (existing.created_rows ?? 0) + (pageCounts.created_rows ?? 0),
        failed_rows: existing.failed_rows + pageCounts.failed_rows,
        skipped_rows: existing.skipped_rows + pageCounts.skipped_rows,
      });
      // `updateMany` con el id: el scope agrega el filtro de tienda sin romper
      // la forma de un `update` por clave única.
      await this.prisma.bulk_upload_logs.updateMany({
        where: { id: existing.id },
        data: { ...merged, status: resolveBulkUploadStatus(merged) },
      });
    } catch (error: any) {
      this.logger.warn(
        `No se pudo registrar la página de la carga masiva (${upload_type}, sesión ${session_id}): ${error?.message ?? error}`,
      );
    }
  }

  async list(query: QueryBulkUploadLogsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Record<string, unknown> = {};
    if (query.upload_type) where.upload_type = query.upload_type;
    const created_at = await this.buildDateFilter(query);
    if (created_at) where.created_at = created_at;

    const [rows, total] = await Promise.all([
      this.prisma.bulk_upload_logs.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: USER_SELECT },
      }),
      this.prisma.bulk_upload_logs.count({ where }),
    ]);
    return { data: rows.map((row) => this.toView(row)), total, page, limit };
  }

  async findOne(id: number) {
    const row = await this.prisma.bulk_upload_logs.findFirst({
      where: { id },
      include: { user: USER_SELECT },
    });
    if (!row) throw new VendixHttpException(ErrorCodes.BULK_LOG_NOT_FOUND);
    return this.toView(row);
  }

  private toView(row: any) {
    const { user, session_id: _session, store_id: _store, ...rest } = row;
    return { ...rest, user_name: displayUserName(user) };
  }

  private countsFromResult(result: BulkUploadPageResult): BulkUploadCounts {
    const successful_rows = toCount(result.successful);
    const failed_rows = toCount(result.failed);
    const skipped_rows = toCount(result.skipped);
    return this.normalizeCounts({
      total_rows: toCount(result.total ?? result.total_processed),
      successful_rows,
      created_rows: result.created == null ? null : toCount(result.created),
      failed_rows,
      skipped_rows,
    });
  }

  /** El total nunca queda por debajo de lo que se contó. */
  private normalizeCounts(counts: BulkUploadCounts): BulkUploadCounts {
    const successful_rows = toCount(counts.successful_rows);
    const failed_rows = toCount(counts.failed_rows);
    const skipped_rows = toCount(counts.skipped_rows);
    // Lo creado es parte de lo cargado: nunca lo supera.
    const created_rows =
      counts.created_rows == null
        ? null
        : Math.min(toCount(counts.created_rows), successful_rows);
    return {
      total_rows: Math.max(
        toCount(counts.total_rows),
        successful_rows + failed_rows + skipped_rows,
      ),
      successful_rows,
      created_rows,
      failed_rows,
      skipped_rows,
    };
  }

  /** Fechas del filtro = días calendario en la zona horaria de la tienda. */
  private async buildDateFilter(query: QueryBulkUploadLogsDto) {
    if (!query.date_from && !query.date_to) return undefined;
    const storeId = RequestContextService.getStoreId();
    const tz = storeId
      ? await resolveStoreTimezone(this.prisma, storeId)
      : DEFAULT_STORE_TIMEZONE;
    const filter: { gte?: Date; lte?: Date } = {};
    if (query.date_from) {
      filter.gte = resolveLocalDateRange(
        { date_from: query.date_from, date_to: query.date_from },
        tz,
      ).startDate;
    }
    if (query.date_to) {
      filter.lte = resolveLocalDateRange(
        { date_from: query.date_to, date_to: query.date_to },
        tz,
      ).endDate;
    }
    return filter;
  }
}
