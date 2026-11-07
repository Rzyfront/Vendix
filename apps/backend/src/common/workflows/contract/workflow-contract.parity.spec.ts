import { readFileSync } from 'fs';
import { join } from 'path';

// Three byte-identical copies (no executable shared package between runtimes).
const REPO_ROOT = join(__dirname, '../../../../../..');
const FILES = [
  'workflow-contract.ts',
  'workflow-validator.ts',
  'workflow-runtime.ts',
  'index.ts',
];
const FOLDERS = [
  { name: 'shared-types', dir: 'libs/shared-types/workflows' },
  { name: 'backend', dir: 'apps/backend/src/common/workflows/contract' },
  {
    name: 'frontend',
    dir: 'apps/frontend/src/app/shared/workflows/contract',
  },
];

describe('vendix.workflow/v1 contract — parity of the copies', () => {
  it.each(FILES)('%s is byte-identical in the three copies', (file) => {
    const [canonical, ...rest] = FOLDERS.map((f) =>
      readFileSync(join(REPO_ROOT, f.dir, file)),
    );
    rest.forEach((buf, i) => {
      expect({
        copy: FOLDERS[i + 1].name,
        equal: buf.equals(canonical),
      }).toEqual({ copy: FOLDERS[i + 1].name, equal: true });
    });
  });

  it.each(FILES)('%s header names the parity spec', (file) => {
    const text = readFileSync(
      join(REPO_ROOT, FOLDERS[0].dir, file),
      'utf8',
    );
    expect(text).toContain('workflow-contract.parity.spec.ts');
  });
});
