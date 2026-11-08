import { BoardAllCard, BoardAllColumn, BoardAllQuery } from '../../interfaces/workflow-board.interfaces';

/** The filter bar state; `all` means "no filter". */
export interface BoardAllFilters {
  definition: string;
  role: string;
  location: string;
  overdue: boolean;
}

export const ALL_OPTION = 'all';

/** Query of the general board for the selected filters (ids only when chosen). */
export function buildBoardQuery(filters: BoardAllFilters): BoardAllQuery {
  const id = (v: string) => (v === ALL_OPTION ? undefined : Number(v));
  return {
    ...(id(filters.definition) ? { definition_id: id(filters.definition) } : {}),
    ...(id(filters.role) ? { role_id: id(filters.role) } : {}),
    ...(id(filters.location) ? { location_id: id(filters.location) } : {}),
    ...(filters.overdue ? { overdue: true } : {}),
  };
}

/** Appends the next page of a column to the loaded one, keeping the new cursor. */
export function appendColumnPage(current: BoardAllColumn, next: BoardAllColumn): BoardAllColumn {
  const seen = new Set(current.cards.map((c) => c.id));
  return {
    ...current,
    count: next.count,
    cards: [...current.cards, ...next.cards.filter((c) => !seen.has(c.id))],
    next_cursor: next.next_cursor,
  };
}

/** Spanish names of the system roles; a custom role keeps the name its owner gave it. */
const SYSTEM_ROLE_NAME: Record<string, string> = {
  owner: 'Dueño',
  admin: 'Administrador',
  manager: 'Gerente',
  employee: 'Empleado',
};

export function roleName(name: string): string {
  return SYSTEM_ROLE_NAME[name] ?? name;
}

/** Who must act on a card: the person, or the role in Spanish. */
export function assigneeText(assignee: BoardAllCard['assignee']): string {
  if (!assignee?.name) return 'Sin responsable';
  return assignee.type === 'role' ? `Rol: ${roleName(assignee.name)}` : assignee.name;
}
