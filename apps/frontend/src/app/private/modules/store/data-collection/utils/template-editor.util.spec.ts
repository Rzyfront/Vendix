import {
  defaultItemWidth,
  defaultValidationRules,
  duplicateSectionStructure,
  EditableSection,
  moveInList,
  patchDocumentsRules,
  reindexSortOrder,
  toggleAcceptedKind,
} from './template-editor.util';

function section(title: string, children: EditableSection[] = []): EditableSection {
  return { title, description: 'd', icon: 'i', sort_order: 3, items: [{ metadata_field_id: 1 }], child_sections: children, expanded: false };
}

describe('template-editor.util', () => {
  it('moveInList moves an element and ignores out-of-range targets', () => {
    expect(moveInList([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moveInList([1, 2, 3], 2, 1)).toEqual([1, 3, 2]);
    expect(moveInList([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(moveInList([1, 2, 3], 2, 3)).toEqual([1, 2, 3]);
  });

  it('reindexSortOrder renumbers without mutating the input', () => {
    const input = [{ sort_order: 5 }, { sort_order: 9 }];
    const out = reindexSortOrder(input);
    expect(out.map((e) => e.sort_order)).toEqual([0, 1]);
    expect(input[0].sort_order).toBe(5);
  });

  it('defaultItemWidth uses a full row for long content and half for short inputs', () => {
    expect(defaultItemWidth('textarea')).toBe('100');
    expect(defaultItemWidth('file')).toBe('100');
    expect(defaultItemWidth('text')).toBe('50');
    expect(defaultItemWidth(undefined)).toBe('100');
  });

  it('defaultValidationRules only seeds documents fields', () => {
    expect(defaultValidationRules('text')).toBeNull();
    const rules = defaultValidationRules('file') as { documents: { multiple: boolean; accept: string[] } };
    expect(rules.documents.multiple).toBeFalse();
    expect(rules.documents.accept).toEqual(['pdf', 'image']);
  });

  it('duplicateSectionStructure drops items and ids, keeps the child structure', () => {
    const copy = duplicateSectionStructure(section('Datos', [section('Sub')]));
    expect(copy.title).toBe('Datos (copia)');
    expect(copy.items).toEqual([]);
    expect(copy.expanded).toBeTrue();
    expect(copy.child_sections.length).toBe(1);
    expect(copy.child_sections[0].title).toBe('Sub (copia)');
    expect(copy.child_sections[0].items).toEqual([]);
  });

  it('patchDocumentsRules keeps other rules, clamps the size and never empties the kinds', () => {
    const base = { min: 2, documents: { multiple: false, accept: ['pdf'], max_size_mb: 5 } };
    const out = patchDocumentsRules(base, { multiple: true }) as { min: number; documents: { multiple: boolean; accept: string[]; max_size_mb: number } };
    expect(out.min).toBe(2);
    expect(out.documents.multiple).toBeTrue();
    expect(out.documents.max_size_mb).toBe(5);
    const big = patchDocumentsRules(base, { max_size_mb: 999 }) as { documents: { max_size_mb: number } };
    expect(big.documents.max_size_mb).toBe(20);
    const small = patchDocumentsRules(base, { max_size_mb: 0 }) as { documents: { max_size_mb: number } };
    expect(small.documents.max_size_mb).toBe(1);
    const none = patchDocumentsRules(base, { accept: [] }) as { documents: { accept: string[] } };
    expect(none.documents.accept).toEqual(['pdf']);
  });

  it('patchDocumentsRules on a legacy item (no documents config) starts from the permissive legacy policy', () => {
    const out = patchDocumentsRules({ min: 1 }, { multiple: true }) as { documents: { multiple: boolean; accept: string[]; max_size_mb: number } };
    expect(out.documents.multiple).toBeTrue();
    expect(out.documents.accept).toEqual(['pdf', 'image', 'word', 'excel', 'powerpoint', 'text']);
    expect(out.documents.max_size_mb).toBe(20);
  });

  it('toggleAcceptedKind adds, removes and refuses to empty the list', () => {
    expect(toggleAcceptedKind(['pdf'], 'image')).toEqual(['pdf', 'image']);
    expect(toggleAcceptedKind(['pdf', 'image'], 'pdf')).toEqual(['image']);
    expect(toggleAcceptedKind(['pdf'], 'pdf')).toEqual(['pdf']);
  });
});
