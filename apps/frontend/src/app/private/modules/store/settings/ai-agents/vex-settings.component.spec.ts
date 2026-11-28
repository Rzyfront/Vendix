import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { VexSettingsComponent } from './vex-settings.component';
import { VexFloatingAvatarComponent } from '../../../../../shared/components/vex-floating-avatar/vex-floating-avatar.component';
import { StoreSettingsService } from '../general/services/store-settings.service';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { SubscriptionAccessService } from '../../../../../core/services/subscription-access.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { AgentStatusService } from './agent-status.service';

/** agentes-admin S1/S3: the Vex section owns the floating-avatar switch. */
describe('VexSettingsComponent (floating avatar)', () => {
  function setup(vex: { enabled?: boolean; floating_avatar?: boolean }) {
    const saveSettingsNow = jasmine
      .createSpy('saveSettingsNow')
      .and.returnValue(of({}));
    const settings = signal<Record<string, unknown>>({ vex });
    TestBed.configureTestingModule({
      imports: [VexSettingsComponent],
      providers: [
        provideRouter([]),
        { provide: StoreSettingsService, useValue: { saveSettingsNow } },
        {
          provide: StoreSettingsFacade,
          useValue: {
            settings,
            vexEnabled: signal(vex.enabled === true),
          },
        },
        {
          provide: SubscriptionAccessService,
          useValue: {
            canUseAI: () => signal(true),
            aiBlockReason: () => signal(null),
            getAiUsageReport: () => Promise.resolve({ agent_usage: null }),
          },
        },
        {
          provide: ToastService,
          useValue: { success: jasmine.createSpy(), error: jasmine.createSpy() },
        },
        {
          provide: AgentStatusService,
          useValue: { loadFor: () => Promise.resolve(null) },
        },
      ],
    });
    const fixture = TestBed.createComponent(VexSettingsComponent);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, saveSettingsNow };
  }

  it('shows the switch off by default and locked while Vex is off', async () => {
    const { fixture, component, saveSettingsNow } = setup({ enabled: false });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Avatar flotante de Vex');
    expect(text).toContain('Activa Vex primero');
    expect(component.floatingAvatar()).toBeFalse();
    expect(component.avatarLocked()).toBeTrue();

    await component.onToggle('floating_avatar', true);
    expect(saveSettingsNow).not.toHaveBeenCalled();
  });

  it('with Vex on, turning the avatar on saves only vex.floating_avatar', async () => {
    const { component, saveSettingsNow } = setup({ enabled: true });
    expect(component.avatarLocked()).toBeFalse();

    await component.onToggle('floating_avatar', true);
    expect(saveSettingsNow).toHaveBeenCalledOnceWith({
      vex: { floating_avatar: true },
    });
  });

  it('«Usar Vex» still saves only vex.enabled', async () => {
    const { component, saveSettingsNow } = setup({ enabled: false });
    await component.onToggle('enabled', true);
    expect(saveSettingsNow).toHaveBeenCalledOnceWith({ vex: { enabled: true } });
  });
});

describe('VexFloatingAvatarComponent', () => {
  it('is a link to /admin/vex, not a chat', () => {
    TestBed.configureTestingModule({
      imports: [VexFloatingAvatarComponent],
      providers: [provideRouter([])],
    });
    const fixture = TestBed.createComponent(VexFloatingAvatarComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const link = el.querySelector<HTMLAnchorElement>(
      '[data-testid="vex-floating-avatar"]',
    );
    expect(link?.getAttribute('href')).toBe('/admin/vex');
    expect(el.querySelector('textarea, input, form')).toBeNull();
  });
});
