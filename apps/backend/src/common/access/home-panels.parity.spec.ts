import { readFileSync } from 'fs';
import { join } from 'path';
import {
  HOME_PANEL_IDS,
  isHomePanelId,
  suggestHomePanel,
  suggestHomePanelSettings,
} from './home-panels';

// Two byte-identical copies (no executable shared package between runtimes).
const REPO_ROOT = join(__dirname, '../../../../..');

describe('home-panels (QUI-967) — parity and suggestion', () => {
  it('the frontend mirror is byte-identical', () => {
    const canonical = readFileSync(
      join(REPO_ROOT, 'apps/backend/src/common/access/home-panels.ts'),
    );
    const mirror = readFileSync(
      join(REPO_ROOT, 'apps/frontend/src/app/shared/constants/home-panels.ts'),
    );
    expect(mirror.equals(canonical)).toBe(true);
  });

  it('closed catalog', () => {
    expect([...HOME_PANEL_IDS]).toEqual([
      'summary',
      'occupancy',
      'reservations_agenda',
      'scheduled_orders_agenda',
      'production',
      'workflows_board',
      'crm_pipeline',
    ]);
    expect(isHomePanelId('crm_pipeline')).toBe(true);
    expect(isHomePanelId('widgets')).toBe(false);
    expect(isHomePanelId(undefined)).toBe(false);
  });

  it.each([
    [['hospitality'], 'occupancy'],
    [['service'], 'reservations_agenda'],
    [['restaurant'], 'scheduled_orders_agenda'],
    [['administration'], 'workflows_board'],
    [['retail'], 'summary'],
    [['gym'], 'summary'],
    [[], 'summary'],
  ])('suggests by industry %j → %s', (industries, panel) => {
    expect(suggestHomePanel(industries)).toBe(panel);
  });

  it('multi-industry priority: Hotelería > Servicios > Pedidos > Administración', () => {
    expect(suggestHomePanel(['retail', 'service', 'hospitality'])).toBe('occupancy');
    expect(suggestHomePanel(['administration', 'restaurant', 'service'])).toBe(
      'reservations_agenda',
    );
    expect(suggestHomePanel(['administration', 'restaurant'])).toBe(
      'scheduled_orders_agenda',
    );
    expect(suggestHomePanel(null)).toBe('summary');
  });

  it('suggested settings keep the Resumen as second tab', () => {
    expect(suggestHomePanelSettings(['hospitality'])).toEqual({
      default_panel: 'occupancy',
      enabled_panels: ['occupancy', 'summary'],
    });
    expect(suggestHomePanelSettings(['retail'])).toEqual({
      default_panel: 'summary',
      enabled_panels: ['summary'],
    });
  });
});
