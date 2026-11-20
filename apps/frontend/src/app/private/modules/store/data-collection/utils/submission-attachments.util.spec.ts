import { responseAttachments } from './submission-attachments.util';

describe('responseAttachments', () => {
  it('prefers the files list', () => {
    const items = responseAttachments({
      value_text: 'x/y/a.pdf',
      files: [
        { key: 'x/y/a.pdf', name: 'a.pdf', size: 10, mime_type: 'application/pdf', url: 'https://s3/a' },
        { key: 'x/y/b.png', name: '', size: 5, mime_type: 'image/png', url: null },
      ],
    });
    expect(items.length).toBe(2);
    expect(items[0].url).toBe('https://s3/a');
    expect(items[1].name).toBe('b.png');
    expect(items[1].url).toBeNull();
  });

  it('keeps the legacy single URL or storage key', () => {
    expect(responseAttachments({ value_text: 'https://s3/bucket/cedula.pdf?sig=1' })[0]).toEqual({
      name: 'cedula.pdf',
      url: 'https://s3/bucket/cedula.pdf?sig=1',
    });
    const key = responseAttachments({ value_text: 'organizations/1/f.png' }, 'https://signed');
    expect(key[0].url).toBe('https://signed');
    expect(key[0].name).toBe('f.png');
    expect(responseAttachments({ value_text: 'organizations/1/f.png' })[0].url).toBeNull();
  });

  it('returns nothing without value', () => {
    expect(responseAttachments({})).toEqual([]);
    expect(responseAttachments({ value_text: '[object File]' })).toEqual([]);
  });
});
