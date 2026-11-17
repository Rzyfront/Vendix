import type {
  BulkJobPageResult,
  BulkJobUserSnapshot,
} from './bulk-upload-job.types';

/**
 * Foto del usuario autenticado para el worker (`validateStoreAccess` lee
 * `id`, `organization_id`, `roles` y `user_roles`). Sin token ni credenciales.
 */
export function snapshotBulkJobUser(user: any): BulkJobUserSnapshot {
  return {
    id: user?.id,
    email: user?.email,
    organization_id: user?.organization_id,
    store_id: user?.store_id,
    roles: Array.isArray(user?.roles) ? user.roles : undefined,
    user_roles: Array.isArray(user?.user_roles)
      ? user.user_roles.map((ur: any) => ({
          id: ur?.id,
          user_id: ur?.user_id,
          role_id: ur?.role_id,
          organization_id: ur?.organization_id,
          store_id: ur?.store_id,
          roles: ur?.roles
            ? { id: ur.roles.id, name: ur.roles.name }
            : undefined,
        }))
      : undefined,
  };
}

/**
 * Resultado paginado de un servicio de carga → página del trabajo. `created`
 * cuenta las filas exitosas cuya `action` es `createdAction` (el tipo que no
 * lo distingue lo deja en `null`).
 */
export function toBulkJobPage(
  result: any,
  createdAction?: string,
): BulkJobPageResult {
  const rows: Array<Record<string, unknown>> = Array.isArray(result?.results)
    ? result.results
    : [];
  return {
    total: Number(result?.total ?? result?.total_processed ?? rows.length) || 0,
    successful: Number(result?.successful) || 0,
    failed: Number(result?.failed) || 0,
    skipped: Number(result?.skipped) || 0,
    created: createdAction
      ? rows.filter((r) => r.status === 'success' && r.action === createdAction)
          .length
      : null,
    rows,
    done: result?.done === true,
  };
}
