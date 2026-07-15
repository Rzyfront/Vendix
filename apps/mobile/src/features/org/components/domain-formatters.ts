/**
 * Formatters para la sección Dominios de ORG_ADMIN.
 *
 * Espejo de los formatters inline en
 * `apps/frontend/src/app/private/modules/organization/domains/domains.component.ts`
 * (formatAppType / formatOwnership / formatStatus / formatSslStatus + colorMaps).
 *
 * Mantenerlos centralizados evita que los modales, la lista y la pantalla de
 * detalle diverjan y muestren valores distintos para el mismo campo.
 *
 * El cambio de un valor nuevo (ej. un `DomainStatus` agregado por el backend)
 * se hace en un único lugar: este archivo.
 */

import type {
  AppType,
  DomainOwnership,
  DomainStatus,
  SslStatus,
} from '@/core/models/org-admin/domains.types';

const APP_TYPE_LABELS: Record<AppType, string> = {
  STORE_ECOMMERCE: 'E-commerce',
  STORE_LANDING: 'Landing de Tienda',
  STORE_ADMIN: 'Admin de Tienda',
  ORG_LANDING: 'Landing de Organización',
  ORG_ADMIN: 'Admin de Organización',
};

const APP_TYPE_COLORS: Record<AppType, string> = {
  STORE_ECOMMERCE: '#3b82f6',
  STORE_LANDING: '#22c55e',
  STORE_ADMIN: '#8b5cf6',
  ORG_LANDING: '#06b6d4',
  ORG_ADMIN: '#f59e0b',
};

const OWNERSHIP_LABELS: Record<DomainOwnership, string> = {
  VENDIX_SUBDOMAIN: 'Subdominio Vendix',
  CUSTOM_DOMAIN: 'Dominio Personalizado',
  CUSTOM_SUBDOMAIN: 'Subdominio Personalizado',
  THIRD_PARTY_SUBDOMAIN: 'Subdominio Terceros',
};

const OWNERSHIP_COLORS: Record<DomainOwnership, string> = {
  VENDIX_SUBDOMAIN: '#22c55e',
  CUSTOM_DOMAIN: '#3b82f6',
  CUSTOM_SUBDOMAIN: '#8b5cf6',
  THIRD_PARTY_SUBDOMAIN: '#f59e0b',
};

const STATUS_LABELS: Record<DomainStatus, string> = {
  PENDING: 'Pendiente',
  VERIFYING: 'Verificando',
  PENDING_DNS: 'DNS Pendiente',
  PENDING_OWNERSHIP: 'Propiedad pendiente',
  VERIFYING_OWNERSHIP: 'Verificando propiedad',
  PENDING_SSL: 'SSL Pendiente',
  PENDING_CERTIFICATE: 'Certificado pendiente',
  ISSUING_CERTIFICATE: 'Emitiendo certificado',
  PENDING_ALIAS: 'Conectando dominio',
  PROPAGATING: 'Propagando SSL',
  FAILED: 'Falló',
  FAILED_OWNERSHIP: 'Falló propiedad',
  FAILED_CERTIFICATE: 'Falló certificado',
  FAILED_ALIAS: 'Falló alias',
  EXPIRED: 'Expirado',
  ACTIVE: 'Activo',
  DISABLED: 'Deshabilitado',
};

const STATUS_COLORS: Record<DomainStatus, string> = {
  PENDING: '#f59e0b',
  VERIFYING: '#f59e0b',
  PENDING_DNS: '#f59e0b',
  PENDING_OWNERSHIP: '#f59e0b',
  VERIFYING_OWNERSHIP: '#f59e0b',
  PENDING_SSL: '#f97316',
  PENDING_CERTIFICATE: '#f97316',
  ISSUING_CERTIFICATE: '#f97316',
  PENDING_ALIAS: '#6366f1',
  PROPAGATING: '#06b6d4',
  FAILED: '#ef4444',
  FAILED_OWNERSHIP: '#ef4444',
  FAILED_CERTIFICATE: '#ef4444',
  FAILED_ALIAS: '#ef4444',
  EXPIRED: '#ef4444',
  ACTIVE: '#22c55e',
  DISABLED: '#ef4444',
};

const SSL_STATUS_LABELS: Record<SslStatus, string> = {
  PENDING: 'Pendiente',
  PROVISIONING: 'Aprovisionando',
  ISSUED: 'Emitido',
  ACTIVE: 'Activo',
  NONE: 'Sin SSL',
  ERROR: 'Error',
  REVOKED: 'Revocado',
  FAILED: 'Falló',
  EXPIRED: 'Expirado',
};

const SSL_STATUS_COLORS: Record<SslStatus, string> = {
  PENDING: '#f59e0b',
  PROVISIONING: '#f97316',
  ISSUED: '#22c55e',
  ACTIVE: '#22c55e',
  NONE: '#9ca3af',
  ERROR: '#ef4444',
  REVOKED: '#dc2626',
  FAILED: '#ef4444',
  EXPIRED: '#ef4444',
};

export function formatAppType(type: AppType | string | null | undefined): string {
  if (!type) return 'N/A';
  return APP_TYPE_LABELS[type as AppType] ?? String(type);
}

export function getAppTypeColor(type: AppType | string | null | undefined): string {
  if (!type) return '#9ca3af';
  return APP_TYPE_COLORS[type as AppType] ?? '#9ca3af';
}

export function formatOwnership(ownership: DomainOwnership | string | null | undefined): string {
  if (!ownership) return 'N/A';
  return OWNERSHIP_LABELS[ownership as DomainOwnership] ?? String(ownership);
}

export function getOwnershipColor(ownership: DomainOwnership | string | null | undefined): string {
  if (!ownership) return '#9ca3af';
  return OWNERSHIP_COLORS[ownership as DomainOwnership] ?? '#9ca3af';
}

export function formatStatus(status: DomainStatus | string | null | undefined): string {
  if (!status) return 'Desconocido';
  return STATUS_LABELS[status as DomainStatus] ?? String(status);
}

export function getStatusColor(status: DomainStatus | string | null | undefined): string {
  if (!status) return '#9ca3af';
  return STATUS_COLORS[status as DomainStatus] ?? '#9ca3af';
}

export function formatSslStatus(status: SslStatus | string | null | undefined): string {
  if (!status) return 'N/A';
  return SSL_STATUS_LABELS[status as SslStatus] ?? String(status);
}

export function getSslStatusColor(status: SslStatus | string | null | undefined): string {
  if (!status) return '#9ca3af';
  return SSL_STATUS_COLORS[status as SslStatus] ?? '#9ca3af';
}

/** Opciones para el dropdown de status en filtros y en el modal crear. */
export const DOMAIN_STATUS_OPTIONS: Array<{ value: DomainStatus; label: string }> = (
  Object.keys(STATUS_LABELS) as DomainStatus[]
).map((value) => ({ value, label: STATUS_LABELS[value] }));

/** Opciones para el dropdown de ownership. */
export const DOMAIN_OWNERSHIP_OPTIONS: Array<{ value: DomainOwnership; label: string }> = (
  Object.keys(OWNERSHIP_LABELS) as DomainOwnership[]
).map((value) => ({ value, label: OWNERSHIP_LABELS[value] }));

/** Opciones para el dropdown de app_type. */
export const APP_TYPE_OPTIONS: Array<{ value: AppType; label: string }> = (
  Object.keys(APP_TYPE_LABELS) as AppType[]
).map((value) => ({ value, label: APP_TYPE_LABELS[value] }));