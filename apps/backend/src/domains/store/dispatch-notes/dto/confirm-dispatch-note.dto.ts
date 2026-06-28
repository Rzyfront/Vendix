import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * QUI-431 — Serial transport for a single dispatch-note item at confirm time.
 *
 * For serialized products (`products.requires_serial_numbers = true`) the
 * confirm step MUST carry the concrete units being remisión-ed. They can be
 * provided either as existing pool ids (`serial_ids`) or as free text
 * (`serial_numbers`); free text is resolved/created into real pool rows before
 * enforcement. Non-serialized products ignore both fields entirely.
 */
export class ConfirmDispatchNoteItemSerialsDto {
  /**
   * Target dispatch_note_item this batch of serials belongs to. Lets the
   * client bind serials to the exact line being confirmed (matters when the
   * same product appears on more than one line).
   */
  @IsInt()
  @Min(1)
  dispatch_note_item_id: number;

  /** Existing serial pool ids to dispatch (in_stock). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsInt({ each: true })
  serial_ids?: number[];

  /** Free-text serials; resolved or created into real pool rows. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  serial_numbers?: string[];
}

export class ConfirmDispatchNoteDto {
  /**
   * Per-item serial selection. Optional: a remisión with no serialized
   * products needs none. Serialized products that are missing here fail with
   * SERIAL_REQUIRED_001 during confirm (the note stays in draft).
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfirmDispatchNoteItemSerialsDto)
  item_serials?: ConfirmDispatchNoteItemSerialsDto[];
}
