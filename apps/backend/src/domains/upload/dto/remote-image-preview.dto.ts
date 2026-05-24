import { IsUrl, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RemoteImagePreviewDto {
  @ApiProperty({
    description: 'Public image URL to download for product image preview/cropping',
    example: 'https://example.com/product.jpg',
  })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  url: string;
}
