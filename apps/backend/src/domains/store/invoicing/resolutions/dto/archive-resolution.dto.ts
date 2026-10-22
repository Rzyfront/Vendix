import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Archivado lógico de una resolución. `replacement_prefix` solo aplica cuando la
 * resolución es la serie de notas en uso: la forma la valida
 * `archiveResolutionInTx`, no el DTO.
 */
export class ArchiveResolutionDto {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  replacement_prefix?: string;
}
