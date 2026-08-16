import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { normalizeNit } from '../utils/nit.util';

/**
 * Nombres de los campos hermanos que el constraint debe leer, y el valor que
 * en ese DTO significa «NIT».
 *
 * No son universales en el repo: `CreateCustomerDto` usa la sigla
 * (`document_type: 'NIT'`, `document_number`, `verification_digit`), mientras
 * que `CreateInvoiceDto` habla el vocabulario de la DIAN
 * (`customer_document_type: '31'`, `customer_tax_id`,
 * `customer_verification_digit`). Con nombres fijos, aplicar el decorador al
 * DTO equivocado no falla: lee `undefined`, sale por la guarda y queda como
 * un no-op silencioso.
 */
export interface NitDvMatchesFields {
  documentTypeField?: string;
  documentNumberField?: string;
  verificationDigitField?: string;
  /** Valor de `documentTypeField` que activa la regla. Por defecto `'NIT'`. */
  nitValue?: string;
}

const DEFAULT_FIELDS: Required<NitDvMatchesFields> = {
  documentTypeField: 'document_type',
  documentNumberField: 'document_number',
  verificationDigitField: 'verification_digit',
  nitValue: 'NIT',
};

function resolveFields(args: ValidationArguments): Required<NitDvMatchesFields> {
  const [config] = args.constraints ?? [];
  return { ...DEFAULT_FIELDS, ...((config as NitDvMatchesFields) ?? {}) };
}

/**
 * Cross-field validator (class-level): when the document type field equals the
 * configured NIT value AND a verification digit is provided, the DV must equal
 * the modulo-11 checksum of the document number. Re-uses the canonical
 * algorithm from `common/utils/nit.util.ts` so the validation never drifts
 * from the service-layer split.
 *
 * The DV is a checksum, not data; if the merchant types a digit that
 * disagrees, DIAN rejects the document after burning a fiscal consecutive.
 * Catching the mismatch at the DTO layer is the cheapest control.
 *
 * Use via `@NitDvMatches()` on the DTO class — pass `NitDvMatchesFields` when
 * the DTO does not use the customer-domain field names.
 */
@ValidatorConstraint({ name: 'NitDvMatches', async: false })
export class NitDvMatchesConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const obj = args.object as Record<string, unknown>;
    const fields = resolveFields(args);
    const documentType = obj[fields.documentTypeField];
    const documentNumber = obj[fields.documentNumberField];
    const verificationDigit = obj[fields.verificationDigitField];

    // Rule applies only to NIT with explicit DV.
    if (documentType !== fields.nitValue) {
      return true;
    }

    if (
      verificationDigit === undefined ||
      verificationDigit === null ||
      verificationDigit === ''
    ) {
      // DV not provided → the service will derive it. Allow.
      return true;
    }

    if (
      typeof verificationDigit !== 'string' ||
      typeof documentNumber !== 'string' ||
      !documentNumber
    ) {
      // Cannot compute without a number — let other validators flag it.
      return true;
    }

    // `normalizeNit` recorta un DV ya pegado al número (`900123456-7`);
    // `computeNitDv` a secas lo tomaría como parte de la base y produciría
    // un rechazo falso.
    const computed = normalizeNit(documentNumber).dv;
    return computed === verificationDigit;
  }

  defaultMessage(args: ValidationArguments): string {
    const obj = args.object as Record<string, unknown>;
    const fields = resolveFields(args);
    const documentNumber = obj[fields.documentNumberField];
    const verificationDigit = obj[fields.verificationDigitField];

    if (typeof documentNumber !== 'string' || !documentNumber) {
      return `${fields.documentNumberField} es requerido para validar el dígito de verificación`;
    }

    // `normalizeNit` recorta un DV ya pegado al número (`900123456-7`);
    // `computeNitDv` a secas lo tomaría como parte de la base y produciría
    // un rechazo falso.
    const computed = normalizeNit(documentNumber).dv;
    // La causa más frecuente del desacuerdo no es un dedazo en el DV, sino el
    // NIT escrito con el DV pegado. Decirlo evita el ciclo de reintentos a
    // ciegas del que el mensaje escueto no saca a nadie.
    const hint =
      computed !== verificationDigit &&
      normalizeNit(documentNumber.slice(0, -1)).dv === verificationDigit
        ? ` Parece que el NIT trae el DV pegado: el número va sin DV ('${documentNumber.slice(0, -1)}') y el DV en su propio campo.`
        : '';
    return `El dígito de verificación '${verificationDigit}' no corresponde al NIT '${documentNumber}' (DV calculado: '${computed}').${hint}`;
  }
}

/**
 * Property-level decorator factory. Apply on a property that always exists in
 * the DTO (e.g. `document_type` or `verification_digit`) — the constraint
 * reads sibling fields via `ValidationArguments.object`.
 */
export function NitDvMatches(
  fields?: NitDvMatchesFields,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return function (object: object, propertyName: string | symbol) {
    registerDecorator({
      name: 'NitDvMatches',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      constraints: [fields ?? {}],
      validator: NitDvMatchesConstraint,
    });
  };
}
