import {
    Controller,
    Post,
    UploadedFile,
    UseInterceptors,
    Body,
    Get,
    Query,
    Param,
    BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { S3Service } from '@common/services/s3.service';
import { RequestContextService } from '@common/context/request-context.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';

@ApiTags('Upload')
@Controller('upload')
export class UploadController {
    constructor(
        private readonly s3Service: S3Service,
        private readonly s3PathHelper: S3PathHelper,
        private readonly prisma: GlobalPrismaService,
    ) { }

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
                    enum: ['products', 'avatars', 'brands', 'categories', 'logos', 'store_logos', 'receipts'],
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
    async uploadFile(
        @UploadedFile() file: any,
        @Body('entityType') entityType: string,
        @Body('entityId') entityId?: string,
        @Body('isMainImage') isMainImage?: string | boolean,
    ) {
        const context = RequestContextService.getContext();
        const orgId = context?.organization_id;
        const storeId = context?.store_id;

        if (!orgId) {
            throw new BadRequestException('Organization context is required for uploads');
        }

        // Obtener organización con slug
        const org = await this.prisma.organizations.findUnique({
            where: { id: orgId },
            select: { id: true, slug: true },
        });

        if (!org) {
            throw new BadRequestException('Organization not found');
        }

        // Construir path según el tipo de entidad
        let path: string;

        switch (entityType) {
            case 'products': {
                if (!storeId) throw new BadRequestException('Store context required for product uploads');
                const store = await this.getStoreWithSlug(storeId);
                path = this.s3PathHelper.buildProductPath(org, store);
                break;
            }
            case 'categories': {
                if (!storeId) throw new BadRequestException('Store context required for category uploads');
                const store = await this.getStoreWithSlug(storeId);
                path = this.s3PathHelper.buildCategoryPath(org, store);
                break;
            }
            case 'store_logos': {
                if (!storeId) throw new BadRequestException('Store context required for store logo uploads');
                const store = await this.getStoreWithSlug(storeId);
                path = this.s3PathHelper.buildStoreLogoPath(org, store);
                break;
            }
            case 'avatars': {
                const userId = context?.user_id;
                if (!userId) throw new BadRequestException('User context required for avatar uploads');
                path = this.s3PathHelper.buildAvatarPath(org, userId);
                break;
            }
            case 'receipts': {
                if (!storeId) throw new BadRequestException('Store context required for receipt uploads');
                const store = await this.getStoreWithSlug(storeId);
                path = this.s3PathHelper.buildReceiptPath(org, store);
                break;
            }
            case 'brands':
            case 'logos':
                path = this.s3PathHelper.buildOrgEntityPath(org, entityType);
                break;
            default:
                path = this.s3PathHelper.buildOrgEntityPath(org, 'others');
        }

        if (entityId) {
            path += `/${entityId}`;
        }

        const fileName = `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
        const key = `${path}/${fileName}`;

        // Always generate thumbnails for listings-heavy entities, or if explicitly requested
        const isMain = isMainImage === 'true' ||
            isMainImage === true ||
            ['avatars', 'brands', 'categories', 'store_logos'].includes(entityType);

        if (file.mimetype.startsWith('image/')) {
            const { key: uploadedKey, thumbKey } = await this.s3Service.uploadImage(
                file.buffer,
                key,
                { generateThumbnail: isMain },
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
    }

    @Get('presigned-url')
    @ApiOperation({ summary: 'Get a temporary URL for a file' })
    async getUrl(@Query('key') key: string) {
        const url = await this.s3Service.getPresignedUrl(key);
        return { url };
    }

    /**
     * Helper to get store with slug for S3 path building
     */
    private async getStoreWithSlug(storeId: number): Promise<{ id: number; slug: string }> {
        const store = await this.prisma.stores.findUnique({
            where: { id: storeId },
            select: { id: true, slug: true },
        });

        if (!store) {
            throw new BadRequestException('Store not found');
        }

        return store;
    }
}

