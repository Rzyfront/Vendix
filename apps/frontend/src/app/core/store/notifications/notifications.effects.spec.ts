import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { Action } from '@ngrx/store';
import { Subject } from 'rxjs';

import { NotificationsEffects } from './notifications.effects';
import * as NotificationsActions from './notifications.actions';
import * as AuthActions from '../auth/auth.actions';
import * as SubscriptionActions from '../subscription/subscription.actions';
import { NotificationsApiService } from '../../services/notifications.service';
import { PushSubscriptionService } from '../../services/push-subscription.service';
import { AuthFacade } from '../auth/auth.facade';
import { NotificationSoundPlayerService } from '../../services/notification-sound-player.service';
import { NotificationSoundsCatalogService } from '../../services/notification-sounds-catalog.service';
import { StoreSettingsFacade } from '../store-settings/store-settings.facade';
import { StaffScanApprovalService } from '../../../private/modules/store/restaurant-ops/tables/services/staff-scan-approval.service';
import { ToastService } from '../../../shared/components/toast/toast.service';

/** Captures the EventSource the effect opens so the test can push messages. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

describe('NotificationsEffects (demo hotel/canchas S14, S15)', () => {
  let actions$: Subject<Action>;
  let effects: NotificationsEffects;
  let appType: string;
  const originalEventSource = (window as any).EventSource;

  beforeEach(() => {
    actions$ = new Subject<Action>();
    appType = 'STORE_ADMIN';
    FakeEventSource.instances = [];
    (window as any).EventSource = FakeEventSource;

    TestBed.configureTestingModule({
      providers: [
        NotificationsEffects,
        provideMockActions(() => actions$),
        provideMockStore({}),
        {
          provide: NotificationsApiService,
          useValue: { getSseUrl: () => 'https://api.test/store/notifications/stream?token=t' },
        },
        { provide: PushSubscriptionService, useValue: {} },
        {
          provide: AuthFacade,
          useValue: { selectedAppType: () => appType, isAuthenticated: () => true },
        },
        { provide: NotificationSoundPlayerService, useValue: {} },
        { provide: NotificationSoundsCatalogService, useValue: {} },
        { provide: StoreSettingsFacade, useValue: {} },
        { provide: StaffScanApprovalService, useValue: {} },
        { provide: ToastService, useValue: {} },
      ],
    });
    effects = TestBed.inject(NotificationsEffects);
  });

  afterEach(() => {
    (window as any).EventSource = originalEventSource;
  });

  function afterLogin(): Action[] {
    const emitted: Action[] = [];
    const sub = effects.initAfterLogin$.subscribe((a) => emitted.push(a));
    actions$.next(AuthActions.restoreAuthState({} as any));
    sub.unsubscribe();
    return emitted;
  }

  for (const publicApp of [
    'STORE_BOOKING',
    'STORE_LANDING',
    'STORE_HOME',
    'STORE_PRODUCT_PAGE',
    'STORE_SERVICE_PAGE',
  ]) {
    it(`does not load staff notifications on the public app ${publicApp}`, () => {
      appType = publicApp;
      expect(afterLogin()).toEqual([NotificationsActions.disconnectSse()]);
    });
  }

  // QUI-981: el backend rechaza /store/* a un token ORG_ADMIN (DomainScopeGuard).
  it('does not request store notifications in the organization panel and closes the inherited stream', () => {
    appType = 'ORG_ADMIN';
    expect(afterLogin()).toEqual([NotificationsActions.disconnectSse()]);
  });

  it('does not poll store notifications in the organization panel', () => {
    jasmine.clock().install();
    try {
      const emitted: Action[] = [];
      appType = 'ORG_ADMIN';
      const sub = effects.poll$.subscribe((a) => emitted.push(a));
      jasmine.clock().tick(35_000);
      expect(emitted).toEqual([]);

      appType = 'STORE_ADMIN';
      jasmine.clock().tick(30_000);
      expect(emitted).toEqual([NotificationsActions.loadNotifications()]);
      sub.unsubscribe();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('keeps loading notifications and the stream in the admin and the ecommerce', () => {
    for (const app of ['STORE_ADMIN', 'STORE_ECOMMERCE']) {
      appType = app;
      expect(afterLogin().map((a) => a.type)).toEqual([
        NotificationsActions.loadNotifications().type,
        NotificationsActions.connectSse().type,
      ]);
    }
  });

  it('keeps skipping the carrier app', () => {
    appType = 'STORE_DELIVERY';
    expect(afterLogin()).toEqual([NotificationsActions.disconnectSse()]);
  });

  it('forwards subscription.updated from the shared stream instead of a second connection', () => {
    const emitted: Action[] = [];
    const sub = effects.connectSse$.subscribe((a) => emitted.push(a));
    actions$.next(NotificationsActions.connectSse());

    expect(FakeEventSource.instances.length).toBe(1);
    FakeEventSource.instances[0].emit({ type: 'subscription.updated', data: { state: 'active' } });

    expect(emitted).toContain(
      SubscriptionActions.subscriptionUpdated({ subscription: { state: 'active' } as any }),
    );
    expect(emitted.some((a) => a.type === NotificationsActions.receivedNotification.type)).toBe(
      false,
    );
    sub.unsubscribe();
  });
});
