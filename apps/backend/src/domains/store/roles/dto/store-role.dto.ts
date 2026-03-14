import {
  IsString,
  IsOptional,
  IsArray,
  IsInt,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStoreRoleDto {
  @ApiProperty({
    description: 'Nombre unico del rol',
    example: 'cajero',
    minLength: 2,
    maxLength: 50,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name: string;

  @ApiPropertyOptional({
    description: 'Descripcion del rol',
    example: 'Cajero con permisos de punto de venta',
  })
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateStoreRoleDto {
  @ApiPropertyOptional({
    description: 'Nombre unico del rol',
    example: 'cajero_senior',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({
    description: 'Descripcion del rol',
    example: 'Cajero senior con permisos avanzados',
  })
  @IsOptional()
  @IsString()
  description?: string;
}

export class AssignPermissionsDto {
  @ApiProperty({
    description: 'Lista de IDs de permisos a asignar',
    example: [1, 2, 3],
    type: [Number],
  })
  @IsArray()
  @IsInt({ each: true })
  permission_ids: number[];
}

export class RemovePermissionsDto {
  @ApiProperty({
    description: 'Lista de IDs de permisos a remover',
    example: [2, 4],
    type: [Number],
  })
  @IsArray()
  @IsInt({ each: true })
  permission_ids: number[];
}
