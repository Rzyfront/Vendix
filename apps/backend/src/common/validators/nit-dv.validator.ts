import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { computeNitDv } from '../utils/nit.util';

/**
 * Cross-field validator (class-level): when `document_type === 'NIT'` AND a
 * `verification_digit` is provided, the DV must equal
 * `computeNitDv(document_number)` modulo-11. Re-uses the canonical algorithm
 * from `common/utils/nit.util.ts` so the validation never drifts from the
 * service-layer split.
 *
 * The DV is a checksum, not data; if the merchant types a digit that
 * disagrees, DIAN rejects the document after burning a fiscal consecutive.
 * Catching the mismatch at the DTO layer is the cheapest control.
 *
 * Use via `@NitDvMatches()` on the DTO class.
 */
@ValidatorConstraint({ name: 'NitDvMatches', async: false })
export class NitDvMatchesConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const obj = args.object as Record<string, unknown>;
    const documentType = obj['document_type'];
    const documentNumber = obj['document_number'];
    const verificationDigit = obj['verification_digit'];

    // Rule applies only to NIT with explicit DV.
    if (documentType !== 'NIT') {
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

    const computed = computeNitDv(documentNumber);
    return computed === verificationDigit;
  }

  defaultMessage(args: ValidationArguments): string {
    const obj = args.object as Record<string, unknown>;
    const documentNumber = obj['document_number'];
    const verificationDigit = obj['verification_digit'];

    if (typeof documentNumber !== 'string' || !documentNumber) {
      return 'document_number es requerido para validar el dígito de verificación';
    }

    const computed = computeNitDv(documentNumber);
    return `El dígito de verificación '${verificationDigit}' no corresponde al NIT '${documentNumber}' (DV calculado: '${computed}')`;
  }
}

/**
 * Property-level decorator factory. Apply on a property that always exists in
 * the DTO (e.g. `document_type` or `verification_digit`) — the constraint
 * reads sibling fields via `ValidationArguments.object`.
 */
export function NitDvMatches(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return function (object: object, propertyName: string | symbol) {
    registerDecorator({
      name: 'NitDvMatches',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: NitDvMatchesConstraint,
    });
  };
}
