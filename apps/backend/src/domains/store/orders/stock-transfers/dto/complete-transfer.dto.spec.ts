import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CompleteTransferDto } from './complete-transfer.dto';

/**
 * D-3.2 (P0) — la recepción de transferencias corría con validación CERO.
 *
 * El controlador declaraba el body como tipo literal inline. Un tipo estructural
 * de TypeScript no sobrevive a la compilación: `design:paramtypes` queda en
 * `Object` y el `ValidationPipe` global no valida nada. El endpoint aceptaba
 * `{"items":[{"id":31,"quantity_received":100000}]}` y acreditaba 100.000
 * unidades reales en destino, repetible, incluso sobre una transferencia ya
 * cerrada.
 *
 * Este spec prueba que el contrato ahora es una CLASE con reglas efectivas.
 * Las opciones de `validate` replican el pipe global (`whitelist` +
 * `forbidNonWhitelisted`); si el pipe cambia, este spec debe cambiar con él.
 */
const OPCIONES_DEL_PIPE_GLOBAL = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

async function validar(payload: unknown) {
  const dto = plainToInstance(CompleteTransferDto, payload, {
    enableImplicitConversion: false,
  });
  return validate(dto, OPCIONES_DEL_PIPE_GLOBAL);
}

function propiedadesConError(errores: Awaited<ReturnType<typeof validar>>) {
  const nombres: string[] = [];
  const recorrer = (lista: typeof errores) => {
    for (const e of lista) {
      nombres.push(e.property);
      if (e.children?.length) recorrer(e.children);
    }
  };
  recorrer(errores);
  return nombres;
}

describe('CompleteTransferDto', () => {
  it('acepta una recepción bien formada', async () => {
    const errores = await validar({
      items: [{ id: 31, quantity_received: 10 }],
    });
    expect(errores).toHaveLength(0);
  });

  it('acepta recibir 0 — recibir nada es una respuesta legítima', async () => {
    const errores = await validar({
      items: [{ id: 31, quantity_received: 0 }],
    });
    expect(errores).toHaveLength(0);
  });

  it('rechaza el body vacío en vez de reventar iterando undefined', async () => {
    const errores = await validar({});
    expect(errores.length).toBeGreaterThan(0);
    expect(propiedadesConError(errores)).toContain('items');
  });

  it('rechaza una lista de líneas vacía', async () => {
    const errores = await validar({ items: [] });
    expect(errores.length).toBeGreaterThan(0);
    expect(propiedadesConError(errores)).toContain('items');
  });

  it('rechaza items que no es una lista', async () => {
    const errores = await validar({ items: 'todas' });
    expect(errores.length).toBeGreaterThan(0);
    expect(propiedadesConError(errores)).toContain('items');
  });

  it('rechaza cantidades negativas — no se recibe stock en reversa', async () => {
    const errores = await validar({
      items: [{ id: 31, quantity_received: -100 }],
    });
    expect(errores.length).toBeGreaterThan(0);
    expect(propiedadesConError(errores)).toContain('quantity_received');
  });

  it('rechaza cantidades fraccionarias — el inventario es entero', async () => {
    const errores = await validar({
      items: [{ id: 31, quantity_received: 2.5 }],
    });
    expect(errores.length).toBeGreaterThan(0);
    expect(propiedadesConError(errores)).toContain('quantity_received');
  });

  it('rechaza una cantidad no numérica en vez de dejarla llegar a Prisma como 500', async () => {
    const errores = await validar({
      items: [{ id: 31, quantity_received: 'muchas' }],
    });
    expect(errores.length).toBeGreaterThan(0);
    expect(propiedadesConError(errores)).toContain('quantity_received');
  });

  it('rechaza un id de línea ausente o inválido', async () => {
    const sinId = await validar({ items: [{ quantity_received: 5 }] });
    expect(propiedadesConError(sinId)).toContain('id');

    const idCero = await validar({ items: [{ id: 0, quantity_received: 5 }] });
    expect(propiedadesConError(idCero)).toContain('id');
  });

  it('valida CADA línea, no sólo la primera', async () => {
    const errores = await validar({
      items: [
        { id: 31, quantity_received: 10 },
        { id: 32, quantity_received: -5 },
      ],
    });
    expect(errores.length).toBeGreaterThan(0);
    expect(propiedadesConError(errores)).toContain('quantity_received');
  });

  it('rechaza campos que el contrato no declara', async () => {
    // Con forbidNonWhitelisted, un payload que intenta colar columnas
    // (p.ej. `status` o `to_location_id`) se rechaza en vez de ignorarse.
    const errores = await validar({
      items: [{ id: 31, quantity_received: 10 }],
      status: 'received',
    });
    expect(errores.length).toBeGreaterThan(0);
    expect(propiedadesConError(errores)).toContain('status');
  });
});
