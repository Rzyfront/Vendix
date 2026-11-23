import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Saving a suggested follow-up is the approval. Every field is optional: the
 * card sends only what the person edited; the rest comes from the suggestion.
 */
export class SaveFollowupDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'title must not be empty' })
  @MaxLength(120, { message: 'title must be at most 120 characters' })
  title?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string | null;

  /**
   * ISO 8601 instant or a store-local wall clock (`2026-11-27T09:00`);
   * `null` saves it without date (a log entry).
   */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  remind_at?: string | null;
}

/** «No sugerir en este chat». */
export class MuteFollowupsDto {
  @IsBoolean()
  muted!: boolean;
}
