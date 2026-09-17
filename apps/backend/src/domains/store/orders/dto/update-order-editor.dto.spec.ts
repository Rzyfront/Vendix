// Obligatorio y no decorativo: sin él `plainToInstance` revienta con
// «Reflect.getMetadata is not a function». `register-payment.dto.spec.ts`
// lo importa por la misma razón.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateOrderEditorItemDto } from './update-order-editor.dto';

/**
 * F-075 (major) — piso de las cuatro columnas monetarias de la línea del
 * editor de órdenes.
 *
 * `unit_price`, `total_price`, `final_unit_price` y `tax_amount_item` ya
 * llevan `@Min(0)` (aplicado bajo F-081, ver el comentario junto a
 * `unit_price` en `update-order-editor.dto.ts`), pero no existía ningún spec
 * que fijara el contrato. Sin el piso, un `waiter` podía mandar
 * `unit_price: -1` sobre una orden en `created` y, como tras ADR-05 el
 * subtotal declarado sale de ese campo, la base gravable DIAN colapsaba y la
 * retención desaparecía. Este spec deja el piso auditado para que nadie lo
 * retire sin que un test rojo lo note.
 *
 * `cost` (línea de costo/COGS) queda FUERA de alcance a propósito: F-075
 * acota el fix a estas cuatro columnas; no se toca `cost` aquí.
 */
const OPCIONES_DEL_PIPE_GLOBAL = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

/** Réplica exacta de `main.ts`: transform + conversión implícita ENCENDIDA. */
async function validarItem(payload: unknown) {
  const dto = plainToInstance(UpdateOrderEditorItemDto, payload, {
    enableImplicitConversion: true,
  });
  return validate(dto, OPCIONES_DEL_PIPE_GLOBAL);
}

function restriccionesDe(
  errores: Awaited<ReturnType<typeof validarItem>>,
  propiedad: string,
): string[] {
  const error = errores.find((e) => e.property === propiedad);
  return Object.keys(error?.constraints ?? {});
}

/** Línea mínima válida; cada test sobrescribe el campo bajo prueba. */
const itemBase = {
  product_name: 'Producto de prueba',
  quantity: 1,
  unit_price: 1000,
  total_price: 1000,
};

describe('UpdateOrderEditorItemDto — piso de las columnas monetarias (F-075)', () => {
  it('rechaza unit_price NEGATIVO', async () => {
    const errores = await validarItem({ ...itemBase, unit_price: -1 });

    expect(restriccionesDe(errores, 'unit_price')).toContain('min');
  });

  it('acepta unit_price en 0: el piso es "no negativo", no "positivo"', async () => {
    const errores = await validarItem({ ...itemBase, unit_price: 0 });

    expect(restriccionesDe(errores, 'unit_price')).toHaveLength(0);
  });

  it('rechaza total_price NEGATIVO', async () => {
    const errores = await validarItem({ ...itemBase, total_price: -1000 });

    expect(restriccionesDe(errores, 'total_price')).toContain('min');
  });

  it('rechaza final_unit_price NEGATIVO', async () => {
    const errores = await validarItem({
      ...itemBase,
      final_unit_price: -0.01,
    });

    expect(restriccionesDe(errores, 'final_unit_price')).toContain('min');
  });

  it('rechaza tax_amount_item NEGATIVO', async () => {
    const errores = await validarItem({
      ...itemBase,
      tax_amount_item: -500,
    });

    expect(restriccionesDe(errores, 'tax_amount_item')).toContain('min');
  });

  /**
   * La conversión implícita del pipe global corre antes que los
   * validadores; sobre `unit_price` además corre el `@Transform(parseFloat)`
   * explícito del propio DTO. Este caso prueba el escenario real de un
   * `<input>` sin coerción o un cURL a mano, que serializa el monto como
   * texto.
   */
  it('rechaza unit_price como CADENA negativa ("-1")', async () => {
    const errores = await validarItem({ ...itemBase, unit_price: '-1' });

    expect(restriccionesDe(errores, 'unit_price')).toContain('min');
  });

  it('acepta una línea normal: el camino que ya funcionaba no cambia', async () => {
    const errores = await validarItem({
      ...itemBase,
      final_unit_price: 1000,
      tax_amount_item: 190,
    });

    expect(errores).toHaveLength(0);
  });
});
