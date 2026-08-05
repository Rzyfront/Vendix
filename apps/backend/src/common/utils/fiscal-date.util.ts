import { BadRequestException } from '@nestjs/common';

/**
 * Cotas de plausibilidad para las fechas de una resolución DIAN.
 *
 * POR QUÉ EXISTE — el defecto que cierra:
 *
 * En producción quedó guardada una `resolution_date` de `0001-01-01`. Dos vías
 * la producen, y las dos están abiertas en las tres superficies (plataforma,
 * tienda y organización):
 *
 *  1. `<input type="date">` pinta el año a medio teclear como `0001` y lo envía
 *     como una fecha ISO perfectamente válida.
 *  2. El escáner de resoluciones por IA (`ResolutionScannerService`, compartido
 *     por el controlador de tiendas y el de plataforma) puede devolver una fecha
 *     inventada con formato correcto.
 *
 * Ninguna de las dos falla al guardar. La fecha entra al período de autorización
 * del XML del documento, y el síntoma aparece horas después como un lote que la
 * DIAN no clasifica — sin error, sin rechazo y sin nada que señale el campo.
 *
 * Vive en `common/utils` a propósito: la validación nació duplicada en el
 * servicio de plataforma y una copia por dominio habría derivado. La regla la
 * define la DIAN, no el dominio que escribe la fila.
 */

/** La facturación electrónica en Colombia no existe antes de 2016. */
const MIN_FISCAL_YEAR = 2016;

/** Una resolución no se autoriza a más de una década vista. */
const MAX_YEARS_AHEAD = 10;

/**
 * Lanza `BadRequestException` si la fecha es inválida o cae fuera de las cotas.
 *
 * @param label Nombre del campo tal como lo ve el usuario, para que el error
 *              nombre el campo culpable en vez de decir «revisa el formulario».
 */
export function assertPlausibleFiscalDate(label: string, value: Date): void {
  if (Number.isNaN(value.getTime())) {
    throw new BadRequestException(`La ${label} no es una fecha válida.`);
  }
  const year = value.getUTCFullYear();
  const maxYear = new Date().getUTCFullYear() + MAX_YEARS_AHEAD;
  if (year < MIN_FISCAL_YEAR || year > maxYear) {
    throw new BadRequestException(
      `La ${label} (${value.toISOString().slice(0, 10)}) está fuera de rango: debe estar entre ${MIN_FISCAL_YEAR} y ${maxYear}. Revisa el campo — un año incompleto se guarda como 0001.`,
    );
  }
}

/**
 * Valida y convierte en un paso, para los sitios que hacían `new Date(dto.x)`
 * en línea dentro del objeto `data` de Prisma.
 */
export function parsePlausibleFiscalDate(label: string, value: string): Date {
  const parsed = new Date(value);
  assertPlausibleFiscalDate(label, parsed);
  return parsed;
}
