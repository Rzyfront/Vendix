import { Injectable } from '@angular/core';
import { AbstractControl, ValidatorFn } from '@angular/forms';

@Injectable({
  providedIn: 'root',
})
export class ValidationService {
  /**
   * Validador para teléfono en formato E.164
   * Formato: +[código_país][número] (7-15 dígitos sin contar +)
   */
  static phoneValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      if (!control.value) {
        return null; // Campo opcional
      }

      const cleanedPhone = control.value.replace(/[\s\-\(\)]/g, '');
      const phoneRegex = /^\+?[1-9]\d{6,14}$/;

      return phoneRegex.test(cleanedPhone) ? null : { invalidPhone: true };
    };
  }

  /**
   * Validador para username (alfanumérico y guiones bajos)
   */
  static usernameValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      if (!control.value) {
        return { required: true };
      }

      const usernameRegex = /^[a-zA-Z0-9_]+$/;

      if (control.value.length < 3) {
        return { minLength: true };
      }

      return usernameRegex.test(control.value)
        ? null
        : { invalidUsername: true };
    };
  }

  /**
   * Validador para email
   */
  static emailValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      if (!control.value) {
        return { required: true };
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(control.value) ? null : { invalidEmail: true };
    };
  }

  /**
   * Validador para número de documento según tipo
   */
  static documentNumberValidator(documentType: string): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      if (!control.value) {
        return null; // Campo opcional
      }

      const value = control.value.toString().replace(/[^0-9Kk]/g, '');

      switch (documentType) {
        case 'dni':
          // DNI peruano: 8 dígitos
          const dniRegex = /^\d{8}$/;
          return dniRegex.test(value) ? null : { invalidDni: true };

        case 'cedula':
          // Cédula ecuatoriana: 10 dígitos
          const cedulaRegex = /^\d{10}$/;
          return cedulaRegex.test(value) ? null : { invalidCedula: true };

        case 'rut':
          // RUT chileno: 7-8 dígitos + K/0-9
          const rutRegex = /^\d{7,8}[Kk0-9]$/;
          return rutRegex.test(value) ? null : { invalidRut: true };

        case 'passport':
          // Pasaporte: 6-9 caracteres alfanuméricos
          const passportRegex = /^[A-Za-z0-9]{6,9}$/;
          return passportRegex.test(control.value)
            ? null
            : { invalidPassport: true };

        default:
          return null;
      }
    };
  }

  /**
   * Validador para nombres y apellidos (solo letras y espacios)
   */
  static nameValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      if (!control.value) {
        return { required: true };
      }

      const nameRegex = /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s']+$/;
      return nameRegex.test(control.value) ? null : { invalidName: true };
    };
  }

  /**
   * Validador para contraseña
   */
  static passwordValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      if (!control.value) {
        return null; // Campo opcional
      }

      if (control.value.length < 8) {
        return { minLength: true };
      }

      const hasSpecialChar = /[^A-Za-z0-9]/.test(control.value);
      return hasSpecialChar ? null : { noSpecialChar: true };
    };
  }

  /**
   * Validador para códigos SKU (formato estándar)
   */
  static skuValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      if (!control.value) {
        return { required: true };
      }

      const skuRegex = /^[A-Z0-9-_]+$/;
      return skuRegex.test(control.value.toUpperCase())
        ? null
        : { invalidSku: true };
    };
  }

  /**
   * Validador para precios (mínimo 0)
   */
  static priceValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      const value = parseFloat(control.value);

      if (isNaN(value)) {
        return { invalidPrice: true };
      }

      return value >= 0 ? null : { negativePrice: true };
    };
  }

  /**
   * Validador para stock (mínimo 0, entero)
   */
  static stockValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      const value = parseInt(control.value);

      if (isNaN(value)) {
        return { invalidStock: true };
      }

      return value >= 0 ? null : { negativeStock: true };
    };
  }

  /**
   * Mensajes de error estándar
   */
  static getErrorMessage(error: any, fieldName: string): string {
    switch (Object.keys(error)[0]) {
      case 'required':
        return `${fieldName} es requerido`;
      case 'minLength':
        return `${fieldName} debe tener al menos 3 caracteres`;
      case 'invalidPhone':
        return 'Formato de teléfono inválido. Use formato internacional (+1234567890)';
      case 'invalidUsername':
        return 'El nombre de usuario solo puede contener letras, números y guiones bajos';
      case 'invalidEmail':
        return 'Email inválido';
      case 'invalidDni':
        return 'DNI inválido (debe tener 8 dígitos)';
      case 'invalidCedula':
        return 'Cédula inválida (debe tener 10 dígitos)';
      case 'invalidRut':
        return 'RUT inválido (formato: 12345678-9 o 1234567-K)';
      case 'invalidPassport':
        return 'Pasaporte inválido (6-9 caracteres alfanuméricos)';
      case 'invalidName':
        return 'El nombre solo puede contener letras y espacios';
      case 'invalidSku':
        return 'SKU inválido (solo mayúsculas, números, guiones y guiones bajos)';
      case 'invalidPrice':
        return 'Precio inválido';
      case 'negativePrice':
        return 'El precio no puede ser negativo';
      case 'invalidStock':
        return 'El stock no puede ser negativo';
      case 'noSpecialChar':
        return 'La contraseña debe contener al menos un carácter especial';
      default:
        return `${fieldName} inválido`;
    }
  }
}
