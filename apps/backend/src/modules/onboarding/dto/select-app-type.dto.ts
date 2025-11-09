import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { AppType } from './setup-app-config-wizard.dto';

export class SelectAppTypeDto {
  @ApiProperty({
    enum: AppType,
    description: 'Tipo de aplicación seleccionada por el usuario',
    example: AppType.STORE_ADMIN,
  })
  @IsEnum(AppType)
  app_type: AppType;

  @ApiPropertyOptional({
    description: 'Notas adicionales sobre la selección del usuario',
    example: 'Usuario prefiere empezar con una tienda única',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}