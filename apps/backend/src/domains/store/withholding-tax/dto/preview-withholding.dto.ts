import { IsIn, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

/**
 * Preview-only payload for the withholding resolver. Mirrors the params the
 * FLOW layer feeds into {@link WithholdingFlowService.resolvePracticed} /
 * {@link WithholdingFlowService.resolveSuffered}, minus the tenant context
 * (organization_id / store_id) which the service derives from the request
 * context — never from the client.
 *
 * No persistence happens for a preview; this DTO never reaches
 * `persistWithholdingLines`.
 */
export class PreviewWithholdingDto {
  /**
   * Legal role of the operation:
   *  - 'practiced' → tenant buys (POP) and may withhold a supplier.
   *  - 'suffered'  → tenant sells (POS) and a customer may withhold it.
   */
  @IsIn(['practiced', 'suffered'])
  role: 'practiced' | 'suffered';

  /** Counterparty supplier (only for role='practiced'). */
  @IsOptional()
  @IsInt()
  supplier_id?: number;

  /** Counterparty customer (only for role='suffered'). */
  @IsOptional()
  @IsInt()
  customer_id?: number;

  /** Operation subtotal the withholding base is computed from. */
  @IsNumber()
  base: number;

  /** Operation IVA amount (drives reteiva when applicable). */
  @IsOptional()
  @IsNumber()
  ivaAmount?: number;

  /** Fiscal year for the UVT lookup; defaults to the current year. */
  @IsOptional()
  @IsInt()
  year?: number;

  /**
   * Sólo para `role='suffered'`: `products.product_type` de lo vendido en
   * este preview (`'physical' | 'service' | 'prepared'`, etc). Decide si la
   * retención se resuelve como bien o como servicio
   * (`WithholdingFlowService.resolveSufferedByOperation`). Ausente → cuenta
   * como bien (`purchase`), igual que una línea sin producto o `prepared`.
   * El cart del POS/POP hoy resuelve un único agregado por preview; una
   * venta mixta necesita un preview por grupo (fuera de alcance de este DTO).
   */
  @IsOptional()
  @IsString()
  product_type?: string;
}
