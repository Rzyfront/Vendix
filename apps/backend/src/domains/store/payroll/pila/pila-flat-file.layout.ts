/**
 * Layout posicional del ARCHIVO PLANO PILA (archivo tipo 2) según la
 * Resolución 2388 de 2016 del Ministerio de Salud y Protección Social,
 * modificada por las Resoluciones 5858/2016, 980/2017 y siguientes
 * (Anexo Técnico 2, versión 09, 16-09-2019).
 *
 * Fuentes (consultadas para este layout):
 * - Anexo Técnico 2 Res. 2388/2016 (minsalud.gov.co):
 *   .../RIDE/DE/OT/Anexo-tecnico-2-2016-pila.pdf
 * - Resolución 5858 de 2016 (pila.enlace-apb.com) — ajustes a la estructura.
 * - Estructura Archivo Plano Res. 2388 y 5858 (aportesenlinea / SOI).
 *
 * Regla de diligenciamiento (Anexo Técnico 2, sección de generalidades):
 *   "Los campos tipo numérico 'N' se reportarán justificados a la derecha y
 *    rellenados con ceros a la izquierda. Los campos tipo alfa-numérico 'A'
 *    se reportarán justificados a la izquierda y se rellenarán con espacios
 *    a la derecha."
 *
 * El archivo consta de:
 *   - 1 registro tipo 1 (encabezado de la planilla), longitud total 359.
 *   - N registros tipo 2 (liquidación detallada por cotizante), long. 686.
 */

export type PilaFieldType = 'N' | 'A';

/** Especificación posicional de un campo del archivo plano PILA. */
export interface PilaFieldSpec {
  /** Número de campo según el Anexo Técnico 2. */
  campo: number;
  /** Nombre del campo (descripción del anexo). */
  name: string;
  /** Longitud fija en caracteres. */
  length: number;
  /** Posición inicial (1-indexada, inclusiva). */
  start: number;
  /** Posición final (1-indexada, inclusiva). */
  end: number;
  /** N = numérico (relleno con ceros a la izquierda); A = alfanumérico. */
  type: PilaFieldType;
}

/**
 * Registro tipo 1 — Encabezado del archivo tipo 2. Longitud total: 359.
 * Los campos asignados por el operador (modalidad, radicación, fecha de pago,
 * código de operador) se reportan en cero/blanco en el archivo de subida.
 */
export const PILA_TYPE1_LAYOUT: readonly PilaFieldSpec[] = [
  { campo: 1, name: 'Tipo de registro (01)', length: 2, start: 1, end: 2, type: 'N' },
  { campo: 2, name: 'Modalidad de la planilla', length: 1, start: 3, end: 3, type: 'N' },
  { campo: 3, name: 'Secuencia', length: 4, start: 4, end: 7, type: 'N' },
  { campo: 4, name: 'Nombre o razon social del aportante', length: 200, start: 8, end: 207, type: 'A' },
  { campo: 5, name: 'Tipo documento del aportante', length: 2, start: 208, end: 209, type: 'A' },
  { campo: 6, name: 'Numero de identificacion del aportante', length: 16, start: 210, end: 225, type: 'A' },
  { campo: 7, name: 'Digito de verificacion del aportante', length: 1, start: 226, end: 226, type: 'N' },
  { campo: 8, name: 'Tipo de planilla', length: 1, start: 227, end: 227, type: 'A' },
  { campo: 9, name: 'Numero de la planilla asociada', length: 10, start: 228, end: 237, type: 'N' },
  { campo: 10, name: 'Fecha de pago planilla asociada (AAAA-MM-DD)', length: 10, start: 238, end: 247, type: 'A' },
  { campo: 11, name: 'Forma de presentacion', length: 1, start: 248, end: 248, type: 'A' },
  { campo: 12, name: 'Codigo de la sucursal del aportante', length: 10, start: 249, end: 258, type: 'A' },
  { campo: 13, name: 'Nombre de la sucursal', length: 40, start: 259, end: 298, type: 'A' },
  { campo: 14, name: 'Codigo de la ARL', length: 6, start: 299, end: 304, type: 'A' },
  { campo: 15, name: 'Periodo de pago para los sistemas diferentes a salud (aaaa-mm)', length: 7, start: 305, end: 311, type: 'A' },
  { campo: 16, name: 'Periodo de pago para el sistema de salud (aaaa-mm)', length: 7, start: 312, end: 318, type: 'A' },
  { campo: 17, name: 'Numero de radicacion o de la planilla integrada', length: 10, start: 319, end: 328, type: 'N' },
  { campo: 18, name: 'Fecha de pago (aaaa-mm-dd)', length: 10, start: 329, end: 338, type: 'A' },
  { campo: 19, name: 'Numero total de cotizantes reportados', length: 5, start: 339, end: 343, type: 'N' },
  { campo: 20, name: 'Valor total de la nomina', length: 12, start: 344, end: 355, type: 'N' },
  { campo: 21, name: 'Tipo de aportante', length: 2, start: 356, end: 357, type: 'N' },
  { campo: 22, name: 'Codigo del operador de informacion', length: 2, start: 358, end: 359, type: 'N' },
] as const;

/** Longitud total exacta del registro tipo 1. */
export const PILA_TYPE1_TOTAL_LENGTH = 359;

/**
 * Registro tipo 2 — Liquidación detallada de aportes por cotizante.
 * Longitud total: 686. Un registro por cada cotizante de la planilla.
 *
 * Grupos: novedades generales (1-30), administradoras/días (31-39),
 * salario/IBC (40-45), pensiones (46-53), salud (54-60), riesgos laborales
 * (61-63), parafiscales CCF/SENA/ICBF/ESAP/MEN (64-73) y datos finales/fechas
 * de novedad (74-97).
 */
export const PILA_TYPE2_LAYOUT: readonly PilaFieldSpec[] = [
  { campo: 1, name: 'Tipo de registro (02)', length: 2, start: 1, end: 2, type: 'N' },
  { campo: 2, name: 'Secuencia', length: 5, start: 3, end: 7, type: 'N' },
  { campo: 3, name: 'Tipo documento del cotizante', length: 2, start: 8, end: 9, type: 'A' },
  { campo: 4, name: 'Numero de identificacion del cotizante', length: 16, start: 10, end: 25, type: 'A' },
  { campo: 5, name: 'Tipo cotizante', length: 2, start: 26, end: 27, type: 'N' },
  { campo: 6, name: 'Subtipo de cotizante', length: 2, start: 28, end: 29, type: 'N' },
  { campo: 7, name: 'Extranjero no obligado a cotizar pensiones', length: 1, start: 30, end: 30, type: 'A' },
  { campo: 8, name: 'Colombiano en el exterior', length: 1, start: 31, end: 31, type: 'A' },
  { campo: 9, name: 'Codigo departamento ubicacion laboral (DANE)', length: 2, start: 32, end: 33, type: 'A' },
  { campo: 10, name: 'Codigo municipio ubicacion laboral (DANE)', length: 3, start: 34, end: 36, type: 'A' },
  { campo: 11, name: 'Primer apellido', length: 20, start: 37, end: 56, type: 'A' },
  { campo: 12, name: 'Segundo apellido', length: 30, start: 57, end: 86, type: 'A' },
  { campo: 13, name: 'Primer nombre', length: 20, start: 87, end: 106, type: 'A' },
  { campo: 14, name: 'Segundo nombre', length: 30, start: 107, end: 136, type: 'A' },
  { campo: 15, name: 'ING: Ingreso', length: 1, start: 137, end: 137, type: 'A' },
  { campo: 16, name: 'RET: Retiro', length: 1, start: 138, end: 138, type: 'A' },
  { campo: 17, name: 'TDE: Traslado desde otra EPS o EOC', length: 1, start: 139, end: 139, type: 'A' },
  { campo: 18, name: 'TAE: Traslado a otra EPS o EOC', length: 1, start: 140, end: 140, type: 'A' },
  { campo: 19, name: 'TDP: Traslado desde otra administradora de pensiones', length: 1, start: 141, end: 141, type: 'A' },
  { campo: 20, name: 'TAP: Traslado a otra administradora de pensiones', length: 1, start: 142, end: 142, type: 'A' },
  { campo: 21, name: 'VSP: Variacion permanente de salario', length: 1, start: 143, end: 143, type: 'A' },
  { campo: 22, name: 'Correcciones', length: 1, start: 144, end: 144, type: 'A' },
  { campo: 23, name: 'VST: Variacion transitoria del salario', length: 1, start: 145, end: 145, type: 'A' },
  { campo: 24, name: 'SLN: Suspension temporal / licencia no remunerada', length: 1, start: 146, end: 146, type: 'A' },
  { campo: 25, name: 'IGE: Incapacidad temporal por enfermedad general', length: 1, start: 147, end: 147, type: 'A' },
  { campo: 26, name: 'LMA: Licencia de maternidad o paternidad', length: 1, start: 148, end: 148, type: 'A' },
  { campo: 27, name: 'VAC-LR: Vacaciones / Licencia remunerada', length: 1, start: 149, end: 149, type: 'A' },
  { campo: 28, name: 'AVP: Aporte voluntario', length: 1, start: 150, end: 150, type: 'A' },
  { campo: 29, name: 'VCT: Variacion centros de trabajo', length: 1, start: 151, end: 151, type: 'A' },
  { campo: 30, name: 'IRL: Dias de incapacidad por accidente/enfermedad laboral', length: 2, start: 152, end: 153, type: 'N' },
  { campo: 31, name: 'Codigo administradora de pensiones (pertenece)', length: 6, start: 154, end: 159, type: 'A' },
  { campo: 32, name: 'Codigo administradora de pensiones (traslado)', length: 6, start: 160, end: 165, type: 'A' },
  { campo: 33, name: 'Codigo EPS o EOC (pertenece)', length: 6, start: 166, end: 171, type: 'A' },
  { campo: 34, name: 'Codigo EPS o EOC (traslado)', length: 6, start: 172, end: 177, type: 'A' },
  { campo: 35, name: 'Codigo CCF (pertenece)', length: 6, start: 178, end: 183, type: 'A' },
  { campo: 36, name: 'Numero de dias cotizados a pension', length: 2, start: 184, end: 185, type: 'N' },
  { campo: 37, name: 'Numero de dias cotizados a salud', length: 2, start: 186, end: 187, type: 'N' },
  { campo: 38, name: 'Numero de dias cotizados a riesgos laborales', length: 2, start: 188, end: 189, type: 'N' },
  { campo: 39, name: 'Numero de dias cotizados a CCF', length: 2, start: 190, end: 191, type: 'N' },
  { campo: 40, name: 'Salario basico (sin centavos)', length: 9, start: 192, end: 200, type: 'N' },
  { campo: 41, name: 'Salario integral', length: 1, start: 201, end: 201, type: 'A' },
  { campo: 42, name: 'IBC pension', length: 9, start: 202, end: 210, type: 'N' },
  { campo: 43, name: 'IBC salud', length: 9, start: 211, end: 219, type: 'N' },
  { campo: 44, name: 'IBC riesgos laborales', length: 9, start: 220, end: 228, type: 'N' },
  { campo: 45, name: 'IBC CCF', length: 9, start: 229, end: 237, type: 'N' },
  { campo: 46, name: 'Tarifa de aportes pensiones', length: 7, start: 238, end: 244, type: 'N' },
  { campo: 47, name: 'Cotizacion obligatoria a pensiones', length: 9, start: 245, end: 253, type: 'N' },
  { campo: 48, name: 'Aporte voluntario del afiliado a fondo pensiones obligatorias', length: 9, start: 254, end: 262, type: 'N' },
  { campo: 49, name: 'Aporte voluntario del aportante a fondo pensiones obligatorias', length: 9, start: 263, end: 271, type: 'N' },
  { campo: 50, name: 'Total cotizacion Sistema General de Pensiones (47+48+49)', length: 9, start: 272, end: 280, type: 'N' },
  { campo: 51, name: 'Aportes fondo de solidaridad pensional - subcuenta solidaridad', length: 9, start: 281, end: 289, type: 'N' },
  { campo: 52, name: 'Aportes fondo de solidaridad pensional - subcuenta subsistencia', length: 9, start: 290, end: 298, type: 'N' },
  { campo: 53, name: 'Valor no retenido por aportes voluntarios', length: 9, start: 299, end: 307, type: 'N' },
  { campo: 54, name: 'Tarifa de aportes salud', length: 7, start: 308, end: 314, type: 'N' },
  { campo: 55, name: 'Cotizacion obligatoria a salud', length: 9, start: 315, end: 323, type: 'N' },
  { campo: 56, name: 'Valor de la UPC adicional', length: 9, start: 324, end: 332, type: 'N' },
  { campo: 57, name: 'N autorizacion de la incapacidad por enfermedad general', length: 15, start: 333, end: 347, type: 'A' },
  { campo: 58, name: 'Valor de la incapacidad por enfermedad general', length: 9, start: 348, end: 356, type: 'N' },
  { campo: 59, name: 'N autorizacion de la licencia de maternidad o paternidad', length: 15, start: 357, end: 371, type: 'A' },
  { campo: 60, name: 'Valor de la licencia de maternidad', length: 9, start: 372, end: 380, type: 'N' },
  { campo: 61, name: 'Tarifa de aportes a riesgos laborales', length: 9, start: 381, end: 389, type: 'N' },
  { campo: 62, name: 'Centro de trabajo CT', length: 9, start: 390, end: 398, type: 'N' },
  { campo: 63, name: 'Cotizacion obligatoria al Sistema General de Riesgos Laborales', length: 9, start: 399, end: 407, type: 'N' },
  { campo: 64, name: 'Tarifa de aportes CCF', length: 7, start: 408, end: 414, type: 'N' },
  { campo: 65, name: 'Valor aporte CCF', length: 9, start: 415, end: 423, type: 'N' },
  { campo: 66, name: 'Tarifa de aportes SENA', length: 7, start: 424, end: 430, type: 'N' },
  { campo: 67, name: 'Valor aportes SENA', length: 9, start: 431, end: 439, type: 'N' },
  { campo: 68, name: 'Tarifa aportes ICBF', length: 7, start: 440, end: 446, type: 'N' },
  { campo: 69, name: 'Valor aporte ICBF', length: 9, start: 447, end: 455, type: 'N' },
  { campo: 70, name: 'Tarifa aportes ESAP', length: 7, start: 456, end: 462, type: 'N' },
  { campo: 71, name: 'Valor aporte ESAP', length: 9, start: 463, end: 471, type: 'N' },
  { campo: 72, name: 'Tarifa aportes MEN', length: 7, start: 472, end: 478, type: 'N' },
  { campo: 73, name: 'Valor aporte MEN', length: 9, start: 479, end: 487, type: 'N' },
  { campo: 74, name: 'Tipo de documento del cotizante principal', length: 2, start: 488, end: 489, type: 'A' },
  { campo: 75, name: 'Numero de identificacion del cotizante principal', length: 16, start: 490, end: 505, type: 'A' },
  { campo: 76, name: 'Cotizante exonerado de pago de aporte salud, SENA e ICBF (S/N)', length: 1, start: 506, end: 506, type: 'A' },
  { campo: 77, name: 'Codigo de la administradora de Riesgos Laborales', length: 6, start: 507, end: 512, type: 'A' },
  { campo: 78, name: 'Clase de riesgo en la que se encuentra el cotizante', length: 1, start: 513, end: 513, type: 'A' },
  { campo: 79, name: 'Indicador de tarifa especial (alto riesgo)', length: 1, start: 514, end: 514, type: 'A' },
  { campo: 80, name: 'Fecha de ingreso (AAAA-MM-DD)', length: 10, start: 515, end: 524, type: 'A' },
  { campo: 81, name: 'Fecha de retiro (AAAA-MM-DD)', length: 10, start: 525, end: 534, type: 'A' },
  { campo: 82, name: 'Fecha inicio VSP (AAAA-MM-DD)', length: 10, start: 535, end: 544, type: 'A' },
  { campo: 83, name: 'Fecha inicio SLN (AAAA-MM-DD)', length: 10, start: 545, end: 554, type: 'A' },
  { campo: 84, name: 'Fecha fin SLN (AAAA-MM-DD)', length: 10, start: 555, end: 564, type: 'A' },
  { campo: 85, name: 'Fecha inicio IGE (AAAA-MM-DD)', length: 10, start: 565, end: 574, type: 'A' },
  { campo: 86, name: 'Fecha fin IGE (AAAA-MM-DD)', length: 10, start: 575, end: 584, type: 'A' },
  { campo: 87, name: 'Fecha inicio LMA (AAAA-MM-DD)', length: 10, start: 585, end: 594, type: 'A' },
  { campo: 88, name: 'Fecha fin LMA (AAAA-MM-DD)', length: 10, start: 595, end: 604, type: 'A' },
  { campo: 89, name: 'Fecha inicio VAC-LR (AAAA-MM-DD)', length: 10, start: 605, end: 614, type: 'A' },
  { campo: 90, name: 'Fecha fin VAC-LR (AAAA-MM-DD)', length: 10, start: 615, end: 624, type: 'A' },
  { campo: 91, name: 'Fecha inicio VCT (AAAA-MM-DD)', length: 10, start: 625, end: 634, type: 'A' },
  { campo: 92, name: 'Fecha fin VCT (AAAA-MM-DD)', length: 10, start: 635, end: 644, type: 'A' },
  { campo: 93, name: 'Fecha inicio IRL (AAAA-MM-DD)', length: 10, start: 645, end: 654, type: 'A' },
  { campo: 94, name: 'Fecha fin IRL (AAAA-MM-DD)', length: 10, start: 655, end: 664, type: 'A' },
  { campo: 95, name: 'IBC otros parafiscales', length: 9, start: 665, end: 673, type: 'N' },
  { campo: 96, name: 'Numero de horas laboradas', length: 3, start: 674, end: 676, type: 'N' },
  { campo: 97, name: 'Fecha de la novedad / dato final', length: 10, start: 677, end: 686, type: 'A' },
] as const;

/** Longitud total exacta del registro tipo 2. */
export const PILA_TYPE2_TOTAL_LENGTH = 686;

/**
 * Valor de un campo antes del formateo. Los `number` se tratan como enteros
 * (se redondean); las fechas ya deben venir como string 'AAAA-MM-DD'.
 */
export type PilaFieldValue = string | number | null | undefined;

/**
 * Formatea un valor a su representación de ancho fijo según el tipo de campo:
 * - Numérico 'N': entero (redondeado), sin signo, justificado a la derecha y
 *   rellenado con ceros a la izquierda.
 * - Alfanumérico 'A': texto sin saltos de línea, justificado a la izquierda y
 *   rellenado con espacios a la derecha; se trunca al largo del campo.
 *
 * Lanza si un valor numérico excede la longitud del campo (evita corromper
 * silenciosamente un archivo legal).
 */
export function formatPilaField(
  spec: PilaFieldSpec,
  value: PilaFieldValue,
): string {
  if (spec.type === 'N') {
    let digits: string;
    if (value === null || value === undefined || value === '') {
      digits = '0';
    } else if (typeof value === 'number') {
      digits = String(Math.max(0, Math.round(value)));
    } else {
      digits = String(value).replace(/[^0-9]/g, '') || '0';
    }
    if (digits.length > spec.length) {
      throw new Error(
        `PILA campo ${spec.campo} (${spec.name}) desborda: ` +
          `"${digits}" excede ${spec.length} dígitos`,
      );
    }
    return digits.padStart(spec.length, '0');
  }

  // Alfanumérico
  const raw = value === null || value === undefined ? '' : String(value);
  const clean = raw.replace(/[\r\n\t]/g, ' ');
  return clean.slice(0, spec.length).padEnd(spec.length, ' ');
}

/**
 * Ensambla un registro de ancho fijo a partir del layout y un mapa
 * campo->valor. Valida que la longitud resultante coincida con la esperada
 * y que las posiciones del layout sean contiguas.
 */
export function buildPilaRecord(
  layout: readonly PilaFieldSpec[],
  expectedLength: number,
  values: Record<number, PilaFieldValue>,
): string {
  let record = '';
  let offset = 0;
  for (const spec of layout) {
    if (spec.start !== offset + 1) {
      throw new Error(
        `PILA layout no contiguo en campo ${spec.campo}: ` +
          `inicia en ${spec.start}, se esperaba ${offset + 1}`,
      );
    }
    record += formatPilaField(spec, values[spec.campo]);
    offset = spec.end;
  }
  if (record.length !== expectedLength) {
    throw new Error(
      `PILA registro con longitud ${record.length}, se esperaba ${expectedLength}`,
    );
  }
  return record;
}
