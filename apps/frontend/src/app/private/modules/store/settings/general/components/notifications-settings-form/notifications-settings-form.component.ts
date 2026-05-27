import {Component, OnInit, effect, inject, input, output, DestroyRef, computed} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';

import {
  ReactiveFormsModule,
  FormsModule,
  FormGroup,
  FormControl,
  Validators,
} from '@angular/forms';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { SettingToggleComponent } from '../../../../../../../shared/components/setting-toggle/setting-toggle.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { SelectorComponent, SelectorOption } from '../../../../../../../shared/components/selector/selector.component';
import { NotificationsApiService } from '../../../../../../../core/services/notifications.service';
import { PushSubscriptionService } from '../../../../../../../core/services/push-subscription.service';
import { NotificationSoundsCatalogService, NotificationSoundCatalogItem } from '../../../../../../../core/services/notification-sounds-catalog.service';

export interface NotificationsSettings {
  email_enabled: boolean;
  sms_enabled: boolean;
  low_stock_alerts: boolean;
  new_order_alerts: boolean;
  low_stock_alerts_email?: string | null;
  new_order_alerts_email?: string | null;
  low_stock_alerts_phone?: string | null;
  new_order_alerts_phone?: string | null;
  sound_id?: string | null;
  sound_volume?: number;
  sound_muted?: boolean;
}

@Component({
  selector: 'app-notifications-settings-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    InputComponent,
    SettingToggleComponent,
    IconComponent,
    ButtonComponent,
    SelectorComponent,
  ],
  templateUrl: './notifications-settings-form.component.html',
  styleUrls: ['./notifications-settings-form.component.scss'],
})
export class NotificationsSettingsForm implements OnInit {
  private destroyRef = inject(DestroyRef);
  readonly settings = input.required<NotificationsSettings>();
  readonly settingsChange = output<NotificationsSettings>();

  private notificationsApi = inject(NotificationsApiService);
  pushService = inject(PushSubscriptionService);
  private catalogService = inject(NotificationSoundsCatalogService);

  protected catalog = toSignal(this.catalogService.getCatalog(), {
    initialValue: [] as NotificationSoundCatalogItem[],
  });

  protected soundOptions = computed<SelectorOption[]>(() =>
    this.catalog().map((sound) => ({ value: sound.id, label: sound.name })),
  );

  private previewAudio: HTMLAudioElement | null = null;

  constructor() {
    effect(() => {
      const current = this.settings();
      if (current) {
        this.form.patchValue(current, { emitEvent: false });
      }
    });

    this.destroyRef.onDestroy(() => this.stopPreview());
  }

  devicePushEnabled = false;

  subscriptions: Record<string, boolean> = {
    new_order: true,
    order_status_change: true,
    low_stock: true,
    new_customer: true,
    payment_received: true,
  };

  subscriptionLabels: Record<string, string> = {
    new_order: 'Nuevas órdenes',
    order_status_change: 'Cambios de estado de orden',
    low_stock: 'Stock bajo',
    new_customer: 'Nuevos clientes',
    payment_received: 'Pagos recibidos',
  };

  form: FormGroup = new FormGroup({
    email_enabled: new FormControl(true),
    sms_enabled: new FormControl(false),
    low_stock_alerts: new FormControl(true),
    new_order_alerts: new FormControl(true),
    low_stock_alerts_email: new FormControl(null),
    new_order_alerts_email: new FormControl(null),
    low_stock_alerts_phone: new FormControl(null, [
      Validators.pattern(/^[\d+#*\s()-]*$/),
    ]),
    new_order_alerts_phone: new FormControl(null, [
      Validators.pattern(/^[\d+#*\s()-]*$/),
    ]),
    sound_muted: new FormControl(false),
    sound_id: new FormControl<string | null>(null),
    sound_volume: new FormControl<number>(70, [
      Validators.min(0),
      Validators.max(100),
    ]),
  });

  // Typed getters for FormControls
  get emailEnabledControl(): FormControl<boolean> {
    return this.form.get('email_enabled') as FormControl<boolean>;
  }

  get smsEnabledControl(): FormControl<boolean> {
    return this.form.get('sms_enabled') as FormControl<boolean>;
  }

  get lowStockAlertsControl(): FormControl<boolean> {
    return this.form.get('low_stock_alerts') as FormControl<boolean>;
  }

  get newOrderAlertsControl(): FormControl<boolean> {
    return this.form.get('new_order_alerts') as FormControl<boolean>;
  }

  get lowStockAlertsEmailControl(): FormControl<string | null> {
    return this.form.get('low_stock_alerts_email') as FormControl<
      string | null
    >;
  }

  get newOrderAlertsEmailControl(): FormControl<string | null> {
    return this.form.get('new_order_alerts_email') as FormControl<
      string | null
    >;
  }

  get lowStockAlertsPhoneControl(): FormControl<string | null> {
    return this.form.get('low_stock_alerts_phone') as FormControl<
      string | null
    >;
  }

  get newOrderAlertsPhoneControl(): FormControl<string | null> {
    return this.form.get('new_order_alerts_phone') as FormControl<
      string | null
    >;
  }

  get soundMutedControl(): FormControl<boolean> {
    return this.form.get('sound_muted') as FormControl<boolean>;
  }

  get soundIdControl(): FormControl<string | null> {
    return this.form.get('sound_id') as FormControl<string | null>;
  }

  get soundVolumeControl(): FormControl<number> {
    return this.form.get('sound_volume') as FormControl<number>;
  }

  get isSoundMuted(): boolean {
    return this.form.get('sound_muted')?.value ?? false;
  }

  playPreview(): void {
    const soundId = this.form.get('sound_id')?.value;
    const muted = this.form.get('sound_muted')?.value;
    const volume = this.form.get('sound_volume')?.value ?? 0;
    if (!soundId || muted) return;

    const sound = this.catalog().find((s) => s.id === soundId);
    if (!sound) return;

    this.stopPreview();
    this.previewAudio = new Audio(sound.url);
    this.previewAudio.volume = Math.max(0, Math.min(1, volume / 100));
    this.previewAudio.play().catch(() => {
      // Autoplay blocked — first user interaction unlocks; ignore silently
    });

    // Auto-stop preview at 1.5s for safety
    setTimeout(() => this.stopPreview(), 1500);
  }

  stopPreview(): void {
    if (this.previewAudio) {
      this.previewAudio.pause();
      this.previewAudio.currentTime = 0;
      this.previewAudio = null;
    }
  }

  ngOnInit() {
    this.loadSubscriptions();
    this.initDevicePushState();
  }

  private async initDevicePushState() {
    if (!this.pushService.isSupported) return;
    if (this.pushService.permissionState === 'granted') {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager?.getSubscription();
      this.devicePushEnabled = !!sub;
    }
  }

  onFieldChange() {
    if (this.form.valid) {
      this.settingsChange.emit(this.form.value);
    }
  }

  get isEmailEnabled(): boolean {
    return this.form.get('email_enabled')?.value ?? false;
  }

  get isSmsEnabled(): boolean {
    return this.form.get('sms_enabled')?.value ?? false;
  }

  get subscriptionTypes(): string[] {
    return Object.keys(this.subscriptions);
  }

  loadSubscriptions() {
    this.notificationsApi.getSubscriptions().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response: any) => {
        const subs = response?.data || [];
        for (const sub of subs) {
          if (sub.type in this.subscriptions) {
            this.subscriptions[sub.type] = sub.in_app;
          }
        }
      },
      error: () => {
        // Silently fail — subscriptions will use defaults
      },
    });
  }

  get devicePushDescription(): string {
    if (this.pushService.permissionState === 'denied') {
      return 'Bloqueado por el navegador — revisa los permisos del sitio';
    }
    return this.devicePushEnabled
      ? 'Recibirás alertas aunque la app esté cerrada'
      : 'Activa para recibir alertas en tu dispositivo';
  }

  onSubscriptionToggle(type: string) {
    this.subscriptions[type] = !this.subscriptions[type];
    this.notificationsApi
      .updateSubscription({ type, in_app: this.subscriptions[type] })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  async onDevicePushToggle() {
    if (!this.devicePushEnabled) {
      // Turning ON — request permission and subscribe
      const success = await this.pushService.requestPermissionAndSubscribe();
      this.devicePushEnabled = success;
    } else {
      // Turning OFF — unsubscribe
      await this.pushService.unsubscribe();
      this.devicePushEnabled = false;
    }
  }
}
