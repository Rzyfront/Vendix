// Obligatorio y no decorativo: sin él `plainToInstance` revienta con
// «Reflect.getMetadata is not a function» y las 10 pruebas fallan a la vez.
// `enableImplicitConversion` se apoya en `design:type` para saber a qué tipo
// convertir, y esa metadata solo existe si el polyfill está cargado. El spec
// hermano `create-invoice.dto.spec.ts` lo importa por la misma razón.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterPaymentDto } from './register-payment.dto';

/**
 * CP-PURCHASE-TRANSPARENCY R2 — el piso del monto de un pago de OC.
 *
 * `RegisterPaymentDto.amount` llevaba solo `@IsNumber()` + `@IsNotEmpty()`, así
 * que `POST /store/orders/purchase-orders/:id/payments` con `amount:-5000`
 * respondía **201 «Pago registrado exitosamente»** y PERSISTÍA la fila
 * (`purchase_order_payments` id 104, espejada en `ap_payments` id 88 contra la
 * OC 215). Un pago negativo INFLA el saldo pendiente de la orden y de la
 * cartera y postea un asiento DR 133005 / CR 1110 por dinero que nunca se
 * movió. La guarda de sobrepago del servicio solo mira el techo
 * (`projectedTotal > totalAmount`), así que un negativo la cruzaba sin tocarla:
 * el único rechazo vivía en el navegador.
 *
 * Este spec fija las cuatro esquinas del contrato — negativo, cero, un centavo
 * y un monto normal — y, sobre todo, **la trampa de la conversión implícita**.
 *
 * ### Por qué las opciones de abajo y no las del spec hermano
 *
 * `complete-transfer.dto.spec.ts` valida con `enableImplicitConversion: false`.
 * Aquí NO sirve: el `ValidationPipe` global de `main.ts:202` declara
 * `transformOptions.enableImplicitConversion = true`, y esa conversión corre
 * ANTES que los validadores. Con ella, un `amount` que llega como CADENA
 * (`"-5000"`) se convierte a número usando el tipo reflejado de la propiedad
 * (`design:type = Number`), de modo que quien ve el valor no es `@IsNumber()`
 * —que lo habría rechazado por ser string— sino `@Min(0.01)`, ya convertido.
 *
 * Eso importa porque cambia QUÉ validador rechaza el payload, y por tanto si
 * lo rechaza alguien. Si el piso no existiera, la cadena `"-5000"` pasaría
 * `@IsNumber()` (ya es número tras convertir) y entraría al servicio igual que
 * el `-5000` numérico. Validar con la conversión apagada probaría un pipe que
 * este repo no tiene y dejaría ese agujero sin cubrir.
 */
const OPCIONES_DEL_PIPE_GLOBAL = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

/** Réplica exacta de `main.ts`: transform + conversión implícita ENCENDIDA. */
async function validar(payload: unknown) {
  const dto = plainToInstance(RegisterPaymentDto, payload, {
    enableImplicitConversion: true,
  });
  return validate(dto, OPCIONES_DEL_PIPE_GLOBAL);
}

function restriccionesDe(
  errores: Awaited<ReturnType<typeof validar>>,
  propiedad: string,
): string[] {
  const error = errores.find((e) => e.property === propiedad);
  return Object.keys(error?.constraints ?? {});
}

const pagoBase = {
  payment_date: '2026-08-22',
  payment_method: 'cash',
};

describe('RegisterPaymentDto.amount', () => {
  describe('monto numérico', () => {
    it('rechaza el pago NEGATIVO que antes respondía 201 y persistía la fila', async () => {
      const errores = await validar({ ...pagoBase, amount: -5000 });

      expect(restriccionesDe(errores, 'amount')).toContain('min');
    });

    it('rechaza el CERO: un comprobante y un asiento por un movimiento que no ocurrió', async () => {
      const errores = await validar({ ...pagoBase, amount: 0 });

      expect(restriccionesDe(errores, 'amount')).toContain('min');
    });

    it('acepta UN CENTAVO — el piso es la unidad mínima de numeric(12,2), no un número mágico', async () => {
      const errores = await validar({ ...pagoBase, amount: 0.01 });

      expect(errores).toHaveLength(0);
    });

    it('acepta un pago normal: el camino que ya funcionaba no cambia', async () => {
      const errores = await validar({ ...pagoBase, amount: 150000.5 });

      expect(errores).toHaveLength(0);
    });

    it('rechaza por encima del techo de numeric(12,2) en vez de dejar que Postgres devuelva 22003 como 500', async () => {
      const errores = await validar({ ...pagoBase, amount: 10000000000 });

      expect(restriccionesDe(errores, 'amount')).toContain('max');
    });
  });

  /**
   * La conversión implícita del pipe global corre antes que los validadores.
   * Estos casos prueban que el piso —y no `@IsNumber()`— es quien ataja el
   * payload una vez convertido, que es exactamente el escenario del cliente
   * que serializa el monto como texto (un `<input>` sin coerción, un cURL a
   * mano, un móvil).
   */
  describe('monto como CADENA (trampa de enableImplicitConversion)', () => {
    it('rechaza "-5000": la conversión lo vuelve número y lo ataja @Min, no @IsNumber', async () => {
      const errores = await validar({ ...pagoBase, amount: '-5000' });

      const restricciones = restriccionesDe(errores, 'amount');
      expect(restricciones).toContain('min');
      // Documenta el reparto de responsabilidades: tras convertir ya ES un
      // número, así que @IsNumber() da por bueno el valor. Si esta expectativa
      // cae, la conversión implícita se apagó y el piso dejó de ser la única
      // red para el negativo en texto.
      expect(restricciones).not.toContain('isNumber');
    });

    it('rechaza "0"', async () => {
      const errores = await validar({ ...pagoBase, amount: '0' });

      expect(restriccionesDe(errores, 'amount')).toContain('min');
    });

    it('acepta "0.01": la cadena bien formada sigue siendo un pago válido', async () => {
      const errores = await validar({ ...pagoBase, amount: '0.01' });

      expect(errores).toHaveLength(0);
    });

    it('rechaza "abc": Number("abc") es NaN y @IsNumber() no admite NaN', async () => {
      const errores = await validar({ ...pagoBase, amount: 'abc' });

      expect(restriccionesDe(errores, 'amount')).toContain('isNumber');
    });
  });

  it('rechaza el body sin amount', async () => {
    const errores = await validar({ ...pagoBase });

    expect(restriccionesDe(errores, 'amount').length).toBeGreaterThan(0);
  });
});
