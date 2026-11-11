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
    expect(extractDocumentConflict(conflict('document', existing))).toEqual(existing);
  });

  it('ignora el conflicto por email y otros errores', () => {
    expect(extractDocumentConflict(conflict('email', { id: 1 }))).toBeNull();
    expect(extractDocumentConflict({ status: 500, error: {} })).toBeNull();
    expect(extractDocumentConflict(null)).toBeNull();
  });
});
