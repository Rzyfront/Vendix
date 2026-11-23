/**
 * T13 (N4) — "Vex explains the limit". Turns the permissions a role lacks
 * (`AIToolRegistry.getDeniedPermissions`) into a short list of AREAS and a
 * Spanish prompt fragment, so the model answers «tu rol no permite X; pídeselo
 * al dueño» instead of a generic «no puedo». Tool names are never exposed.
 */

export interface RoleDeniedArea {
  /** Business area, e.g. `orders`. */
  area: string;
  /** Sorted, deduplicated actions the role lacks in that area, e.g. `cancel`. */
  actions: string[];
}

/** Scope prefixes that are not part of the area name. */
const SCOPE_PREFIXES = new Set(['store', 'organization', 'org', 'platform']);

/** Keeps the fragment short even for a very restricted role. */
const MAX_AREAS = 15;

function parsePermission(permission: string): { area: string; action?: string } {
  const parts = permission.split(':').filter((p) => p.length > 0);
  if (parts.length === 0) return { area: '' };
  const rest =
    parts.length >= 3 && SCOPE_PREFIXES.has(parts[0]) ? parts.slice(1) : parts;
  if (rest.length === 1) return { area: rest[0] };
  return { area: rest[0], action: rest.slice(1).join('.') };
}

/** Groups `store:<area>[:<sub>]:<action>` permissions by area (sorted). */
export function roleDeniedAreas(deniedPermissions: string[]): RoleDeniedArea[] {
  const byArea = new Map<string, Set<string>>();
  for (const permission of deniedPermissions ?? []) {
    const { area, action } = parsePermission(String(permission));
    if (!area) continue;
    const actions = byArea.get(area) ?? new Set<string>();
    if (action) actions.add(action);
    byArea.set(area, actions);
  }
  return [...byArea.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([area, actions]) => ({ area, actions: [...actions].sort() }));
}

/** Spanish system-prompt fragment, or `null` when the role lacks nothing. */
export function roleDeniedAreasPrompt(
  deniedPermissions: string[],
): string | null {
  const areas = roleDeniedAreas(deniedPermissions);
  if (areas.length === 0) return null;
  const shown = areas
    .slice(0, MAX_AREAS)
    .map((a) => (a.actions.length ? `${a.area} (${a.actions.join(', ')})` : a.area));
  const extra = areas.length - shown.length;
  const list = extra > 0 ? `${shown.join(', ')} y ${extra} más` : shown.join(', ');
  return `Áreas que el rol de este usuario no permite: ${list}. Si pide algo de estas áreas, responde «tu rol no permite <acción>; pídeselo al dueño», sin proponer tarjeta ni llamar herramientas.`;
}
