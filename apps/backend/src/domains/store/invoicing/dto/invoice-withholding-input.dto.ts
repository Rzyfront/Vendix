import { IsIn, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * Una línea de retención declarada por el cliente al CREAR la factura.
 *
 * El cálculo del importe (`withholding_amount`) puede venir del cliente o del
 * servidor: si viene del cliente se valida que `amount === base × rate`
 * con la tolerancia del truncado de dos decimales (mismo criterio que
 * `dian-money.util.ts` aplica al CUFE); si viene en 0 se recalcula.
 *
 * `role` distingue el lado de la operación:
 * - 'practiced' → la tienda RETIENE al cliente (gran contribuyente comprando);
 *   el importe se resta del pago que la tienda recibe y NO del `PayableAmount`
 *   del XML (§11.9.1, anexo19.txt:34154).
 * - 'suffered'  → a la tienda LE RETIENEN (cliente es agente de retención);
 *   la tienda cobra menos, y el XML sigue declarando `PayableAmount` sin tocar.
 *
 * `concept_id` referencia `withholding_concepts.id`; la verificación de que el
 * concepto existe y pertenece al tenant la hace `assertWithholdingsResolvable`
 * dentro del flujo, NO este DTO — un concepto que el cliente captura con un id
 * viejo falla con `INVOICING_WITHHOLDING_002`, no con un 400 genérico de
 * class-validator que lo deja sin saber qué concepto está mal.
 */
export class InvoiceWithholdingInputDto {
  @IsIn(['practiced', 'suffered'])
  role: 'practiced' | 'suffered';

  @IsInt()
  concept_id: number;

  /**
   * Base gravable sobre la que se calculó. Verificada contra el subtotal
   * declarado por la DIAN, no contra la suma de líneas, porque las retenciones
   * tributan sobre el agregado (`cbc:TaxableAmount` del grupo de cabecera).
   */
  @IsNumber()
  @Min(0)
  base_amount: number;

  /**
   * Tarifa en FRACCIÓN, no en porcentaje: `0.025` es 2,5 %.
   *
   * ─── POR QUÉ ESTA COTA NO ES COSMÉTICA ────────────────────────────────────
   *
   * `applyClientDeclaredWithholdings` calcula `base.times(rate)` sin dividir
   * entre 100, y `withholding_concepts.rate` —la fuente de la que sale este
   * número— es un `Decimal(7,4)` que el calculador consume igual
   * (`withholding_calculator.service.ts`: `amount * rate`). O sea: la escala
   * del backend es la fracción, punto.
   *
   * La UI, en cambio, pinta «Tarifa %» porque es lo que un contador escribe. Sin
   * este `@Max(1)`, un cliente que mande el porcentaje crudo (`2.5` queriendo
   * decir 2,5 %) persiste una retención del **250 % de la base** en
   * `withholding_calculations` y en `invoices.withholding_amount`, sin un solo
   * error: la aritmética interna cuadra consigo misma, sólo que sobre la escala
   * equivocada. Y `amount` es opcional, así que el contraste `base × rate` ni
   * siquiera corre para atajarlo.
   *
   * Una retención del 100 % (`rate = 1`) es absurda en la práctica pero no
   * imposible de expresar, así que la cota se pone justo ahí: todo lo que la
   * pase es, con certeza, una confusión de escala.
   */
  @IsNumber()
  @Min(0)
  @Max(1)
  rate: number;

  /**
   * Importe retenido. OPCIONAL y, si viene, validado contra `base × rate`
   * dentro de la tolerancia del truncado (≤1 centavo) por la misma razón que
   * `dian-money.util` trunca con `ROUND_DOWN`: una diferencia mayor ya no es
   * truncado, es un dato mal capturado.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  /**
   * `customer_id` cuando `role='suffered'`; obligatorio para que el asiento
   * contable lo atribuya al tercero correcto. Ignorado si `role='practiced'`
   * porque ese caso usa `customer_id` del encabezado de la factura, no de la
   * línea — un cliente no puede ser simultáneamente adquiriente y proveedor.
   */
  @IsOptional()
  @IsInt()
  customer_id?: number;
}
