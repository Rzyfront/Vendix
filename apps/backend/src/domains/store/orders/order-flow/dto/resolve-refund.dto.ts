import { IsEnum, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';

/**
 * refund-gateway-fix (W2-B) — qué transiciones puede pedir el operador en una
 * resolución manual. Sólo los estados terminales alcanzables manualmente: el
 * estado `processing` lo pone el processor del gateway (no el operador) y
 * `requested`/`approved`/`pending_approval` son no-terminales (la guarda de
 * no-terminal corre antes). `cancelled` queda fuera porque el operador ya tiene
 * `cancel-payment` para anular; mezclar dos políticas de cancelación en el mismo
 * endpoint sólo confundiría el audit log.
 */
export enum RefundResolvableState {
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum RefundPayoutChannel {
  CASH = 'cash',
  BANK_TRANSFER = 'bank_transfer',
  STORE_CREDIT = 'store_credit',
  GATEWAY = 'gateway',
}

/**
 * REFUND OVERHAUL — payload para `PATCH /store/orders/:orderId/flow/refunds/:refundId/resolve`.
 *
 * El campo `resolution_notes` es obligatorio por contrato de auditoría:
 * cualquier cierre manual debe registrar QUIÉN y POR QUÉ. La validación
 * `@IsNotEmpty` rechaza `''`; el servicio además hace trim y rechaza
 * `'   '` para no depender exclusivamente del DTO pipe.
 *
 * El límite de 2000 caracteres coincide con `textareas` razonables para
 * una nota de auditoría y evita abuso (no es un campo de free-form del
 * usuario, es una nota justificando una operación de reversión).
 */
export class ResolveRefundDto {
  @IsEnum(RefundResolvableState)
  target_state!: RefundResolvableState;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  resolution_notes!: string;

  @ValidateIf((dto: ResolveRefundDto) => dto.target_state === RefundResolvableState.COMPLETED)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  payout_reference?: string;

  @ValidateIf((dto: ResolveRefundDto) => dto.target_state === RefundResolvableState.COMPLETED)
  @IsEnum(RefundPayoutChannel)
  payout_channel?: RefundPayoutChannel;
}
