import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Cross-field validator (class-level): when `person_type === 'JURIDICA'`,
 * `legal_name` becomes required and `first_name`/`last_name` must be empty
 * (they belong to a persona natural, not a jurídica).
 *
 * This mirrors the Anexo Técnico 19 DIAN rule: `cac:PartyLegalEntity`
 * (jurídica) carries `cbc:RegistrationName` instead of `cac:Person/FirstName +
 * FamilyName`. Persisting both is a contract violation that the XML builder
 * cannot silently fix.
 *
 * Use via `@JuridicaNameRule()` on the DTO class.
 */
@ValidatorConstraint({ name: 'JuridicaNameRule', async: false })
export class JuridicaNameRuleConstraint
  implements ValidatorConstraintInterface
{
  validate(_value: unknown, args: ValidationArguments): boolean {
    const obj = args.object as Record<string, unknown>;
    const personType = obj['person_type'];
    const legalName = obj['legal_name'];
    const firstName = obj['first_name'];
    const lastName = obj['last_name'];

    if (personType !== 'JURIDICA') {
      // No constraint when not jurídica.
      return true;
    }

    // legal_name must be present and non-empty.
    const hasLegalName =
      typeof legalName === 'string' && legalName.trim().length > 0;

    // first_name / last_name must NOT be populated (would render as cac:Person
    // and contradict jurídica contract).
    const firstNameEmpty =
      firstName === undefined ||
      firstName === null ||
      (typeof firstName === 'string' && firstName.trim() === '');
    const lastNameEmpty =
      lastName === undefined ||
      lastName === null ||
      (typeof lastName === 'string' && lastName.trim() === '');

    return hasLegalName && firstNameEmpty && lastNameEmpty;
  }

  defaultMessage(args: ValidationArguments): string {
    const obj = args.object as Record<string, unknown>;
    const personType = obj['person_type'];
    const legalName = obj['legal_name'];
    const firstName = obj['first_name'];
    const lastName = obj['last_name'];

    if (personType !== 'JURIDICA') {
      return 'Regla jurídica no aplica';
    }

    const hasLegalName =
      typeof legalName === 'string' && legalName.trim().length > 0;

    if (!hasLegalName) {
      return 'La razón social es obligatoria cuando el tipo de persona es JURIDICA';
    }
    if (typeof firstName === 'string' && firstName.trim() !== '') {
      return 'Una persona JURIDICA no debe tener nombre; usa razón social';
    }
    if (typeof lastName === 'string' && lastName.trim() !== '') {
      return 'Una persona JURIDICA no debe tener apellido; usa razón social';
    }
    return 'Datos de persona jurídica inválidos';
  }
}

/**
 * Property-level decorator factory. The cross-field constraint reads sibling
 * fields via `ValidationArguments.object`, but it MUST be attached to some
 * property to be registered — `registerDecorator` requires a `propertyName`.
 *
 * Apply on the `person_type` property of the DTO so the validator runs on
 * every request that includes a persona classification. Other property names
 * work too; what matters is that the constraint is reachable from the
 * validation graph.
 */
export function JuridicaNameRule(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return function (object: object, propertyName: string | symbol) {
    registerDecorator({
      name: 'JuridicaNameRule',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: JuridicaNameRuleConstraint,
    });
  };
}
