import { VendixHttpException } from '@common/errors';
import {
  buildWorkflowKit,
  seedPeople,
  seedWorkGroup,
} from '../../../testing/workflows/workflow-test-kit';

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as VendixHttpException).errorCode ?? (e as any).code;
  }
}

describe('WorkGroupsService', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  beforeEach(() => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
  });
  afterEach(() => jest.restoreAllMocks());

  it('availableMemberIds devuelve solo a los disponibles, en orden de alta', async () => {
    const g = seedWorkGroup(kit.db, 'ops', [6, 4, 5], { unavailable: [4] });
    expect(await kit.groups.availableMemberIds(g.id)).toEqual([6, 5]);
  });

  it('crea grupos con la tienda del contexto y rechaza clave o nombre duplicado', async () => {
    const g = await kit.groups.create({ key: 'ventas', name: 'Ventas' });
    expect(g).toMatchObject({ store_id: 1, organization_id: 1, key: 'ventas', assignment_strategy: 'round_robin' });
    expect(await codeOf(kit.groups.create({ key: 'ventas', name: 'Otra' }))).toBe('WORKFLOW_GROUP_DUPLICATE');
    expect(await codeOf(kit.groups.create({ key: 'Mala Clave', name: 'X' }))).toBe('SYS_VALIDATION_001');
  });

  it('agrega miembros solo si son de la tienda y actualiza su disponibilidad', async () => {
    const g = seedWorkGroup(kit.db, 'ops', []);
    expect(await codeOf(kit.groups.setMember(g.id, { user_id: 7 }))).toBe('WORKFLOW_GROUP_MEMBER_INVALID');
    await kit.groups.setMember(g.id, { user_id: 4 });
    await kit.groups.setMember(g.id, { user_id: 4, is_available: false });
    expect(await kit.groups.availableMemberIds(g.id)).toEqual([]);
    expect(kit.db.table('work_group_members')).toHaveLength(1);
    expect(await kit.groups.removeMember(g.id, 4)).toEqual({ removed: 1 });
  });

  it('un grupo de otra tienda no se ve ni se modifica', async () => {
    const other = seedWorkGroup(kit.db, 'ajeno', [7], { storeId: 2 });
    expect(await codeOf(kit.groups.get(other.id))).toBe('WORKFLOW_GROUP_NOT_FOUND');
    expect(await codeOf(kit.groups.update(other.id, { name: 'x' }))).toBe('WORKFLOW_GROUP_NOT_FOUND');
    expect(await codeOf(kit.groups.setMember(other.id, { user_id: 4 }))).toBe('WORKFLOW_GROUP_NOT_FOUND');
  });
});
