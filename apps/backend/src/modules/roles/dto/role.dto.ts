import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsInt,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRoleDto {
  @ApiProperty({
    description: 'Nombre único del rol',
    example: 'manager',
    minLength: 2,
    maxLength: 50,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name: string;

  @ApiPropertyOptional({
    description: 'Descripción del rol',
    example: 'Gestor de tienda con permisos administrativos',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Indica si es un rol del sistema (no se puede eliminar)',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  is_system_role?: boolean;
}

export class UpdateRoleDto {
  @ApiPropertyOptional({
    description: 'Nombre único del rol',
    example: 'senior_manager',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({
    description: 'Descripción del rol',
    example: 'Gestor senior con permisos avanzados',
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
  permissionIds: number[];
}

export class RemovePermissionsDto {
  @ApiProperty({
    description: 'Lista de IDs de permisos a remover',
    example: [2, 4],
    type: [Number],
  })
  @IsArray()
  @IsInt({ each: true })
  permissionIds: number[];
}

export class AssignRoleToUserDto {
  @ApiProperty({
    description: 'ID del usuario',
    example: 123,
  })
  @IsInt()
  userId: number;

  @ApiProperty({
    description: 'ID del rol a asignar',
    example: 5,
  })
  @IsInt()
  roleId: number;
}

export class RemoveRoleFromUserDto {
  @ApiProperty({
    description: 'ID del usuario',
    example: 123,
  })
  @IsInt()
  userId: number;

  @ApiProperty({
    description: 'ID del rol a remover',
    example: 5,
  })
  @IsInt()
  roleId: number;
}

export class RoleDashboardStatsDto {
  @ApiProperty({
    description: 'Total de roles en el sistema',
    example: 15,
  })
  total_roles: number;

  @ApiProperty({
    description: 'Total de roles del sistema',
    example: 5,
  })
  system_roles: number;

  @ApiProperty({
    description: 'Total de roles personalizados',
    example: 10,
  })
  custom_roles: number;

  @ApiProperty({
    description: 'Total de permisos disponibles',
    example: 42,
  })
  total_permissions: number;
}

export class RoleWithPermissionDescriptionsDto {
  @ApiProperty({
    description: 'ID del rol',
    example: 1,
  })
  id: number;

  @ApiProperty({
    description: 'Nombre del rol',
    example: 'manager',
  })
  name: string;

  @ApiProperty({
    description: 'Descripción del rol',
    example: 'Gestor de tienda con permisos administrativos',
  })
  description?: string;

  @ApiProperty({
    description: 'Indica si es un rol del sistema',
    example: false,
  })
  is_system_role: boolean;

  @ApiProperty({
    description: 'Fecha de creación',
    example: '2023-01-01T00:00:00.000Z',
  })
  created_at?: Date;

  @ApiProperty({
    description: 'Fecha de actualización',
    example: '2023-01-01T00:00:00.000Z',
  })
  updated_at?: Date;

  @ApiProperty({
    description: 'Array con las descripciones de los permisos',
    example: ['Crear usuarios', 'Editar productos', 'Ver reportes'],
    type: [String],
  })
  permissions: string[];

  @ApiProperty({
    description: 'Usuarios asignados al rol',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        email: { type: 'string' },
        first_name: { type: 'string' },
        last_name: { type: 'string' },
        state: { type: 'string' },
      },
    },
  })
  user_roles?: any[];

  @ApiProperty({
    description: 'Conteo de usuarios asignados',
    example: 5,
  })
  _count?: {
    user_roles: number;
  };
}
