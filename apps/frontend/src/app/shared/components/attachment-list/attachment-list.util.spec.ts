import { attachmentKind, formatFileSize } from './attachment-list.util';

describe('attachment-list.util', () => {
  it('formatFileSize formats bytes, KB and MB', () => {
    expect(formatFileSize(0)).toBe('');
    expect(formatFileSize(undefined)).toBe('');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1536)).toBe('1,5 KB');
    expect(formatFileSize(10 * 1024)).toBe('10 KB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5,0 MB');
  });

  it('attachmentKind uses the MIME type and falls back to the extension', () => {
    expect(attachmentKind({ name: 'a.bin', mime_type: 'image/png' })).toBe('image');
    expect(attachmentKind({ name: 'a.pdf', mime_type: 'application/pdf' })).toBe('pdf');
    expect(attachmentKind({ name: 'foto.JPG', mime_type: '' })).toBe('image');
    expect(attachmentKind({ name: 'cedula.pdf' })).toBe('pdf');
    expect(attachmentKind({ name: 'a.docx', mime_type: 'application/msword' })).toBe('other');
  });
});
