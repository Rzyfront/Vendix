import { parseApiError } from '../../../../../core/utils/parse-api-error';
import { SaveRequirement } from '../components/save-requirements-modal/save-requirements.interface';

/**
 * Información curada para traducir un código de error del backend a una fila
 * accionable del modal de requisitos de guardado.
 */
export interface ProductSaveErrorInfo {
  label: string;
  reason: string;
  actionKind?: 'focus' | 'scroll' | 'release-reservations';
  actionLabel?: string;
  actionTarget?: string;
}

/**
 * Catálogo curado de errores de guardado de producto.
 * Todas las entradas son `blocker` salvo que el consumidor indique lo contrario.
 */
export const PRODUCT_SAVE_ERROR_MAP: Record<string, ProductSaveErrorInfo> = {
  INV_STOCK_001: {
    label: 'Stock reservado o insuficiente',
    reason:
      'Este producto tiene stock reservado o insuficiente para el cambio. Libera las reservas activas o ajusta el stock antes de guardar.',
    actionKind: 'release-reservations',
    actionLabel: 'Liberar reservas',
  },
  PROD_HAS_RESERVATIONS_001: {
    label: 'Variante con reservas',
    reason:
      'Una variante tiene stock reservado. Libera las reservas antes de eliminarla o cambiar su stock.',
    actionKind: 'release-reservations',
    actionLabel: 'Liberar reservas',
  },
  PROD_DUP_001: {
    label: 'SKU o URL duplicados',
    reason:
      'Ya existe un producto con ese SKU o la misma URL (slug) en la tienda. Usa un SKU o nombre distinto.',
    actionKind: 'focus',
    actionLabel: 'Ir al SKU',
    actionTarget: 'sku',
  },
  PROD_BARCODE_DUP_001: {
    label: 'Código de barras duplicado',
    reason:
      'El código de barras ya está en uso por otro producto o variante de la tienda. Usa uno distinto.',
    actionKind: 'focus',
    actionLabel: 'Ir al código de barras',
    actionTarget: 'barcode',
  },
  PROD_VALIDATE_001: {
    label: 'No se pudo aplicar el cambio',
    reason:
      'Hay un cambio que no se puede aplicar directamente: por ejemplo cambiar el manejo de inventario en un producto con variantes, o eliminar una variante que tiene stock. Revisa las variantes y el manejo de stock.',
    actionKind: 'scroll',
    actionLabel: 'Ir a variantes',
    actionTarget: 'variants',
  },
  PROD_VALIDATE_002: {
    label: 'Falta el SKU del producto',
    reason:
      'El producto necesita un SKU configurado antes de activar variantes. Asigna un SKU al producto.',
    actionKind: 'focus',
    actionLabel: 'Ir al SKU',
    actionTarget: 'sku',
  },
  PROD_VALIDATE_003: {
    label: 'SKU de variante vacío',
    reason:
      'Una variante quedó sin SKU. Asigna un SKU único a cada variante.',
    actionKind: 'scroll',
    actionLabel: 'Ir a variantes',
    actionTarget: 'variants',
  },
  PROD_VALIDATE_004: {
    label: 'Campos de servicio no válidos',
    reason:
      'Los campos de servicio solo aplican a variantes de productos de tipo servicio. Quítalos o cambia el tipo de producto.',
    actionKind: 'scroll',
    actionLabel: 'Ir a variantes',
    actionTarget: 'variants',
  },
  PROD_SVC_001: {
    label: 'Servicio con atributos físicos',
    reason:
      'Un producto de tipo servicio no puede tener peso, dimensiones, seriales ni control de inventario. Quita esos atributos antes de guardar.',
  },
  PROD_SVC_HAS_VARIANTS_001: {
    label: 'No se puede convertir a servicio',
    reason:
      'No puedes convertir a servicio un producto que ya tiene variantes. Elimina las variantes primero.',
    actionKind: 'scroll',
    actionLabel: 'Ir a variantes',
    actionTarget: 'variants',
  },
  PROD_VAR_PRICE_001: {
    label: 'Precio de variante inválido',
    reason:
      'Una variante tiene un precio inválido: debe ser mayor a 0. Corrige el precio de la variante.',
    actionKind: 'scroll',
    actionLabel: 'Ir a variantes',
    actionTarget: 'variants',
  },
  PROD_VAR_SALE_PRICE_001: {
    label: 'Oferta de variante inválida',
    reason:
      'La oferta de una variante debe ser mayor a 0 y menor que su precio regular. Corrige la oferta.',
    actionKind: 'scroll',
    actionLabel: 'Ir a variantes',
    actionTarget: 'variants',
  },
  PROD_PERM_001: {
    label: 'Sin permiso',
    reason:
      'No tienes permiso para modificar este producto. Contacta a un administrador de la tienda.',
  },
  STORE_CONTEXT_001: {
    label: 'Falta contexto de tienda',
    reason:
      'No se detectó la tienda activa. Recarga la página e inténtalo de nuevo.',
  },
};

/** Nombres de campo humanizados para las filas de validación del backend. */
const FIELD_LABELS: Record<string, string> = {
  name: 'Nombre',
  base_price: 'Precio base',
  sku: 'SKU',
  barcode: 'Código de barras',
  slug: 'URL (slug)',
};

/**
 * Detecta frases típicas del `class-validator` en inglés para anteponer un
 * prefijo en español y no mostrar el mensaje crudo del backend sin contexto.
 */
const ENGLISH_VALIDATION_PATTERN =
  /\b(must|should|is not|are not|each value|be a|be an|longer than|shorter than|not exist|not be empty)\b/i;

/** Item crudo que puede venir en `details.validationErrors`. */
type ValidationErrorItem =
  | string
  | { property?: string; constraints?: Record<string, string> };

/**
 * Traduce CUALQUIER error del backend al guardar un producto en filas del modal
 * de requisitos. Nunca devuelve un arreglo vacío: siempre entrega al menos una
 * fila para que el usuario tenga un mensaje accionable.
 */
export function mapBackendErrorToRequirements(err: unknown): SaveRequirement[] {
  const parsed = parseApiError(err);

  // 1) Errores del ValidationPipe global (SYS_VALIDATION_001).
  if (parsed.errorCode === 'SYS_VALIDATION_001') {
    const rows = buildValidationRequirements(parsed.details);
    if (rows.length > 0) {
      return rows;
    }
    // Si no se pudo extraer el detalle, cae al genérico de abajo.
  }

  // 2) Código presente en el catálogo curado.
  const info = parsed.errorCode ? PRODUCT_SAVE_ERROR_MAP[parsed.errorCode] : undefined;
  if (parsed.errorCode && info) {
    let reason = info.reason;

    // PROD_VALIDATE_001 es el ÚNICO código sobrecargado: un mismo código cubre
    // varias violaciones de regla distintas. Anexar el `message` específico del
    // backend ayuda a desambiguar cuál regla falló sin exponerlo en los demás.
    if (parsed.errorCode === 'PROD_VALIDATE_001') {
      const detail = readBackendMessage(err) ?? parsed.devMessage;
      const trimmed = detail?.trim();
      if (trimmed && trimmed !== parsed.errorCode) {
        reason = `${reason} (Detalle: ${trimmed})`;
      }
    }

    return [
      {
        id: parsed.errorCode,
        label: info.label,
        reason,
        severity: 'blocker',
        action: info.actionKind
          ? {
              label: info.actionLabel ?? info.label,
              kind: info.actionKind,
              target: info.actionTarget,
            }
          : undefined,
      },
    ];
  }

  // 3) Código desconocido o error plano (Conflict/NotFound/red).
  const backendMessage = readBackendMessage(err)?.trim();
  return [
    {
      id: 'save-error',
      label: 'No se pudo guardar el producto',
      reason:
        backendMessage && backendMessage.length > 0
          ? backendMessage
          : 'Ocurrió un error al guardar el producto. Revisa los datos e inténtalo de nuevo.',
      severity: 'blocker',
    },
  ];
}

/**
 * Construye una fila `required` por cada campo inválido reportado por el
 * ValidationPipe. Devuelve `[]` si no logra extraer los `validationErrors`.
 */
function buildValidationRequirements(details: unknown): SaveRequirement[] {
  const rawErrors = extractValidationErrors(details);
  if (!rawErrors || rawErrors.length === 0) {
    return [];
  }

  // Agrupa los mensajes por campo para que cada campo inválido sea una sola fila.
  const messagesByField = new Map<string, string[]>();
  for (const item of rawErrors) {
    const { field, message } = normalizeValidationItem(item);
    if (!message) {
      continue;
    }
    const bucket = messagesByField.get(field) ?? [];
    bucket.push(message);
    messagesByField.set(field, bucket);
  }

  const rows: SaveRequirement[] = [];
  for (const [field, messages] of messagesByField) {
    const joined = messages.join(' ');
    const reason = looksEnglish(joined) ? `Revisa este campo: ${joined}` : joined;
    rows.push({
      id: `validation-${field}`,
      label: FIELD_LABELS[field] ?? field,
      reason,
      severity: 'required',
      action: { label: 'Ir al campo', kind: 'focus', target: field },
    });
  }
  return rows;
}

/** Extrae de forma segura el arreglo `validationErrors` de `parsed.details`. */
function extractValidationErrors(details: unknown): ValidationErrorItem[] | null {
  if (!details || typeof details !== 'object') {
    return null;
  }
  const validationErrors = (details as { validationErrors?: unknown }).validationErrors;
  return Array.isArray(validationErrors) ? (validationErrors as ValidationErrorItem[]) : null;
}

/** Normaliza un item de validación (string plano u objeto) a campo + mensaje. */
function normalizeValidationItem(item: ValidationErrorItem): {
  field: string;
  message: string;
} {
  if (typeof item === 'string') {
    return { field: extractFieldFromMessage(item), message: item };
  }
  // Defensivo: algunas configuraciones emiten errores estructurados.
  const field = item.property ?? 'general';
  const message = Object.values(item.constraints ?? {}).join(' ') || field;
  return { field, message };
}

/**
 * Extrae el nombre del campo desde un mensaje del `class-validator`, que por
 * defecto comienza con el nombre de la propiedad (ej. "base_price must be...").
 */
function extractFieldFromMessage(message: string): string {
  const tokens = message.trim().split(/\s+/);
  if (tokens.length === 0 || !tokens[0]) {
    return 'general';
  }
  // `forbidNonWhitelisted` emite "property <campo> should not exist".
  if (tokens[0] === 'property' && tokens.length > 1) {
    return tokens[1];
  }
  return tokens[0];
}

/** Heurística para detectar mensajes de validación en inglés. */
function looksEnglish(message: string): boolean {
  return ENGLISH_VALIDATION_PATTERN.test(message);
}

/**
 * Lee el mensaje humano de un error, cubriendo las formas reales que llegan al
 * componente. El `handleError` de `products.service.ts` aplana el
 * `HttpErrorResponse` a un **string** (perdiendo el `error_code`), así que el
 * caso más común aquí es `err` ya siendo un string. También se cubre `Error` y
 * el `HttpErrorResponse` crudo (`err.error.message`).
 */
function readBackendMessage(err: unknown): string | null {
  if (err === null || err === undefined) {
    return null;
  }
  if (typeof err === 'string') {
    const trimmed = err.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (err instanceof Error && typeof err.message === 'string') {
    const trimmed = err.message.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof err !== 'object') {
    return null;
  }
  const body = (err as { error?: unknown }).error;
  if (body && typeof body === 'object') {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }
  // El propio objeto puede traer el mensaje (VendixHttpException plano).
  const ownMessage = (err as { message?: unknown }).message;
  return typeof ownMessage === 'string' && ownMessage.trim().length > 0
    ? ownMessage.trim()
    : null;
}
