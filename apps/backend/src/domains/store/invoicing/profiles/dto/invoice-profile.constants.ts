import { DIAN_INVOICE_OPERATION_TYPES } from '../../providers/dian-direct/constants/dian-document-types';

/**
 * Valores legales de `invoice_profiles.state`.
 *
 * La columna es `VarChar(20)` y no un enum de Prisma —añadir un estado exigiría
 * `ALTER TYPE ... ADD VALUE`, que no cabe en la misma transacción que otras
 * sentencias— así que ESTA lista es lo único que impide que la columna acepte
 * cualquier cadena. Sin ella, un `state: 'activo'` (en español, por un typo del
 * cliente) se guardaría y el perfil desaparecería del catálogo sin error: el
 * filtro busca `'active'`.
 */
export const INVOICE_PROFILE_STATES = ['active', 'inactive'] as const;
export type InvoiceProfileState = (typeof INVOICE_PROFILE_STATES)[number];

/**
 * Tipos de operación que un perfil puede declarar.
 *
 * Se derivan de `DIAN_INVOICE_OPERATION_TYPES`, que es la fuente única de la
 * tabla del anexo, en vez de repetir los literales. Repetirlos crearía la
 * segunda lista que queda rancia el día que la DIAN añada un código: el perfil
 * lo rechazaría y la factura lo aceptaría, o al revés.
 */
export const INVOICE_PROFILE_OPERATION_TYPES = Object.values(
  DIAN_INVOICE_OPERATION_TYPES,
) as readonly string[];

/** Longitud de `invoice_profiles.name` — `VarChar(150)`. */
export const INVOICE_PROFILE_NAME_MAX_LENGTH = 150;
