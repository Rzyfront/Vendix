import { ValidationOptions, registerDecorator } from 'class-validator';
import { PageAppKind, validateAppPage } from './app-page.contract';

/**
 * Validates an app page document against the block catalog of `kind`
 * (`app-page.contract.ts`). The message lists the first wrong fields so the
 * editor can show them.
 */
export function IsAppPage(kind: PageAppKind, options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isAppPage',
      target: object.constructor,
      propertyName,
      constraints: [kind],
      options,
      validator: {
        validate(value: unknown) {
          return validateAppPage(kind, value).valid;
        },
        defaultMessage(args) {
          const errors = validateAppPage(kind, args?.value).errors;
          return errors.slice(0, 5).join(' ') || 'La página no es válida.';
        },
      },
    });
  };
}
