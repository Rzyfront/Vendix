import { readFileSync } from 'fs';
import { join } from 'path';
import {
  AI_ATTACHMENT_LABEL,
  AI_ATTACHMENT_MAX_BYTES,
  AI_ATTACHMENT_MAX_FILES,
  acceptAttribute,
  resolveAttachmentType,
} from './ai-attachments';

// Three byte-identical copies (no executable shared package between runtimes).
const REPO_ROOT = join(__dirname, '../../../../../..');
const COPIES = [
  { name: 'shared-types', path: 'libs/shared-types/ai-attachments.ts' },
  {
    name: 'backend',
    path: 'apps/backend/src/domains/store/vexi/ai-attachments.ts',
  },
  {
    name: 'frontend',
    path: 'apps/frontend/src/app/shared/constants/ai-attachments.ts',
  },
];

describe('ai-attachments — one list of accepted chat files (T41)', () => {
  it('the three copies are byte-identical', () => {
    const [canonical, ...rest] = COPIES.map((c) =>
      readFileSync(join(REPO_ROOT, c.path)),
    );
    rest.forEach((buf, i) => {
      expect({
        copy: COPIES[i + 1].name,
        equal: buf.equals(canonical),
      }).toEqual({ copy: COPIES[i + 1].name, equal: true });
    });
  });

  it('pins the limits and the label', () => {
    expect(AI_ATTACHMENT_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(AI_ATTACHMENT_MAX_FILES).toBe(5);
    expect(AI_ATTACHMENT_LABEL).toBe(
      'Fotos (JPG, PNG, WEBP, HEIC), PDF, Excel (XLSX), CSV, Word (DOCX) y TXT',
    );
  });

  it('resolves by MIME and falls back to the extension for generic MIMEs', () => {
    expect(resolveAttachmentType('image/jpg', 'a.jpg')?.mime).toBe(
      'image/jpeg',
    );
    expect(resolveAttachmentType('text/csv', 'a.csv')?.kind).toBe('table');
    expect(resolveAttachmentType('application/vnd.ms-excel', 'a.csv')?.mime).toBe(
      'text/csv',
    );
    expect(resolveAttachmentType('', 'DATOS.CSV')?.mime).toBe('text/csv');
    expect(resolveAttachmentType('application/octet-stream', 'x.docx')?.kind).toBe(
      'text',
    );
  });

  it('rejects .xls, unknown extensions and unknown MIMEs', () => {
    expect(resolveAttachmentType('application/vnd.ms-excel', 'a.xls')).toBeNull();
    expect(resolveAttachmentType('', 'a.exe')).toBeNull();
    expect(resolveAttachmentType('application/zip', 'a.csv')).toBeNull();
    expect(resolveAttachmentType('', 'noext')).toBeNull();
  });

  it('builds the accept attribute from the same list', () => {
    const accept = acceptAttribute();
    expect(accept).toContain('text/csv');
    expect(accept).toContain('.xlsx');
    expect(accept).toContain('.docx');
    expect(accept).not.toContain('.xls,');
  });
});
