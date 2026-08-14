import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Set a single note for a member, keyed by (customer_id, note_key).
 * Upsert idempotent: re-setting the same key overwrites `note_value` and
 * merges `include_in_summary` (existing default wins when omitted).
 */
export class SetMembershipNoteDto {
  @IsString()
  @MaxLength(100)
  note_key!: string;

  @IsString()
  note_value!: string;

  @IsOptional()
  @IsBoolean()
  include_in_summary?: boolean;
}

/**
 * Bulk replace/set the notes for a single member. Used by the bulk-scan
 * commit (QUI-558) and by the ficha del socio editor when the user saves
 * the whole notes block at once.
 */
export class BulkSetMembershipNotesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SetMembershipNoteDto)
  notes!: SetMembershipNoteDto[];
}

/**
 * Query hint for "important notes" surfaced across the ficha del socio.
 * Mirrors the consulta-driven importantNote lookup in consultations.service.
 */
export class MembershipNoteQueryDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  customer_id?: number;

  @IsOptional()
  @IsBoolean()
  important_only?: boolean;
}
