import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { dispatch_route_stop_result_enum } from '@prisma/client';

/**
 * Route-sheet AI scanner contract.
 *
 * Mirrors `scan-invoice.dto.ts`: the scan/match results are plain interfaces
 * (AI/derived payloads, never request bodies), while the confirm payload is a
 * validated DTO. The shapes here intentionally match the JSON schema in the
 * `route_sheet_ocr` AI app system prompt 1:1.
 */

// ─────────────────────────────────────────────────────────────────────────────
// /scan — normalized AI extraction (espeja el JSON del prompt)
// ─────────────────────────────────────────────────────────────────────────────

export interface RouteSheetScanStop {
  stop_sequence: number;
  remision_number: string | null;
  delivered: boolean;
  collected_amount: number | null;
  payment_method: string | null;
  notes: string | null;
}

export interface RouteSheetScanResult {
  stops: RouteSheetScanStop[];
  confidence: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// /scan/match — proposal (real stop resolved + actual vs extracted), no persist
// ─────────────────────────────────────────────────────────────────────────────

export interface RouteSheetMatchedStop {
  /** The extracted row as normalized from the scan. */
  extracted: RouteSheetScanStop;
  /** Resolved real stop id, or null when the row could not be mapped. */
  stop_id: number | null;
  /** Resolved real stop sequence. */
  stop_sequence: number | null;
  /** Resolved real remision/dispatch number. */
  remision_number: string | null;
  /** How the row was resolved to a real stop. */
  match_method: 'remision' | 'sequence' | 'none';
  /** Current persisted state of the resolved stop (actual side of the diff). */
  current: {
    status: string;
    result: string | null;
    grand_total: number;
    collected_amount: number;
  } | null;
  /** Suggested settle result derived from the extracted row. */
  suggested_result: dispatch_route_stop_result_enum;
}

export interface RouteSheetMatchResult {
  stops: RouteSheetMatchedStop[];
  confidence: number;
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// /scan/confirm — human-confirmed decisions to settle
// ─────────────────────────────────────────────────────────────────────────────

export class ConfirmRouteSheetStopDto {
  @IsInt()
  stop_id: number;

  @IsBoolean()
  delivered: boolean;

  @IsOptional()
  @Transform(({ value }) =>
    value === null || value === undefined || value === '' ? 0 : Number(value),
  )
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  collected_amount?: number = 0;

  @IsOptional()
  @IsString()
  payment_method?: string;

  /**
   * Explicit settle result. When omitted, the service derives it from
   * `delivered` + `collected_amount` (delivered → 'delivered' if it covers the
   * net, else 'partial'; not delivered → 'rejected').
   */
  @IsOptional()
  @IsString()
  result?: dispatch_route_stop_result_enum;

  @IsOptional()
  @IsObject()
  withholding_breakdown?: {
    retefuente?: number;
    reteiva?: number;
    reteica?: number;
  };

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ConfirmRouteSheetDto {
  // Multipart transport: FormData fields arrive as strings, so parse the
  // JSON-encoded `stops` array before @IsArray/@ValidateNested run.
  @Transform(({ value }) =>
    typeof value === 'string' ? JSON.parse(value) : value,
  )
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfirmRouteSheetStopDto)
  stops: ConfirmRouteSheetStopDto[];

  /**
   * The raw scan result to persist on the route (`scan_result` JSON +
   * `scan_confidence`). Optional: the file + decisions are the source of truth.
   * Also JSON-string-decoded for multipart transport.
   */
  @Transform(({ value }) =>
    typeof value === 'string' ? JSON.parse(value) : value,
  )
  @IsOptional()
  @IsObject()
  scan_result?: RouteSheetScanResult;
}
