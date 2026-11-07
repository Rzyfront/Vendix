import {
  appendToken,
  isValidOutputPath,
  outputFields,
  toOutputRecord,
  usedFieldKeys,
} from './http-action.utils';

describe('http-action.utils', () => {
  it('usedFieldKeys finds each {{fields.x}} once in url, headers and body', () => {
    expect(
      usedFieldKeys({
        url: 'https://a.test/{{fields.id}}',
        headers: 'X: {{ fields.id }}\nY: {{fields.otro}} {{secrets.TOKEN}}',
        body: '{"a":"{{fields.nombre}}"}',
        method: 'POST',
      }),
    ).toEqual(['id', 'otro', 'nombre']);
  });

  it('appendToken starts a new line only in headers', () => {
    expect(appendToken('', '{{secrets.A}}', 'headers')).toBe('{{secrets.A}}');
    expect(appendToken('X: 1', 'Authorization: {{secrets.A}}', 'headers')).toBe('X: 1\nAuthorization: {{secrets.A}}');
    expect(appendToken('https://a.test/', '{{fields.id}}', 'url')).toBe('https://a.test/{{fields.id}}');
  });

  it('toOutputRecord keeps complete rows with a valid path only', () => {
    expect(
      toOutputRecord([
        { field: 'crm_id', path: ' body.id ' },
        { field: 'x', path: 'body..bad' },
        { field: '', path: 'status' },
        { field: 'estado', path: 'status' },
      ]),
    ).toEqual({ crm_id: 'body.id', estado: 'status' });
    expect(isValidOutputPath('headers.x-request-id')).toBeTrue();
    expect(isValidOutputPath('body.items.0.name')).toBeTrue();
    expect(isValidOutputPath('headers.X_Upper')).toBeFalse();
  });

  it('outputFields leaves out calculated fields, files, users and multiselects', () => {
    const fields = [
      { key: 'a', type: 'text', label: 'A' },
      { key: 'b', type: 'number', label: 'B', compute: '1+1' },
      { key: 'c', type: 'file', label: 'C' },
      { key: 'd', type: 'user', label: 'D' },
      { key: 'e', type: 'multiselect', label: 'E' },
      { key: 'f', type: 'money', label: 'F' },
    ] as never;
    expect(outputFields(fields).map((f) => f.key)).toEqual(['a', 'f']);
  });
});
