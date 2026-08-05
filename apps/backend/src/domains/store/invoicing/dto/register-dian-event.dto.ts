import { Type } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  DIAN_ENDORSEMENT_LIST_IDS,
  DIAN_EVENT_CODES,
  DIAN_EVENT_OPERATION_CODES,
} from '../providers/dian-direct/constants/dian-endpoints';

const SUPPORTED_EVENT_CODES = Object.values(DIAN_EVENT_CODES);

/** Every operation type of numeral 14.1.2, flattened. */
const SUPPORTED_OPERATION_CODES = Array.from(
  new Set(Object.values(DIAN_EVENT_OPERATION_CODES).flat()),
);

const SUPPORTED_LIST_IDS = Object.values(DIAN_ENDORSEMENT_LIST_IDS);

/** A party identified only by its tax registration, as RADIAN events do. */
export class DianEventPartyDto {
  /** DIAN identification type code ('31' NIT, '13' CC, …). */
  @IsString()
  @MaxLength(2)
  document_type: string;

  /** Identification WITHOUT dots, dashes or DV. */
  @IsString()
  @MaxLength(20)
  document_number: string;

  @IsOptional()
  @IsString()
  @MaxLength(1)
  document_dv?: string;

  @IsString()
  @MaxLength(450)
  legal_name: string;
}

/**
 * Body of `POST /store/invoicing/invoices/:id/events`.
 *
 * `@IsIn` is the first gate rather than a free string: an invented event code would
 * be signed, transmitted and rejected by RADIAN, burning an event consecutive on
 * the way. Rejecting it at the DTO costs nothing.
 *
 * The per-event required combinations (which operation type, which amounts, when
 * the endorsee is mandatory) are NOT expressed here — they are cross-field rules
 * that depend on the code, and `DianEventsService` enforces them with a message
 * that names the missing field. The DTO's job is to reject values that are invalid
 * on their own.
 */
export class RegisterDianEventDto {
  @IsString()
  @IsIn(SUPPORTED_EVENT_CODES, {
    message: `event_code debe ser uno de: ${SUPPORTED_EVENT_CODES.join(', ')}`,
  })
  event_code: string;

  /** Justification. RADIAN expects one on a reclamo (031). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /**
   * "Tipo de operación" (numeral 14.1.2). Required for events with more than one;
   * the service says which options apply when it is missing.
   */
  @IsOptional()
  @IsString()
  @IsIn(SUPPORTED_OPERATION_CODES, {
    message: `operation_code debe ser uno de: ${SUPPORTED_OPERATION_CODES.join(', ')}`,
  })
  operation_code?: string;

  /** Endorsee, direct buyer or competent officer, depending on the event. */
  @IsOptional()
  @ValidateNested()
  @Type(() => DianEventPartyDto)
  issuer_party?: DianEventPartyDto;

  /** '1' endoso completo · '2' endoso en blanco (numeral 14.2.3). */
  @IsOptional()
  @IsString()
  @IsIn(SUPPORTED_LIST_IDS, {
    message: `endorsement_list_id debe ser '${DIAN_ENDORSEMENT_LIST_IDS.COMPLETE}' (completo) o '${DIAN_ENDORSEMENT_LIST_IDS.BLANK}' (en blanco)`,
  })
  endorsement_list_id?: string;

  /**
   * `InformacionNegociacion` values keyed by the annex literals, e.g.
   * `{ "ValorTotalEndoso": "1500000.00", "TasaDescuento": "0.05" }`.
   *
   * Left as a free map on purpose: the annex's literal vocabulary is wider than the
   * subset any one event needs, and the service validates the required keys per
   * code. Constraining the keys here would reject a legitimate optional value.
   */
  @IsOptional()
  @IsObject()
  negotiation_info?: Record<string, string>;

  /** Mandate validity start, `YYYY-MM-DD`. Both dates absent = mandato ilimitado. */
  @IsOptional()
  @IsISO8601()
  validity_start_date?: string;

  @IsOptional()
  @IsISO8601()
  validity_end_date?: string;
}
