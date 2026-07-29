import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsInt,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RoleScope } from '@common/utils/role-scope.util';

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

  /**
   * QUI-72 — ⚠️ IGNORADO en el nivel organización.
   *
   * Se conserva declarado porque el `ValidationPipe` global corre con
   * `forbidNonWhitelisted: true`: si se borrara la propiedad, el frontend actual
   * (que ya envía `system_role`) recibiría un 422 en vez de crear el rol.
   * `RolesService.create()` NUNCA lee este campo — `is_system_role` sólo lo
   * decide el nivel superadmin. Dejarlo activo aquí sería mass-assignment:
   * cualquier org podría fabricarse un rol de sistema y volverse inmune a la
   * matriz de edición.
   */
  @ApiPropertyOptional({
    description:
      'DEPRECADO en /organization/roles: se ignora. Sólo superadmin crea roles de sistema.',
    example: false,
    default: false,
    deprecated: true,
  })
  @IsOptional()
  @IsBoolean()
  system_role?: boolean;

  /**
   * QUI-72 — alcance TIENDA opcional.
   *
   * Omitido/NULL → rol de alcance organización (`store_id = NULL`).
   * Con valor → rol de alcance tienda; el servicio valida que la tienda
   * pertenezca a la organización del contexto antes de crear nada.
   * `organization_id` jamás viaja en el body: se toma del contexto.
   */
  @ApiPropertyOptional({
    description:
      'Tienda dueña del rol (alcance tienda). Omitir para un rol de alcance organización.',
    example: 3,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  store_id?: number;
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

export class AssignRoleToUserDto {
  @ApiProperty({
    description: 'ID del usuario',
    example: 123,
  })
  @IsInt()
  user_id: number;

  @ApiProperty({
    description: 'ID del rol a asignar',
    example: 5,
  })
  @IsInt()
  role_id: number;

  /**
   * QUI-72 — alcance de la asignación.
   * `null`/omitido = la asignación aplica en TODA la organización.
   * Con valor = aplica sólo en esa tienda (permite ser Cajero en A y no en B).
   */
  @ApiPropertyOptional({
    description:
      'Tienda donde aplica la asignación. NULL/omitido = toda la organización.',
    example: 3,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  store_id?: number | null;
}

export class RemoveRoleFromUserDto {
  @ApiProperty({
    description: 'ID del usuario',
    example: 123,
  })
  @IsInt()
  user_id: number;

  @ApiProperty({
    description: 'ID del rol a remover',
    example: 5,
  })
  @IsInt()
  role_id: number;

  /**
   * QUI-72 — debe coincidir con el alcance con el que se asignó.
   * Omitirlo remueve la asignación org-wide, NO las de tienda.
   */
  @ApiPropertyOptional({
    description:
      'Tienda de la asignación a remover. NULL/omitido = la asignación org-wide.',
    example: 3,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  store_id?: number | null;
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
    description:
      'ID de la organización dueña del rol. NULL para roles del sistema (compartidos entre todas las orgs).',
    example: 1,
    nullable: true,
  })
  organization_id?: number | null;

  @ApiProperty({
    description: 'Descripción del rol',
    example: 'Gestor de tienda con permisos administrativos',
  })
  description?: string;

  @ApiProperty({
    description: 'Indica si es un rol del sistema',
    example: false,
  })
  system_role: boolean;

  /**
   * QUI-72 — alcance DERIVADO de `is_system_role` + `organization_id` +
   * `store_id`. No se persiste; se calcula con `deriveRoleScope()` para que el
   * frontend no tenga que re-implementar la matriz (y desincronizarse).
   */
  @ApiProperty({
    description: 'Alcance derivado del rol',
    enum: ['system', 'organization', 'store'],
    example: 'organization',
  })
  scope: RoleScope;

  @ApiProperty({
    description:
      'Tienda dueña del rol cuando `scope = store`. NULL en los otros alcances.',
    example: 3,
    nullable: true,
  })
  store_id?: number | null;

  @ApiProperty({
    description:
      'Nombre de la tienda dueña del rol, para mostrarlo en la UI sin un segundo request.',
    example: 'Sucursal Centro',
    nullable: true,
  })
  store_name?: string | null;

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
