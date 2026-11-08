import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ENFORCED_INDUSTRY_KEYS,
  LEGACY_INDUSTRY_GATED_KEYS,
  MODULE_INDUSTRIES,
  MODULE_INDUSTRY_VALUES,
  VERTICAL_MODULE_KEYS,
  industryAllowsKey,
  isIndustryAlwaysEnforced,
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

  it('flows and documents are vertical keys of administration only, always enforced', () => {
    expect(MODULE_INDUSTRY_VALUES).toContain('administration');
    for (const key of ['flows', 'documents']) {
      expect(MODULE_INDUSTRIES[key]).toEqual(['administration']);
      expect(VERTICAL_MODULE_KEYS).toContain(key);
      expect(isIndustryAlwaysEnforced(key)).toBe(true);
      expect(industryAllowsKey(key, ['administration'])).toBe(true);
      expect(industryAllowsKey(key, ['retail', 'administration'])).toBe(true);
      expect(industryAllowsKey(key, ['retail'])).toBe(false);
      expect(industryAllowsKey(key, [])).toBe(false);
    }
    expect(isIndustryAlwaysEnforced('restaurant_ops')).toBe(false);
    for (const key of ENFORCED_INDUSTRY_KEYS) {
      expect(Object.keys(MODULE_INDUSTRIES)).toContain(key);
    }
  });

  it('P5.7: every sidebar child key of Flujos and Documentos is administration-only and always enforced', () => {
    const children = Object.keys(MODULE_INDUSTRIES).filter(
      (key) => key.startsWith('flows_') || key.startsWith('documents_'),
    );
    expect(children).toEqual([
      'flows_list',
      'flows_inbox',
      'flows_board',
      'flows_insights',
      'flows_templates',
      'flows_records',
      'flows_connectors',
      'flows_integrations',
      'documents_dossiers',
      'documents_search',
      'documents_folders',
      'documents_expiring',
      'documents_retention',
      'documents_templates',
    ]);
    for (const key of children) {
      expect(MODULE_INDUSTRIES[key]).toEqual(['administration']);
      expect(VERTICAL_MODULE_KEYS).toContain(key);
      expect(isIndustryAlwaysEnforced(key)).toBe(true);
      expect(industryAllowsKey(key, ['retail'])).toBe(false);
    }
  });
});
