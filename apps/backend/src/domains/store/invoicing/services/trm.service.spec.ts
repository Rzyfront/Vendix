import { Prisma } from '@prisma/client';
import { TrmService } from './trm.service';

/**
 * El servicio sólo depende de `fetch` global, así que se instancia con `new` y
 * se le suplanta la red. No hace falta levantar Nest.
 *
 * Lo que estos casos protegen es el comportamiento que NO se ve al probar a
 * mano un martes: el fin de semana, la caída del portal y la precedencia de la
 * tasa manual. Los tres son caminos donde el fallo silencioso sería una factura
 * con un valor en pesos equivocado, o una emisión imposible por una llamada
 * HTTP a un tercero.
 */
describe('TrmService', () => {
  let service: TrmService;
  let fetchMock: jest.Mock;

  /** Fila del dataset `32sa-8pi3` tal como la devuelve Socrata. */
  const row = (
    valor: string,
    vigenciadesde: string,
    vigenciahasta: string,
  ) => ({
    valor,
    vigenciadesde: `${vigenciadesde}T00:00:00.000`,
    vigenciahasta: `${vigenciahasta}T00:00:00.000`,
  });

  const okResponse = (body: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
  });

  beforeEach(() => {
    service = new TrmService();
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
    // El servicio degrada con `logger.warn`; silenciarlo mantiene legible la
    // salida de los casos que prueban justamente la degradación.
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete (global as any).fetch;
  });

  describe('getTrm', () => {
    it('consulta por RANGO de vigencia, no por igualdad de fecha', async () => {
      fetchMock.mockResolvedValue(
        okResponse([row('4100.50', '2026-08-14', '2026-08-17')]),
      );

      // 15/08 es un sábado en este escenario: lo rige la TRM publicada el
      // viernes. Con `?vigenciadesde=2026-08-15` el dataset devolvería `[]`.
      const quote = await service.getTrm('2026-08-15');

      expect(quote?.value.toString()).toBe('4100.5');
      expect(quote?.valid_from).toBe('2026-08-14');
      expect(quote?.valid_to).toBe('2026-08-17');

      const url = String(fetchMock.mock.calls[0][0]);
      expect(url).toContain('%24where=');
      expect(decodeURIComponent(url)).toContain('vigenciadesde <=');
      expect(decodeURIComponent(url)).toContain('vigenciahasta >=');
    });

    it('cachea el acierto y no vuelve a salir a la red', async () => {
      fetchMock.mockResolvedValue(
        okResponse([row('4100.00', '2026-08-14', '2026-08-14')]),
      );

      await service.getTrm('2026-08-14');
      await service.getTrm('2026-08-14');

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('NO cachea el fallo: una caída momentánea no deja al proceso sin TRM', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
      fetchMock.mockResolvedValueOnce(
        okResponse([row('4100.00', '2026-08-14', '2026-08-14')]),
      );

      expect(await service.getTrm('2026-08-14')).toBeNull();
      expect((await service.getTrm('2026-08-14'))?.value.toString()).toBe(
        '4100',
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('degrada a null cuando la red lanza, sin propagar el error', async () => {
      fetchMock.mockRejectedValue(new Error('ENOTFOUND datos.gov.co'));

      await expect(service.getTrm('2026-08-14')).resolves.toBeNull();
    });

    it('degrada a null cuando el dataset no devuelve ninguna vigencia', async () => {
      fetchMock.mockResolvedValue(okResponse([]));

      await expect(service.getTrm('2026-08-14')).resolves.toBeNull();
    });

    it('descarta una fila cuyo valor no es un número positivo', async () => {
      fetchMock.mockResolvedValue(
        okResponse([row('0', '2026-08-14', '2026-08-14')]),
      );

      await expect(service.getTrm('2026-08-14')).resolves.toBeNull();
    });

    it('rechaza una fecha que no es YYYY-MM-DD sin tocar la red', async () => {
      await expect(service.getTrm('15/08/2026')).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('overrideTrm', () => {
    it('siembra TODO el rango de vigencia, no sólo el primer día', async () => {
      service.overrideTrm({
        value: new Prisma.Decimal('4200.00'),
        valid_from: '2026-08-14',
        valid_to: '2026-08-17',
      });

      for (const day of [
        '2026-08-14',
        '2026-08-15',
        '2026-08-16',
        '2026-08-17',
      ]) {
        expect((await service.getTrm(day))?.value.toString()).toBe('4200');
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('resolveExchangeRate', () => {
    it('devuelve null para COP: FAR03 RECHAZA una tasa de 1.00', async () => {
      const resolved = await service.resolveExchangeRate({
        currency: 'COP',
        date: '2026-08-14',
      });

      expect(resolved).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('USD: usa la TRM del día directamente', async () => {
      fetchMock.mockResolvedValue(
        okResponse([row('4100.00', '2026-08-14', '2026-08-14')]),
      );

      const resolved = await service.resolveExchangeRate({
        currency: 'USD',
        date: '2026-08-14',
      });

      expect(resolved?.rate.toString()).toBe('4100');
      expect(resolved?.source).toBe('trm');
    });

    it('la tasa manual GANA sobre la TRM', async () => {
      fetchMock.mockResolvedValue(
        okResponse([row('4100.00', '2026-08-14', '2026-08-14')]),
      );

      const resolved = await service.resolveExchangeRate({
        currency: 'USD',
        date: '2026-08-14',
        manual_rate: '4050.00',
      });

      expect(resolved?.rate.toString()).toBe('4050');
      expect(resolved?.source).toBe('manual');
      // La TRM consultada viaja igual, para poder auditar la diferencia.
      expect(resolved?.trm?.value.toString()).toBe('4100');
    });

    it('la tasa manual sostiene la emisión cuando la TRM no responde', async () => {
      fetchMock.mockRejectedValue(new Error('timeout'));

      const resolved = await service.resolveExchangeRate({
        currency: 'USD',
        date: '2026-08-14',
        manual_rate: 4050,
      });

      expect(resolved?.rate.toString()).toBe('4050');
      expect(resolved?.source).toBe('manual_fallback');
    });

    it('divisa distinta de USD: convierte con la cruzada, o devuelve null', async () => {
      fetchMock.mockResolvedValue(
        okResponse([row('4100.00', '2026-08-14', '2026-08-14')]),
      );

      // Sin cruzada NO se adivina una cotización.
      await expect(
        service.resolveExchangeRate({ currency: 'EUR', date: '2026-08-14' }),
      ).resolves.toBeNull();

      // Con cruzada (1 USD = 0.90 EUR) ⇒ 4100 / 0.90 pesos por euro.
      const resolved = await service.resolveExchangeRate({
        currency: 'EUR',
        date: '2026-08-14',
        usd_cross_rate: '0.90',
      });

      expect(resolved?.rate.toFixed(2)).toBe('4555.56');
    });
  });
});
