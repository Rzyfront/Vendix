import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UploadEntityType } from './upload-entity-type.enum';

export class UploadFileDto {
  @ApiProperty({
    enum: UploadEntityType,
    description: 'Entity type for path organization',
    example: UploadEntityType.PRODUCTS,
  })
  @IsEnum(UploadEntityType, {
    message: `entityType must be one of: ${Object.values(UploadEntityType).join(', ')}`,
  })
  @IsNotEmpty()
  entityType: UploadEntityType;

  @ApiPropertyOptional({
    description: 'Optional entity ID for the path',
    example: '12345',
  })
  @IsOptional()
  @IsString()
  entityId?: string;

  @ApiPropertyOptional({
    description: 'If true, generates a 200px thumbnail',
    default: false,
  })
  @IsOptional()
  @IsString()
  isMainImage?: string;
}
