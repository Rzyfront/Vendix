import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import {
  HomePanelId,
  HomePanelSettings,
} from '../../../../../../../shared/constants/home-panels';
import { HOME_PANEL_REGISTRY } from '../../../../dashboard/home-panels/home-panel.registry';
import { HomePanelService } from '../../../../dashboard/home-panels/home-panel.service';
import { HomePanelSettingsForm } from './home-panel-settings-form.component';

describe('HomePanelSettingsForm', () => {
  const eligibleIds = signal<HomePanelId[]>([
    'summary',
    'scheduled_orders_agenda',
    'crm_pipeline',
  ]);
  const suggested = signal<HomePanelId>('scheduled_orders_agenda');
  const canEdit = signal(true);
  const suggestedSettings: HomePanelSettings = {
    default_panel: 'scheduled_orders_agenda',
    enabled_panels: ['scheduled_orders_agenda', 'summary'],
  };

  function build(settings: HomePanelSettings | undefined) {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: HomePanelService,
          useValue: {
            eligiblePanels: () =>
              eligibleIds().map((id) => HOME_PANEL_REGISTRY[id]),
            suggestedPanel: () => suggested(),
            suggestedSettings: () => suggestedSettings,
          },
        },
        {
          provide: AuthFacade,
          useValue: {
            isOwner: () => canEdit(),
            isAdmin: () => false,
            hasAnyRole: () => false,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(HomePanelSettingsForm);
    fixture.componentRef.setInput('settings', settings);
    const emitted: HomePanelSettings[] = [];
    fixture.componentInstance.settingsChange.subscribe((v) => emitted.push(v));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, emitted };
  }

  beforeEach(() => {
    canEdit.set(true);
    eligibleIds.set(['summary', 'scheduled_orders_agenda', 'crm_pipeline']);
  });

  it('renders only the eligible panels as cards', () => {
    const { el } = build(undefined);
    const cards = Array.from(el.querySelectorAll('.home-panel-card')).map((c) =>
      c.getAttribute('data-panel'),
    );
    expect(cards).toEqual(['summary', 'scheduled_orders_agenda', 'crm_pipeline']);
    expect(el.querySelector('[data-panel="occupancy"]')).toBeNull();
  });

  it('labels only the suggested card', () => {
    const { el } = build(undefined);
    const labels = el.querySelectorAll('.home-panel-suggested');
    expect(labels.length).toBe(1);
    expect(
      labels[0].closest('.home-panel-card')?.getAttribute('data-panel'),
    ).toBe('scheduled_orders_agenda');
    expect(labels[0].textContent).toContain('Sugerido para tu industria');
  });

  it('shows the Resumen selected when the store has no saved choice', () => {
    const { el } = build(undefined);
    const selected = el.querySelector('.home-panel-card[aria-checked="true"]');
    expect(selected?.getAttribute('data-panel')).toBe('summary');
  });

  it('selecting a card emits it first in enabled_panels', () => {
    const { el, emitted } = build({
      default_panel: 'summary',
      enabled_panels: ['summary'],
    });
    (el.querySelector('[data-panel="crm_pipeline"]') as HTMLButtonElement).click();
    expect(emitted).toEqual([
      { default_panel: 'crm_pipeline', enabled_panels: ['crm_pipeline', 'summary'] },
    ]);
  });

  it('toggling an extra panel emits with the home panel first', () => {
    const { el, emitted } = build({
      default_panel: 'summary',
      enabled_panels: ['summary'],
    });
    const box = el.querySelector(
      '.home-panel-extra[data-panel="crm_pipeline"] input',
    ) as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(emitted).toEqual([
      { default_panel: 'summary', enabled_panels: ['summary', 'crm_pipeline'] },
    ]);
  });

  it('keeps the home panel checked and disabled, and drops non-eligible ids', () => {
    const { el } = build({
      default_panel: 'summary',
      enabled_panels: ['summary', 'occupancy'],
    });
    const home = el.querySelector(
      '.home-panel-extra[data-panel="summary"] input',
    ) as HTMLInputElement;
    expect(home.checked).toBeTrue();
    expect(home.disabled).toBeTrue();
  });

  it('"Usar sugerido" emits the suggested settings', () => {
    const { el, emitted } = build(undefined);
    const btn = el.querySelector('app-button button') as HTMLButtonElement;
    btn.click();
    expect(emitted).toEqual([suggestedSettings]);
  });

  it('shows a soft notice above the recommended maximum', () => {
    eligibleIds.set([
      'summary',
      'occupancy',
      'reservations_agenda',
      'scheduled_orders_agenda',
      'crm_pipeline',
    ]);
    const { el } = build({
      default_panel: 'summary',
      enabled_panels: [
        'summary',
        'occupancy',
        'reservations_agenda',
        'scheduled_orders_agenda',
        'crm_pipeline',
      ],
    });
    expect(el.querySelector('.home-panel-limit')?.textContent).toContain(
      'Recomendamos máximo 4 paneles',
    );
  });

  it('is read-only for users who cannot edit', () => {
    canEdit.set(false);
    const { el, emitted } = build(undefined);
    const cards = Array.from(
      el.querySelectorAll('.home-panel-card'),
    ) as HTMLButtonElement[];
    expect(cards.every((c) => c.disabled)).toBeTrue();
    const boxes = Array.from(
      el.querySelectorAll('.home-panel-extra input'),
    ) as HTMLInputElement[];
    expect(boxes.every((b) => b.disabled)).toBeTrue();
    expect(el.textContent).toContain(
      'Solo el propietario o un administrador pueden cambiar el panel principal.',
    );
    expect(el.querySelector('app-button')).toBeNull();
    expect(emitted).toEqual([]);
  });
});
