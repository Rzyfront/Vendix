import { Inject, Injectable, Logger, MessageEvent } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Redis from 'ioredis';
import { Observable } from 'rxjs';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import { ImageContext } from '../../../common/config/image-presets';
import { RequestContextService } from '../../../common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { S3PathHelper } from '../../../common/helpers/s3-path.helper';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { S3Service } from '../../../common/services/s3.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import {
  CreateMarketingAdCreativeDto,
  CreateManualMarketingAdCreativeDto,
  QueryMarketingAdCreativesDto,
  UpdateMarketingAdCreativeDetailsDto,
} from './dto';

type AdFormat = 'square' | 'story' | 'landscape';

@Injectable()
export class MarketingAdCreativesService {
  private readonly logger = new Logger(MarketingAdCreativesService.name);
  private readonly dailyGenerationLimit = 3;
  private readonly dailyGenerationTtlSeconds = 48 * 60 * 60;
  private readonly consumeGenerationQuotaLua = `
    if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then return 0 end
    redis.call('SADD', KEYS[2], ARGV[1])
    redis.call('EXPIRE', KEYS[2], ARGV[3])
    local v = redis.call('INCRBY', KEYS[1], ARGV[2])
    redis.call('EXPIRE', KEYS[1], ARGV[3])
    return v
  `;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly aiEngine: AIEngineService,
    private readonly s3Service: S3Service,
    private readonly s3PathHelper: S3PathHelper,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async findAll(query: QueryMarketingAdCreativesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;
    const skip = (page - 1) * limit;
    const creativeDelegate = this.getCreativeDelegate();

    if (!creativeDelegate || !(await this.hasAdStorage())) {
      return this.findAllRaw(query, page, limit, skip);
    }

    const where: Prisma.marketing_ad_creativesWhereInput = {
      ...(query.search && {
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
          { prompt: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
      ...(query.status && { status: query.status }),
      ...(query.format && { format: query.format }),
    };

    try {
      const [data, total] = await Promise.all([
        creativeDelegate.findMany({
          where,
          skip,
          take: limit,
          orderBy: { created_at: 'desc' },
          include: this.creativeInclude(),
        }),
        creativeDelegate.count({ where }),
      ]);

      return {
        data: await Promise.all(
          data.map((item) => this.serializeCreative(item)),
        ),
        meta: {
          total,
          page,
          limit,
          total_pages: Math.ceil(total / limit),
        },
      };
    } catch (error: any) {
      if (this.isMissingAdStorageError(error)) {
        this.logger.warn(
          `Anuncios no tiene almacenamiento disponible aun: ${error.message}`,
        );
        return this.findAllRaw(query, page, limit, skip);
      }
      throw error;
    }
  }

  async getSummary() {
    const creativeDelegate = this.getCreativeDelegate();

    if (!creativeDelegate || !(await this.hasAdStorage())) {
      return this.getSummaryRaw();
    }

    try {
      const [total, completed, processing, failed] = await Promise.all([
        creativeDelegate.count(),
        creativeDelegate.count({
          where: { status: 'completed' },
        }),
        creativeDelegate.count({
          where: { status: 'processing' },
        }),
        creativeDelegate.count({ where: { status: 'failed' } }),
      ]);

      return {
        total,
        completed,
        processing,
        failed,
      };
    } catch (error: any) {
      if (this.isMissingAdStorageError(error)) {
        this.logger.warn(
          `Resumen de Anuncios no disponible aun: ${error.message}`,
        );
        return this.getSummaryRaw();
      }
      throw error;
    }
  }

  async getEcommerceDomain() {
    const domain = await this.prisma.domain_settings.findFirst({
      where: {
        app_type: 'STORE_ECOMMERCE' as any,
        status: 'active' as any,
      },
      orderBy: [{ is_primary: 'desc' }, { created_at: 'desc' }],
      select: {
        id: true,
        hostname: true,
        app_type: true,
        status: true,
        is_primary: true,
      },
    });

    if (!domain) return null;

    return {
      ...domain,
      url: this.toHttpsUrl(domain.hostname),
    };
  }

  async getProductImageAsset(imageId: number) {
    const context = this.getContext();
    const productImage = await this.prisma.product_images.findFirst({
      where: {
        id: imageId,
        products: {
          store_id: context.store_id,
        },
      },
      select: {
        image_url: true,
      },
    });

    if (!productImage) {
      throw new VendixHttpException(ErrorCodes.PROD_IMAGE_001);
    }

    const key = this.s3Service.sanitizeForStorage(productImage.image_url);
    if (!key) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'La imagen seleccionada no tiene una ruta valida.',
      );
    }

    return {
      buffer: await this.s3Service.downloadImage(key),
      contentType: this.imageContentType(key),
    };
  }

  async findOne(id: number) {
    const creativeDelegate = this.getCreativeDelegate();
    await this.ensureAdStorageAvailable();

    const creative = !creativeDelegate
      ? await this.getCreativeByIdRaw(id)
      : await this.runWithAdStorageGuard(() =>
          creativeDelegate.findFirst({
            where: { id },
            include: this.creativeInclude(),
          }),
        );

    if (!creative) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    return this.serializeCreative(creative);
  }

  async create(dto: CreateMarketingAdCreativeDto) {
    const context = this.getContext();
    const productIds = this.uniqueNumbers(dto.product_ids);
    const productImageIds = this.uniqueNumbers(dto.product_image_ids || []);
    const creativeDelegate = this.getCreativeDelegate();
    await this.ensureAdStorageAvailable();

    const products = await this.prisma.products.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        name: true,
        sku: true,
        base_price: true,
        sale_price: true,
        description: true,
        product_images: {
          select: {
            id: true,
            image_url: true,
            is_main: true,
            sort_order: true,
          },
          orderBy: [{ is_main: 'desc' }, { sort_order: 'asc' }],
        },
      },
    });

    if (products.length !== productIds.length) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'Uno o varios productos no pertenecen a la tienda actual.',
      );
    }

    const selectedImages = await this.resolveSelectedImages(
      products,
      productImageIds,
    );

    if (!creativeDelegate) {
      return this.createRaw(dto, productIds, selectedImages, context);
    }

    const creative = await this.runWithAdStorageGuard(() =>
      creativeDelegate.create({
        data: {
          title: dto.title.trim(),
          description: dto.description?.trim() || null,
          prompt: dto.prompt?.trim() || null,
          format: dto.format || 'square',
          ai_app_key: dto.ai_app_key || 'marketing_ad_image_generator',
          created_by_user_id: context.user_id ?? null,
          creative_products: {
            create: productIds.map((product_id) => ({ product_id })),
          },
          creative_images: selectedImages.length
            ? {
                create: selectedImages.map((image, index) => ({
                  product_image_id: image.id,
                  image_url:
                    this.s3Service.sanitizeForStorage(image.image_url) ||
                    image.image_url,
                  source_type: 'product',
                  sort_order: index,
                })),
              }
            : undefined,
        },
        include: this.creativeInclude(),
      }),
    );

    return this.serializeCreative(creative);
  }

  async createManual(dto: CreateManualMarketingAdCreativeDto) {
    const created = await this.create({
      title: dto.title,
      description: dto.description,
      prompt: dto.prompt,
      format: dto.format,
      product_ids: dto.product_ids,
      product_image_ids: dto.product_image_ids,
      ai_app_key: 'manual_ad_editor',
    });

    try {
      return await this.saveManualImage(created.id, dto.image_base64);
    } catch (error: any) {
      await this.markFailed(
        created.id,
        error?.message || 'Manual image upload failed',
      );
      throw error;
    }
  }

  async updateDetails(id: number, dto: UpdateMarketingAdCreativeDetailsDto) {
    const creativeDelegate = this.getCreativeDelegate();
    const title = dto.title?.trim();
    const description = dto.description?.trim();
    await this.ensureAdStorageAvailable();

    if (!title && description === undefined) {
      return this.findOne(id);
    }

    if (!creativeDelegate) {
      const updated = await this.updateDetailsRaw(id, title, description);
      return this.serializeCreative(updated);
    }

    const creative = await this.runWithAdStorageGuard(() =>
      creativeDelegate.findFirst({
        where: { id },
        select: { id: true },
      }),
    );

    if (!creative) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    const updated = await this.runWithAdStorageGuard(() =>
      creativeDelegate.update({
        where: { id },
        data: {
          ...(title ? { title } : {}),
          ...(description !== undefined
            ? { description: description || null }
            : {}),
          updated_at: new Date(),
        },
        include: this.creativeInclude(),
      }),
    );

    return this.serializeCreative(updated);
  }

  streamGenerate(id: number, requestId?: string): Observable<MessageEvent> {
    const context = RequestContextService.getContext();
    const generationRequestId = this.resolveGenerationRequestId(id, requestId);

    return new Observable<MessageEvent>((subscriber) => {
      const run = async () => {
        try {
          const creative = await this.getCreativeForGeneration(id);
          const currentContext = this.getContext();
          await this.assertDailyGenerationQuota(currentContext.store_id);
          await this.markProcessing(id);

          const variables = this.buildVariables(creative);
          const referenceImages = await this.buildReferenceImages(creative);
          let savedCreative: any = null;

          for await (const chunk of this.aiEngine.runImageStream(
            creative.ai_app_key,
            variables,
            {
              size: this.formatToSize(creative.format as AdFormat),
              quality: 'high',
              outputFormat: 'png',
              background: 'auto',
              partialImages: 2,
              inputFidelity: referenceImages.length ? 'high' : undefined,
              referenceImages,
            },
          )) {
            if (chunk.type === 'completed' && chunk.imageBase64) {
              savedCreative = await this.saveGeneratedImage(id, chunk);
              await this.consumeDailyGenerationQuota(
                currentContext.store_id,
                generationRequestId,
              );
              subscriber.next({
                type: 'ai-chunk',
                data: JSON.stringify({
                  type: 'completed',
                  creative: savedCreative,
                  usage: chunk.usage,
                  model: chunk.model,
                  revisedPrompt: chunk.revisedPrompt,
                }),
              } as MessageEvent);
              continue;
            }

            if (chunk.type === 'error') {
              await this.markFailed(id, chunk.error || 'Generation failed');
              subscriber.next({
                type: 'ai-chunk',
                data: JSON.stringify(chunk),
              } as MessageEvent);
              subscriber.complete();
              return;
            }

            subscriber.next({
              type: 'ai-chunk',
              data: JSON.stringify(chunk),
            } as MessageEvent);

            if (chunk.type === 'done') {
              if (!savedCreative) {
                await this.markFailed(id, 'Image model did not return data');
              }
              subscriber.complete();
              return;
            }
          }

          subscriber.complete();
        } catch (error: any) {
          if (this.shouldMarkGenerationFailed(error)) {
            await this.markFailed(id, error.message);
          }
          subscriber.next({
            type: 'ai-chunk',
            data: JSON.stringify(this.toStreamError(error)),
          } as MessageEvent);
          subscriber.complete();
        }
      };

      if (context) {
        RequestContextService.run(context, () => {
          run();
        });
      } else {
        run();
      }
    });
  }

  async remove(id: number) {
    const creativeDelegate = this.getCreativeDelegate();
    await this.ensureAdStorageAvailable();

    const creative = !creativeDelegate
      ? await this.getCreativeFileKeysRaw(id)
      : await this.runWithAdStorageGuard(() =>
          creativeDelegate.findFirst({
            where: { id },
            select: { id: true, image_url: true, thumb_url: true },
          }),
        );

    if (!creative) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    if (creativeDelegate) {
      await this.runWithAdStorageGuard(() =>
        creativeDelegate.delete({ where: { id } }),
      );
    } else {
      await this.deleteRaw(id);
    }

    for (const key of [creative.image_url, creative.thumb_url]) {
      if (!key) continue;
      this.s3Service.deleteFile(key).catch((error) => {
        this.logger.warn(
          `No se pudo eliminar archivo de anuncio ${key}: ${error.message}`,
        );
      });
    }
  }

  private creativeInclude() {
    return {
      creative_products: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              base_price: true,
              sale_price: true,
              description: true,
            },
          },
        },
      },
      creative_images: {
        include: {
          product_image: {
            select: {
              id: true,
              image_url: true,
              alt_text: true,
              product_id: true,
            },
          },
        },
        orderBy: { sort_order: 'asc' as const },
      },
    };
  }

  private async getCreativeForGeneration(id: number) {
    const creativeDelegate = this.getCreativeDelegate();
    await this.ensureAdStorageAvailable();

    const creative = !creativeDelegate
      ? await this.getCreativeByIdRaw(id)
      : await this.runWithAdStorageGuard(() =>
          creativeDelegate.findFirst({
            where: { id },
            include: this.creativeInclude(),
          }),
        );

    if (!creative) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    return creative;
  }

  private async resolveSelectedImages(products: any[], imageIds: number[]) {
    if (imageIds.length > 0) {
      const productIds = products.map((product) => product.id);
      const images = await this.prisma.product_images.findMany({
        where: {
          id: { in: imageIds },
          product_id: { in: productIds },
        },
        orderBy: [{ is_main: 'desc' }, { sort_order: 'asc' }],
      });

      if (images.length !== imageIds.length) {
        throw new VendixHttpException(
          ErrorCodes.SYS_VALIDATION_001,
          'Una o varias imagenes no pertenecen a los productos seleccionados.',
        );
      }

      return images;
    }

    return products
      .map((product) => product.product_images?.[0])
      .filter(Boolean);
  }

  private async serializeCreative(creative: any) {
    const signedImages = await Promise.all(
      (creative.creative_images || []).map(async (image: any) => {
        const rawKey = image.image_url || image.product_image?.image_url;
        return {
          ...image,
          image_key: rawKey,
          image_url: await this.s3Service.signUrl(rawKey),
        };
      }),
    );

    return {
      ...creative,
      image_key: creative.image_url,
      thumb_key: creative.thumb_url,
      image_url: await this.s3Service.signUrl(creative.image_url),
      thumb_url: await this.s3Service.signUrl(creative.thumb_url),
      creative_images: signedImages,
    };
  }

  private async buildReferenceImages(creative: any) {
    const images = await Promise.all(
      (creative.creative_images || []).map(async (image: any) => {
        const rawKey = image.image_url || image.product_image?.image_url;
        const url = await this.s3Service.signUrl(rawKey);
        return url ? { url, detail: 'high' as const } : null;
      }),
    );

    return images.filter(
      (image): image is { url: string; detail: 'high' } => !!image,
    );
  }

  private buildVariables(creative: any): Record<string, string> {
    const productsContext = (creative.creative_products || [])
      .map((item: any, index: number) => {
        const product = item.product;
        const salePrice = product.sale_price
          ? ` | Precio oferta: ${Number(product.sale_price)}`
          : '';
        const sku = product.sku ? ` | SKU: ${product.sku}` : '';
        const description = product.description
          ? `\n  Descripcion: ${product.description}`
          : '';
        return `${index + 1}. ${product.name}${sku} | Precio base: ${Number(
          product.base_price,
        )}${salePrice}${description}`;
      })
      .join('\n');

    const imageContext = (creative.creative_images || [])
      .map((image: any, index: number) => {
        const productName =
          creative.creative_products?.find(
            (item: any) => item.product.id === image.product_image?.product_id,
          )?.product?.name || 'Producto seleccionado';
        return `${index + 1}. Referencia visual para ${productName}`;
      })
      .join('\n');

    const size = this.formatToSize(creative.format as AdFormat);

    return {
      title: creative.title,
      description: creative.description || 'Sin descripcion adicional',
      prompt: creative.prompt || 'Sin instrucciones adicionales',
      format_label: this.formatLabel(creative.format as AdFormat),
      size,
      products_context: productsContext || 'Sin productos detallados',
      reference_images_context:
        imageContext || 'No se seleccionaron imagenes de referencia',
    };
  }

  private async saveGeneratedImage(id: number, chunk: any) {
    const creativeDelegate = this.getCreativeDelegate();
    await this.ensureAdStorageAvailable();

    const context = this.getContext();
    const store = await this.prisma.stores.findUnique({
      where: { id: context.store_id },
      select: {
        id: true,
        slug: true,
        organizations: {
          select: {
            id: true,
            slug: true,
          },
        },
      },
    });

    if (!store?.organizations) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'No se encontro la tienda actual para guardar el anuncio.',
      );
    }

    const basePath = this.s3PathHelper.buildMarketingAnunciosPath(
      store.organizations,
      store,
    );
    const key = `${basePath}/${id}-${Date.now()}-${this.slugify(
      chunk.model || 'ai-image',
    )}.png`;
    const upload = await this.s3Service.uploadBase64(
      chunk.imageBase64,
      key,
      'image/png',
      {
        generateThumbnail: true,
        context: ImageContext.MARKETING_AD,
      },
    );

    if (!creativeDelegate) {
      const updated = await this.saveGeneratedImageRaw(id, upload, chunk);
      return this.serializeCreative(updated);
    }

    const updated = await this.runWithAdStorageGuard(() =>
      creativeDelegate.update({
        where: { id },
        data: {
          status: 'completed',
          image_url: upload.key,
          thumb_url: upload.thumbKey || null,
          provider_model: chunk.model || null,
          error_message: null,
          completed_at: new Date(),
          updated_at: new Date(),
          generation_metadata: {
            usage: chunk.usage || null,
            revised_prompt: chunk.revisedPrompt || null,
          },
        },
        include: this.creativeInclude(),
      }),
    );

    return this.serializeCreative(updated);
  }

  private async saveManualImage(id: number, imageBase64: string) {
    const parsedImage = this.parseManualImage(imageBase64);
    const creativeDelegate = this.getCreativeDelegate();
    await this.ensureAdStorageAvailable();

    const context = this.getContext();
    const store = await this.prisma.stores.findUnique({
      where: { id: context.store_id },
      select: {
        id: true,
        slug: true,
        organizations: {
          select: {
            id: true,
            slug: true,
          },
        },
      },
    });

    if (!store?.organizations) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'No se encontro la tienda actual para guardar el anuncio.',
      );
    }

    const basePath = this.s3PathHelper.buildMarketingAnunciosPath(
      store.organizations,
      store,
    );
    const key = `${basePath}/${id}-${Date.now()}-manual-editor.${parsedImage.extension}`;
    const upload = await this.s3Service.uploadBase64(
      parsedImage.dataUrl,
      key,
      parsedImage.contentType,
      {
        generateThumbnail: true,
        context: ImageContext.MARKETING_AD,
      },
    );

    if (!creativeDelegate) {
      const updated = await this.saveManualImageRaw(id, upload);
      return this.serializeCreative(updated);
    }

    const updated = await this.runWithAdStorageGuard(() =>
      creativeDelegate.update({
        where: { id },
        data: {
          status: 'completed',
          image_url: upload.key,
          thumb_url: upload.thumbKey || null,
          provider_model: null,
          error_message: null,
          completed_at: new Date(),
          updated_at: new Date(),
          generation_metadata: {
            source: 'manual_editor',
          },
        },
        include: this.creativeInclude(),
      }),
    );

    return this.serializeCreative(updated);
  }

  private parseManualImage(imageBase64: string) {
    const match = imageBase64.match(
      /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/,
    );

    if (!match) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'La imagen manual debe enviarse como data URL base64.',
      );
    }

    const contentType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
    const payload = match[2];
    const sizeInBytes = Buffer.byteLength(payload, 'base64');

    if (sizeInBytes > 10 * 1024 * 1024) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'La imagen manual supera el tamano maximo permitido.',
      );
    }

    return {
      contentType,
      dataUrl: imageBase64,
      extension: contentType.split('/')[1].replace('jpeg', 'jpg'),
    };
  }

  private async markProcessing(id: number) {
    const creativeDelegate = this.getCreativeDelegate();
    await this.ensureAdStorageAvailable();

    if (!creativeDelegate) {
      await this.updateStatusRaw(id, 'processing');
      return;
    }

    await this.runWithAdStorageGuard(() =>
      creativeDelegate.update({
        where: { id },
        data: {
          status: 'processing',
          error_message: null,
          updated_at: new Date(),
        },
      }),
    );
  }

  private async markFailed(id: number, error: string) {
    try {
      const creativeDelegate = this.getCreativeDelegate();

      if (!creativeDelegate) {
        await this.updateFailedRaw(id, error);
        return;
      }

      await this.runWithAdStorageGuard(() =>
        creativeDelegate.update({
          where: { id },
          data: {
            status: 'failed',
            error_message: error.slice(0, 1000),
            updated_at: new Date(),
          },
        }),
      );
    } catch (updateError: any) {
      this.logger.warn(
        `No se pudo marcar anuncio ${id} como fallido: ${updateError.message}`,
      );
    }
  }

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new VendixHttpException(
        ErrorCodes.SYS_FORBIDDEN_001,
        'Se requiere contexto de tienda.',
      );
    }
    // Narrow store_id to number after the guard above (TypeScript does not
    // propagate the narrowing through the function return type).
    return context as typeof context & { store_id: number };
  }

  private async assertDailyGenerationQuota(storeId: number) {
    if (!Number.isInteger(storeId) || storeId <= 0) {
      throw new VendixHttpException(ErrorCodes.SYS_FORBIDDEN_001);
    }

    const period = this.dailyPeriodKey();
    const quotaKey = this.generationQuotaKey(storeId, period);

    try {
      const currentRaw = await this.redis.get(quotaKey);
      const current = Number(currentRaw || 0);

      if (current >= this.dailyGenerationLimit) {
        throw this.dailyGenerationLimitException(period);
      }
    } catch (error: any) {
      if (
        this.extractErrorCode(error) === ErrorCodes.MKT_AD_RATE_LIMIT_001.code
      ) {
        throw error;
      }

      this.logger.warn(
        `No se pudo verificar limite diario de anuncios para tienda ${storeId}: ${error.message}`,
      );
      throw new VendixHttpException(
        ErrorCodes.MKT_AD_RATE_LIMIT_002,
        'No se pudo verificar el limite diario de generacion de anuncios.',
      );
    }
  }

  private async consumeDailyGenerationQuota(
    storeId: number,
    requestId: string,
  ): Promise<void> {
    if (!Number.isInteger(storeId) || storeId <= 0) return;
    if (!requestId.trim()) return;

    const period = this.dailyPeriodKey();
    const quotaKey = this.generationQuotaKey(storeId, period);
    const dedupKey = this.generationDedupKey(storeId, period);

    try {
      await this.redis.eval(
        this.consumeGenerationQuotaLua,
        2,
        quotaKey,
        dedupKey,
        requestId,
        1,
        this.dailyGenerationTtlSeconds,
      );
    } catch (error: any) {
      this.logger.warn(
        `No se pudo consumir cuota diaria de anuncios para tienda ${storeId} request=${requestId}: ${error.message}`,
      );
    }
  }

  private dailyGenerationLimitException(period: string) {
    return new VendixHttpException(
      ErrorCodes.MKT_AD_RATE_LIMIT_001,
      `Alcanzaste el limite diario de ${this.dailyGenerationLimit} anuncios generados para esta tienda. Intenta de nuevo manana.`,
      {
        limit: this.dailyGenerationLimit,
        period,
      },
    );
  }

  private resolveGenerationRequestId(id: number, requestId?: string): string {
    const cleanRequestId = requestId?.trim();
    if (cleanRequestId) return cleanRequestId.slice(0, 120);

    const contextRequestId = RequestContextService.getRequestId()?.trim();
    if (contextRequestId) return contextRequestId.slice(0, 120);

    return `ad-creative-${id}-${Date.now()}`;
  }

  private generationQuotaKey(storeId: number, period: string) {
    return `marketing:ad-creatives:generation:${storeId}:${period}`;
  }

  private generationDedupKey(storeId: number, period: string) {
    return `marketing:ad-creatives:generation:dedup:${storeId}:${period}`;
  }

  private dailyPeriodKey(date = new Date()): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  private shouldMarkGenerationFailed(error: any): boolean {
    const errorCode = this.extractErrorCode(error);
    return (
      errorCode !== ErrorCodes.MKT_AD_RATE_LIMIT_001.code &&
      errorCode !== ErrorCodes.MKT_AD_RATE_LIMIT_002.code
    );
  }

  private toStreamError(error: any) {
    const response =
      typeof error?.getResponse === 'function' ? error.getResponse() : null;
    const responseBody =
      response && typeof response === 'object' ? (response as any) : null;
    const errorCode = this.extractErrorCode(error);

    return {
      type: 'error',
      error:
        responseBody?.message ||
        error?.message ||
        'No se pudo generar la imagen.',
      ...(errorCode ? { error_code: errorCode } : {}),
      ...(responseBody?.details ? { details: responseBody.details } : {}),
    };
  }

  private extractErrorCode(error: any): string | undefined {
    if (typeof error?.errorCode === 'string') return error.errorCode;

    const response =
      typeof error?.getResponse === 'function' ? error.getResponse() : null;
    if (response && typeof response === 'object') {
      const responseBody = response as { error_code?: unknown };
      if (typeof responseBody.error_code === 'string') {
        return responseBody.error_code;
      }
    }

    return undefined;
  }

  private uniqueNumbers(values: number[]) {
    return Array.from(
      new Set(values.filter((value) => Number.isInteger(value))),
    );
  }

  private formatToSize(
    format: AdFormat,
  ): '1024x1024' | '1024x1536' | '1536x1024' {
    switch (format) {
      case 'story':
        return '1024x1536';
      case 'landscape':
        return '1536x1024';
      case 'square':
      default:
        return '1024x1024';
    }
  }

  private formatLabel(format: AdFormat) {
    switch (format) {
      case 'story':
        return 'Historia vertical';
      case 'landscape':
        return 'Horizontal para banner';
      case 'square':
      default:
        return 'Cuadrado para feed';
    }
  }

  private slugify(value: string) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
  }

  private getCreativeDelegate(): any | null {
    const delegate = (this.prisma as any).marketing_ad_creatives;
    return delegate?.findMany && delegate?.count ? delegate : null;
  }

  private async hasAdStorage(): Promise<boolean> {
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        creatives_table: string | null;
        products_table: string | null;
        images_table: string | null;
      }>
    >(
      `
      SELECT
        to_regclass('public.marketing_ad_creatives')::text AS creatives_table,
        to_regclass('public.marketing_ad_creative_products')::text AS products_table,
        to_regclass('public.marketing_ad_creative_images')::text AS images_table
      `,
    );
    const storage = rows[0];
    return !!(
      storage?.creatives_table &&
      storage.products_table &&
      storage.images_table
    );
  }

  private async findAllRaw(
    query: QueryMarketingAdCreativesDto,
    page: number,
    limit: number,
    skip: number,
  ) {
    const context = this.getContext();
    const { whereSql, values } = this.buildRawFilters(query, context.store_id);

    if (!(await this.hasAdStorage())) {
      return {
        data: [],
        meta: {
          total: 0,
          page,
          limit,
          total_pages: 0,
        },
      };
    }

    try {
      const dataValues = [...values, limit, skip];
      const limitIndex = dataValues.length - 1;
      const offsetIndex = dataValues.length;
      const data = await this.prisma.$queryRawUnsafe<any[]>(
        `
        SELECT *
        FROM "marketing_ad_creatives"
        WHERE ${whereSql}
        ORDER BY "created_at" DESC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}
        `,
        ...dataValues,
      );
      const totalRows = await this.prisma.$queryRawUnsafe<
        Array<{ total: number }>
      >(
        `
        SELECT COUNT(*)::int AS total
        FROM "marketing_ad_creatives"
        WHERE ${whereSql}
        `,
        ...values,
      );
      const total = Number(totalRows[0]?.total || 0);
      const hydrated = await this.hydrateCreativeRows(data);

      return {
        data: await Promise.all(
          hydrated.map((item) => this.serializeCreative(item)),
        ),
        meta: {
          total,
          page,
          limit,
          total_pages: Math.ceil(total / limit),
        },
      };
    } catch (error: any) {
      if (this.isMissingAdStorageError(error)) {
        this.logger.warn(
          `Anuncios no tiene almacenamiento disponible aun: ${error.message}`,
        );
        return {
          data: [],
          meta: {
            total: 0,
            page,
            limit,
            total_pages: 0,
          },
        };
      }
      throw error;
    }
  }

  private async getSummaryRaw() {
    const context = this.getContext();

    if (!(await this.hasAdStorage())) {
      return {
        total: 0,
        completed: 0,
        processing: 0,
        failed: 0,
      };
    }

    try {
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{
          total: number;
          completed: number;
          processing: number;
          failed: number;
        }>
      >(
        `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE "status"::text = 'completed')::int AS completed,
          COUNT(*) FILTER (WHERE "status"::text = 'processing')::int AS processing,
          COUNT(*) FILTER (WHERE "status"::text = 'failed')::int AS failed
        FROM "marketing_ad_creatives"
        WHERE "store_id" = $1
        `,
        context.store_id,
      );

      return {
        total: Number(rows[0]?.total || 0),
        completed: Number(rows[0]?.completed || 0),
        processing: Number(rows[0]?.processing || 0),
        failed: Number(rows[0]?.failed || 0),
      };
    } catch (error: any) {
      if (this.isMissingAdStorageError(error)) {
        this.logger.warn(
          `Resumen de Anuncios no disponible aun: ${error.message}`,
        );
        return {
          total: 0,
          completed: 0,
          processing: 0,
          failed: 0,
        };
      }
      throw error;
    }
  }

  private async createRaw(
    dto: CreateMarketingAdCreativeDto,
    productIds: number[],
    selectedImages: any[],
    context: { store_id?: number | null; user_id?: number | null },
  ) {
    if (!(await this.hasAdStorage())) {
      throw this.adStorageUnavailableException();
    }

    try {
      const creativeRows = await this.prisma.$transaction(async (tx: any) => {
        const created = (await tx.$queryRawUnsafe(
          `
          INSERT INTO "marketing_ad_creatives"
            ("store_id", "created_by_user_id", "title", "description", "prompt", "format", "ai_app_key")
          VALUES
            ($1, $2, $3, $4, $5, $6::marketing_ad_creative_format_enum, $7)
          RETURNING *
          `,
          context.store_id,
          context.user_id ?? null,
          dto.title.trim(),
          dto.description?.trim() || null,
          dto.prompt?.trim() || null,
          dto.format || 'square',
          dto.ai_app_key || 'marketing_ad_image_generator',
        )) as any[];
        const creative = created[0];

        for (const productId of productIds) {
          await tx.$executeRawUnsafe(
            `
            INSERT INTO "marketing_ad_creative_products" ("creative_id", "product_id")
            VALUES ($1, $2)
            ON CONFLICT ("creative_id", "product_id") DO NOTHING
            `,
            creative.id,
            productId,
          );
        }

        for (const [index, image] of selectedImages.entries()) {
          await tx.$executeRawUnsafe(
            `
            INSERT INTO "marketing_ad_creative_images"
              ("creative_id", "product_image_id", "image_url", "source_type", "sort_order")
            VALUES ($1, $2, $3, 'product', $4)
            `,
            creative.id,
            image.id ?? null,
            this.s3Service.sanitizeForStorage(image.image_url) ||
              image.image_url ||
              null,
            index,
          );
        }

        return created;
      });

      const creative = await this.getCreativeByIdRaw(creativeRows[0].id);
      return this.serializeCreative(creative);
    } catch (error: any) {
      if (this.isMissingAdStorageError(error)) {
        throw this.adStorageUnavailableException();
      }
      throw error;
    }
  }

  private buildRawFilters(
    query: QueryMarketingAdCreativesDto,
    storeId?: number | null,
  ) {
    const filters = ['"store_id" = $1'];
    const values: any[] = [storeId];

    if (query.search?.trim()) {
      values.push(`%${query.search.trim()}%`);
      const index = values.length;
      filters.push(
        `("title" ILIKE $${index} OR "description" ILIKE $${index} OR "prompt" ILIKE $${index})`,
      );
    }

    if (query.status) {
      values.push(query.status);
      filters.push(`"status"::text = $${values.length}`);
    }

    if (query.format) {
      values.push(query.format);
      filters.push(`"format"::text = $${values.length}`);
    }

    return {
      whereSql: filters.join(' AND '),
      values,
    };
  }

  private async getCreativeByIdRaw(id: number) {
    const context = this.getContext();

    if (!(await this.hasAdStorage())) {
      throw this.adStorageUnavailableException();
    }

    try {
      const rows = await this.prisma.$queryRawUnsafe<any[]>(
        `
        SELECT *
        FROM "marketing_ad_creatives"
        WHERE "id" = $1 AND "store_id" = $2
        LIMIT 1
        `,
        id,
        context.store_id,
      );
      const hydrated = await this.hydrateCreativeRows(rows);
      return hydrated[0] || null;
    } catch (error: any) {
      if (this.isMissingAdStorageError(error)) {
        throw this.adStorageUnavailableException();
      }
      throw error;
    }
  }

  private async hydrateCreativeRows(rows: any[]) {
    if (!rows.length) return [];

    const ids = rows.map((row) => Number(row.id));
    const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ');
    const products = await this.prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        macp."id",
        macp."creative_id",
        macp."product_id",
        p."id" AS "p_id",
        p."name" AS "p_name",
        p."sku" AS "p_sku",
        p."base_price"::text AS "p_base_price",
        p."sale_price"::text AS "p_sale_price",
        p."description" AS "p_description"
      FROM "marketing_ad_creative_products" macp
      JOIN "products" p ON p."id" = macp."product_id"
      WHERE macp."creative_id" IN (${placeholders})
      ORDER BY macp."id" ASC
      `,
      ...ids,
    );
    const images = await this.prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        maci."id",
        maci."creative_id",
        maci."product_image_id",
        maci."image_url",
        maci."source_type",
        maci."sort_order",
        pi."id" AS "pi_id",
        pi."image_url" AS "pi_image_url",
        pi."alt_text" AS "pi_alt_text",
        pi."product_id" AS "pi_product_id"
      FROM "marketing_ad_creative_images" maci
      LEFT JOIN "product_images" pi ON pi."id" = maci."product_image_id"
      WHERE maci."creative_id" IN (${placeholders})
      ORDER BY maci."sort_order" ASC, maci."id" ASC
      `,
      ...ids,
    );
    const byId = new Map(
      rows.map((row) => [
        Number(row.id),
        {
          ...row,
          creative_products: [] as any[],
          creative_images: [] as any[],
        },
      ]),
    );

    for (const item of products) {
      byId.get(Number(item.creative_id))?.creative_products.push({
        id: Number(item.id),
        creative_id: Number(item.creative_id),
        product_id: Number(item.product_id),
        product: {
          id: Number(item.p_id),
          name: item.p_name,
          sku: item.p_sku,
          base_price: item.p_base_price,
          sale_price: item.p_sale_price,
          description: item.p_description,
        },
      });
    }

    for (const image of images) {
      byId.get(Number(image.creative_id))?.creative_images.push({
        id: Number(image.id),
        creative_id: Number(image.creative_id),
        product_image_id: image.product_image_id
          ? Number(image.product_image_id)
          : null,
        image_url: image.image_url,
        source_type: image.source_type,
        sort_order: image.sort_order,
        product_image: image.pi_id
          ? {
              id: Number(image.pi_id),
              image_url: image.pi_image_url,
              alt_text: image.pi_alt_text,
              product_id: image.pi_product_id
                ? Number(image.pi_product_id)
                : null,
            }
          : null,
      });
    }

    return rows.map((row) => byId.get(Number(row.id)));
  }

  private async getCreativeFileKeysRaw(id: number) {
    const context = this.getContext();
    if (!(await this.hasAdStorage())) {
      throw this.adStorageUnavailableException();
    }

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
      SELECT "id", "image_url", "thumb_url"
      FROM "marketing_ad_creatives"
      WHERE "id" = $1 AND "store_id" = $2
      LIMIT 1
      `,
      id,
      context.store_id,
    );
    return rows[0] || null;
  }

  private async deleteRaw(id: number) {
    const context = this.getContext();
    if (!(await this.hasAdStorage())) {
      throw this.adStorageUnavailableException();
    }

    await this.prisma.$executeRawUnsafe(
      `
      DELETE FROM "marketing_ad_creatives"
      WHERE "id" = $1 AND "store_id" = $2
      `,
      id,
      context.store_id,
    );
  }

  private async updateDetailsRaw(
    id: number,
    title?: string,
    description?: string,
  ) {
    const context = this.getContext();
    if (!(await this.hasAdStorage())) {
      throw this.adStorageUnavailableException();
    }

    const current = await this.getCreativeByIdRaw(id);
    if (!current) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    await this.prisma.$executeRawUnsafe(
      `
      UPDATE "marketing_ad_creatives"
      SET
        "title" = $1,
        "description" = $2,
        "updated_at" = NOW()
      WHERE "id" = $3 AND "store_id" = $4
      `,
      title || current.title,
      description === undefined ? current.description : description || null,
      id,
      context.store_id,
    );

    return this.getCreativeByIdRaw(id);
  }

  private async saveGeneratedImageRaw(id: number, upload: any, chunk: any) {
    const context = this.getContext();
    if (!(await this.hasAdStorage())) {
      throw this.adStorageUnavailableException();
    }

    await this.prisma.$executeRawUnsafe(
      `
      UPDATE "marketing_ad_creatives"
      SET
        "status" = 'completed'::marketing_ad_creative_status_enum,
        "image_url" = $1,
        "thumb_url" = $2,
        "provider_model" = $3,
        "error_message" = NULL,
        "completed_at" = NOW(),
        "updated_at" = NOW(),
        "generation_metadata" = $4::jsonb
      WHERE "id" = $5 AND "store_id" = $6
      `,
      upload.key,
      upload.thumbKey || null,
      chunk.model || null,
      JSON.stringify({
        usage: chunk.usage || null,
        revised_prompt: chunk.revisedPrompt || null,
      }),
      id,
      context.store_id,
    );

    return this.getCreativeByIdRaw(id);
  }

  private async saveManualImageRaw(id: number, upload: any) {
    const context = this.getContext();
    if (!(await this.hasAdStorage())) {
      throw this.adStorageUnavailableException();
    }

    await this.prisma.$executeRawUnsafe(
      `
      UPDATE "marketing_ad_creatives"
      SET
        "status" = 'completed'::marketing_ad_creative_status_enum,
        "image_url" = $1,
        "thumb_url" = $2,
        "provider_model" = NULL,
        "error_message" = NULL,
        "completed_at" = NOW(),
        "updated_at" = NOW(),
        "generation_metadata" = $3::jsonb
      WHERE "id" = $4 AND "store_id" = $5
      `,
      upload.key,
      upload.thumbKey || null,
      JSON.stringify({ source: 'manual_editor' }),
      id,
      context.store_id,
    );

    return this.getCreativeByIdRaw(id);
  }

  private async updateStatusRaw(id: number, status: string) {
    const context = this.getContext();
    if (!(await this.hasAdStorage())) {
      throw this.adStorageUnavailableException();
    }

    await this.prisma.$executeRawUnsafe(
      `
      UPDATE "marketing_ad_creatives"
      SET
        "status" = $1::marketing_ad_creative_status_enum,
        "error_message" = NULL,
        "updated_at" = NOW()
      WHERE "id" = $2 AND "store_id" = $3
      `,
      status,
      id,
      context.store_id,
    );
  }

  private async updateFailedRaw(id: number, error: string) {
    const context = this.getContext();
    if (!(await this.hasAdStorage())) {
      throw this.adStorageUnavailableException();
    }

    await this.prisma.$executeRawUnsafe(
      `
      UPDATE "marketing_ad_creatives"
      SET
        "status" = 'failed'::marketing_ad_creative_status_enum,
        "error_message" = $1,
        "updated_at" = NOW()
      WHERE "id" = $2 AND "store_id" = $3
      `,
      error.slice(0, 1000),
      id,
      context.store_id,
    );
  }

  private toHttpsUrl(hostname: string): string {
    const cleanHostname = hostname
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');
    return `https://${cleanHostname}`;
  }

  private imageContentType(key: string): string {
    const extension = key.split('?')[0].split('.').pop()?.toLowerCase();
    const contentTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
      avif: 'image/avif',
    };

    return contentTypes[extension || ''] || 'application/octet-stream';
  }

  private async ensureAdStorageAvailable() {
    try {
      if (!(await this.hasAdStorage())) {
        throw this.adStorageUnavailableException();
      }
    } catch (error: any) {
      if (this.isMissingAdStorageError(error)) {
        throw this.adStorageUnavailableException();
      }
      throw error;
    }
  }

  private async runWithAdStorageGuard<T>(operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error: any) {
      if (this.isMissingAdStorageError(error)) {
        throw this.adStorageUnavailableException();
      }
      throw error;
    }
  }

  private isMissingAdStorageError(error: any): boolean {
    const message = String(error?.message || error || '').toLowerCase();
    const driverCause = error?.meta?.driverAdapterError?.cause;
    return (
      error?.code === 'P2021' ||
      error?.code === '42P01' ||
      error?.meta?.code === '42P01' ||
      driverCause?.originalCode === '42P01' ||
      driverCause?.kind === 'TableDoesNotExist' ||
      (message.includes('marketing_ad_creatives') &&
        (message.includes('does not exist') ||
          message.includes('no existe') ||
          message.includes('undefined')))
    );
  }

  private adStorageUnavailableException() {
    return new VendixHttpException(
      ErrorCodes.MKT_AD_STORAGE_001,
      'El modulo de Anuncios aun no esta listo. Ejecuta la migracion y regenera Prisma Client.',
    );
  }
}
