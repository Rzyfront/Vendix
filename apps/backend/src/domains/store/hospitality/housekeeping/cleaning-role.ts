import { HOUSEKEEPER_ROLE } from '@common/constants/lodging-roles.constant';

/**
 * Agenda unificada (F3) — the fixed cleaning role. Its users head the list
 * recommended when a check-out suggests the room's clean.
 *
 * The role already exists as the system role `housekeeper` (seeded by
 * `permissions-roles.seed.ts`); only its display name is pending. The
 * internal keys can be overridden without a deploy of the seed through
 * `LODGING_CLEANING_ROLE_NAMES` (comma separated role names); an empty or
 * missing value falls back to `housekeeper`.
 */
export const CLEANING_ROLE_ENV = 'LODGING_CLEANING_ROLE_NAMES';

export function cleaningRoleNames(env: NodeJS.ProcessEnv = process.env): string[] {
  const names = (env[CLEANING_ROLE_ENV] ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);
  return names.length > 0 ? [...new Set(names)] : [HOUSEKEEPER_ROLE];
}

/**
 * Permission that lets a user see and finish her own cleaning tasks
 * ("Mis tareas"). Anyone holding it may receive a check-out clean, after the
 * cleaning role.
 */
export const HOUSEKEEPING_OPERATE_PERMISSION = 'store:lodging:housekeeping:operate';
