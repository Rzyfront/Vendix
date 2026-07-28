import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import type { RoleScope } from '@common/utils/role-scope.util';

/**
 * QUI-72 — DTOs propios del nivel PLATAFORMA.
 *
 * No se reutilizan los de `organization/roles` porque a nivel superadmin el
 * alcance del rol lo decide el PAYLOAD (puede crear roles de sistema, de
 * organización y de tienda), mientras que a nivel organización/tienda lo decide
 * el contexto del actor. Compartir un DTO obligaría a exponer `organization_id`
 * / `store_id` a niveles que jamás deben poder elegirlos.
 */

const ROLE_SCOPE_VALUES: readonly RoleScope[] = [
  'system',
  'organization',
  'store',
];

/**
 * Entero opcional que además admite NULL explícito.
 *
 * `null` NO es "sin valor": en este dominio significa "sin dueño" (rol de
 * sistema) o "org-wide" (asignación que aplica en todas las tiendas). Por eso
 * hay que distinguirlo de `undefined` en vez de colapsar ambos.
 *
 * Si el valor no es parseable se devuelve tal cual para que `@IsInt()` produzca
 * un 422 legible en lugar de dejar pasar un `NaN` silencioso hasta Prisma.
 */
const toNullableInt = ({ value }: { value: unknown }): unknown => {
  if (value === null || value === undefined) return value;
  if (value === '' || value === 'null') return null;
  if (typeof value === 'number') return value;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? value : parsed;
};

const toOptionalInt = ({ value }: { value: unknown }): unknown => {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number') return value;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? value : parsed;
};

const toOptionalBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  return value === 'true' || value === '1';
};

export class SuperadminRoleQueryDto {
  @ApiPropertyOptional({ description: 'Página (1-based)', example: 1 })
  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Elementos por página', example: 10 })
  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ description: 'Búsqueda por nombre o descripción' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filtra por el flag crudo `is_system_role`',
  })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  is_system_role?: boolean;

  @ApiPropertyOptional({
    description:
      'Filtra por alcance DERIVADO. A nivel plataforma la lista contiene los roles de todos los tenants, así que sin este filtro es inmanejable.',
    enum: ['system', 'organization', 'store'],
  })
  @IsOptional()
  @IsIn(ROLE_SCOPE_VALUES as string[])
  scope?: RoleScope;

  @ApiPropertyOptional({ description: 'Filtra por organización dueña' })
  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt()
  organization_id?: number;

  @ApiPropertyOptional({ description: 'Filtra por tienda dueña' })
  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt()
  store_id?: number;
}

export class SuperadminCreateRoleDto {
  @ApiProperty({ description: 'Nombre del rol', example: 'cajero' })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name: string;

  @ApiPropertyOptional({ description: 'Descripción del rol' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description:
      'Marca el rol como rol de sistema. Exige `organization_id` y `store_id` nulos.',
    default: false,
  })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  system_role?: boolean;

  @ApiPropertyOptional({
    description:
      'Alias de `system_role`. Existe porque el panel de superadmin ya enviaba este nombre; sin él, `forbidNonWhitelisted` rechazaría el payload con 422.',
  })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  is_system_role?: boolean;

  @ApiPropertyOptional({
    description: 'Organización dueña. NULL = rol de sistema.',
    nullable: true,
  })
  @IsOptional()
  @Transform(toNullableInt)
  @IsInt()
  organization_id?: number | null;

  @ApiPropertyOptional({
    description:
      'Tienda dueña. Exige `organization_id` y que la tienda pertenezca a esa organización.',
    nullable: true,
  })
  @IsOptional()
  @Transform(toNullableInt)
  @IsInt()
  store_id?: number | null;
}

export class SuperadminUpdateRoleDto {
  @ApiPropertyOptional({ description: 'Nombre del rol' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ description: 'Descripción del rol' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Marca/desmarca el rol como de sistema' })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  system_role?: boolean;

  @ApiPropertyOptional({ description: 'Alias de `system_role`' })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  is_system_role?: boolean;

  @ApiPropertyOptional({
    description: 'Reasigna la organización dueña. NULL la desvincula.',
    nullable: true,
  })
  @IsOptional()
  @Transform(toNullableInt)
  @IsInt()
  organization_id?: number | null;

  @ApiPropertyOptional({
    description: 'Reasigna la tienda dueña. NULL la sube a alcance organización.',
    nullable: true,
  })
  @IsOptional()
  @Transform(toNullableInt)
  @IsInt()
  store_id?: number | null;
}

/**
 * Alcance de UNA asignación rol↔usuario.
 *
 * Se usa igual en las dos direcciones (usuario→rol y rol→usuario) para que
 * ambas hablen exactamente el mismo lenguaje. Ausente o `null` = org-wide.
 */
export class RoleAssignmentScopeDto {
  @ApiPropertyOptional({
    description:
      'Tienda en la que aplica la asignación. Ausente o NULL = org-wide (aplica en todas las tiendas de la organización).',
    nullable: true,
  })
  @IsOptional()
  @Transform(toNullableInt)
  @IsInt()
  store_id?: number | null;
}
