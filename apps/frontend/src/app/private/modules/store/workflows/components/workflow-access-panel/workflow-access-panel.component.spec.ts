import { accessFromDrafts, draftsFromAccess } from './workflow-access-panel.component';

describe('workflow access panel drafts', () => {
  it('turns the server document into per-section drafts', () => {
    const drafts = draftsFromAccess({
      design: { roles: ['manager'], user_ids: [] },
      stages: { review: { act: { roles: [], user_ids: [7] } } },
    });
    expect(drafts['design']).toEqual({ roles: ['manager'], users: [] });
    expect(drafts['stage:review']).toEqual({ roles: [], users: [7] });
    expect(drafts['view']).toBeUndefined();
  });

  it('round-trips a document', () => {
    const doc = {
      view: { roles: ['seller'], user_ids: [3] },
      stages: { review: { act: { roles: ['manager'], user_ids: [] } } },
    };
    expect(accessFromDrafts(draftsFromAccess(doc))).toEqual(doc);
  });

  it('drops empty sections and returns null when nothing is restricted', () => {
    expect(
      accessFromDrafts({
        design: { roles: [], users: [] },
        'stage:review': { roles: [], users: [] },
      }),
    ).toBeNull();
    expect(draftsFromAccess(null)).toEqual({});
  });
});
