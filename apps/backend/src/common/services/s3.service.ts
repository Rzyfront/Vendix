import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    ObjectCannedACL,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import * as sharp from 'sharp';

@Injectable()
export class S3Service {
    private readonly s3Client: S3Client;
    private readonly bucketName: string;
    private readonly logger = new Logger(S3Service.name);

    constructor(private readonly configService: ConfigService) {
        const region = this.configService.get<string>('AWS_REGION') || 'us-east-1';
        const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
        const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');

        this.bucketName = this.configService.get<string>('AWS_S3_BUCKET') || 'vendix-assets-storage';

        const s3Config: any = {
            region,
        };

        // If keys are provided in env, use them. Otherwise, SDK will try to find credentials (IAM Role)
        if (accessKeyId && secretAccessKey) {
            s3Config.credentials = {
                accessKeyId,
                secretAccessKey,
            };
        }

        this.s3Client = new S3Client(s3Config);
    }

    /**
     * Optimizes and uploads an image to S3. Optionally generates a thumbnail.
     */
    async uploadImage(
        file: Buffer,
        key: string,
        options: { generateThumbnail?: boolean } = {},
    ): Promise<{ key: string; thumbKey?: string }> {
        try {
            // 1. Optimize Main Image (WebP, Max 1000px)
            const optimizedMain = await sharp(file)
                .resize(1000, 1000, { fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 80 })
                .toBuffer();

            const mainKey = key.endsWith('.webp') ? key : `${key.split('.')[0]}.webp`;
            await this.uploadToS3(optimizedMain, mainKey, 'image/webp');

            let thumbKey: string | undefined;
            if (options.generateThumbnail) {
                // 2. Generate Thumbnail (WebP, Max 200px)
                const optimizedThumb = await sharp(file)
                    .resize(200, 200, { fit: 'cover' })
                    .webp({ quality: 70 })
                    .toBuffer();

                const pathParts = mainKey.split('/');
                const fileName = pathParts.pop();
                thumbKey = [...pathParts, `thumb_${fileName}`].join('/');

                await this.uploadToS3(optimizedThumb, thumbKey, 'image/webp');
            }

            return { key: mainKey, thumbKey };
        } catch (error) {
            this.logger.error(`Error processing/uploading image: ${error.message}`);
            throw error;
        }
    }

    private async uploadToS3(file: Buffer, key: string, contentType: string): Promise<void> {
        const upload = new Upload({
            client: this.s3Client,
            params: {
                Bucket: this.bucketName,
                Key: key,
                Body: file,
                ContentType: contentType,
            },
        });
        await upload.done();
        this.logger.log(`File uploaded successfully to ${key}`);
    }

    /**
     * Uploads a base64 encoded image to S3
     */
    async uploadBase64(
        base64: string,
        key: string,
        contentType?: string,
        options: { generateThumbnail?: boolean } = {}
    ): Promise<{ key: string; thumbKey?: string }> {
        const matches = base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);

        if (!matches || matches.length !== 3) {
            // If it doesn't match dataURI pattern, maybe it's raw base64
            const buffer = Buffer.from(base64, 'base64');
            return this.uploadImage(buffer, key, options);
        }

        const buffer = Buffer.from(matches[2], 'base64');

        // Use uploadImage to optimize it
        return this.uploadImage(buffer, key, options);
    }

    /**
     * Uploads a file to S3
     * @param file Buffer of the file
     * @param key Path/Name of the file in S3
     * @param contentType MIME type
     */
    async uploadFile(file: Buffer, key: string, contentType: string): Promise<string> {
        try {
            await this.uploadToS3(file, key, contentType);
            return key;
        } catch (error) {
            this.logger.error(`Error uploading file to S3: ${error.message}`);
            throw error;
        }
    }

    /**
     * Generates a presigned URL for viewing/downloading the file
     * @param key Path of the file in S3
     * @param expiresIn Expiration time in seconds (default 1 hour)
     */
    async getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
        try {
            const command = new GetObjectCommand({
                Bucket: this.bucketName,
                Key: key,
            });

            return await getSignedUrl(this.s3Client, command, { expiresIn });
        } catch (error) {
            this.logger.error(`Error generating presigned URL for ${key}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Deletes a file from S3
     * @param key Path of the file in S3
     */
    async deleteFile(key: string): Promise<void> {
        try {
            const command = new DeleteObjectCommand({
                Bucket: this.bucketName,
                Key: key,
            });

            await this.s3Client.send(command);
            this.logger.log(`File deleted successfully: ${key}`);
        } catch (error) {
            this.logger.error(`Error deleting file from S3: ${error.message}`);
            throw error;
        }
    }

    /**
     * Signs a URL for a given S3 key, optionally targeting a thumbnail.
     * If the URL is already an absolute HTTP(S) URL, returns it as is.
     */
    async signUrl(keyOrUrl: string | null | undefined, useThumbnail = false): Promise<string | undefined> {
        if (!keyOrUrl || keyOrUrl.startsWith('http')) {
            return keyOrUrl || undefined;
        }

        let targetKey = keyOrUrl;
        if (useThumbnail) {
            const pathParts = keyOrUrl.split('/');
            const fileName = pathParts.pop();
            targetKey = [...pathParts, `thumb_${fileName}`].join('/');

            try {
                return await this.getPresignedUrl(targetKey);
            } catch {
                // Return original key signature as fallback
                return this.getPresignedUrl(keyOrUrl);
            }
        }

        return this.getPresignedUrl(targetKey);
    }
}
