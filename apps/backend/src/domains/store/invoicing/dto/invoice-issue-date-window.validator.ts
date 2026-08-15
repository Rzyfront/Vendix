import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Tolerancia hacia el futuro, en días.
 *
 * POR QUÉ 1 y no 0: la DIAN rechaza todo documento cuya `IssueDate` sea
 * posterior al instante en que ella lo recibe, así que el techo natural es
 * "ahora". Pero `issue_date` llega como fecha-sólo (`YYYY-MM-DD`) desde un
 * formulario que la arma en la zona de la tienda, y `Date.parse` la interpreta
 * como medianoche UTC. Un día de holgura absorbe ese desfase de zona sin abrir
 * la puerta a facturas fechadas la semana que viene.
 */
export const ISSUE_DATE_MAX_FUTURE_DAYS = 1;

/**
 * Tope hacia el pasado, en años.
 *
 * POR QUÉ 5: es el término de firmeza de las declaraciones tributarias en
 * Colombia (Art. 714 E.T. tras la Ley 2010/2019) y el período de conservación
 * de los documentos soporte. Una factura fechada antes de esa ventana no puede
 * corresponder a un período vivo: es un error de captura —el clásico año
 * tecleado mal— y capturarlo aquí evita que queme un consecutivo autorizado.
 */
export const ISSUE_DATE_MAX_PAST_YEARS = 5;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Límites vigentes de la ventana, calculados contra el reloj de la petición. */
export function resolveIssueDateWindow(now: number = Date.now()): {
  min: Date;
  max: Date;
} {
  const min = new Date(now);
  min.setUTCFullYear(min.getUTCFullYear() - ISSUE_DATE_MAX_PAST_YEARS);
  return { min, max: new Date(now + ISSUE_DATE_MAX_FUTURE_DAYS * MS_PER_DAY) };
}

const asIsoDay = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Acota `issue_date` a una ventana fiscal plausible.
 *
 * No duplica a `@IsDateString`: si el valor no es una fecha parseable devuelve
 * `true` y deja que aquel emita su propio error, para que el cliente reciba una
 * sola causa por campo en vez de dos mensajes que se contradicen.
 */
@ValidatorConstraint({ name: 'IsWithinFiscalIssueDateWindow', async: false })
export class IsWithinFiscalIssueDateWindowConstraint
  implements ValidatorConstraintInterface
{
  validate(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value !== 'string' || value.trim() === '') return true;

    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return true; // formato: trabajo de @IsDateString

    const { min, max } = resolveIssueDateWindow();
    return parsed >= min.getTime() && parsed <= max.getTime();
  }

  defaultMessage(args: ValidationArguments): string {
    const { min, max } = resolveIssueDateWindow();
    const value = typeof args.value === 'string' ? args.value : String(args.value);
    return `La fecha de emisión «${value}» está fuera de la ventana fiscal admitida (${asIsoDay(
      min,
    )} a ${asIsoDay(
      max,
    )}). La DIAN rechaza un documento fechado después del momento en que lo recibe, y uno con más de ${ISSUE_DATE_MAX_PAST_YEARS} años cae fuera del término de firmeza. Revisa el año en ${args.property}.`;
  }
}

export function IsWithinFiscalIssueDateWindow(
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'IsWithinFiscalIssueDateWindow',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsWithinFiscalIssueDateWindowConstraint,
    });
  };
}
