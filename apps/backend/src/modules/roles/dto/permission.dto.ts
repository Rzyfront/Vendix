import { IsString, IsOptional, IsEnum, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { http_method_enum, permission_status_enum } from '@prisma/client';

export class CreatePermissionDto {
  @ApiProperty({
    description: 'Nombre único del permiso',
    example: 'users.create',
    minLength: 3,
    maxLength: 100
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: 'Descripción del permiso',
    example: 'Permite crear nuevos usuarios en el sistema'
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Ruta del endpoint',
    example: '/api/users'
  })
  @IsString()
  path: string;

  @ApiProperty({
    description: 'Método HTTP',
    example: 'POST',
    enum: http_method_enum
  })
  @IsEnum(http_method_enum)
  method: http_method_enum;

  @ApiPropertyOptional({
    description: 'Estado del permiso',
    example: 'active',
    enum: permission_status_enum,
    default: 'active'
  })
  @IsOptional()
  @IsEnum(permission_status_enum)
  status?: permission_status_enum;
}

export class UpdatePermissionDto {
  @ApiPropertyOptional({
    description: 'Nombre único del permiso',
    example: 'users.create.admin'
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: 'Descripción del permiso',
    example: 'Permite crear usuarios administradores'
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Ruta del endpoint',
    example: '/api/admin/users'
  })
  @IsOptional()
  @IsString()
  path?: string;

  @ApiPropertyOptional({
    description: 'Método HTTP',
    enum: http_method_enum
  })
  @IsOptional()
  @IsEnum(http_method_enum)
  method?: http_method_enum;

  @ApiPropertyOptional({
    description: 'Estado del permiso',
    enum: permission_status_enum
  })
  @IsOptional()
  @IsEnum(permission_status_enum)
  status?: permission_status_enum;
}

export class PermissionFilterDto {
  @ApiPropertyOptional({
    description: 'Filtrar por método HTTP',
    enum: http_method_enum
  })
  @IsOptional()
  @IsEnum(http_method_enum)
  method?: http_method_enum;

  @ApiPropertyOptional({
    description: 'Filtrar por estado',
    enum: permission_status_enum
  })
  @IsOptional()
  @IsEnum(permission_status_enum)
  status?: permission_status_enum;

  @ApiPropertyOptional({
    description: 'Buscar por nombre o descripción',
    example: 'user'
  })
  @IsOptional()
  @IsString()
  search?: string;
}
