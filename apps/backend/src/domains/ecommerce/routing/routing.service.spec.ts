import { RoutingService } from './routing.service';

/**
 * Cobertura del cambio de política de ruteo (km para cobro por distancia):
 * Valhalla ya NO manda `costing_options.auto.shortest: true` y OSRM ya NO
 * pide `alternatives=true` para elegir la de menor distancia — ambos usan
 * ahora la ruta ESTÁNDAR de cada proveedor (ver comentarios en
 * `routing.service.ts` junto a `VALHALLA_AUTO_COSTING_OPTIONS` y
 * `fetchFromOsrm`). `shortest: true` generaba rutas por vías no aptas o
 * raras solo por ser unos metros más cortas.
 *
 * El mismo patrón de mock de `global.fetch` que usan los specs de Wompi
 * (`wompi.client.spec.ts`) se usa aquí para consistencia.
 */
describe('RoutingService — política de ruta estándar (no shortest)', () => {
  let fetchMock: jest.Mock;
  let redisMock: { get: jest.Mock; set: jest.Mock };
  let service: RoutingService;

  const coords = '-74.07,4.71;-74.06,4.72';

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
    // Cache siempre en MISS y lock siempre adquirido: cada test ejerce el
    // fetch real a los proveedores, sin depender de Redis de verdad.
    redisMock = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };
    service = new RoutingService(redisMock as any);
  });

  afterEach(() => {
    delete (global as any).fetch;
    jest.restoreAllMocks();
  });

  function osrmSuccess(routes: Array<{ distance: number; duration: number }>) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        code: 'Ok',
        routes: routes.map((r) => ({
          geometry: {
            type: 'LineString',
            coordinates: [
              [-74.07, 4.71],
              [-74.06, 4.72],
            ],
          },
          distance: r.distance,
          duration: r.duration,
        })),
      }),
    };
  }

  it('Valhalla: el body NO envía shortest:true, usa costing auto estándar', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500 } as any) // Valhalla falla → fallback
      .mockResolvedValueOnce(
        osrmSuccess([{ distance: 5000, duration: 600 }]) as any,
      );

    await service.directions(coords);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [valhallaUrl, valhallaOptions] = fetchMock.mock.calls[0];
    expect(valhallaUrl).toContain('/route');
    const body = JSON.parse(valhallaOptions.body as string);
    expect(body.costing).toBe('auto');
    expect(body.costing_options.auto).not.toHaveProperty('shortest');
    expect(body.costing_options.auto).toEqual({});
  });

  it('OSRM: no pide alternatives=true en la URL', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500 } as any) // Valhalla falla → fallback
      .mockResolvedValueOnce(
        osrmSuccess([{ distance: 5000, duration: 600 }]) as any,
      );

    await service.directions(coords);

    const [osrmUrl] = fetchMock.mock.calls[1];
    expect(osrmUrl).not.toContain('alternatives');
  });

  it('OSRM: toma la PRIMERA ruta (estándar), no la de menor distancia entre alternativas', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500 } as any) // Valhalla falla → fallback
      .mockResolvedValueOnce(
        osrmSuccess([
          { distance: 5200, duration: 480 }, // primaria: mayor distancia, menor tiempo
          { distance: 3100, duration: 900 }, // hipotética alternativa más corta
        ]) as any,
      );

    const result = await service.directions(coords);

    // Antes del cambio se habría elegido 3100 (la más corta). Ahora debe
    // quedarse con la primaria (5200), igual que si nunca hubiera pedido
    // alternativas.
    expect(result.distance_m).toBe(5200);
  });

  it('Valhalla exitoso no cae a OSRM (fetch se llama una sola vez)', async () => {
    // Un solo punto→punto (2 waypoints codificados como un polyline vacío no
    // es representativo del decode real; esta prueba solo verifica que un
    // Valhalla `ok` no dispara el fallback a OSRM). Se simula una respuesta
    // Valhalla mínima pero completa.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        trip: {
          summary: { length: 1.5, time: 120 },
          legs: [{ shape: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' }],
        },
      }),
    } as any);

    await service.directions(coords);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
