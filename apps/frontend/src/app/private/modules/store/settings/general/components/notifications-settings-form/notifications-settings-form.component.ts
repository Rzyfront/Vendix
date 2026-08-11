import {
  Component,
  OnInit,
  effect,
  inject,
  input,
  output,
  DestroyRef,
  computed,
  signal,
} from '@angular/core';
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
import { AlertBannerComponent } from '../../../../../../../shared/components/alert-banner/alert-banner.component';
import {
  BadgeComponent,
  BadgeVariant,
} from '../../../../../../../shared/components/badge/badge.component';
import { TooltipComponent } from '../../../../../../../shared/components/tooltip/tooltip.component';
import { ExpandableCardComponent } from '../../../../../../../shared/components/expandable-card/expandable-card.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../../shared/components/selector/selector.component';
import { NotificationsApiService } from '../../../../../../../core/services/notifications.service';
import { PushSubscriptionService } from '../../../../../../../core/services/push-subscription.service';
import {
  NotificationSoundsCatalogService,
  NotificationSoundCatalogItem,
} from '../../../../../../../core/services/notification-sounds-catalog.service';

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
  /**
   * Anticipación del aviso de vencimiento de cuotas de CxP, en días (0-30).
   * La consume el cron `ApDueNotificationsJob` por tienda.
   */
  ap_due_soon_days?: number;
}

/**
 * Metadatos de un tipo de suscripción en-la-app. El `trigger` describe el
 * evento REAL que crea la notificación, no el nombre del campo: es lo que el
 * operador necesita para decidir si la quiere encendida.
 */
interface SubscriptionMeta {
  readonly label: string;
  readonly trigger: string;
  readonly icon: string;
}

/**
 * Los tipos que este formulario expone. El backend inicializa más (los de
 * separados/layaway) con `in_app: true` y sin interruptor propio: esos llegan
 * siempre a la campana. Los de vencimientos CxP sí tienen interruptor: el
 * operador decide si quiere campana/web push para cada uno.
 */
const SUBSCRIPTION_META: Readonly<Record<string, SubscriptionMeta>> = {
  new_order: {
    label: 'Nuevas órdenes',
    trigger: 'Cuando entra un pedido nuevo, venga del POS o de la tienda.',
    icon: 'shopping-bag',
  },
  order_status_change: {
    label: 'Cambios de estado de orden',
    trigger:
      'Cuando una orden avanza o retrocede: confirmada, despachada, entregada, anulada.',
    icon: 'arrow-left-right',
  },
  low_stock: {
    label: 'Stock bajo',
    trigger:
      'Cuando un producto baja del mínimo que definiste en Inventario.',
    icon: 'package',
  },
  new_customer: {
    label: 'Nuevos clientes',
    trigger: 'Cuando se registra un cliente nuevo en la tienda.',
    icon: 'user-plus',
  },
  payment_received: {
    label: 'Pagos recibidos',
    trigger: 'Cuando se registra un pago sobre una orden o una cuenta.',
    icon: 'banknote',
  },
  new_review: {
    label: 'Nuevas reseñas',
    trigger: 'Cuando un cliente califica un producto o la tienda.',
    icon: 'star',
  },
  ap_installment_due_soon: {
    label: 'Pago a proveedor por vencer',
    trigger:
      'Cuando una cuota de Cuentas por Pagar entra en la ventana de anticipación que definiste en los ajustes de la tienda.',
    icon: 'calendar-clock',
  },
  ap_installment_overdue: {
    label: 'Pago a proveedor vencido',
    trigger:
      'Cuando una cuota de Cuentas por Pagar pasó su fecha de vencimiento sin pagarse.',
    icon: 'alert-triangle',
  },
};

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
    AlertBannerComponent,
    BadgeComponent,
    TooltipComponent,
    ExpandableCardComponent,
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
        this.syncSoundIdDisabledState();
        this.soundMuted.set(this.isSoundMuted);
      }
    });

    this.destroyRef.onDestroy(() => this.stopPreview());
  }

  /**
   * Era un campo plano. En zoneless, `initDevicePushState()` y
   * `onDevicePushToggle()` lo escriben DESPUÉS de un `await`: fuera del turno
   * del evento de plantilla, así que nada marcaba la vista sucia y el toggle se
   * quedaba pintado en el estado anterior. Como señal, el repintado es propio.
   */
  readonly devicePushEnabled = signal(false);

  /**
   * Espejo del permiso del navegador. `pushService.permissionState` lee
   * `Notification.permission`, que no es reactivo: se refresca a mano cada vez
   * que el permiso pudo haber cambiado.
   */
  readonly pushPermission = signal<NotificationPermission>('default');

  /**
   * Mismo motivo que `devicePushEnabled`: `loadSubscriptions()` escribe este
   * mapa desde el callback de un observable, sin evento de plantilla detrás.
   */
  readonly subscriptions = signal<Record<string, boolean>>({
    new_order: true,
    order_status_change: true,
    low_stock: true,
    new_customer: true,
    payment_received: true,
    new_review: true,
    ap_installment_due_soon: true,
    ap_installment_overdue: true,
  });

  readonly subscriptionMeta = SUBSCRIPTION_META;

  /** Panel colapsable con el diagnóstico de «no me llegan las notificaciones». */
  readonly troubleshootOpen = signal(false);

  /** Espejo en señal de `sound_muted` para las partes reactivas de la plantilla. */
  readonly soundMuted = signal(false);

  /**
   * Estado del canal de dispositivo, resumido en una insignia. Es la causa
   * número uno de «no me llegan las notificaciones»: si el navegador bloqueó el
   * permiso, ningún ajuste de esta pantalla lo puede reactivar.
   */
  readonly pushStatus = computed<{
    text: string;
    variant: BadgeVariant;
  }>(() => {
    if (!this.pushService.isSupported) {
      return { text: 'No compatible con este navegador', variant: 'neutral' };
    }
    if (this.pushPermission() === 'denied') {
      return { text: 'Bloqueado por el navegador', variant: 'error' };
    }
    if (this.devicePushEnabled()) {
      return { text: 'Activo en este dispositivo', variant: 'success' };
    }
    return { text: 'Requiere permisos del navegador', variant: 'warning' };
  });

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
    ap_due_soon_days: new FormControl<number>(1, [
      Validators.min(0),
      Validators.max(30),
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

  get apDueSoonDaysControl(): FormControl<number> {
    return this.form.get('ap_due_soon_days') as FormControl<number>;
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
    this.pushPermission.set(this.pushService.permissionState);
    if (this.pushService.permissionState === 'granted') {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager?.getSubscription();
      this.devicePushEnabled.set(!!sub);
    }
  }

  onFieldChange() {
    this.syncSoundIdDisabledState();
    this.soundMuted.set(this.isSoundMuted);
    if (this.form.valid) {
      this.settingsChange.emit(this.form.value);
    }
  }

  /**
   * Gobierna el disabled de sound_id desde el control reactivo (fuente de
   * verdad), no vía [disabled] en el template — que la directiva reactiva
   * intercepta y dispara la advertencia "disabled attribute with a reactive
   * form directive". Al silenciar sonidos, el selector queda deshabilitado.
   */
  private syncSoundIdDisabledState(): void {
    if (this.isSoundMuted) {
      this.soundIdControl.disable({ emitEvent: false });
    } else {
      this.soundIdControl.enable({ emitEvent: false });
    }
  }

  get isEmailEnabled(): boolean {
    return this.form.get('email_enabled')?.value ?? false;
  }

  get isSmsEnabled(): boolean {
    return this.form.get('sms_enabled')?.value ?? false;
  }

  readonly subscriptionTypes = computed(() =>
    Object.keys(this.subscriptions()),
  );

  loadSubscriptions() {
    this.notificationsApi
      .getSubscriptions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const subs = response?.data || [];
          this.subscriptions.update((current) => {
            const next = { ...current };
            for (const sub of subs) {
              if (sub.type in next) {
                next[sub.type] = sub.in_app;
              }
            }
            return next;
          });
        },
        error: () => {
          // Silently fail — subscriptions will use defaults
        },
      });
  }

  readonly devicePushDescription = computed(() => {
    if (!this.pushService.isSupported) {
      return 'Este navegador no admite avisos en el dispositivo';
    }
    if (this.pushPermission() === 'denied') {
      return 'Bloqueado por el navegador — habilita las notificaciones del sitio en la configuración del navegador y vuelve a intentarlo';
    }
    return this.devicePushEnabled()
      ? 'Recibirás alertas en este dispositivo aunque la app esté cerrada'
      : 'Al activarlo, el navegador te pedirá permiso para enviar notificaciones';
  });

  onSubscriptionToggle(type: string) {
    let nextValue = false;
    this.subscriptions.update((current) => {
      nextValue = !current[type];
      return { ...current, [type]: nextValue };
    });
    this.notificationsApi
      .updateSubscription({ type, in_app: nextValue })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
  }

  async onDevicePushToggle() {
    if (!this.devicePushEnabled()) {
      // Turning ON — request permission and subscribe
      const success = await this.pushService.requestPermissionAndSubscribe();
      this.devicePushEnabled.set(success);
    } else {
      // Turning OFF — unsubscribe
      await this.pushService.unsubscribe();
      this.devicePushEnabled.set(false);
    }
    // El permiso pudo cambiar dentro del diálogo del navegador (concedido o
    // bloqueado): refrescar el espejo para que la insignia diga la verdad.
    this.pushPermission.set(this.pushService.permissionState);
  }
}
