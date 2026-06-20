import { colorScales } from '@/shared/theme';
import type {
  AuditLogAction,
  AuditLogResource,
  AuditLog,
  ActiveSession,
  LoginAttempt,
} from '@/core/models/org-admin/audit.types';

// ─────────────────────────────────────────────────────────────────────────────
// Action labels + colors (espejo del `actionLabels` + `badgeConfig.colorMap`
// en `logs.component.ts` de la web).
// ─────────────────────────────────────────────────────────────────────────────

export const ACTION_LABELS: Record<string, string> = {
  CREATE: 'Creación',
  UPDATE: 'Actualización',
  DELETE: 'Eliminación',
  LOGIN: 'Inicio de sesión',
  LOGOUT: 'Cierre de sesión',
  PASSWORD_CHANGE: 'Cambio de contraseña',
  EMAIL_VERIFY: 'Correo verificado',
  ONBOARDING_COMPLETE: 'Onboarding completo',
  PERMISSION_CHANGE: 'Cambio de permisos',
  LOGIN_FAILED: 'Login fallido',
  ACCOUNT_LOCKED: 'Cuenta bloqueada',
  ACCOUNT_UNLOCKED: 'Cuenta desbloqueada',
  SUSPICIOUS_ACTIVITY: 'Actividad sospechosa',
  PASSWORD_RESET: 'Restablecimiento de contraseña',
  VIEW: 'Consulta',
  SEARCH: 'Búsqueda',
};

export const ACTION_COLORS: Record<string, string> = {
  CREATE: colorScales.green[600],
  UPDATE: colorScales.blue[600],
  DELETE: colorScales.red[600],
  LOGIN: colorScales.blue[700],
  LOGOUT: colorScales.gray[500],
  LOGIN_FAILED: colorScales.amber[600],
  PASSWORD_CHANGE: colorScales.blue[500],
  PASSWORD_RESET: colorScales.amber[700],
  ACCOUNT_LOCKED: colorScales.red[600],
  ACCOUNT_UNLOCKED: colorScales.green[600],
  SUSPICIOUS_ACTIVITY: colorScales.red[600],
  PERMISSION_CHANGE: colorScales.blue[700],
  EMAIL_VERIFY: colorScales.green[500],
  ONBOARDING_COMPLETE: colorScales.green[600],
  VIEW: colorScales.gray[600],
  SEARCH: colorScales.gray[500],
};

export function formatAction(action: string): string {
  return ACTION_LABELS[action] || action.replace(/_/g, ' ');
}

export function getActionColor(action: string): string {
  return ACTION_COLORS[action] ?? colorScales.gray[500];
}

export function getActionIcon(action: string): string {
  switch (action) {
    case 'CREATE':
      return 'plus';
    case 'UPDATE':
      return 'edit-2';
    case 'DELETE':
      return 'trash-2';
    case 'LOGIN':
      return 'log-in';
    case 'LOGOUT':
      return 'log-out';
    case 'PASSWORD_CHANGE':
    case 'PASSWORD_RESET':
      return 'key';
    case 'EMAIL_VERIFY':
      return 'mail';
    case 'ONBOARDING_COMPLETE':
      return 'user-check';
    case 'PERMISSION_CHANGE':
      return 'shield';
    case 'LOGIN_FAILED':
      return 'log-in';
    case 'ACCOUNT_LOCKED':
      return 'lock';
    case 'ACCOUNT_UNLOCKED':
      return 'unlock';
    case 'SUSPICIOUS_ACTIVITY':
      return 'alert-triangle';
    case 'VIEW':
      return 'eye';
    case 'SEARCH':
      return 'search';
    default:
      return 'activity';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Resource labels
// ─────────────────────────────────────────────────────────────────────────────

export const RESOURCE_LABELS: Record<string, string> = {
  users: 'Usuarios',
  organizations: 'Organizaciones',
  stores: 'Tiendas',
  domain_settings: 'Dominios',
  products: 'Productos',
  orders: 'Pedidos',
  auth: 'Autenticación',
  roles: 'Roles',
  permissions: 'Permisos',
  system: 'Sistema',
  settings: 'Configuración',
};

export function formatResource(resource: string): string {
  return RESOURCE_LABELS[resource] || resource.replace(/_/g, ' ');
}

export function getResourceIcon(resource: string): string {
  switch (resource) {
    case 'users':
      return 'user';
    case 'organizations':
      return 'building';
    case 'stores':
      return 'store';
    case 'domain_settings':
      return 'globe';
    case 'products':
      return 'package';
    case 'orders':
      return 'shopping-cart';
    case 'auth':
      return 'shield';
    case 'roles':
      return 'users';
    case 'permissions':
      return 'key';
    case 'system':
      return 'server';
    case 'settings':
      return 'settings';
    default:
      return 'box';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Listas para filtros (ordenadas, con "Todos" prepended por el modal)
// ─────────────────────────────────────────────────────────────────────────────

export const AUDIT_ACTION_OPTIONS: { value: AuditLogAction; label: string }[] = ([
  'CREATE',
  'UPDATE',
  'DELETE',
  'LOGIN',
  'LOGOUT',
  'LOGIN_FAILED',
  'ACCOUNT_LOCKED',
  'ACCOUNT_UNLOCKED',
  'SUSPICIOUS_ACTIVITY',
  'PASSWORD_CHANGE',
  'PASSWORD_RESET',
  'EMAIL_VERIFY',
  'ONBOARDING_COMPLETE',
  'PERMISSION_CHANGE',
  'VIEW',
  'SEARCH',
] as AuditLogAction[]).map((value) => ({ value, label: ACTION_LABELS[value] }));

export const AUDIT_RESOURCE_OPTIONS: { value: AuditLogResource; label: string }[] = ([
  'users',
  'organizations',
  'stores',
  'domain_settings',
  'products',
  'orders',
  'auth',
  'roles',
  'permissions',
  'system',
  'settings',
] as AuditLogResource[]).map((value) => ({ value, label: RESOURCE_LABELS[value] }));

// ─────────────────────────────────────────────────────────────────────────────
// LoginAttempt status
// ─────────────────────────────────────────────────────────────────────────────

export const LOGIN_ATTEMPT_STATUS_LABELS = {
  SUCCESS: 'Exitoso',
  FAILED: 'Fallido',
  BLOCKED: 'Bloqueado',
} as const;

export function getLoginAttemptStatusColor(status: LoginAttempt['status']): string {
  switch (status) {
    case 'SUCCESS':
      return colorScales.green[600];
    case 'FAILED':
      return colorScales.red[600];
    case 'BLOCKED':
      return colorScales.amber[600];
    default:
      return colorScales.gray[500];
  }
}

export function getLoginAttemptStatusIcon(status: LoginAttempt['status']): string {
  switch (status) {
    case 'SUCCESS':
      return 'check-circle';
    case 'FAILED':
      return 'x-circle';
    case 'BLOCKED':
      return 'shield-alert';
    default:
      return 'help-circle';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session
// ─────────────────────────────────────────────────────────────────────────────

export function isSessionActive(session: ActiveSession): boolean {
  if (typeof session.is_active === 'boolean') return session.is_active;
  if (session.expires_at) {
    return new Date(session.expires_at).getTime() > Date.now();
  }
  return true;
}

export function getDeviceIcon(device?: string | null): string {
  if (!device) return 'monitor';
  if (/mobile|android|iphone|ipad/i.test(device)) return 'smartphone';
  return 'monitor';
}

// ─────────────────────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────────────────────

export function formatUser(log: AuditLog): string {
  if (log.users) return `${log.users.first_name} ${log.users.last_name}`.trim();
  if (log.user_name) return log.user_name;
  if (log.user_email) return log.user_email;
  return 'Sistema';
}

export function formatSessionUser(session: ActiveSession): string {
  if (session.users) return `${session.users.first_name} ${session.users.last_name}`.trim();
  if (session.user_name) return session.user_name;
  if (session.user_email) return session.user_email;
  return 'Usuario';
}
