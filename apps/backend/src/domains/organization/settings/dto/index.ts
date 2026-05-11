import { IsObject, IsOptional } from 'class-validator';
import { ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';

@ApiSchema({ name: 'OrganizationUpdateSettingsDto' })
export class UpdateSettingsDto {
  @ApiPropertyOptional({
    description: 'Configuración de la organización en formato JSON',
    example: { theme: 'dark', language: 'es', notifications: true },
  })
  @IsOptional()
  @IsObject()
  settings?: Record<string, any>;
}

export * from './operating-scope.dto';
export * from './fiscal-scope.dto';
export * from './update-org-inventory-settings.dto';
export * from './update-org-fiscal-data.dto';
