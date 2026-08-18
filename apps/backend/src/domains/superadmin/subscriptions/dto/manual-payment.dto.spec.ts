// `enableImplicitConversion` lee `design:type` vía Reflect; sin este import el
// spec revienta con "Reflect.getMetadata is not a function" (en runtime real lo
// carga el bootstrap de Nest, acá no hay bootstrap).
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ManualPaymentDto } from './manual-payment.dto';

/**
 * El endpoint `POST /superadmin/subscriptions/invoices/:id/manual-payment`
 * NUNCA funcionó: su DTO era una clase sin un solo decorador, y bajo
 * `whitelist` + `forbidNonWhitelisted` eso significa lista blanca vacía → el
 * pipe borra los tres campos del body y a continuación rechaza la petición
 * porque "sobran". 400 en el 100% de las llamadas, sin UI que lo delatara.
 *
 * Este spec fija el contrato real. Las opciones replican el `ValidationPipe`
 * global de `apps/backend/src/main.ts` (incluida
 * `enableImplicitConversion: true`); si el pipe cambia, este spec cambia con
 * él.
 */
const OPCIONES_DEL_PIPE_GLOBAL = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

async function validar(payload: unknown) {
  const dto = plainToInstance(ManualPaymentDto, payload, {
    enableImplicitConversion: true,
  });
  return validate(dto, OPCIONES_DEL_PIPE_GLOBAL);
}

function propiedadesConError(errores: Awaited<ReturnType<typeof validar>>) {
  return errores.map((e) => e.property);
}

const CUERPO_VALIDO = {
  bank_reference: 'BANCOLOMBIA-4472819',
  paid_at: '2026-08-17T14:47:00.000Z',
  amount: 69900,
};

describe('ManualPaymentDto', () => {
  it('acepta un pago manual bien formado', async () => {
    const errores = await validar(CUERPO_VALIDO);
    expect(errores).toHaveLength(0);
  });

  it('conserva los tres campos tras el whitelist (la regresión original)', async () => {
    // El defecto no era "acepta basura", era que el pipe VACIABA el body. Si
    // los decoradores desaparecen, esta aserción es la primera en caer.
    const dto = plainToInstance(ManualPaymentDto, CUERPO_VALIDO, {
      enableImplicitConversion: true,
    });
    expect(dto.bank_reference).toBe('BANCOLOMBIA-4472819');
    expect(dto.paid_at).toBe('2026-08-17T14:47:00.000Z');
    expect(dto.amount).toBe(69900);
  });

  it('rechaza una referencia bancaria vacía', async () => {
    const errores = await validar({ ...CUERPO_VALIDO, bank_reference: '' });
    expect(propiedadesConError(errores)).toContain('bank_reference');
  });

  it('rechaza una referencia bancaria de más de 120 caracteres', async () => {
    const errores = await validar({
      ...CUERPO_VALIDO,
      bank_reference: 'X'.repeat(121),
    });
    expect(propiedadesConError(errores)).toContain('bank_reference');
  });

  it('rechaza una fecha que no es ISO-8601', async () => {
    const errores = await validar({ ...CUERPO_VALIDO, paid_at: '17/08/2026' });
    expect(propiedadesConError(errores)).toContain('paid_at');
  });

  it('rechaza un monto negativo', async () => {
    const errores = await validar({ ...CUERPO_VALIDO, amount: -69900 });
    expect(propiedadesConError(errores)).toContain('amount');
  });

  it('rechaza un monto en cero', async () => {
    const errores = await validar({ ...CUERPO_VALIDO, amount: 0 });
    expect(propiedadesConError(errores)).toContain('amount');
  });

  it('rechaza un monto no numérico', async () => {
    const errores = await validar({ ...CUERPO_VALIDO, amount: 'sesenta mil' });
    expect(propiedadesConError(errores)).toContain('amount');
  });

  it('rechaza campos no declarados (forbidNonWhitelisted sigue activo)', async () => {
    const errores = await validar({
      ...CUERPO_VALIDO,
      recorded_by_user_id: 1, // se resuelve del contexto, no del cliente
    });
    expect(propiedadesConError(errores)).toContain('recorded_by_user_id');
  });
});
