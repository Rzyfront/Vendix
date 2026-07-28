import { IsInt, IsOptional, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * QUI-72 — alcance de una asignación rol↔usuario desde el nivel organización.
 *
 * Se acepta tanto por query (`?store_id=3`) como por body porque el par de
 * endpoints es POST/DELETE: DELETE no lleva cuerpo de forma fiable en todos los
 * clientes HTTP, así que ambos leen el mismo DTO desde las dos fuentes.
 *
 * `store_id` omitido/NULL = asignación org-wide (aplica en todas las tiendas).
 */
export class UserRoleAssignmentScopeDto {
  @ApiPropertyOptional({
    description:
      'Tienda donde aplica la asignación. Omitir para que aplique en toda la organización.',
    example: 3,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  store_id?: number | null;
}
