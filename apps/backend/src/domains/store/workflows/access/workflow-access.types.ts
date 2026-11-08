import { ErrorCodes, VendixHttpException } from '@common/errors';

/** Roles (by name, like `start_roles`) and people allowed to do something. */
export interface WorkflowAccessGroup {
  roles: string[];
  user_ids: number[];
}

/**
 * Per-flow permissions (flujos-adm P7.3), stored in `workflow_definitions.access`.
 * `NULL` in the column (or no key at all) means open: every behavior stays as
 * before the flow had permissions. Who STARTS a flow is not here: it stays the
 * `start_roles` of the published contract.
 */
export interface WorkflowAccess {
  design?: WorkflowAccessGroup;
  view?: WorkflowAccessGroup;
  stages?: Record<string, { act: WorkflowAccessGroup }>;
}

const MAX_ROLES = 50;
const MAX_USERS = 200;
const MAX_STAGES = 100;
const MAX_ROLE_LENGTH = 100;
const TOP_KEYS = new Set(['design', 'view', 'stages']);

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function invalid(message: string): never {
  throw new VendixHttpException(ErrorCodes.WORKFLOW_ACCESS_INVALID, message);
}

function group(raw: unknown, where: string): WorkflowAccessGroup | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isObj(raw)) invalid(`${where}: debe indicar roles y personas.`);
  for (const k of Object.keys(raw)) {
    if (k !== 'roles' && k !== 'user_ids') invalid(`${where}: la propiedad "${k}" no existe.`);
  }
  const rawRoles = raw.roles ?? [];
  const rawUsers = raw.user_ids ?? [];
  if (!Array.isArray(rawRoles) || !Array.isArray(rawUsers)) {
    invalid(`${where}: roles y personas deben ser listas.`);
  }
  const roles = [
    ...new Set(
      rawRoles.map((r) => {
        if (typeof r !== 'string' || !r.trim() || r.trim().length > MAX_ROLE_LENGTH) {
          invalid(`${where}: un rol no es válido.`);
        }
        return r.trim();
      }),
    ),
  ];
  const user_ids = [
    ...new Set(
      rawUsers.map((u) => {
        if (typeof u !== 'number' || !Number.isInteger(u) || u <= 0) {
          invalid(`${where}: una persona no es válida.`);
        }
        return u;
      }),
    ),
  ];
  if (roles.length > MAX_ROLES || user_ids.length > MAX_USERS) {
    invalid(`${where}: hay demasiados roles o personas.`);
  }
  // Empty = open: an empty group is the same as no group.
  return roles.length || user_ids.length ? { roles, user_ids } : undefined;
}

/**
 * Validates the SHAPE of an access document and returns its canonical form
 * (empty groups dropped), or `null` when nothing is restricted. Existence of
 * roles, people and stages is checked against the store by the service.
 */
export function normalizeWorkflowAccess(raw: unknown): WorkflowAccess | null {
  if (raw === undefined || raw === null) return null;
  if (!isObj(raw)) invalid('Los permisos deben ser un objeto.');
  for (const k of Object.keys(raw)) {
    if (!TOP_KEYS.has(k)) invalid(`La propiedad "${k}" no existe.`);
  }
  const out: WorkflowAccess = {};
  const design = group(raw.design, 'Quién diseña');
  if (design) out.design = design;
  const view = group(raw.view, 'Quién ve');
  if (view) out.view = view;
  if (raw.stages !== undefined && raw.stages !== null) {
    if (!isObj(raw.stages)) invalid('Las etapas deben ser un objeto.');
    const entries = Object.entries(raw.stages);
    if (entries.length > MAX_STAGES) invalid('Hay demasiadas etapas.');
    const stages: Record<string, { act: WorkflowAccessGroup }> = {};
    for (const [key, value] of entries) {
      if (!isObj(value)) invalid(`Etapa "${key}": debe indicar quién decide.`);
      for (const k of Object.keys(value)) {
        if (k !== 'act') invalid(`Etapa "${key}": la propiedad "${k}" no existe.`);
      }
      const act = group(value.act, `Etapa "${key}": quién decide`);
      if (act) stages[key] = { act };
    }
    if (Object.keys(stages).length) out.stages = stages;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Reads the stored column. Only this module writes it (already normalized),
 * so anything that does not parse is treated as "no permissions".
 */
export function readWorkflowAccess(raw: unknown): WorkflowAccess | null {
  try {
    return normalizeWorkflowAccess(raw);
  } catch {
    return null;
  }
}

export function accessUserIds(access: WorkflowAccess): number[] {
  const groups: Array<WorkflowAccessGroup | undefined> = [
    access.design,
    access.view,
    ...Object.values(access.stages ?? {}).map((s) => s.act),
  ];
  return [...new Set(groups.flatMap((g) => g?.user_ids ?? []))];
}

export function accessRoleNames(access: WorkflowAccess): string[] {
  const groups: Array<WorkflowAccessGroup | undefined> = [
    access.design,
    access.view,
    ...Object.values(access.stages ?? {}).map((s) => s.act),
  ];
  return [...new Set(groups.flatMap((g) => g?.roles ?? []))];
}
