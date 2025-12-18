import { IsOptional, IsObject } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserSettingsDto {
    @ApiPropertyOptional({ description: 'Configuración JSON del usuario' })
    @IsOptional()
    @IsObject()
    config?: Record<string, any>;
}
