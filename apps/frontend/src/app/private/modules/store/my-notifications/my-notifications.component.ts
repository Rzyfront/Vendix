import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { ToggleComponent } from '../../../../shared/components/toggle/toggle.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';
import { AlertBannerComponent } from '../../../../shared/components/alert-banner/alert-banner.component';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { PushSubscriptionService } from '../../../../core/services/push-subscription.service';
import {
  MyNotificationsService,
  NotificationPreferenceGroup,
  PreferenceChannel,
  describeTestError,
  describeTestResult,
} from './my-notifications.service';

@Component({
  selector: 'app-my-notifications',
  standalone: true,
  imports: [
    CardComponent,
    ToggleComponent,
    ButtonComponent,
    AlertBannerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './my-notifications.component.html',
})
export class MyNotificationsComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly service = inject(MyNotificationsService);
  private readonly toast = inject(ToastService);
  readonly push = inject(PushSubscriptionService);

  readonly loading = signal(true);
  readonly loadFailed = signal(false);
  readonly groups = signal<NotificationPreferenceGroup[]>([]);
  readonly storeEmailEnabled = signal(true);
  readonly userEmail = signal<string | null>(null);
  readonly testing = signal(false);
  readonly activating = signal(false);

  /** Espejo del permiso del navegador: `Notification.permission` no es reactivo. */
  readonly permission = signal<NotificationPermission>('default');
  readonly deviceSubscribed = signal(false);

  readonly deviceStatus = computed(() => {
    if (!this.push.isSupported) {
      return 'Este navegador no admite avisos en el dispositivo.';
    }
    if (this.permission() === 'denied') {
      return 'Bloqueado. Habilita las notificaciones de este sitio en la configuración del navegador y recarga la página.';
    }
    if (this.permission() === 'granted' && this.deviceSubscribed()) {
      return 'Activo en este dispositivo.';
    }
    if (this.permission() === 'granted') {
      return 'Permiso concedido, falta activar los avisos en este dispositivo.';
    }
    return 'Todavía no activaste los avisos en este dispositivo.';
  });

  readonly canActivateDevice = computed(
    () =>
      this.push.isSupported &&
      this.permission() !== 'denied' &&
      !(this.permission() === 'granted' && this.deviceSubscribed()),
  );

  ngOnInit(): void {
    this.loadPreferences();
    void this.refreshDeviceState();
  }

  private loadPreferences(): void {
    this.service
      .getPreferences()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (prefs) => {
          this.groups.set(prefs.groups);
          this.storeEmailEnabled.set(prefs.store_email_enabled);
          this.userEmail.set(prefs.user_email);
          this.loading.set(false);
        },
        error: () => {
          this.loadFailed.set(true);
          this.loading.set(false);
        },
      });
  }

  private async refreshDeviceState(): Promise<void> {
    if (!this.push.isSupported) return;
    this.permission.set(this.push.permissionState);
    if (this.push.permissionState === 'granted') {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager?.getSubscription();
      this.deviceSubscribed.set(!!sub);
    }
  }

  onToggle(type: string, channel: PreferenceChannel, value: boolean): void {
    this.setEffective(type, channel, value);
    this.service
      .updatePreference(type, channel, value)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: () => {
          this.setEffective(type, channel, !value);
          this.toast.error('No se pudo guardar el cambio. Intenta de nuevo.');
        },
      });
  }

  private setEffective(
    type: string,
    channel: PreferenceChannel,
    value: boolean,
  ): void {
    this.groups.update((groups) =>
      groups.map((group) => ({
        ...group,
        types: group.types.map((item) =>
          item.type === type
            ? {
                ...item,
                customized: true,
                effective: { ...item.effective, [channel]: value },
              }
            : item,
        ),
      })),
    );
  }

  async activateDevice(): Promise<void> {
    this.activating.set(true);
    try {
      const ok = await this.push.requestPermissionAndSubscribe();
      this.deviceSubscribed.set(ok);
      if (ok) {
        this.toast.success('Avisos activados en este dispositivo');
      } else if (this.push.permissionState === 'denied') {
        this.toast.warning('El navegador bloqueó los avisos de este sitio');
      } else {
        this.toast.warning('No se pudieron activar los avisos');
      }
    } finally {
      this.permission.set(this.push.permissionState);
      this.activating.set(false);
    }
  }

  sendTest(): void {
    this.testing.set(true);
    this.service
      .sendTest()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.testing.set(false);
          const outcome = describeTestResult(result);
          if (outcome.variant === 'success') {
            this.toast.success(outcome.message, undefined, 4000);
          } else {
            this.toast.warning(outcome.message, undefined, 4000);
          }
        },
        error: (error: unknown) => {
          this.testing.set(false);
          this.toast.warning(describeTestError(error), undefined, 4000);
        },
      });
  }
}
