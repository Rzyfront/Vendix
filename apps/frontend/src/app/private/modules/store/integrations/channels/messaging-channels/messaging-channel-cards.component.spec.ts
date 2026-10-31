import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { ToastService } from '../../../../../../shared/components';
import { MessagingChannelCardsComponent } from './messaging-channel-cards.component';
import { MessagingChannels } from './messaging-channels.interface';
import { MessagingChannelsService } from './messaging-channels.service';

const CHANNELS: MessagingChannels = {
  sms: {
    id: 1,
    channel_type: 'sms',
    provider: 'aws_sns',
    status: 'connected',
    enabled: true,
    connected_at: '2026-10-01T00:00:00.000Z',
    disconnected_at: null,
    updated_at: '2026-10-01T00:00:00.000Z',
    sender_id: 'MiTienda',
    spend: {
      currency: 'USD',
      period_start: '2026-10-01',
      limit: 50,
      used: 10,
      remaining: 40,
    },
  },
  email: {
    id: 2,
    channel_type: 'email',
    provider: 'aws_ses',
    status: 'connected',
    enabled: true,
    connected_at: '2026-10-01T00:00:00.000Z',
    disconnected_at: null,
    updated_at: '2026-10-01T00:00:00.000Z',
    from_name: 'Mi Tienda',
    reply_to: 'hola@mitienda.co',
  },
};

describe('MessagingChannelCardsComponent', () => {
  let api: jasmine.SpyObj<MessagingChannelsService>;

  async function mount(
    loadFails: boolean,
  ): Promise<ComponentFixture<MessagingChannelCardsComponent>> {
    api = jasmine.createSpyObj<MessagingChannelsService>(
      'MessagingChannelsService',
      ['list', 'updateSms', 'updateEmail'],
    );
    api.list.and.returnValue(
      loadFails ? throwError(() => new Error('network down')) : of(CHANNELS),
    );
    api.updateSms.and.returnValue(of(CHANNELS.sms!));
    api.updateEmail.and.returnValue(of(CHANNELS.email!));

    TestBed.configureTestingModule({
      imports: [MessagingChannelCardsComponent],
      providers: [
        { provide: MessagingChannelsService, useValue: api },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj<ToastService>('ToastService', [
            'success',
            'error',
          ]),
        },
        {
          provide: AuthFacade,
          useValue: { hasPermission: () => true, isOwner: () => true },
        },
      ],
    });
    const fixture = TestBed.createComponent(MessagingChannelCardsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const saveButton = (
    f: ComponentFixture<unknown>,
    label: string,
  ): HTMLButtonElement =>
    [...(f.nativeElement as HTMLElement).querySelectorAll('app-button button')].find(
      (b) => b.textContent?.includes(label),
    ) as HTMLButtonElement;

  const submitForms = (f: ComponentFixture<unknown>): void => {
    (f.nativeElement as HTMLElement)
      .querySelectorAll('form')
      .forEach((form) => form.dispatchEvent(new Event('submit')));
  };

  it('keeps both save buttons disabled when the configuration could not be read', async () => {
    const f = await mount(true);
    expect(saveButton(f, 'Guardar SMS').disabled).toBeTrue();
    expect(saveButton(f, 'Guardar correo').disabled).toBeTrue();
  });

  it('never sends a PUT after a failed load, so the stored configuration is not wiped', async () => {
    const f = await mount(true);
    submitForms(f);
    await f.whenStable();
    expect(api.updateSms).not.toHaveBeenCalled();
    expect(api.updateEmail).not.toHaveBeenCalled();
  });

  it('saves the loaded values once the configuration was read', async () => {
    const f = await mount(false);
    expect(saveButton(f, 'Guardar correo').disabled).toBeFalse();
    submitForms(f);
    await f.whenStable();
    expect(api.updateEmail).toHaveBeenCalledOnceWith({
      enabled: true,
      from_name: 'Mi Tienda',
      reply_to: 'hola@mitienda.co',
    });
    expect(api.updateSms).toHaveBeenCalledOnceWith({
      enabled: true,
      sender_id: 'MiTienda',
      monthly_spend_limit: 50,
    });
  });
});
