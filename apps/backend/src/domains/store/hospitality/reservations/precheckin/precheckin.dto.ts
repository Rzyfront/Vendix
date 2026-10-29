import { ApiProperty, PickType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, Equals, IsArray, ValidateNested } from 'class-validator';
import { LodgingGuestDto } from '../guests/guest.dto';

/** Most guests one online check-in sends (a family or a small group). */
export const PRECHECKIN_MAX_GUESTS = 20;

/**
 * Hospitality Suite (H8.1) — one guest of the online check-in: exactly the
 * TRA (Res. 409/2022 art. 7) and SIRE fields of the desk register. The
 * holder link, IVA exemption and permit fields stay with the front desk.
 */
export class PrecheckinGuestDto extends PickType(LodgingGuestDto, [
  'reservation_room_id',
  'document_type',
  'document_number',
  'first_name',
  'last_name',
  'nationality_country_code',
  'birth_date',
  'residence_city',
  'origin_city',
  'travel_purpose',
] as const) {}

/** The guest's party (holder first) plus the data-processing authorization. */
export class PrecheckinSubmitDto {
  @ApiProperty({ type: [PrecheckinGuestDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Registra al menos un huésped' })
  @ArrayMaxSize(PRECHECKIN_MAX_GUESTS)
  @ValidateNested({ each: true })
  @Type(() => PrecheckinGuestDto)
  guests!: PrecheckinGuestDto[];

  @ApiProperty({ description: 'Autorizó el tratamiento de datos (Ley 1581).' })
  @Equals(true, { message: 'Debes autorizar el tratamiento de datos' })
  data_consent!: boolean;
}
