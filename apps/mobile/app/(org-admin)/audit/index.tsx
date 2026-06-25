import { Redirect } from 'expo-router';

/**
 * Entrada del módulo Auditoría.
 *
 * En la web (`/admin/audit`) no existe un hub con 4 cards; se entra
 * directamente a Registros de auditoría (`/admin/audit/logs`).
 * Acá replicamos eso: al tocar "Auditoría y Cumplimiento" en el drawer,
 * Redirect envía al usuario directo a la pantalla de logs.
 */
export default function AuditIndex() {
  return <Redirect href="/(org-admin)/audit/logs" />;
}
