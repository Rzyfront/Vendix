import { readFileSync } from 'fs';
import { join } from 'path';
import {
  LEGACY_INDUSTRY_GATED_KEYS,
  MODULE_INDUSTRIES,
  VERTICAL_MODULE_KEYS,
} from './module-industries';

// Two byte-identical copies (no executable shared package between runtimes).
// The backend one is canonical; the frontend one is its mirror.
const REPO_ROOT = join(__dirname, '../../../../..');
const COPIES = [
  {
    name: 'backend',
    path: 'apps/backend/src/common/access/module-industries.ts',
  },
  {
    name: 'frontend',
    path: 'apps/frontend/src/app/shared/constants/module-industries.ts',
  },
];

describe('module-industries — parity and map invariants', () => {
  it('the two copies are byte-identical', () => {
    const [canonical, ...rest] = COPIES.map((c) =>
      readFileSync(join(REPO_ROOT, c.path)),
    );
    rest.forEach((buf, i) => {
      expect({ copy: COPIES[i + 1].name, equal: buf.equals(canonical) }).toEqual(
        { copy: COPIES[i + 1].name, equal: true },
      );
    });
  });

  it('every vertical and legacy-gated key has an entry in the map', () => {
    for (const key of [...VERTICAL_MODULE_KEYS, ...LEGACY_INDUSTRY_GATED_KEYS]) {
      expect(Object.keys(MODULE_INDUSTRIES)).toContain(key);
    }
  });

  it("every non-vertical key is 'all' or includes retail", () => {
    const vertical = new Set(VERTICAL_MODULE_KEYS);
    for (const [key, rule] of Object.entries(MODULE_INDUSTRIES)) {
      if (vertical.has(key)) continue;
      expect({ key, ok: rule === 'all' || rule.includes('retail') }).toEqual({
        key,
        ok: true,
      });
    }
  });
});
