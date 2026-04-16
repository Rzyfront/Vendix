import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsSafeS3Key } from '@common/decorators/is-safe-s3-key.decorator';

export class GetPresignedUrlDto {
    @ApiProperty({
        example: 'organizations/my-org-1/products/12345-image.webp',
        description: 'S3 key of the file to generate a presigned URL for',
    })
    @IsString()
    @IsNotEmpty()
    @IsSafeS3Key()
    key: string;
}
