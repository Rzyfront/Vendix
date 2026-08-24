import { Injectable, Logger } from '@nestjs/common';

import { ErrorCodes, VendixHttpException } from '../../../../common/errors';

/**
 * Consecutivo que lleva el XML PROYECTADO de una previsualización.
 *
 * No es un número: es una etiqueta que ningún rango DIAN puede contener. Se
 * eligió así a propósito, y la elección es la mitad de la protección de ADR-5:
 *
 * · **No se parece a un consecutivo real.** Un `'1'` o un `'0'` de relleno son
 *   valores que una resolución SÍ puede otorgar, así que un XML de muestra que
 *   se filtrara a un log, a un adjunto o a una captura de pantalla sería
 *   indistinguible de un documento emitido. `PREVIEW` no se confunde con nada.
 * · **No es numérico.** Cualquier comparación aritmética contra `range_from` /
 *   `range_to` falla en vez de dar un resultado plausible, así que un camino que
 *   intentara medir este número contra un rango se rompe de forma visible.
 *
 * Va sin prefijo de resolución: el prefijo lo otorga la Autorización de
 * Numeración, y una previsualización no consulta ninguna.
 */
export const PREVIEW_INVOICE_NUMBER = 'PREVIEW';

/**
 * CUFE de relleno del XML proyectado.
 *
 * El CUFE real es un SHA-384 sobre 16 campos, entre ellos la ClTec de la
 * resolución y el consecutivo autorizado. Recalcularlo en una previsualización
 * exigiría los dos datos que la previsualización precisamente no tiene, y
 * calcularlo con valores de relleno produciría un hash de 96 hex con toda la
 * apariencia de un CUFE verdadero — el peor resultado posible, porque un CUFE
 * es lo que la DIAN usa para identificar un documento de forma única.
 *
 * La cadena dice qué es. Ver también `PREVIEW_INVOICE_NUMBER`.
 */
export const PREVIEW_CUFE = 'PREVIEW-SIN-CUFE-NO-TRANSMITIDO';

/**
 * Sustituto del generador de numeración DENTRO del módulo de perfiles (ERR-11).
 *
 * ## Por qué existe una clase en vez de «simplemente no llamar al generador»
 *
 * No llamarlo es una decisión que se toma una vez y se pierde. Este módulo va a
 * crecer —el editor pide previsualizar, el wizard pide catálogo, mañana pedirá
 * otra cosa— y la línea que reserve numeración no la va a escribir alguien que
 * quiera quemar consecutivos: la va a escribir alguien que necesite un número
 * para completar un payload y encuentre un servicio inyectable que se lo da.
 *
 * `ProfilesModule` registra esta clase BAJO EL TOKEN `InvoiceNumberGenerator`.
 * Consecuencia: cualquier proveedor del módulo de perfiles que pida el generador
 * recibe esto, y la primera llamada devuelve un 409 `INVOICING_PREVIEW_001` en
 * vez de mover `invoice_resolutions.current_number`.
 *
 * El alcance es exactamente el módulo. Los servicios que viven en
 * `InvoicingModule` —`InvoiceFlowService` entre ellos— resuelven sus
 * dependencias en SU módulo y siguen recibiendo el generador de verdad: la
 * emisión real no se toca. Es la propiedad que hace que este cinturón no pueda
 * convertirse en un bloqueo de producción.
 *
 * ## Por qué lanza en vez de devolver un número
 *
 * Devolver `PREVIEW_INVOICE_NUMBER` desde acá haría que el llamador equivocado
 * siguiera adelante creyendo que numeró. Si el camino que pide un consecutivo es
 * de verdad un camino de emisión mal cableado, lo que tiene que pasar es que
 * falle antes de producir un documento; y si es un camino de previsualización,
 * no debería estar pidiendo numeración en absoluto. Las dos lecturas terminan en
 * el mismo sitio: un error visible.
 */
@Injectable()
export class PreviewNumberingGuard {
  private readonly logger = new Logger(PreviewNumberingGuard.name);

  /**
   * Misma firma que `InvoiceNumberGenerator.generateNextNumber`, para que la
   * sustitución del token sea estructuralmente válida y el error salga en la
   * llamada —no en la inyección—, que es donde se puede leer quién la hizo.
   *
   * Devuelve `never`: no hay rama de éxito.
   */
  generateNextNumber(options?: unknown): never {
    // Se registra ANTES de lanzar y con la traza: el mensaje del 409 le llega al
    // operador, pero quien tiene que arreglar el cableado necesita el archivo y
    // la línea de la llamada, y eso sólo lo dice la pila.
    this.logger.error(
      'Un camino del módulo de perfiles pidió numeración fiscal. La previsualización no numera ' +
        '(ADR-5): la llamada se rechaza con INVOICING_PREVIEW_001 en vez de mover ' +
        `invoice_resolutions.current_number. Opciones recibidas: ${JSON.stringify(options ?? null)}`,
      new Error('PreviewNumberingGuard.generateNextNumber').stack,
    );

    throw new VendixHttpException(
      ErrorCodes.INVOICING_PREVIEW_001,
      'La previsualización no se puede generar porque intentó consumir numeración fiscal. Es un ' +
        'defecto de la aplicación, no un dato mal ingresado: una previsualización nunca debe tomar ' +
        'un consecutivo, porque un consecutivo autorizado que se toma y no se usa deja un hueco en ' +
        'la numeración ante la DIAN que no se puede recuperar. No se asignó numeración y no se ' +
        'emitió nada. Reporta este mensaje al soporte técnico.',
      { guard: 'PreviewNumberingGuard', reserved: false },
    );
  }
}
