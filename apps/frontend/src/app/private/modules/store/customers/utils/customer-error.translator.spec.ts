import { extractDocumentConflict } from './customer-error.translator';

describe('extractDocumentConflict', () => {
  const conflict = (kind: string, existing?: unknown) => ({
    status: 409,
    error: {
      error_code: 'SYS_CONFLICT_001',
      details: { kind, existing_customer: existing },
    },
  });

  it('devuelve el cliente existente en un conflicto por documento', () => {
    const existing = { id: 7, legal_name: 'ACME SAS', document_number: '900123' };
    expect(extractDocumentConflict(conflict('document', existing))).toEqual({
      ...existing,
      matched_by: ['document'],
      other_matches: [],
    });
  });

  it('también devuelve el cliente cuando coincide por correo (S8)', () => {
    expect(extractDocumentConflict(conflict('email', { id: 1 }))).toEqual({
      id: 1,
      matched_by: ['email'],
      other_matches: [],
    });
  });

  it('ignora otros errores', () => {
    expect(extractDocumentConflict({ status: 500, error: {} })).toBeNull();
    expect(extractDocumentConflict(null)).toBeNull();
  });
});
