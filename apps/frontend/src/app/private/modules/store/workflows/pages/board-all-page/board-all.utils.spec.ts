import { BoardAllCard, BoardAllColumn } from '../../interfaces/workflow-board.interfaces';
import { appendColumnPage, assigneeText, buildBoardQuery, roleName } from './board-all.utils';

const card = (id: number): BoardAllCard => ({
  id,
  reference: `FLU-${id}`,
  title: 'Compra',
  status: 'active',
  definition: { id: 1, name: 'Compras' },
  stage_key: 'manager',
  stage_name: 'Gerencia',
  assignee: null,
  stage_due_at: null,
  overdue: false,
  location: null,
});

describe('board-all utils', () => {
  it('sin filtros no manda ningún parámetro', () => {
    expect(buildBoardQuery({ definition: 'all', role: 'all', location: 'all', overdue: false })).toEqual({});
  });

  it('manda solo los filtros elegidos como números', () => {
    expect(buildBoardQuery({ definition: '3', role: 'all', location: '7', overdue: true })).toEqual({
      definition_id: 3,
      location_id: 7,
      overdue: true,
    });
    expect(buildBoardQuery({ definition: 'all', role: '2', location: 'all', overdue: false })).toEqual({ role_id: 2 });
  });

  it('appendColumnPage suma la página siguiente sin repetir tarjetas', () => {
    const current: BoardAllColumn = { key: 'pending', name: 'Por atender', count: 3, cards: [card(3), card(2)], next_cursor: 2 };
    const next: BoardAllColumn = { key: 'pending', name: 'Por atender', count: 3, cards: [card(2), card(1)], next_cursor: null };
    const merged = appendColumnPage(current, next);
    expect(merged.cards.map((c) => c.id)).toEqual([3, 2, 1]);
    expect(merged.next_cursor).toBeNull();
  });

  it('roleName traduce los roles de sistema y deja los propios como están', () => {
    expect(roleName('manager')).toBe('Gerente');
    expect(roleName('owner')).toBe('Dueño');
    expect(roleName('Auxiliar contable')).toBe('Auxiliar contable');
  });

  it('assigneeText muestra la persona, el rol en español o "Sin responsable"', () => {
    expect(assigneeText({ type: 'user', id: 2, name: 'Carlos Rodríguez' })).toBe('Carlos Rodríguez');
    expect(assigneeText({ type: 'role', id: 3, name: 'admin' })).toBe('Rol: Administrador');
    expect(assigneeText(null)).toBe('Sin responsable');
  });
});
