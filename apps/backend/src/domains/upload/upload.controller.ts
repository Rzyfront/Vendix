import {
    Controller,
    Post,
    UploadedFile,
    UseInterceptors,
    Body,
    Get,
    Query,
    Param,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { S3Service } from '@common/services/s3.service';
import { RequestContextService } from '@common/context/request-context.service';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';

@ApiTags('Upload')
@Controller('upload')
export class UploadController {
    constructor(private readonly s3Service: S3Service) { }

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
                    enum: ['products', 'avatars', 'brands', 'categories', 'logos', 'store_logos'],
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
        @UploadedFile() file: Express.Multer.File,
        @Body('entityType') entityType: string,
        @Body('entityId') entityId?: string,
        @Body('isMainImage') isMainImage?: string | boolean,
    ) {
        const context = RequestContextService.getContext();
        const orgId = context?.organization_id;
        const storeId = context?.store_id;

        if (!orgId) {
            throw new Error('Organization context is required for uploads');
        }

        // 1. Construct Hierarchical Path
        let path = `organizations/${orgId}`;

        switch (entityType) {
            case 'products':
                if (!storeId) throw new Error('Store context required for product uploads');
                path += `/stores/${storeId}/products`;
                break;
            case 'categories':
                if (!storeId) throw new Error('Store context required for category uploads');
                path += `/stores/${storeId}/categories`;
                break;
            case 'store_logos':
                if (!storeId) throw new Error('Store context required for store logo uploads');
                path += `/stores/${storeId}/logos`;
                break;
            case 'avatars':
                const userId = context?.user_id;
                if (!userId) throw new Error('User context required for avatar uploads');
                path += `/users/${userId}/avatars`;
                break;
            case 'brands':
            case 'logos':
                path += `/${entityType}`;
                break;
            default:
                path += `/others`;
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
}
