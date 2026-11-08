import { VendixHttpException } from '@common/errors';
import { normalizeWorkflowAccess, readWorkflowAccess } from './workflow-access.types';

const codeOf = (fn: () => unknown) => {
  try {
    fn();
    return undefined;
  } catch (e) {
    return (e as VendixHttpException).errorCode;
  }
};

describe('workflow access document', () => {
  it('nothing configured is open (null)', () => {
    expect(normalizeWorkflowAccess(null)).toBeNull();
    expect(normalizeWorkflowAccess(undefined)).toBeNull();
    expect(normalizeWorkflowAccess({})).toBeNull();
  });

  it('empty groups and empty stages mean open and are dropped', () => {
    expect(
      normalizeWorkflowAccess({
        design: { roles: [], user_ids: [] },
        view: { roles: ['manager'], user_ids: [] },
        stages: { approve: { act: { roles: [], user_ids: [] } } },
      }),
    ).toEqual({ view: { roles: ['manager'], user_ids: [] } });
  });

  it('trims and de-duplicates roles and people, missing lists default to empty', () => {
    expect(
      normalizeWorkflowAccess({
        design: { roles: [' manager ', 'manager'], user_ids: [3, 3, 4] },
        stages: { review: { act: { user_ids: [5] } } },
      }),
    ).toEqual({
      design: { roles: ['manager'], user_ids: [3, 4] },
      stages: { review: { act: { roles: [], user_ids: [5] } } },
    });
  });

  it.each([
    ['not an object', 'x'],
    ['unknown top-level key', { start: { roles: ['a'], user_ids: [] } }],
    ['unknown group key', { view: { roles: [], user_ids: [], groups: [] } }],
    ['roles not a list', { view: { roles: 'manager' } }],
    ['blank role', { view: { roles: ['  '] } }],
    ['non-integer user', { view: { user_ids: [1.5] } }],
    ['negative user', { design: { user_ids: [-1] } }],
    ['stage without act object', { stages: { a: 'x' } }],
    ['stage with unknown key', { stages: { a: { view: { roles: ['x'] } } } }],
  ])('rejects %s with WORKFLOW_ACCESS_INVALID', (_name, raw) => {
    expect(codeOf(() => normalizeWorkflowAccess(raw))).toBe('WORKFLOW_ACCESS_INVALID');
  });

  it('reading a stored value that does not parse means no permissions', () => {
    expect(readWorkflowAccess({ nope: true })).toBeNull();
    expect(readWorkflowAccess(null)).toBeNull();
    expect(readWorkflowAccess({ view: { roles: ['manager'], user_ids: [] } })).toEqual({
      view: { roles: ['manager'], user_ids: [] },
    });
  });
});
