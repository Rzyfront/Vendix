import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { SettingToggleComponent } from '../../../../../../../shared/components/setting-toggle/setting-toggle.component';
import { NotificationsApiService } from '../../../../../../../core/services/notifications.service';
import { PushSubscriptionService } from '../../../../../../../core/services/push-subscription.service';

export interface NotificationsSettings {
  email_enabled: boolean;
  sms_enabled: boolean;
  low_stock_alerts: boolean;
  new_order_alerts: boolean;
  low_stock_alerts_email?: string | null;
  new_order_alerts_email?: string | null;
  low_stock_alerts_phone?: string | null;
  new_order_alerts_phone?: string | null;
}


@Component({
  selector: 'app-notifications-settings-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, InputComponent, SettingToggleComponent],
  templateUrl: './notifications-settings-form.component.html',
  styleUrls: ['./notifications-settings-form.component.scss'],
})
export class NotificationsSettingsForm implements OnInit, OnChanges {
  @Input() settings!: NotificationsSettings;
  @Output() settingsChange = new EventEmitter<NotificationsSettings>();

  private notificationsApi = inject(NotificationsApiService);
  pushService = inject(PushSubscriptionService);

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
    low_stock_alerts_phone: new FormControl(null, [Validators.pattern(/^[\d+#*\s()-]*$/)]),
    new_order_alerts_phone: new FormControl(null, [Validators.pattern(/^[\d+#*\s()-]*$/)]),
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

  ngOnInit() {
    this.patchForm();
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

  ngOnChanges() {
    this.patchForm();
  }

  patchForm() {
    if (this.settings) {
      this.form.patchValue(this.settings);
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
    this.notificationsApi.getSubscriptions().subscribe({
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
      .subscribe();
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
