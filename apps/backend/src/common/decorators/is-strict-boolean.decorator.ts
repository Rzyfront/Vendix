import { registerDecorator, ValidationOptions } from 'class-validator';

export function IsStrictBoolean(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStrictBoolean',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any): boolean {
          return typeof value === 'boolean';
        },
        defaultMessage(): string {
          return `${propertyName} must be strictly true or false (boolean type)`;
        },
      },
    });
  };
}
