import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  Body,
  Get,
  Query,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { S3Service } from '@common/services/s3.service';
import { RequestContextService } from '@common/context/request-context.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { ImageContext } from '@common/config/image-presets';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UploadFileDto, UploadEntityType, GetPresignedUrlDto } from './dto';

@ApiTags('Upload')
@ApiBearerAuth()
@Controller('upload')
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  private readonly ENTITY_TO_CONTEXT: Record<UploadEntityType, ImageContext> = {
    products: ImageContext.PRODUCT,
    avatars: ImageContext.AVATAR,
    brands: ImageContext.LOGO,
    categories: ImageContext.CATEGORY,
    logos: ImageContext.LOGO,
    store_logos: ImageContext.LOGO,
    store_favicons: ImageContext.LOGO,
    receipts: ImageContext.RECEIPT,
  };

  constructor(
    private readonly s3Service: S3Service,
    private readonly s3PathHelper: S3PathHelper,
    private readonly prisma: GlobalPrismaService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Upload a file to S3 with structured path' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        entityType: {
          type: 'string',
          enum: Object.values(UploadEntityType),
          description: 'Entity type for path organization',
        },
        entityId: {
          type: 'string',
          description: 'Optional entity ID for the path',
        },
        isMainImage: {
          type: 'boolean',
          description: 'If true, generates a 200px thumbnail',
          default: false,
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@UploadedFile() file: any, @Body() body: UploadFileDto) {
    const { entityType, entityId, isMainImage } = body;
    const context = RequestContextService.getContext();
    const orgId = context?.organization_id;
    const storeId = context?.store_id;

    if (!file?.buffer) {
      throw new VendixHttpException(ErrorCodes.UPLOAD_FILE_001);
    }

    if (!orgId) {
      throw new VendixHttpException(ErrorCodes.UPLOAD_CONTEXT_001);
    }

    // Obtener organización con slug
    const org = await this.prisma.organizations.findUnique({
      where: { id: orgId },
      select: { id: true, slug: true },
    });

    if (!org) {
      throw new VendixHttpException(ErrorCodes.UPLOAD_ORG_001);
    }

    // Construir path según el tipo de entidad
    let path: string;

    switch (entityType) {
      case UploadEntityType.PRODUCTS: {
        if (!storeId)
          throw new VendixHttpException(ErrorCodes.UPLOAD_STORE_CONTEXT_001);
        const store = await this.getStoreWithSlug(storeId);
        path = this.s3PathHelper.buildProductPath(org, store);
        break;
      }
      case UploadEntityType.CATEGORIES: {
        if (!storeId)
          throw new VendixHttpException(ErrorCodes.UPLOAD_STORE_CONTEXT_001);
        const store = await this.getStoreWithSlug(storeId);
        path = this.s3PathHelper.buildCategoryPath(org, store);
        break;
      }
      case UploadEntityType.STORE_LOGOS: {
        if (!storeId)
          throw new VendixHttpException(ErrorCodes.UPLOAD_STORE_CONTEXT_001);
        const store = await this.getStoreWithSlug(storeId);
        path = this.s3PathHelper.buildStoreLogoPath(org, store);
        break;
      }
      case UploadEntityType.STORE_FAVICONS: {
        if (!storeId)
          throw new VendixHttpException(ErrorCodes.UPLOAD_STORE_CONTEXT_001);
        const store = await this.getStoreWithSlug(storeId);
        path = this.s3PathHelper.buildFaviconPath(org, store);
        break;
      }
      case UploadEntityType.AVATARS: {
        const userId = context?.user_id;
        if (!userId) throw new VendixHttpException(ErrorCodes.AUTH_CONTEXT_001);
        path = this.s3PathHelper.buildAvatarPath(org, userId);
        break;
      }
      case UploadEntityType.RECEIPTS: {
        if (!storeId)
          throw new VendixHttpException(ErrorCodes.UPLOAD_STORE_CONTEXT_001);
        const store = await this.getStoreWithSlug(storeId);
        path = this.s3PathHelper.buildReceiptPath(org, store);
        break;
      }
      case UploadEntityType.BRANDS:
      case UploadEntityType.LOGOS:
        path = this.s3PathHelper.buildOrgEntityPath(org, entityType);
        break;
      default:
        throw new VendixHttpException(ErrorCodes.UPLOAD_TYPE_001, undefined, {
          entityType,
        });
    }

    if (entityId) {
      path += `/${entityId}`;
    }

    const fileName = `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
    const key = `${path}/${fileName}`;

    // Always generate thumbnails for listings-heavy entities, or if explicitly requested
    const isMain =
      isMainImage === 'true' ||
      [
        UploadEntityType.AVATARS,
        UploadEntityType.BRANDS,
        UploadEntityType.CATEGORIES,
        UploadEntityType.STORE_LOGOS,
        UploadEntityType.STORE_FAVICONS,
      ].includes(entityType);

    try {
      if (file.mimetype.startsWith('image/')) {
        const context =
          this.ENTITY_TO_CONTEXT[entityType] ?? ImageContext.DEFAULT;
        const { key: uploadedKey, thumbKey } = await this.s3Service.uploadImage(
          file.buffer,
          key,
          { generateThumbnail: isMain, context },
        );

        return {
          key: uploadedKey,
          thumbKey,
          url: await this.s3Service.signUrl(uploadedKey),
          thumbUrl: await this.s3Service.signUrl(thumbKey, true),
        };
      }

      const uploadedKey = await this.s3Service.uploadFile(
        file.buffer,
        key,
        file.mimetype,
      );

      return {
        key: uploadedKey,
        url: await this.s3Service.signUrl(uploadedKey),
      };
    } catch (error) {
      this.logger.error(
        `Upload failed for entityType=${entityType}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new VendixHttpException(ErrorCodes.UPLOAD_FAILED_001, undefined, {
        entityType,
      });
    }
  }

  @Get('presigned-url')
  @ApiOperation({ summary: 'Get a temporary URL for a file' })
  async getUrl(@Query() query: GetPresignedUrlDto) {
    const key = query.key;

    const context = RequestContextService.getContext();
    const orgId = context?.organization_id;

    if (!orgId) {
      throw new VendixHttpException(ErrorCodes.UPLOAD_CONTEXT_001);
    }

    const org = await this.prisma.organizations.findUnique({
      where: { id: orgId },
      select: { id: true, slug: true },
    });

    if (!org) {
      throw new VendixHttpException(ErrorCodes.UPLOAD_ORG_001);
    }

    // Validate key does not contain path traversal sequences before normalization
    if (key.includes('..')) {
      throw new VendixHttpException(ErrorCodes.UPLOAD_FORBIDDEN_001);
    }

    const expectedOrgPrefix = this.s3PathHelper.buildOrgPath(org);

    // Normalize key to resolve path segments before checking prefix
    const normalizedKey = key
      .split('/')
      .filter((s) => s && s !== '.')
      .join('/');
    if (!normalizedKey.startsWith(expectedOrgPrefix)) {
      throw new VendixHttpException(ErrorCodes.UPLOAD_FORBIDDEN_001);
    }

    const url = await this.s3Service.getPresignedUrl(normalizedKey);
    return { url };
  }

  /**
   * Helper to get store with slug for S3 path building
   */
  private async getStoreWithSlug(
    storeId: number,
  ): Promise<{ id: number; slug: string }> {
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { id: true, slug: true },
    });

    if (!store) {
      throw new VendixHttpException(ErrorCodes.UPLOAD_STORE_001);
    }

    return store;
  }
}
