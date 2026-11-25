import {
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { S3Service } from '@common/services/s3.service';
import { ImageContext } from '@common/config/image-presets';
import { RequestContextService } from '@common/context/request-context.service';
import { app_kind_enum, app_media_kind_enum } from '@prisma/client';

/** Tope por archivo y por lote (apps-customization F1.1). */
export const APP_MEDIA_MAX_BYTES = 8 * 1024 * 1024;
export const APP_MEDIA_MAX_BATCH = 20;

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
  url: string | null;
  thumb_url: string | null;
}

/**
 * Biblioteca de medios de las apps (apps-customization F1.1).
 *
 * Las fotos se suben a nuestro storage (S3) y quedan registradas por tienda:
 * las apps las referencian por id, así que no dependen de un enlace externo.
 * Las imágenes se optimizan a webp con thumbnail; los PDF se guardan tal cual.
 * Nada de esto se cobra por cantidad: el único límite es técnico (8 MB).
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
    const storeId = this.requireStoreId();
    const userId = RequestContextService.getUserId() ?? null;
    const saved: AppMediaRow[] = [];
    for (const file of files) {
      saved.push(await this.saveOne(storeId, userId, file, appKind ?? null));
    }
    return saved;
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
    return {
      data: await Promise.all(rows.map((row) => this.withUrls(row))),
      total,
      page,
      limit,
    };
  }

  /** `alt` es lo único editable: el archivo y su clave no se tocan. */
  async updateAlt(id: number, alt: string | null): Promise<AppMediaRow> {
    const found = await this.prisma.store_app_media.findFirst({ where: { id } });
    if (!found) throw new NotFoundException('Medio no encontrado');
    const row = await this.prisma.store_app_media.update({
      where: { id },
      data: { alt: alt?.trim().slice(0, 200) || null },
    });
    return this.withUrls(row);
  }

  async remove(id: number): Promise<{ deleted: true }> {
    const found = await this.prisma.store_app_media.findFirst({ where: { id } });
    if (!found) throw new NotFoundException('Medio no encontrado');
    await this.prisma.store_app_media.delete({ where: { id } });
    // El archivo se borra después: si falla, la fila ya no lo referencia y el
    // barrido de huérfanos lo recoge; nunca se pierde la respuesta.
    await Promise.allSettled(
      [found.s3_key, found.thumb_key]
        .filter((key): key is string => !!key)
        .map((key) => this.s3.deleteFile(key)),
    );
    return { deleted: true };
  }

  private async saveOne(
    storeId: number,
    userId: number | null,
    file: Express.Multer.File,
    appKind: app_kind_enum | null,
  ): Promise<AppMediaRow> {
    if (!file?.buffer?.length) throw new UnsupportedMediaTypeException('Archivo vacío');
    if (file.size > APP_MEDIA_MAX_BYTES) {
      throw new PayloadTooLargeException('La imagen supera los 8 MB');
    }
    const mime = (file.mimetype ?? '').toLowerCase();
    const isImage = IMAGE_MIMES.includes(mime);
    const isDocument = DOCUMENT_MIMES.includes(mime);
    if (!isImage && !isDocument) {
      throw new UnsupportedMediaTypeException(
        'Formato no permitido: usa JPG, PNG, WEBP, AVIF o PDF',
      );
    }

    const fingerprint = createHash('sha1').update(file.buffer).digest('hex').slice(0, 12);
    const base = `stores/${storeId}/apps/${appKind ?? 'shared'}/${randomUUID()}-${fingerprint}`;
    let s3Key: string;
    let thumbKey: string | null = null;

    if (isImage) {
      const uploaded = await this.s3.uploadImage(file.buffer, `${base}.webp`, {
        generateThumbnail: true,
        context: ImageContext.PRODUCT,
      });
      s3Key = uploaded.key;
      thumbKey = uploaded.thumbKey ?? null;
      // Las dimensiones quedan en null: el navegador las conoce al elegir la
      // foto y no hace falta decodificarla otra vez en el servidor.
    } else {
      s3Key = `${base}.pdf`;
      await this.s3.uploadFile(file.buffer, s3Key, 'application/pdf');
    }

    const created = await this.prisma.store_app_media.create({
      data: {
        store_id: storeId,
        app_kind: appKind,
        kind: isImage ? 'image' : 'document',
        s3_key: s3Key,
        thumb_key: thumbKey,
        mime_type: mime,
        size_bytes: file.size,
        width: null,
        height: null,
        alt: this.defaultAlt(file.originalname),
        created_by_user_id: userId,
      },
    });
    return this.withUrls(created);
  }

  /** Nombre del archivo como texto alternativo inicial, sin extensión. */
  private defaultAlt(originalname?: string): string | null {
    const name = (originalname ?? '').replace(/\.[a-z0-9]+$/i, '').trim();
    return name ? name.slice(0, 200) : null;
  }

  private async withUrls(row: {
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
  }): Promise<AppMediaRow> {
    const [url, thumbUrl] = await Promise.all([
      this.sign(row.s3_key),
      row.thumb_key ? this.sign(row.thumb_key) : Promise.resolve(null),
    ]);
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
      url,
      thumb_url: thumbUrl,
    };
  }

  private async sign(key: string): Promise<string | null> {
    try {
      return await this.s3.signUrl(key);
    } catch {
      return null;
    }
  }

  private requireStoreId(): number {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) throw new NotFoundException('Sin tienda en contexto');
    return storeId;
  }
}
