import { DEFAULT_TOOL_VERSION } from '../interfaces/tool.interface';

/**
 * Adaptador de presentación del contrato `customers` (T6, paso 15).
 *
 * Mudado desde `domains/customers.tools.ts`: `fullName` y `formatDocument`
 * viven aquí, versionados, en vez de inline en la factory.
 *
 * Reglas del adaptador:
 *
 * - `CUSTOMER_ADAPTER_VERSION` implementa la versión del contrato de las
 *   tools (`version: '1'`): si el contrato sube de versión, el adaptador sube
 *   con él en la misma PR.
 * - Degradación honesta: sin nombres, `fullName` devuelve `''` (el llamante
 *   decide el sustituto —nunca un nombre inventado—); sin número de
 *   documento, `formatDocument` devuelve `null` en vez de armar un
 *   "documento" a medias.
 * - Migración que renombre columnas usadas por estos mappers actualiza
 *   adaptador + contrato + spec en la misma PR (ver specs `*.adapter.spec.ts`).
 */

export const CUSTOMER_ADAPTER_VERSION: string = DEFAULT_TOOL_VERSION;

export function fullName(user: {
  first_name?: string;
  last_name?: string;
}): string {
  return [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
}

export function formatDocument(user: {
  document_type?: string | null;
  document_number?: string | null;
}): string | null {
  if (!user.document_number) return null;
  return [user.document_type, user.document_number].filter(Boolean).join(' ');
}
