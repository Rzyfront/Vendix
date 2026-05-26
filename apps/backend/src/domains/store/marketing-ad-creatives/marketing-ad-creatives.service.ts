import { Inject, Injectable, Logger, MessageEvent } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Redis from 'ioredis';
import { Observable } from 'rxjs';
import sharp = require('sharp');
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
  SuggestMarketingAdPromptDto,
  UpdateMarketingAdCreativeDetailsDto,
} from './dto';

type AdFormat = 'square' | 'story' | 'landscape';
type ReferenceImageInput = NonNullable<
  CreateMarketingAdCreativeDto['reference_images']
>[number];

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
          { post_copy: { contains: query.search, mode: 'insensitive' } },
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

  async suggestPrompt(dto: SuggestMarketingAdPromptDto) {
    const productIds = this.uniqueNumbers(dto.product_ids || []);
    const products = productIds.length
      ? await this.prisma.products.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            name: true,
            sku: true,
            base_price: true,
            sale_price: true,
            description: true,
            online_purchase_qr_code: true,
          },
        })
      : [];

    if (products.length !== productIds.length) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'Uno o varios productos no pertenecen a la tienda actual.',
      );
    }

    const variables = await this.buildMarketingTextVariables(
      dto,
      products,
      [],
      dto.selected_resource_types,
    );
    const response = await this.aiEngine.run(
      'marketing_ad_prompt_specialist',
      variables,
    );

    if (!response.success || !response.content?.trim()) {
      throw new VendixHttpException(
        ErrorCodes.AI_REQUEST_001,
        response.error || 'No se pudo sugerir el anuncio.',
      );
    }

    return this.parsePromptSuggestion(response.content);
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
    const productIds = this.uniqueNumbers(dto.product_ids || []);
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
    const selectedReferenceImages = await this.resolveReferenceImages(
      dto.reference_images || [],
      context,
    );
    const creativeImages = [...selectedImages, ...selectedReferenceImages];

    if (!creativeDelegate) {
      return this.createRaw(dto, productIds, creativeImages, context, null);
    }

    const creative = await this.runWithAdStorageGuard(() =>
      creativeDelegate.create({
        data: {
          title: dto.title.trim(),
          description: dto.description?.trim() || null,
          prompt: dto.prompt?.trim() || null,
          post_copy: null,
          format: dto.format || 'square',
          ai_app_key: dto.ai_app_key || 'marketing_ad_image_generator',
          created_by_user_id: context.user_id ?? null,
          ...(productIds.length
            ? {
                creative_products: {
                  create: productIds.map((product_id) => ({ product_id })),
                },
              }
            : {}),
          creative_images: creativeImages.length
            ? {
                create: creativeImages.map((image, index) => ({
                  product_image_id: image.product_image_id ?? image.id ?? null,
                  image_url:
                    this.s3Service.sanitizeForStorage(image.image_url) ||
                    image.image_url,
                  source_type: image.source_type || 'product',
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
      intent: dto.intent,
      channel: dto.channel,
      cta: dto.cta,
      visual_style: dto.visual_style,
      brief: dto.brief,
      format: dto.format,
      product_ids: dto.product_ids,
      product_image_ids: dto.product_image_ids,
      reference_images: dto.reference_images,
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
              savedCreative = await this.saveGeneratedImage(
                id,
                chunk,
                creative,
              );
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

              // Post copy runs only after image succeeds — saves tokens on failure.
              try {
                const postCopy = await this.generatePostCopyForCreative(
                  id,
                  creative,
                );
                if (postCopy) {
                  savedCreative = {
                    ...savedCreative,
                    post_copy: postCopy,
                  };
                  subscriber.next({
                    type: 'ai-chunk',
                    data: JSON.stringify({
                      type: 'post_copy',
                      post_copy: postCopy,
                      creative: savedCreative,
                    }),
                  } as MessageEvent);
                }
              } catch (postCopyError: any) {
                this.logger.warn(
                  `Post copy generation failed for creative ${id}: ${postCopyError?.message || postCopyError}`,
                );
              }
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

  private async resolveReferenceImages(
    references: ReferenceImageInput[],
    context: { store_id?: number | null },
  ) {
    const resolved: Array<{
      product_image_id: null;
      image_url: string;
      source_type: string;
      label?: string | null;
    }> = [];

    for (const [index, reference] of references.entries()) {
      const sourceType = this.normalizeSourceType(reference.source_type);
      const label = reference.label?.trim() || null;
      let imageKey: string | null = null;

      if (reference.image_base64) {
        imageKey = await this.uploadReferenceImage(
          reference.image_base64,
          sourceType,
          context,
          index,
        );
      } else if (reference.image_url) {
        const sanitized = this.s3Service.sanitizeForStorage(
          reference.image_url,
        );
        if (sanitized && !sanitized.startsWith('http')) {
          imageKey = sanitized;
        }
      }

      if (!imageKey || imageKey.includes('..')) {
        throw new VendixHttpException(
          ErrorCodes.SYS_VALIDATION_001,
          'Una imagen de referencia no tiene una ruta valida.',
        );
      }

      resolved.push({
        product_image_id: null,
        image_url: imageKey,
        source_type: sourceType,
        label,
      });
    }

    return resolved;
  }

  private normalizeSourceType(value?: string): string {
    const sourceType = (value || 'uploaded')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 30);
    return sourceType || 'uploaded';
  }

  private async uploadReferenceImage(
    imageBase64: string,
    sourceType: string,
    context: { store_id?: number | null },
    index: number,
  ): Promise<string> {
    const parsed = this.parseManualImage(imageBase64);
    const store = await this.getStoreForAssets(context.store_id);
    const basePath = this.s3PathHelper.buildMarketingAnunciosPath(
      store.organizations,
      store,
    );
    const key = `${basePath}/references/${Date.now()}-${index}-${this.slugify(
      sourceType,
    )}.${parsed.extension}`;
    if (this.isQrSourceType(sourceType)) {
      const upload = await this.s3Service.uploadProcessedImage(
        this.base64ImageToBuffer(parsed.dataUrl),
        key.replace(/\.(jpg|jpeg|webp)$/i, '.png'),
        'image/png',
        {
          generateThumbnail: false,
          context: ImageContext.DEFAULT,
        },
      );
      return upload.key;
    }

    const upload = await this.s3Service.uploadBase64(
      parsed.dataUrl,
      key,
      parsed.contentType,
      {
        generateThumbnail: false,
        context: this.isQrSourceType(sourceType)
          ? ImageContext.DEFAULT
          : ImageContext.MARKETING_AD,
      },
    );
    return upload.key;
  }

  private async getStoreForAssets(storeId?: number | null) {
    if (!storeId) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'No se encontro la tienda actual para guardar el anuncio.',
      );
    }

    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: {
        id: true,
        slug: true,
        name: true,
        logo_url: true,
        store_settings: {
          select: {
            settings: true,
          },
        },
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

    return store;
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
      (creative.creative_images || [])
        .filter((image: any) => !this.isQrSourceType(image.source_type))
        .map(async (image: any) => {
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
        const description = product.description
          ? `\n  Descripcion: ${product.description}`
          : '';
        return `${index + 1}. ${product.name} | Precio base: ${Number(
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
    const sourceTypes = (creative.creative_images || [])
      .map((image: any) => image?.source_type)
      .filter((type: any): type is string => !!type);
    const products = (creative.creative_products || []).map(
      (item: any) => item.product,
    );
    const inventory = this.buildResourcesInventory(sourceTypes, products);

    return {
      title: creative.title,
      description: creative.description || 'Sin descripcion adicional',
      prompt: creative.prompt || 'Sin instrucciones adicionales',
      format_label: this.formatLabel(creative.format as AdFormat),
      size,
      products_context: productsContext || 'Sin productos detallados',
      reference_images_context:
        imageContext || 'No se seleccionaron imagenes de referencia',
      available_resources_inventory: inventory,
      qr_context: this.hasQrReference(creative)
        ? 'El QR seleccionado se insertara despues como overlay exacto. Deja una zona limpia, profesional y discreta en una esquina o area de baja interferencia visual.'
        : 'Sin QR seleccionado',
    };
  }

  private hasQrReference(creative: any): boolean {
    return (creative.creative_images || []).some((image: any) =>
      this.isQrSourceType(image.source_type),
    );
  }

  private isQrSourceType(sourceType?: string | null): boolean {
    return (sourceType || '').toLowerCase().includes('qr');
  }

  private async generatePostCopyForCreative(
    creativeId: number,
    creative: any,
  ): Promise<string | null> {
    const products = (creative.creative_products || []).map(
      (item: any) => item.product,
    );
    const creativeImages = creative.creative_images || [];
    const dtoLike: Partial<CreateMarketingAdCreativeDto> = {
      title: creative.title,
      description: creative.description || undefined,
      prompt: creative.prompt || undefined,
      format: creative.format,
    };

    const postCopy = await this.generatePostCopy(
      dtoLike as CreateMarketingAdCreativeDto,
      products,
      creativeImages,
    );

    if (!postCopy) return null;

    const creativeDelegate = this.getCreativeDelegate();
    if (creativeDelegate) {
      await this.runWithAdStorageGuard(() =>
        creativeDelegate.update({
          where: { id: creativeId },
          data: { post_copy: postCopy, updated_at: new Date() },
        }),
      );
    } else {
      await this.updatePostCopyRaw(creativeId, postCopy);
    }

    return postCopy;
  }

  private async updatePostCopyRaw(id: number, postCopy: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `
      UPDATE "marketing_ad_creatives"
      SET "post_copy" = $1, "updated_at" = NOW()
      WHERE "id" = $2
      `,
      postCopy,
      id,
    );
  }

  private async generatePostCopy(
    dto: CreateMarketingAdCreativeDto,
    products: any[],
    creativeImages: any[],
  ): Promise<string | null> {
    const variables = await this.buildMarketingTextVariables(
      dto,
      products,
      creativeImages,
    );
    const response = await this.aiEngine.run(
      'marketing_ad_post_copywriter',
      variables,
    );

    if (!response.success || !response.content?.trim()) {
      throw new VendixHttpException(
        ErrorCodes.AI_REQUEST_001,
        response.error || 'No se pudo generar el post del anuncio.',
      );
    }

    const postCopy = this.parsePostCopy(response.content);
    if (!postCopy) {
      throw new VendixHttpException(
        ErrorCodes.AI_REQUEST_001,
        'No se pudo generar el post del anuncio.',
      );
    }

    return postCopy.slice(0, 4000);
  }

  private async buildMarketingTextVariables(
    dto: Partial<CreateMarketingAdCreativeDto> | SuggestMarketingAdPromptDto,
    products: any[],
    creativeImages: any[],
    selectedSourceTypes?: string[],
  ): Promise<Record<string, string>> {
    const data = dto as Partial<CreateMarketingAdCreativeDto>;
    const context = this.getContext();
    const store = await this.getStoreForAssets(context.store_id);
    const settings = (store.store_settings?.settings as any) || {};
    const branding = settings.branding || {};
    const ecommerce = settings.ecommerce || {};
    const format = (dto.format || 'square') as AdFormat;

    const sourceTypes =
      selectedSourceTypes && selectedSourceTypes.length
        ? selectedSourceTypes
        : (creativeImages || [])
            .map((image) => image?.source_type)
            .filter((type): type is string => !!type);
    const storeQrAvailable = Boolean(
      ecommerce?.general?.qr_code_url ||
        ecommerce?.general?.qr_code_data_url,
    );
    const productQrAvailable = (products || []).some(
      (product) => !!product?.online_purchase_qr_code,
    );
    const inventory = this.buildResourcesInventory(sourceTypes, products, {
      storeQrAvailable,
      productQrAvailable,
    });
    const qrAvailable = storeQrAvailable || productQrAvailable;
    const qrSelected = sourceTypes.some((type) => this.isQrSourceType(type));

    return {
      store_name: store.name || branding.name || 'Tienda',
      store_branding: JSON.stringify({
        name: branding.name || store.name,
        primary_color: branding.primary_color,
        secondary_color: branding.secondary_color,
        accent_color: branding.accent_color,
        logo_url: branding.logo_url || store.logo_url,
      }),
      ecommerce_context: JSON.stringify({
        qr_available: qrAvailable,
        qr_store_available: storeQrAvailable,
        qr_product_available: productQrAvailable,
        slider_count: Array.isArray(ecommerce?.slider?.photos)
          ? ecommerce.slider.photos.length
          : 0,
      }),
      title: data.title || 'Anuncio de tienda',
      description: data.description || 'Sin descripcion adicional',
      intent: dto.intent || 'general',
      channel: dto.channel || 'redes_sociales',
      cta: dto.cta || 'Sin CTA especifico',
      visual_style: dto.visual_style || 'profesional, claro y comercial',
      brief: dto.brief || 'Sin brief adicional',
      prompt: data.prompt || 'Sin prompt final todavia',
      format_label: this.formatLabel(format),
      size: this.formatToSize(format),
      products_context:
        this.productsContext(products) || 'Sin productos seleccionados',
      resources_context:
        this.resourcesContext(creativeImages) ||
        'Sin recursos visuales adicionales',
      available_resources_inventory: inventory,
      qr_context: qrSelected
        ? 'Hay un QR seleccionado por el usuario. El post puede invitar a escanearlo, pero sin asumir descuentos no indicados.'
        : qrAvailable
          ? 'La tienda tiene QR disponible (configurado en ajustes o en productos). El post puede mencionarlo como mecanismo de compra/contacto si encaja con la intencion, sin asumir descuentos no indicados.'
          : 'No hay QR disponible ni seleccionado',
    };
  }

  private buildResourcesInventory(
    sourceTypes: string[],
    products: any[],
    availability: {
      storeQrAvailable?: boolean;
      productQrAvailable?: boolean;
    } = {},
  ): string {
    const normalized = sourceTypes.map((type) => (type || '').toLowerCase());
    const has = (predicate: (type: string) => boolean) =>
      normalized.some(predicate);
    const flag = (value: boolean) => (value ? 'SI' : 'NO');

    const hasAnyLogo = has((type) => type.includes('logo'));
    const hasSlider = has((type) => type.includes('slider'));
    const hasStoreQrSelected = has(
      (type) => type.includes('qr') && !type.includes('product'),
    );
    const hasProductQrSelected = has(
      (type) => type.includes('qr') && type.includes('product'),
    );
    const hasProductImage = has(
      (type) => type === 'product' || type === 'product_image',
    );
    const hasCustom = has(
      (type) => type === 'uploaded' || type === 'custom',
    );
    const productCount = (products || []).length;

    // QR es senal de disponibilidad: la tienda puede tener QR configurado
    // o productos con online_purchase_qr_code aunque el usuario no marque la card.
    // Otros recursos (logo, slider, uploads) siguen siendo inventario cerrado
    // por seleccion explicita.
    const storeQrAvailable = Boolean(availability.storeQrAvailable);
    const productQrAvailable = Boolean(availability.productQrAvailable);
    const storeQrFlag = hasStoreQrSelected
      ? 'SELECCIONADO'
      : storeQrAvailable
        ? 'DISPONIBLE'
        : 'NO';
    const productQrFlag = hasProductQrSelected
      ? 'SELECCIONADO'
      : productQrAvailable
        ? 'DISPONIBLE'
        : 'NO';

    return [
      `- Logo de la tienda: ${flag(hasAnyLogo)}`,
      `- Slider/banner ecommerce: ${flag(hasSlider)}`,
      `- QR de la tienda: ${storeQrFlag}`,
      `- QR de productos: ${productQrFlag}`,
      `- Imagenes de producto seleccionadas: ${flag(hasProductImage)}`,
      `- Recursos cargados por el usuario: ${flag(hasCustom)}`,
      `- Productos seleccionados (cantidad): ${productCount}`,
    ].join('\n');
  }

  private productsContext(products: any[]): string {
    return products
      .map((product, index) => {
        const salePrice = product.sale_price
          ? ` | Precio oferta: ${Number(product.sale_price)}`
          : '';
        const basePrice = product.base_price
          ? ` | Precio base: ${Number(product.base_price)}`
          : '';
        const description = product.description
          ? `\n  Descripcion: ${product.description}`
          : '';
        return `${index + 1}. ${product.name}${basePrice}${salePrice}${description}`;
      })
      .join('\n');
  }

  private resourcesContext(images: any[]): string {
    return images
      .map((image, index) => {
        const sourceType = image.source_type || 'product';
        const readableType = this.isQrSourceType(sourceType)
          ? 'QR escaneable'
          : sourceType;
        return `${index + 1}. ${readableType}`;
      })
      .join('\n');
  }

  private parsePromptSuggestion(content: string) {
    const parsed = this.safeJsonParse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const data = parsed as Record<string, any>;
      return {
        suggested_prompt:
          String(data.suggested_prompt || data.prompt || '').trim() ||
          content.trim(),
        suggested_title: String(
          data.suggested_title || data.title || '',
        ).trim(),
        notes: String(data.notes || '').trim(),
      };
    }

    return {
      suggested_prompt: content.trim(),
      suggested_title: '',
      notes: '',
    };
  }

  private parsePostCopy(content: string): string {
    const parsed = this.safeJsonParse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const data = parsed as Record<string, any>;
      return String(data.post_copy || data.copy || data.text || '').trim();
    }

    return content.trim();
  }

  private safeJsonParse(content: string): unknown | null {
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private async composeQrOverlayIfNeeded(
    imageBase64: string,
    creative: any,
  ): Promise<Buffer | null> {
    const qrImage = (creative.creative_images || []).find((image: any) =>
      this.isQrSourceType(image.source_type),
    );
    if (!qrImage) return null;

    const baseBuffer = this.base64ImageToBuffer(imageBase64);
    const qrKey = this.s3Service.sanitizeForStorage(
      qrImage.image_url || qrImage.product_image?.image_url,
    );
    if (!qrKey || qrKey.startsWith('http')) return null;

    const qrBuffer = await this.s3Service.downloadImage(qrKey);
    const baseMeta = await sharp(baseBuffer).metadata();
    const width = baseMeta.width || 1024;
    const height = baseMeta.height || 1024;
    const shorterSide = Math.min(width, height);
    const qrSize = Math.round(Math.max(128, Math.min(shorterSide * 0.18, 280)));
    const padding = Math.round(qrSize * 0.12);
    const boxSize = qrSize + padding * 2;
    const margin = Math.round(Math.max(28, shorterSide * 0.045));
    const left = Math.max(margin, width - boxSize - margin);
    const top = Math.max(margin, height - boxSize - margin);

    const qr = await sharp(qrBuffer)
      .resize(qrSize, qrSize, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer();
    const qrPanel = await sharp({
      create: {
        width: boxSize,
        height: boxSize,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 0.96 },
      },
    })
      .composite([{ input: qr, top: padding, left: padding }])
      .png()
      .toBuffer();

    return sharp(baseBuffer)
      .composite([{ input: qrPanel, top, left }])
      .png()
      .toBuffer();
  }

  private base64ImageToBuffer(imageBase64: string): Buffer {
    const match = imageBase64.match(
      /^data:image\/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/,
    );
    return Buffer.from(match?.[1] || imageBase64, 'base64');
  }

  private async saveGeneratedImage(id: number, chunk: any, creative: any) {
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
    const composedImage = await this.composeQrOverlayIfNeeded(
      chunk.imageBase64,
      creative,
    );
    const upload = composedImage
      ? await this.s3Service.uploadProcessedImage(
          composedImage,
          key,
          'image/png',
          {
            generateThumbnail: true,
            context: ImageContext.MARKETING_AD,
          },
        )
      : await this.s3Service.uploadBase64(chunk.imageBase64, key, 'image/png', {
          generateThumbnail: true,
          context: ImageContext.MARKETING_AD,
        });

    if (!creativeDelegate) {
      const updated = await this.saveGeneratedImageRaw(id, upload, {
        ...chunk,
        qrOverlay: Boolean(composedImage),
      });
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
            qr_overlay: Boolean(composedImage),
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
    postCopy: string | null,
  ) {
    if (!(await this.hasAdStorage())) {
      throw this.adStorageUnavailableException();
    }

    try {
      const creativeRows = await this.prisma.$transaction(async (tx: any) => {
        const created = (await tx.$queryRawUnsafe(
          `
          INSERT INTO "marketing_ad_creatives"
            ("store_id", "created_by_user_id", "title", "description", "prompt", "post_copy", "format", "ai_app_key")
          VALUES
            ($1, $2, $3, $4, $5, $6, $7::marketing_ad_creative_format_enum, $8)
          RETURNING *
          `,
          context.store_id,
          context.user_id ?? null,
          dto.title.trim(),
          dto.description?.trim() || null,
          dto.prompt?.trim() || null,
          postCopy,
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
            VALUES ($1, $2, $3, $4, $5)
            `,
            creative.id,
            image.product_image_id ?? image.id ?? null,
            this.s3Service.sanitizeForStorage(image.image_url) ||
              image.image_url ||
              null,
            image.source_type || 'product',
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
        `("title" ILIKE $${index} OR "description" ILIKE $${index} OR "prompt" ILIKE $${index} OR "post_copy" ILIKE $${index})`,
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
        qr_overlay: Boolean(chunk.qrOverlay),
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
