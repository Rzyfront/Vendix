import { readFileSync } from 'fs';
import { join } from 'path';

// Two byte-identical copies of the template JSON contract (no executable
// shared package between runtimes). The backend copy is canonical.
const REPO_ROOT = join(__dirname, '../../../../../../..');
const CANONICAL =
  'apps/backend/src/domains/store/data-collection/template-json/template-json.contract.ts';
const FRONTEND =
  'apps/frontend/src/app/private/modules/store/data-collection/utils/template-json.contract.ts';

describe('vendix.data-collection-template/v1 contract — parity of the copies', () => {
  it('the frontend copy is byte-identical to the backend one', () => {
    const canonical = readFileSync(join(REPO_ROOT, CANONICAL));
    const frontend = readFileSync(join(REPO_ROOT, FRONTEND));
    expect(frontend.equals(canonical)).toBe(true);
  });

  it('the header names this parity spec', () => {
    expect(readFileSync(join(REPO_ROOT, CANONICAL), 'utf8')).toContain(
      'template-json.contract.parity.spec.ts',
    );
  });
});
