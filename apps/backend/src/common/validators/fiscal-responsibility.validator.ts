import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import {
  FISCAL_RESPONSIBILITIES,
  FiscalResponsibilityCode,
} from '../constants/fiscal-responsibilities';

/**
 * Validator: each element of `fiscal_responsibilities` must be in the
 * canonical RUT catalog (`FISCAL_RESPONSIBILITIES`).
 *
 * The catalog mirrors `apps/frontend/src/app/shared/constants/fiscal-
 * responsibilities.constants.ts`. Persisting a code outside the catalog would
 * emit an XML Anexo Técnico 19 that DIAN rejects because `TaxLevelCode` must
 * belong to the published RUT table.
 *
 * Use via `@FiscalResponsibilityInCatalogRule()` on the `fiscal_responsibilities`
 * property.
 */
@ValidatorConstraint({
  name: 'FiscalResponsibilityInCatalogRule',
  async: false,
})
export class FiscalResponsibilityInCatalogRuleConstraint
  implements ValidatorConstraintInterface
{
  validate(value: unknown): boolean {
    if (value === undefined || value === null) {
      return true;
    }

    if (!Array.isArray(value)) {
      // Wrong shape — let `@IsArray` flag it.
      return true;
    }

    const allowed: readonly string[] = FISCAL_RESPONSIBILITIES;
    for (const entry of value) {
      if (typeof entry !== 'string' || !allowed.includes(entry)) {
        return false;
      }
    }
    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    const value = args.value;
    if (!Array.isArray(value)) {
      return 'fiscal_responsibilities debe ser un arreglo de códigos RUT';
    }
    const allowed: readonly string[] = FISCAL_RESPONSIBILITIES;
    const unknown = value.filter(
      (entry) => typeof entry !== 'string' || !allowed.includes(entry),
    );
    const unknownTyped: FiscalResponsibilityCode[] = unknown.filter(
      (e): e is FiscalResponsibilityCode => typeof e === 'string',
    );
    return `fiscal_responsibilities contiene códigos fuera del catálogo RUT: ${unknownTyped.join(', ')}. Permitidos: ${FISCAL_RESPONSIBILITIES.join(', ')}`;
  }
}

export function FiscalResponsibilityInCatalogRule(
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'FiscalResponsibilityInCatalogRule',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: FiscalResponsibilityInCatalogRuleConstraint,
    });
  };
}
