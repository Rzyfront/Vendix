import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Cota superior del monto de un pago. `purchase_order_payments.amount` es
 * `numeric(12,2)`: por encima de este valor Postgres aborta con 22003
 * (numeric field overflow) y el operador recibe un 500 en vez de un rechazo
 * legible. Mismo techo que `ConfigurePaymentPlanDto` (cuotas del plan).
 */
const PO_PAYMENT_MAX_AMOUNT = 9999999999.99;

/**
 * Piso del monto de un pago. **Cero NO es un pago válido**, y negativo mucho
 * menos:
 *
 * 1. `registerPayment` no solo inserta la fila: recalcula `payment_status`,
 *    espeja el pago hacia `ap_payments` cuando la OC ya tiene CxP, baja
 *    `balance`/`paid_amount` de esa CxP y emite `purchase_order.payment`, que
 *    postea un asiento DR 133005 / CR 1110. Un monto <= 0 recorre TODO ese
 *    camino: un pago negativo INFLA el saldo pendiente de la orden y de la
 *    cartera, y uno en cero deja un comprobante y un asiento que afirman un
 *    movimiento de dinero que nunca ocurrió.
 * 2. La guarda de sobrepago del servicio solo mira el techo
 *    (`projectedTotal > totalAmount`), así que un negativo la cruza sin
 *    tocarla — no había NINGUNA red en el servidor. El cliente sí lo bloquea,
 *    lo que hace peor la ausencia: el rechazo solo existía en el navegador.
 * 3. El espejo de este mismo pago, `RegisterApPaymentDto` (`@Min(0.01)`), ya
 *    rechaza <= 0. Aceptarlo aquí era pedirle al puente PO→AP que escribiera
 *    en CxP un monto que el contrato de CxP prohíbe.
 *
 * `0.01` y no `Number.MIN_VALUE` porque la columna es `numeric(12,2)`: un
 * centavo es la unidad mínima representable, y es el mismo piso que ya usan el
 * abono de `create-purchase-order.dto.ts` y las cuotas del plan de pago.
 */
const PO_PAYMENT_MIN_AMOUNT = 0.01;

export class RegisterPaymentDto {
  @IsNumber()
  @IsNotEmpty()
  @Min(PO_PAYMENT_MIN_AMOUNT)
  @Max(PO_PAYMENT_MAX_AMOUNT)
  amount: number;

  @IsDateString()
  payment_date: string;

  @IsString()
  @IsNotEmpty()
  payment_method: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /**
   * QUI-647 — id de la cuota del plan (`purchase_order_payment_schedules`)
   * que se está saldando con este pago. Opcional: si viene, el backend
   * marca la cuota como `status='paid'` dentro de la misma transacción
   * del pago, para que la tabla del detail deje de mostrarla como
   * "Programada" al refrescar. Sin este link, el schedule queda en
   * `planned` aunque el pago quede registrado (ver knowledge gap del
   * plan original: schema solo permitía `'planned' | 'materialized'`,
   * `'paid'` es un valor defensivo válido del varchar(20)).
   */
  @IsOptional()
  @IsInt()
  @IsPositive()
  payment_schedule_id?: number;
}
