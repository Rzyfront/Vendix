import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
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
  /** ia-cargas F5a (optional): Spanish notices, e.g. pages that could not be read. */
  warnings?: string[];
  /** ia-cargas F5a (optional): how the document was read. */
  scan_source?: {
    pages: number;
    text_pages: number;
    batches: number;
    missing_pages?: number[];
  };
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
    /**
     * DERIVED prepaid (live payment state of the note/order). A prepaid stop
     * is never collected: the review UI hides the collection fields and the
     * confirm rejects any amount on it.
     */
    is_prepaid?: boolean;
    /** Live amount still owed on the stop (0 when prepaid). */
    pending_amount?: number;
  } | null;
  /**
   * Suggested settle result derived from the extracted row.
   *
   * `null` ⇒ la planilla dice ENTREGADA pero el cobro es menor al neto. No es un
   * resultado válido (una parada se entrega solo con pago total) y tampoco puede
   * derivarse automáticamente: marcarla `rejected` reversaría inventario ya
   * despachado y marcarla `delivered` chocaría con el gate de monto. Requiere
   * decisión del operador — ver `short_payment_requires_decision` en el confirm.
   */
  suggested_result: dispatch_route_stop_result_enum | null;
  /**
   * Resultado de ENTREGA sugerido para la revisión, independiente del cobro:
   * `delivered` si la hoja la marca entregada, `pending` en cualquier otro
   * caso. Nunca sugiere `rejected`/`released`: esos exigen motivo y los marca
   * el operador.
   */
  suggested_outcome?: 'delivered' | 'pending';
}

export interface RouteSheetMatchResult {
  stops: RouteSheetMatchedStop[];
  confidence: number;
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// /scan/confirm — human-confirmed decisions to settle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Largest amount a `Decimal(14,2)` column can store (dispatch_route_stops
 * collected/withholding amounts and the route totals). A bigger value made
 * Postgres reject the write with Prisma P2020 in the middle of the settle.
 */
export const ROUTE_SHEET_MAX_AMOUNT = 999_999_999_999.99;

/** Largest id an `Int` (int4) column can store. */
const MAX_INT4 = 2_147_483_647;

const toAmount = ({ value }: { value: unknown }) =>
  value === null || value === undefined || value === '' ? 0 : Number(value);

/** Withholding certificate lines of a withholding-agent customer. */
export class RouteSheetWithholdingBreakdownDto {
  @IsOptional()
  @Transform(toAmount)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(ROUTE_SHEET_MAX_AMOUNT)
  retefuente?: number;

  @IsOptional()
  @Transform(toAmount)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(ROUTE_SHEET_MAX_AMOUNT)
  reteiva?: number;

  @IsOptional()
  @Transform(toAmount)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(ROUTE_SHEET_MAX_AMOUNT)
  reteica?: number;
}

/**
 * Resultado de ENTREGA que el operador confirma por parada. Va separado del
 * cobro (`collected_amount` / `payment_method`): una parada se entrega,
 * se rechaza o se libera; el cobro es otro dato que se confirma aparte.
 * Las paradas que quedan pendientes simplemente no viajan en el confirm.
 */
export const ROUTE_SHEET_STOP_RESULTS = [
  'delivered',
  'rejected',
  'released',
] as const;
export type RouteSheetStopResult = (typeof ROUTE_SHEET_STOP_RESULTS)[number];

export class ConfirmRouteSheetStopDto {
  @IsInt()
  @Min(1)
  @Max(MAX_INT4)
  stop_id: number;

  /**
   * Legacy: la entrega como booleano. Se usa solo si no viene `result`;
   * `delivered: false` sin `result` NO rechaza la parada (queda sin tocar, en
   * `skipped[]` con `outcome_required`): rechazar exige motivo.
   */
  @IsOptional()
  @IsBoolean()
  delivered?: boolean;

  @IsOptional()
  @Transform(toAmount)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(ROUTE_SHEET_MAX_AMOUNT)
  collected_amount?: number = 0;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  payment_method?: string;

  /**
   * Resultado de entrega explícito: `delivered`, `rejected` o `released`.
   * Si no viene, se deriva de `delivered` + `collected_amount`:
   *   - entregada y cubre el neto           → 'delivered'
   *   - entregada y NO cubre el neto        → sin derivación: la parada sale en
   *     `skipped[]` con `reason: 'short_payment_requires_decision'` y no se
   *     liquida, porque en ruta no hay pago parcial y la disyuntiva (rechazar vs
   *     asumir el faltante) es una decisión de caja que toma el operador.
   *   - no entregada                        → sin derivación (`outcome_required`).
   */
  @IsOptional()
  @IsIn(ROUTE_SHEET_STOP_RESULTS as unknown as string[], {
    message: 'result debe ser: delivered, rejected o released',
  })
  result?: RouteSheetStopResult;

  /** Motivo del rechazo o de la liberación. Obligatorio para ambos. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RouteSheetWithholdingBreakdownDto)
  withholding_breakdown?: RouteSheetWithholdingBreakdownDto;

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
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ConfirmRouteSheetStopDto)
  stops: ConfirmRouteSheetStopDto[];

  /**
   * The raw scan result to persist on the route (`scan_result` JSON +
   * `scan_confidence`). Optional: the file + decisions are the source of truth.
   * Also JSON-string-decoded for multipart transport. `confidence` is the scan
   * percentage (0-100); it is stored as a 0-1 fraction (`Decimal(5,4)`).
   */
  @Transform(({ value }) =>
    typeof value === 'string' ? JSON.parse(value) : value,
  )
  @IsOptional()
  @IsObject()
  scan_result?: RouteSheetScanResult;
}
