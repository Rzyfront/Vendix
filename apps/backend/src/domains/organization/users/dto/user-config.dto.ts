import { IsArray, IsEnum, IsInt, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserConfigDto {
    @ApiProperty({
        enum: ['ORG_ADMIN', 'STORE_ADMIN', 'STORE_ECOMMERCE', 'VENDIX_LANDING'],
        description: 'Application assigned to the user',
    })
    @IsEnum(['ORG_ADMIN', 'STORE_ADMIN', 'STORE_ECOMMERCE', 'VENDIX_LANDING'])
    app: 'ORG_ADMIN' | 'STORE_ADMIN' | 'STORE_ECOMMERCE' | 'VENDIX_LANDING';

    @ApiPropertyOptional({
        type: [Number],
        description: 'IDs of roles assigned to the user',
    })
    @IsOptional()
    @IsArray()
    @IsInt({ each: true })
    roles?: number[];

    @ApiPropertyOptional({
        type: [Number],
        description: 'IDs of stores assigned to the user',
    })
    @IsOptional()
    @IsArray()
    @IsInt({ each: true })
    store_ids?: number[];

    @ApiPropertyOptional({
        type: Object,
        description: 'UI configuration for the panel',
    })
    @IsOptional()
    @IsObject()
    panel_ui?: Record<string, any>;
}
