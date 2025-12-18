import { IsObject, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSettingsDto {
  @ApiPropertyOptional({
    description: 'Configuración de la organización en formato JSON',
    example: { theme: 'dark', language: 'es', notifications: true },
  })
  @IsOptional()
  @IsObject()
  settings?: Record<string, any>;
}
