import 'reflect-metadata';

import { ErrorCodes, VendixHttpException } from '@common/errors';

import { InvoiceNumberGenerator } from '../utils/invoice-number-generator';

import {
  PREVIEW_CUFE,
  PREVIEW_INVOICE_NUMBER,
  PreviewNumberingGuard,
} from './preview-numbering.guard';
import { ProfilesModule } from './profiles.module';

/**
 * ERR-11 — EL CINTURÓN DE LA NUMERACIÓN.
 *
 * ## Por qué este invariante necesita un spec y no basta un `curl`
 *
 * Porque **por diseño no hay petición que lo alcance**. La previsualización no
 * pide numeración, así que ninguna llamada HTTP hace saltar el guard, y un
 * `curl` que devuelve 200 no distingue «el cinturón funciona» de «el cinturón no
 * está puesto». La promesa que hay que verificar no es un comportamiento
 * observable: es que **el token esté sustituido**, para que el día que alguien
 * añada un camino que pida un consecutivo se estrelle en vez de gastarlo.
 *
 * Lo que se está protegiendo: un consecutivo autorizado que se toma y no se usa
 * **no se recupera**. La DIAN espera la serie completa y el hueco sólo se
 * explica con un reporte de anulación. No hay commit que lo arregle después.
 */
describe('PreviewNumberingGuard — ERR-11', () => {
  describe('la sustitución del token está declarada en ProfilesModule', () => {
    /**
     * Se lee el metadata del decorador en vez de arrancar un `TestingModule`.
     *
     * Arrancar Nest instanciaría `ProfilesService` con su `StorePrismaService` y
     * su `AuditService`, o exigiría mockear el grafo entero — y el resultado
     * dependería de que los mocks fueran fieles. El metadata es el dato
     * literal que Nest va a leer: si la sustitución está ahí, está puesta.
     */
    const providers: any[] = Reflect.getMetadata('providers', ProfilesModule) ?? [];

    it('reemplaza InvoiceNumberGenerator por el guard, no lo añade al lado', () => {
      const override = providers.find(
        (provider) => provider?.provide === InvoiceNumberGenerator,
      );

      expect(override).toBeDefined();
      expect(override.useClass).toBe(PreviewNumberingGuard);

      // Y el generador real NO puede estar además como proveedor suelto: eso
      // reintroduciría la clase capaz de mover el cursor dentro del módulo, y el
      // último proveedor registrado para un token es el que gana.
      expect(providers).not.toContain(InvoiceNumberGenerator);
    });

    it('no exporta el token sustituido, para no imponerlo a quien importe el módulo', () => {
      // `InvoicingModule` importa `ProfilesModule`. Si la sustitución se
      // exportara, el generador FALSO viajaría hasta `InvoiceFlowService` y
      // bloquearía la emisión real — el cinturón se convertiría en el defecto
      // que pretende evitar. Que sea inocuo depende de esto.
      const exports: any[] = Reflect.getMetadata('exports', ProfilesModule) ?? [];
      const leaked = exports.filter(
        (item) =>
          item === InvoiceNumberGenerator ||
          item === PreviewNumberingGuard ||
          item?.provide === InvoiceNumberGenerator,
      );
      expect(leaked).toEqual([]);
    });
  });

  describe('generateNextNumber', () => {
    it('lanza INVOICING_PREVIEW_001 en vez de devolver un número', () => {
      const guard = new PreviewNumberingGuard();
      jest.spyOn((guard as any).logger, 'error').mockImplementation(() => undefined);

      let thrown: unknown;
      try {
        guard.generateNextNumber({ resolution_id: 41 });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(VendixHttpException);
      const exception = thrown as VendixHttpException;
      expect((exception.getResponse() as any).error_code).toBe(
        ErrorCodes.INVOICING_PREVIEW_001.code,
      );
      expect(exception.getStatus()).toBe(409);
    });

    it('declara `reserved: false` en los detalles', () => {
      const guard = new PreviewNumberingGuard();
      jest.spyOn((guard as any).logger, 'error').mockImplementation(() => undefined);

      try {
        guard.generateNextNumber();
        throw new Error('debió lanzar');
      } catch (error) {
        const response = (error as VendixHttpException).getResponse() as any;
        // El dato que importa del fallo: que nadie tenga que deducir si el
        // consecutivo se movió. Lo dice la respuesta.
        expect(response.details?.reserved).toBe(false);
      }
    });

    it('registra la llamada con traza, porque es un defecto que hay que poder ubicar', () => {
      const guard = new PreviewNumberingGuard();
      const spy = jest
        .spyOn((guard as any).logger, 'error')
        .mockImplementation(() => undefined);

      expect(() => guard.generateNextNumber()).toThrow();
      expect(spy).toHaveBeenCalledTimes(1);
      // Sin la traza, el 409 dice QUE alguien pidió numeración pero no DÓNDE, y
      // el camino culpable puede estar a varias capas de profundidad.
      expect(spy.mock.calls[0][1]).toContain('PreviewNumberingGuard');
    });
  });

  describe('los marcadores de la previsualización', () => {
    it('el consecutivo NO es numérico', () => {
      // Deliberado: cualquier aritmética contra `range_from`/`range_to` —o un
      // `parseInt` que compare rangos— se rompe de forma VISIBLE en vez de
      // producir un número plausible dentro del rango autorizado.
      expect(Number.isNaN(Number(PREVIEW_INVOICE_NUMBER))).toBe(true);
    });

    it('ni el consecutivo ni el CUFE se pueden confundir con una emisión real', () => {
      // Un CUFE real son 96 hex. Un XML de muestra que se filtre a un log o a una
      // captura tiene que delatarse solo.
      expect(PREVIEW_CUFE).not.toMatch(/^[0-9a-f]{96}$/i);
      expect(PREVIEW_CUFE).toContain('PREVIEW');
      expect(PREVIEW_INVOICE_NUMBER).toContain('PREVIEW');
    });
  });
});
