import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  WORKFLOW_ACTION_CATALOG,
  WORKFLOW_CONNECTOR_CATALOG,
  WORKFLOW_VENDIX_ACTIONS,
} from '@common/workflows/contract';

/**
 * R1/R6 registry guard. The action groups are read as source (they inject
 * heavy domain services that cannot be built in a unit test): a handler is a
 * `'<action>':` key of a `handlers` map in `engine/actions/*.actions.ts`.
 */
const actionsDir = join(__dirname, 'actions');
const groupSources = readdirSync(actionsDir)
  .filter((f) => f.endsWith('.actions.ts'))
  .map((f) => readFileSync(join(actionsDir, f), 'utf8'));
const startSource = readFileSync(join(__dirname, 'workflow-start.service.ts'), 'utf8');

const hasHandler = (action: string) =>
  groupSources.some((src) => src.includes(`'${action}': (ctx)`));

describe('Action and connector registry (R1, R6)', () => {
  it.each(WORKFLOW_VENDIX_ACTIONS)('action %s has a handler in an action group', (action) => {
    expect(hasHandler(action)).toBe(true);
  });

  it('the catalog is not empty and every action names its permission', () => {
    expect(WORKFLOW_VENDIX_ACTIONS.length).toBeGreaterThan(0);
    for (const spec of Object.values(WORKFLOW_ACTION_CATALOG)) {
      expect(spec.permission).toMatch(/^[a-z_-]+(:[a-z_-]+)+$/);
    }
  });

  describe.each(Object.entries(WORKFLOW_CONNECTOR_CATALOG))('connector %s', (_key, connector) => {
    it('declares only actions of the catalog that have an executor', () => {
      for (const action of connector.actions) {
        expect(WORKFLOW_ACTION_CATALOG).toHaveProperty([action]);
        expect(hasHandler(action)).toBe(true);
      }
    });

    it('declares only triggers the start service can start', () => {
      for (const trigger of connector.triggers) {
        expect(startSource).toContain(`trigger.kind === '${trigger}'`);
      }
    });
  });

  it('no action is claimed by two connectors', () => {
    const claimed = Object.values(WORKFLOW_CONNECTOR_CATALOG).flatMap((c) => [...c.actions]);
    expect(new Set(claimed).size).toBe(claimed.length);
  });
});
