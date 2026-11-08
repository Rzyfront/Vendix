import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import { IntegrationsPageComponent } from './integrations-page.component';

describe('IntegrationsPageComponent (tabs by permission)', () => {
  const create = (permissions: string[], owner = false) => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [IntegrationsPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: AuthFacade,
          useValue: {
            isOwner: () => owner,
            hasPermission: (permission: string) => permissions.includes(permission),
          },
        },
      ],
    });
    // Only the tab logic is under test: drop the panels and their HTTP deps.
    TestBed.overrideComponent(IntegrationsPageComponent, { set: { imports: [], template: '' } });
    return TestBed.createComponent(IntegrationsPageComponent).componentInstance;
  };

  const ids = (page: IntegrationsPageComponent) => page.tabs.map((tab) => tab.id);

  it('shows the three tabs to whoever holds both permissions', () => {
    const page = create(['store:integrations:api_keys', 'store:workflows:manage']);
    expect(ids(page)).toEqual(['api_keys', 'webhooks', 'secrets']);
    expect(page.activeTab()).toBe('api_keys');
  });

  it('a role with only workflows:manage sees Secretos and lands on it', () => {
    const page = create(['store:workflows:manage']);
    expect(ids(page)).toEqual(['secrets']);
    expect(page.activeTab()).toBe('secrets');
    page.onTabChange('api_keys');
    expect(page.activeTab()).toBe('secrets');
  });

  it('a role with only integrations:api_keys sees API keys and Webhooks', () => {
    const page = create(['store:integrations:api_keys']);
    expect(ids(page)).toEqual(['api_keys', 'webhooks']);
    page.onTabChange('webhooks');
    expect(page.activeTab()).toBe('webhooks');
  });

  it('the owner sees every tab', () => {
    expect(ids(create([], true))).toEqual(['api_keys', 'webhooks', 'secrets']);
  });
});
