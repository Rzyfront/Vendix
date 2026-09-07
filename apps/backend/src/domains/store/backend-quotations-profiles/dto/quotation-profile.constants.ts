/**
 * Valores legales de `quotation_profiles.state`.
 *
 * La columna es `VarChar(20)` y no un enum de Prisma —igual que
 * `invoice_profiles.state`— así que ESTA lista es lo único que impide que la
 * columna acepte cualquier cadena. Sin ella, un `state: 'activo'` se
 * guardaría y el perfil desaparecería del catálogo sin error: el filtro
 * busca `'active'`.
 */
export const QUOTATION_PROFILE_STATES = ['active', 'inactive'] as const;
export type QuotationProfileState =
  (typeof QUOTATION_PROFILE_STATES)[number];

/** Longitud de `quotation_profiles.name` — `VarChar(150)`. */
export const QUOTATION_PROFILE_NAME_MAX_LENGTH = 150;
