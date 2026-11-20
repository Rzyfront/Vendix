import {
  addUploadedDocument,
  buildFieldResponse,
  documentsToValueInput,
  normalizeDocumentsValue,
  restoreResponseValue,
  toStoredDocument,
} from './document-responses.util';

const doc = { key: 's/1/a.pdf', name: 'a.pdf', size: 10, mime_type: 'application/pdf' };

describe('document-responses.util', () => {
  it('toStoredDocument prefers the server data and falls back to the local file', () => {
    expect(toStoredDocument({ key: 'k', name: 'x.pdf', size: 5, mime_type: 'application/pdf' }, { name: 'y', size: 1, type: 't' })).toEqual({
      key: 'k', name: 'x.pdf', size: 5, mime_type: 'application/pdf',
    });
    expect(toStoredDocument({ key: 'k', originalName: 'orig.pdf' }, { name: 'y', size: 7, type: 'application/pdf' })).toEqual({
      key: 'k', name: 'orig.pdf', size: 7, mime_type: 'application/pdf',
    });
  });

  it('normalizeDocumentsValue accepts lists, a legacy key and empty values', () => {
    expect(normalizeDocumentsValue([doc])).toEqual([doc]);
    const legacy = normalizeDocumentsValue('tienda/1/cedula.png');
    expect(legacy.length).toBe(1);
    expect(legacy[0].key).toBe('tienda/1/cedula.png');
    expect(legacy[0].name).toBe('cedula.png');
    expect(normalizeDocumentsValue('')).toEqual([]);
    expect(normalizeDocumentsValue(null)).toEqual([]);
  });

  it('restoreResponseValue returns the files list or keeps the old precedence', () => {
    expect(restoreResponseValue({ value_text: 'a.pdf', value_json: { files: [doc] } })).toEqual([doc]);
    expect(restoreResponseValue({ value_text: 'legacy-key' })).toBe('legacy-key');
    expect(restoreResponseValue({ value_number: 3 })).toBe(3);
    expect(restoreResponseValue({ value_bool: false })).toBe(false);
  });

  describe('buildFieldResponse', () => {
    it('sends value_text and value_json.files for a documents list', () => {
      const r = buildFieldResponse(9, 'file', [doc, { ...doc, key: 'b' }]);
      expect(r['field_id']).toBe(9);
      expect(r['value_text']).toBe('s/1/a.pdf');
      expect(Array.isArray(r['value_json'])).toBeFalse();
      expect((r['value_json'] as { files: unknown[] }).files.length).toBe(2);
    });

    it('sends null text and an empty files object when nothing is attached', () => {
      const r = buildFieldResponse(9, 'file', []);
      expect(r['value_text']).toBeNull();
      expect(r['value_json']).toEqual({ files: [] });
    });

    it('keeps a legacy single key as value_text only', () => {
      const r = buildFieldResponse(9, 'file', 'legacy-key');
      expect(r['value_text']).toBe('legacy-key');
      expect('value_json' in r).toBeFalse();
    });

    it('keeps the previous behavior of the other types', () => {
      expect(buildFieldResponse(1, 'number', '4.5')['value_number']).toBe(4.5);
      expect(buildFieldResponse(1, 'number', '')['value_number']).toBeNull();
      expect(buildFieldResponse(1, 'checkbox', 'true')['value_bool']).toBeTrue();
      expect(buildFieldResponse(1, 'date', '')['value_date']).toBeNull();
      expect(buildFieldResponse(1, 'text', 'hola')['value_text']).toBe('hola');
      expect(buildFieldResponse(1, 'text', undefined)['value_text']).toBeNull();
    });
  });

  it('addUploadedDocument appends for multiple (bounded) and replaces for single', () => {
    const b = { ...doc, key: 'b' };
    expect(addUploadedDocument([doc], b, true, 10)).toEqual([doc, b]);
    expect(addUploadedDocument([doc], b, false, 10)).toEqual([b]);
    expect(addUploadedDocument([doc, doc], b, true, 2)).toEqual([doc, doc]);
  });

  it('documentsToValueInput sends the first key plus files, or all-null when empty', () => {
    const out = documentsToValueInput([{ ...doc, uploaded_at: 'x' }, { ...doc, key: 'b' }]);
    expect(out.value_text).toBe('s/1/a.pdf');
    expect(out.value_json?.files.length).toBe(2);
    expect(documentsToValueInput([])).toEqual({ value_text: null, value_json: null });
  });
});
