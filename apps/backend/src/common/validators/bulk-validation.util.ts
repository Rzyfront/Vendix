import { ValidationError } from 'class-validator';
import { BulkRowError } from '../../domains/store/customers/dto/bulk-customer.dto';

/**
 * Column header (in Spanish) for each DTO field. Used by the bulk
 * validation pipe to give the operator a human-readable column label
 * instead of the technical field name.
 *
 * Duplicado en `CustomersBulkService` para evitar dependencia circular;
 * mantener ambos en sincronía si se agrega una columna nueva.
 */
export const FIELD_TO_COLUMN: Record<string, string> = {
  email: 'Correo',
  first_name: 'Nombre',
  last_name: 'Apellido',
  document_number: 'Documento',
  document_type: 'Tipo Documento',
  phone: 'Teléfono',
  row_number: 'Fila',
};

/**
 * Mapea un código de constraint de class-validator a una sugerencia de
 * corrección en español. Devuelve `undefined` si el código no tiene una
 * acción obvia.
 */
export const CONSTRAINT_SUGGESTIONS: Record<string, string> = {
  isEmail:
    'Usa el formato usuario@dominio.com. Si no tienes correo, deja la celda vacía.',
  isString: 'Escribe texto en esta celda, sin números ni símbolos especiales.',
  isNumber: 'Escribe un número entero (sin letras ni puntos decimales).',
  isIn:
    'Usa uno de los códigos válidos (CC, CE, NIT, TI, PA, etc.). Revisa la hoja "Instrucciones" de la plantilla.',
  DocumentNumberMatchesType:
    'Revisa que la cantidad de dígitos coincida con el tipo de documento (CC: 6-10, NIT: 9 + dígito de verificación, etc.).',
};

/**
 * Detecta si el árbol de errores de class-validator pertenece a una carga
 * masiva. El shape típico de un DTO con `@ValidateNested({ each: true })`
 * sobre `customers: ItemDto[]` produce:
 *   - root: `property: "customers"`
 *   - 1er nivel: `property: "0"`, `"1"`, ...
 *   - 2do nivel: `property: "email"`, `"document_type"`, ...
 *
 * Se considera bulk si en cualquier nivel aparece el nombre raíz
 * `"customers"` o un índice numérico puro.
 */
export function isBulkValidationError(
  errors: ValidationError[],
): boolean {
  const visit = (errs: ValidationError[]): boolean => {
    for (const e of errs) {
      if (e.property === 'customers' || /^\d+$/.test(e.property)) return true;
      if (e.children && e.children.length > 0 && visit(e.children)) {
        return true;
      }
    }
    return false;
  };
  return visit(errors);
}

/**
 * Aplana el árbol de errores anidados de class-validator en una lista
 * plana de `BulkRowError` con fila, columna legible y sugerencia de
 * acción en español.
 *
 * Shape de entrada (class-validator):
 *   { property: 'customers', children: [
 *       { property: '10', children: [
 *           { property: 'email', constraints: { isEmail: '...' }, value: '...' }
 *         ]}
 *     ]}
 *
 * El `row` que emitimos es el número de fila EXCEL (1-based, con la fila
 * de encabezados = 1) que viene en el DTO como `row_number`. Si el DTO
 * no lo trae (caso raro), caemos al índice 0-based del array.
 */
export function flattenBulkValidationErrors(
  errors: ValidationError[],
): BulkRowError[] {
  const out: BulkRowError[] = [];

  const resolveRow = (
    err: ValidationError,
    fallbackIndex: number,
  ): number => {
    const candidate = (err.value as { row_number?: number } | null)
      ?.row_number;
    return typeof candidate === 'number' && candidate > 0
      ? candidate
      : fallbackIndex + 1; // +1 para mantener consistencia 1-based
  };

  const walk = (errs: ValidationError[], rowHint?: number) => {
    for (let i = 0; i < errs.length; i++) {
      const err = errs[i];
      const isRowContainer = /^\d+$/.test(err.property);
      const childRow = isRowContainer
        ? resolveRow(err, Number(err.property))
        : rowHint;

      if (err.children && err.children.length > 0) {
        walk(err.children, childRow);
        continue;
      }

      const code = err.constraints
        ? Object.keys(err.constraints)[0]
        : 'invalid';
      const message = err.constraints
        ? Object.values(err.constraints)[0]
        : 'Valor inválido';
      const suggestion = CONSTRAINT_SUGGESTIONS[code];

      const rowError: BulkRowError = {
        row: childRow ?? 0,
        column: FIELD_TO_COLUMN[err.property] ?? err.property,
        field: err.property,
        value: err.value,
        message,
        code,
      };
      if (suggestion) rowError.suggestion = suggestion;

      out.push(rowError);
    }
  };

  walk(errors);
  return out;
}
