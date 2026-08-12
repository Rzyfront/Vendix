import { ValidationError } from 'class-validator';
import {
  flattenValidationMessages,
  isBulkValidationError,
} from './bulk-validation.util';

/** Nodo de árbol de class-validator, sin el ruido de los campos opcionales. */
const nodo = (
  property: string,
  extra: Partial<ValidationError> = {},
): ValidationError => ({ property, ...extra }) as ValidationError;

describe('bulk-validation.util', () => {
  describe('isBulkValidationError', () => {
    it('reconoce la carga masiva de clientes', () => {
      // customers -> "10" -> email
      const errors = [
        nodo('customers', {
          children: [
            nodo('10', {
              children: [
                nodo('email', { constraints: { isEmail: 'no es un correo' } }),
              ],
            }),
          ],
        }),
      ];

      expect(isBulkValidationError(errors)).toBe(true);
    });

    /**
     * El shape `root -> "0" -> campo` no es exclusivo de un bulk: lo produce
     * CUALQUIER DTO con `@ValidateNested({ each: true })`. El detector aceptaba
     * el índice numérico suelto, así que faltar `total_price` en los `items` de
     * una cotización respondía `CUST_BULK_VALIDATION` — "carga masiva" — con
     * sugerencias de clientes ("Usa uno de los códigos válidos (CC, CE, NIT...)")
     * en endpoints que no tienen filas ni plantilla de Excel.
     */
    it('NO confunde los items de una cotización con una carga masiva', () => {
      const errors = [
        nodo('items', {
          children: [
            nodo('0', {
              children: [
                nodo('total_price', {
                  constraints: { isNumber: 'total_price must be a number' },
                }),
              ],
            }),
          ],
        }),
      ];

      expect(isBulkValidationError(errors)).toBe(false);
    });

    it('NO se dispara por un índice numérico en la raíz', () => {
      expect(isBulkValidationError([nodo('0', { children: [] })])).toBe(false);
    });

    it('NO se dispara con errores planos', () => {
      const errors = [
        nodo('email', { constraints: { isEmail: 'no es un correo' } }),
      ];

      expect(isBulkValidationError(errors)).toBe(false);
    });

    it('exige que la raíz de bulk traiga hijos', () => {
      // `customers` sin children es el array entero fallando (`isArray`),
      // no una fila puntual: no hay filas que aplanar.
      expect(
        isBulkValidationError([
          nodo('customers', { constraints: { isArray: 'debe ser un arreglo' } }),
        ]),
      ).toBe(false);
    });
  });

  describe('flattenValidationMessages', () => {
    /**
     * El `exceptionFactory` sólo leía `constraints` en la raíz. Un error dentro
     * de un array no la tiene —la raíz sólo trae `children`— así que el mensaje
     * salía como "Valor inválido" sin decir qué campo de qué fila corregir.
     */
    it('prefija la ruta del campo cuando el error está anidado', () => {
      const errors = [
        nodo('items', {
          children: [
            nodo('0', {
              children: [
                nodo('total_price', {
                  constraints: { isNumber: 'total_price must be a number' },
                }),
              ],
            }),
          ],
        }),
      ];

      expect(flattenValidationMessages(errors)).toEqual([
        'items.0.total_price: total_price must be a number',
      ]);
    });

    it('deja el mensaje plano sin prefijo', () => {
      // Los formularios normales ya consumen este texto tal cual.
      const errors = [
        nodo('email', { constraints: { isEmail: 'no es un correo' } }),
      ];

      expect(flattenValidationMessages(errors)).toEqual(['no es un correo']);
    });

    it('junta varios constraints del mismo campo', () => {
      const errors = [
        nodo('items', {
          children: [
            nodo('0', {
              children: [
                nodo('tax_rate', {
                  constraints: {
                    max: 'tax_rate se expresa como fracción',
                    min: 'tax_rate must not be less than 0',
                  },
                }),
              ],
            }),
          ],
        }),
      ];

      expect(flattenValidationMessages(errors)).toHaveLength(2);
    });

    it('cae a un mensaje genérico si el árbol no tiene constraints', () => {
      expect(flattenValidationMessages([nodo('items')])).toEqual([
        'Valor inválido',
      ]);
    });
  });
});
