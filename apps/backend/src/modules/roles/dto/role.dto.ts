import { IsString, IsOptional, IsBoolean, IsArray, IsInt, MinLength, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRoleDto {
  @ApiProperty({
    description: 'Nombre único del rol',
    example: 'manager',
    minLength: 2,
    maxLength: 50
  })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name: string;

  @ApiPropertyOptional({
    description: 'Descripción del rol',
    example: 'Gestor de tienda con permisos administrativos'
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Indica si es un rol del sistema (no se puede eliminar)',
    example: false,
    default: false
  })
  @IsOptional()
  @IsBoolean()
  is_system_role?: boolean;
}

export class UpdateRoleDto {
  @ApiPropertyOptional({
    description: 'Nombre único del rol',
    example: 'senior_manager'
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({
    description: 'Descripción del rol',
    example: 'Gestor senior con permisos avanzados'
  })
  @IsOptional()
  @IsString()
  description?: string;
}

export class AssignPermissionsDto {
  @ApiProperty({
    description: 'Lista de IDs de permisos a asignar',
    example: [1, 2, 3],
    type: [Number]
  })
  @IsArray()
  @IsInt({ each: true })
  permissionIds: number[];
}

export class RemovePermissionsDto {
  @ApiProperty({
    description: 'Lista de IDs de permisos a remover',
    example: [2, 4],
    type: [Number]
  })
  @IsArray()
  @IsInt({ each: true })
  permissionIds: number[];
}

export class AssignRoleToUserDto {
  @ApiProperty({
    description: 'ID del usuario',
    example: 123
  })
  @IsInt()
  userId: number;

  @ApiProperty({
    description: 'ID del rol a asignar',
    example: 5
  })
  @IsInt()
  roleId: number;
}

export class RemoveRoleFromUserDto {
  @ApiProperty({
    description: 'ID del usuario',
    example: 123
  })
  @IsInt()
  userId: number;

  @ApiProperty({
    description: 'ID del rol a remover',
    example: 5
  })
  @IsInt()
  roleId: number;
}
