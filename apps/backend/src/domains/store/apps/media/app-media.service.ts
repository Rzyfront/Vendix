import {
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { S3Service } from '@common/services/s3.service';
import { ImageContext } from '@common/config/image-presets';
import { RequestContextService } from '@common/context/request-context.service';
import { app_kind_enum, app_media_kind_enum } from '@prisma/client';

/** Tope por archivo, por lote y por tienda (apps-customization F1.1). */
export const APP_MEDIA_MAX_BYTES = 8 * 1024 * 1024;
export const APP_MEDIA_MAX_BATCH = 20;
/** Techo técnico de almacenamiento por tienda: 1 GB. */
export const APP_MEDIA_STORE_QUOTA_BYTES = 1024 * 1024 * 1024;

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const DOCUMENT_MIMES = ['application/pdf'];

export interface AppMediaRow {
  id: number;
  app_kind: app_kind_enum | null;
  kind: 'image' | 'document';
  s3_key: string;
  thumb_key: string | null;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  alt: string | null;
  created_at: Date;
  /** URL estable de la app (`/public/apps/media/:id`): no vence. */
  url: string | null;
  thumb_url: string | null;
}

/**
 * Biblioteca de medios de las apps (apps-customization F1.1).
 *
 * Las fotos se suben a nuestro storage (S3) y quedan registradas por tienda.
 * Las apps guardan la **URL estable** (`/public/apps/media/:id`), que redirige a
 * una URL firmada fresca: nada de enlaces que vencen a las 24 h.
 *
 * Reglas del lote: se valida TODO antes de subir nada; si falla la creación de
 * una fila, se borran de S3 los objetos ya subidos. Borrar es lógico: la fila
 * deja de listarse pero el archivo sigue resolviendo para las apps publicadas.
 */
@Injectable()
export class AppMediaService {
  private readonly logger = new Logger(AppMediaService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly s3: S3Service,
  ) {}

  async upload(
    files: Express.Multer.File[],
    appKind?: app_kind_enum | null,
  ): Promise<AppMediaRow[]> {
    if (!files?.length) return [];
    if (files.length > APP_MEDIA_MAX_BATCH) {
      throw new PayloadTooLargeException(
        `Máximo ${APP_MEDIA_MAX_BATCH} archivos por lote`,
      );
    }
    // Validación completa ANTES de tocar S3: un archivo malo no deja medio lote.
    for (const file of files) this.assertFile(file);

    const storeId = this.requireStoreId();
    await this.assertStorageQuota(storeId, files);
    const userId = RequestContextService.getUserId() ?? null;

    const saved: AppMediaRow[] = [];
    const uploadedKeys: string[] = [];
    try {
      for (const file of files) {
        const uploaded = await this.uploadToStorage(storeId, file, appKind ?? null);
        uploadedKeys.push(...[uploaded.s3Key, uploaded.thumbKey].filter(Boolean) as string[]);
        const created = await this.prisma.store_app_media.create({
          data: {
            store_id: storeId,
            app_kind: appKind ?? null,
            kind: uploaded.kind,
            s3_key: uploaded.s3Key,
            thumb_key: uploaded.thumbKey,
            mime_type: file.mimetype.toLowerCase(),
            size_bytes: file.size,
            width: null,
            height: null,
            alt: this.defaultAlt(file.originalname),
            created_by_user_id: userId,
          },
        });
        saved.push(this.withUrls(created));
      }
      return saved;
    } catch (error) {
      // Nada de objetos huérfanos si la fila no se pudo crear.
      await Promise.allSettled(uploadedKeys.map((key) => this.s3.deleteFile(key)));
      throw error;
    }
  }

  async list(params: {
    appKind?: app_kind_enum | null;
    search?: string | null;
    page?: number;
    limit?: number;
  }): Promise<{ data: AppMediaRow[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, Math.floor(params.page ?? 1));
    const limit = Math.min(60, Math.max(1, Math.floor(params.limit ?? 24)));
    const where = {
      deleted_at: null,
      ...(params.appKind ? { app_kind: params.appKind } : {}),
      ...(params.search?.trim()
        ? { alt: { contains: params.search.trim(), mode: 'insensitive' as const } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.store_app_media.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.store_app_media.count({ where }),
    ]);
    return { data: rows.map((row) => this.withUrls(row)), total, page, limit };
  }

  /** `alt` es lo único editable: el archivo y su clave no se tocan. */
  async updateAlt(id: number, alt: string | null): Promise<AppMediaRow> {
    const found = await this.findActive(id);
    const row = await this.prisma.store_app_media.update({
      where: { id: found.id },
      data: { alt: alt?.trim().slice(0, 200) || null },
    });
    return this.withUrls(row);
  }

  /**
   * Borrado lógico: la galería deja de mostrarlo y las apps publicadas siguen
   * resolviendo su archivo (la página ya lo referencia por id).
   */
  async remove(id: number): Promise<{ deleted: true }> {
    const found = await this.findActive(id);
    await this.prisma.store_app_media.update({
      where: { id: found.id },
      data: { deleted_at: new Date() },
    });
    return { deleted: true };
  }

  private async findActive(id: number) {
    const found = await this.prisma.store_app_media.findFirst({
      where: { id, deleted_at: null },
    });
    if (!found) throw new NotFoundException('Medio no encontrado');
    return found;
  }

  private assertFile(file: Express.Multer.File): void {
    if (!file?.buffer?.length) {
      throw new UnsupportedMediaTypeException('Archivo vacío');
    }
    if (file.size > APP_MEDIA_MAX_BYTES) {
      throw new PayloadTooLargeException('El archivo supera los 8 MB');
    }
    const mime = (file.mimetype ?? '').toLowerCase();
    if (IMAGE_MIMES.includes(mime)) return;
    if (DOCUMENT_MIMES.includes(mime)) {
      // El tipo declarado por el cliente no basta: un PDF empieza por %PDF-.
      if (!file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        throw new UnsupportedMediaTypeException('El archivo no es un PDF válido');
      }
      return;
    }
    throw new UnsupportedMediaTypeException(
      'Formato no permitido: usa JPG, PNG, WEBP, AVIF o PDF',
    );
  }

  private async assertStorageQuota(
    storeId: number,
    files: Express.Multer.File[],
  ): Promise<void> {
    const incoming = files.reduce((sum, file) => sum + (file.size ?? 0), 0);
    const aggregate = await this.prisma.store_app_media.aggregate({
      where: { deleted_at: null },
      _sum: { size_bytes: true },
    });
    const used = Number(aggregate._sum.size_bytes ?? 0);
    if (used + incoming > APP_MEDIA_STORE_QUOTA_BYTES) {
      throw new PayloadTooLargeException(
        'La galería llegó a su límite de 1 GB. Elimina fotos que no uses para subir más.',
      );
    }
  }

  private async uploadToStorage(
    storeId: number,
    file: Express.Multer.File,
    appKind: app_kind_enum | null,
  ): Promise<{ s3Key: string; thumbKey: string | null; kind: app_media_kind_enum }> {
    const fingerprint = createHash('sha1').update(file.buffer).digest('hex').slice(0, 12);
    const base = `stores/${storeId}/apps/${appKind ?? 'shared'}/${randomUUID()}-${fingerprint}`;
    if (IMAGE_MIMES.includes(file.mimetype.toLowerCase())) {
      const uploaded = await this.s3.uploadImage(file.buffer, `${base}.webp`, {
        generateThumbnail: true,
        context: ImageContext.PRODUCT,
      });
      return { s3Key: uploaded.key, thumbKey: uploaded.thumbKey ?? null, kind: 'image' };
    }
    const key = `${base}.pdf`;
    await this.s3.uploadFile(file.buffer, key, 'application/pdf');
    return { s3Key: key, thumbKey: null, kind: 'document' };
  }

  /** Nombre del archivo como texto alternativo inicial, sin extensión. */
  private defaultAlt(originalname?: string): string | null {
    const name = (originalname ?? '').replace(/\.[a-z0-9]+$/i, '').trim();
    return name ? name.slice(0, 200) : null;
  }

  /**
   * URL estable de la API (`/public/apps/media/:id`), relativa: el frontend le
   * antepone su `environment.apiUrl`. Ese endpoint firma al vuelo, así que el
   * enlace guardado en la app nunca vence.
   */
  private stableUrl(id: number, thumb = false): string {
    return `/public/apps/media/${id}${thumb ? '?thumb=1' : ''}`;
  }

  private withUrls(row: {
    id: number;
    app_kind: app_kind_enum | null;
    kind: app_media_kind_enum;
    s3_key: string;
    thumb_key: string | null;
    mime_type: string;
    size_bytes: number;
    width: number | null;
    height: number | null;
    alt: string | null;
    created_at: Date;
  }): AppMediaRow {
    return {
      id: row.id,
      app_kind: row.app_kind,
      kind: row.kind === 'document' ? 'document' : 'image',
      s3_key: row.s3_key,
      thumb_key: row.thumb_key,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      width: row.width,
      height: row.height,
      alt: row.alt,
      created_at: row.created_at,
      url: this.stableUrl(row.id),
      thumb_url: row.thumb_key ? this.stableUrl(row.id, true) : null,
    };
  }

  private requireStoreId(): number {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) throw new NotFoundException('Sin tienda en contexto');
    return storeId;
  }
}
