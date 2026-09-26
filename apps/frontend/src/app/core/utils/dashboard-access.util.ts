import { AuthFacade } from '../store/auth/auth.facade';

/**
 * Roles that always have dashboard access (regardless of granular permission).
 */
export const DASHBOARD_TRUSTED_ROLES = [
  'owner',
  'admin',
  'super_admin',
  'STORE_OWNER',
  'ORG_OWNER',
  'manager',
];

/**
 * Permission codes that unlock the dashboard. Try the canonical one first,
 * fall back to analytics-read since the dashboard depends on those endpoints.
 */
export const DASHBOARD_REQUIRED_PERMISSIONS = [
  'store:dashboard:view',
  'store:analytics:read',
];

/**
 * Determines whether a user has authorization to access the main store dashboard.
 */
export function canUserAccessDashboard(
  authFacade: Pick<AuthFacade, 'isOwner' | 'isAdmin' | 'hasAnyRole' | 'hasAnyPermission'>,
): boolean {
  return (
    authFacade.isOwner() ||
    authFacade.isAdmin() ||
    authFacade.hasAnyRole(DASHBOARD_TRUSTED_ROLES) ||
    authFacade.hasAnyPermission(DASHBOARD_REQUIRED_PERMISSIONS)
  );
}
