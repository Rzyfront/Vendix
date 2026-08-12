import { ValidationError } from 'class-validator';

/**
 * Error canónico para UNA fila de una carga masiva (clientes, productos,
 * órdenes, etc.). Este shape es emitido por DOS lugares:
 *  - El `exceptionFactory` del `ValidationPipe` global (errores de DTO:
 *    emails mal formados, strings en lugar de números, etc.).
 *  - El catch por fila del bulk service respectivo (errores de negocio:
 *    email duplicado, documento duplicado, etc.).
 *
 * Mantener el mismo shape permite que el frontend renderice una sola tabla
 * de errores sin tener que distinguir entre "falló la validación del DTO"
 * y "falló al guardar en BD".
 *
 * Vive aquí (en `common/`) y NO en un DTO de dominio para que la util
 * pueda ser reusada por otros bulks (products, orders, ...) sin invertir
 * la dependencia `common → domains`.
 */
export interface BulkRowError {
  /** Índice 1-based de la fila dentro de la plantilla Excel (header = fila 1). 0 = desconocida. */
  row: number;
  /** Encabezado de la columna legible para el operador (`"Correo"`, `"Documento"`, etc.). */
  column: string;
  /** Clave técnica del campo (`email`, `document_number`, etc.). */
  field: string;
  /** Valor que disparó el error, tal cual vino en la fila. */
  value: unknown;
  /** Motivo concreto del fallo, en español. */
  message: string;
  /**
   * Código estable de error. El frontend puede usarlo para colorear / filtrar
   * (`validation` | `duplicate_email` | `duplicate_document` | `conflict` |
   * `internal`, etc.).
   */
  code: string;
  /** Acción sugerida para corregir el error, en español. Vacío si no aplica. */
  suggestion?: string;
}

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
 * Mapea un `code` de `BulkRowError` (canónico, emitido por el mapper o
 * por el catch per-row) al campo técnico del DTO y al encabezado legible
 * que verá el operador.
 *
 * El campo técnico es lo que el frontend usa para resaltar la celda en
 * el Excel si algún día se hace; el encabezado es lo que se muestra en
 * la columna "Columna" de la tabla de errores.
 */
export function getFieldAndColumnForCode(code: string): {
  field: string;
  column: string;
} {
  switch (code) {
    case 'duplicate_email':
      return { field: 'email', column: FIELD_TO_COLUMN.email };
    case 'duplicate_document':
      return { field: 'document_number', column: FIELD_TO_COLUMN.document_number };
    case 'duplicate_email_in_file':
      return { field: 'email', column: FIELD_TO_COLUMN.email };
    default:
      return { field: 'general', column: 'General' };
  }
}

/**
 * Propiedades raíz que SÍ corresponden a una carga masiva. La detección se
 * ancla al nombre de la raíz, no al shape.
 *
 * Agregar una raíz aquí es lo único que hace falta cuando aparezca un bulk
 * nuevo (`products`, `orders`), y su DTO tiene que exponer el array con ese
 * mismo nombre.
 */
const BULK_ROOT_PROPERTIES = new Set(['customers']);

/**
 * Detecta si el árbol de errores de class-validator pertenece a una carga
 * masiva. El shape típico de un DTO con `@ValidateNested({ each: true })`
 * sobre `customers: ItemDto[]` produce:
 *   - root: `property: "customers"`
 *   - 1er nivel: `property: "0"`, `"1"`, ...
 *   - 2do nivel: `property: "email"`, `"document_type"`, ...
 *
 * El primer nivel numérico NO alcanza para reconocer un bulk: ese shape es el
 * de CUALQUIER DTO con un array validado. Aceptando el índice suelto, faltar
 * `total_price` en los `items` de una cotización respondía
 * `CUST_BULK_VALIDATION` — "Se encontraron 1 error(es) de validación en la
 * carga masiva" — con sugerencias de clientes ("Usa uno de los códigos válidos
 * (CC, CE, NIT...)") en endpoints de cotizaciones, órdenes, compras y ajustes
 * de inventario, que no tienen filas ni plantilla de Excel.
 */
export function isBulkValidationError(errors: ValidationError[]): boolean {
  return errors.some(
    (e) =>
      BULK_ROOT_PROPERTIES.has(e.property) && (e.children?.length ?? 0) > 0,
  );
}

/**
 * Aplana el árbol de class-validator a mensajes legibles, prefijando la ruta
 * del campo cuando el error está anidado (`items.0.total_price: ...`).
 *
 * El `exceptionFactory` sólo miraba `constraints` en la raíz, y un error dentro
 * de un array no la tiene: el DTO raíz sólo trae `children`. El operador recibía
 * `"Valor inválido"` sin saber qué campo de qué fila corregir.
 *
 * Los errores planos se dejan sin prefijo para no cambiar el mensaje que hoy
 * consume el frontend en los formularios normales.
 */
export function flattenValidationMessages(errors: ValidationError[]): string[] {
  const visit = (errs: ValidationError[], parentPath: string): string[] => {
    const messages: string[] = [];
    for (const e of errs) {
      const path = parentPath ? `${parentPath}.${e.property}` : e.property;
      if (e.constraints) {
        const texts = Object.values(e.constraints);
        messages.push(
          ...texts.map((text) => (parentPath ? `${path}: ${text}` : text)),
        );
      }
      if (e.children?.length) {
        messages.push(...visit(e.children, path));
      }
    }
    return messages;
  };

  const messages = visit(errors, '');
  return messages.length > 0 ? messages : ['Valor inválido'];
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
    // Si el DTO trae `row_number` (1-based, número de fila del Excel),
    // lo respetamos. Si no, devolvemos 0 para señalar "fila desconocida"
    // y que el frontend muestre "Fila ?" en vez de inventar un número.
    const candidate = (err.value as { row_number?: number } | null)
      ?.row_number;
    return typeof candidate === 'number' && candidate > 0
      ? candidate
      : 0;
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
