import { Component, computed, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import {
  AlertBannerComponent,
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  IconComponent,
  InputComponent,
  ToastService,
  ToggleComponent,
} from '../../../../../../shared/components';
import type { BadgeVariant } from '../../../../../../shared/components';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { MessagingChannelsService } from './messaging-channels.service';
import {
  EmailChannel,
  MessagingChannels,
  SmsChannel,
} from './messaging-channels.interface';

interface ChannelState {
  label: string;
  variant: BadgeVariant;
}

/** Mirrors `MAX_MONTHLY_SMS_SPEND_USD` of the backend DTO. */
const MAX_MONTHLY_SMS_SPEND_USD = 10_000;

/**
 * SMS and email cards of Integraciones → Canales (PLAN-CRM §7). SMS goes
 * through the platform SNS account with a hard monthly cap per store; email
 * through the platform SES sender with the store name and Reply-To.
 */
@Component({
  selector: 'app-messaging-channel-cards',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    AlertBannerComponent,
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    InputComponent,
    ToggleComponent,
  ],
  template: `
    @if (loadError()) {
      <app-alert-banner variant="danger" icon="triangle-alert">
        {{ loadError() }}
        <button
          type="button"
          class="ml-2 font-semibold underline"
          (click)="load()"
        >
          Reintentar
        </button>
      </app-alert-banner>
    }

    <div class="grid gap-7 lg:grid-cols-2">
      <!-- SMS -->
      <app-card [responsivePadding]="true" overflow="visible">
        <div class="flex flex-col gap-5">
          <div class="flex items-start gap-4">
            <div
              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
            >
              <app-icon name="smartphone" [size]="20"></app-icon>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <h2
                  class="text-base font-semibold text-[var(--color-text-primary)]"
                >
                  SMS
                </h2>
                <app-badge [variant]="smsState().variant" size="sm">
                  {{ smsState().label }}
                </app-badge>
              </div>
              <p class="mt-2 text-sm text-[var(--color-text-secondary)]">
                Responde por SMS desde la bandeja. Vendix asume el costo hasta
                el tope mensual que definas; al llegar, los SMS se pausan y te
                avisamos.
              </p>
            </div>
          </div>

          @if (loading()) {
            <div
              class="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]"
            >
              <app-icon name="loader-2" [size]="16" [spin]="true"></app-icon>
              Cargando configuración…
            </div>
          } @else {
            @if (sms(); as channel) {
              <div class="rounded-xl border border-[var(--color-border)] p-4">
                <div class="flex items-center justify-between text-sm">
                  <span class="text-[var(--color-text-secondary)]"
                    >Gastado este mes</span
                  >
                  <span class="font-bold text-[var(--color-text-primary)]">
                    {{ usd(channel.spend.used) }}
                    @if (channel.spend.limit !== null) {
                      <span
                        class="font-normal text-[var(--color-text-secondary)]"
                      >
                        de {{ usd(channel.spend.limit) }}
                      </span>
                    }
                  </span>
                </div>
                <div
                  class="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-surface-muted)]"
                  role="progressbar"
                  aria-label="Gasto de SMS del mes"
                  [attr.aria-valuenow]="spendPercent()"
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  <div
                    class="h-full rounded-full"
                    [class.bg-primary]="spendPercent() < 100"
                    [class.bg-error]="spendPercent() >= 100"
                    [style.width.%]="spendPercent()"
                  ></div>
                </div>
                <p class="mt-2 text-xs text-[var(--color-text-secondary)]">
                  Periodo desde {{ channel.spend.period_start }} (UTC).
                </p>
              </div>
            }

            <form
              class="flex flex-col gap-4"
              [formGroup]="smsForm"
              (ngSubmit)="saveSms()"
            >
              <app-toggle
                formControlName="enabled"
                label="Activar SMS"
                ariaLabel="Activar SMS"
              ></app-toggle>
              <app-input
                label="Tope mensual (USD)"
                type="number"
                formControlName="monthly_spend_limit"
                [min]="0"
                [max]="maxSpend"
                step="0.01"
                [required]="true"
                helperText="0 bloquea todos los SMS."
                [error]="fieldError(smsForm.controls.monthly_spend_limit, 'Indica un tope entre 0 y 10.000 USD.')"
              ></app-input>
              <app-input
                label="Remitente (Sender ID, opcional)"
                formControlName="sender_id"
                placeholder="MiTienda"
                [maxlength]="11"
                helperText="De 1 a 11 letras o números. Colombia no lo muestra."
                [error]="fieldError(smsForm.controls.sender_id, 'Usa de 1 a 11 letras o números, con al menos una letra.')"
              ></app-input>
              <div class="flex justify-end">
                <app-button
                  type="submit"
                  variant="primary"
                  size="md"
                  [loading]="savingSms()"
                  [disabled]="!canManage()"
                >
                  <app-icon slot="icon" name="save" [size]="16"></app-icon>
                  Guardar SMS
                </app-button>
              </div>
            </form>
          }
        </div>
      </app-card>

      <!-- Email -->
      <app-card [responsivePadding]="true" overflow="visible">
        <div class="flex flex-col gap-5">
          <div class="flex items-start gap-4">
            <div
              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
            >
              <app-icon name="mail" [size]="20"></app-icon>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <h2
                  class="text-base font-semibold text-[var(--color-text-primary)]"
                >
                  Correo
                </h2>
                <app-badge [variant]="emailState().variant" size="sm">
                  {{ emailState().label }}
                </app-badge>
              </div>
              <p class="mt-2 text-sm text-[var(--color-text-secondary)]">
                Escribe a tus clientes por correo desde la bandeja. Sale del
                remitente verificado de Vendix con el nombre de tu tienda; las
                respuestas llegan a tu dirección.
              </p>
            </div>
          </div>

          @if (loading()) {
            <div
              class="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]"
            >
              <app-icon name="loader-2" [size]="16" [spin]="true"></app-icon>
              Cargando configuración…
            </div>
          } @else {
            <form
              class="flex flex-col gap-4"
              [formGroup]="emailForm"
              (ngSubmit)="saveEmail()"
            >
              <app-toggle
                formControlName="enabled"
                label="Activar correo"
                ariaLabel="Activar correo"
              ></app-toggle>
              <app-input
                label="Nombre del remitente (opcional)"
                formControlName="from_name"
                placeholder="Mi Tienda"
                [maxlength]="80"
                [error]="fieldError(emailForm.controls.from_name, 'Sin saltos de línea, comillas ni < >.')"
              ></app-input>
              <app-input
                label="Responder a (opcional)"
                type="email"
                formControlName="reply_to"
                placeholder="hola@mitienda.co"
                [maxlength]="160"
                [error]="fieldError(emailForm.controls.reply_to, 'Escribe un correo válido.')"
              ></app-input>
              <div class="flex justify-end">
                <app-button
                  type="submit"
                  variant="primary"
                  size="md"
                  [loading]="savingEmail()"
                  [disabled]="!canManage()"
                >
                  <app-icon slot="icon" name="save" [size]="16"></app-icon>
                  Guardar correo
                </app-button>
              </div>
            </form>
          }
        </div>
      </app-card>
    </div>

    @if (!canManage()) {
      <p class="mt-3 text-xs text-[var(--color-text-secondary)]">
        Solo quien administra los canales de la tienda puede cambiar esta
        configuración.
      </p>
    }
  `,
})
export class MessagingChannelCardsComponent {
  private readonly service = inject(MessagingChannelsService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthFacade);

  protected readonly maxSpend = MAX_MONTHLY_SMS_SPEND_USD;
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly savingSms = signal(false);
  protected readonly savingEmail = signal(false);
  protected readonly sms = signal<SmsChannel | null>(null);
  protected readonly email = signal<EmailChannel | null>(null);
  /** Bumped on submit so field errors render after a failed save attempt. */
  private readonly submitted = signal(0);

  protected readonly canManage = computed(
    () =>
      this.auth.hasPermission('store:social_sales:manage') ||
      this.auth.isOwner(),
  );

  protected readonly smsForm = new FormGroup({
    enabled: new FormControl(false, { nonNullable: true }),
    monthly_spend_limit: new FormControl<number | null>(null, [
      Validators.required,
      Validators.min(0),
      Validators.max(MAX_MONTHLY_SMS_SPEND_USD),
    ]),
    sender_id: new FormControl('', {
      nonNullable: true,
      validators: [Validators.pattern(/^$|^(?=.*[A-Za-z])[A-Za-z0-9]{1,11}$/)],
    }),
  });

  protected readonly emailForm = new FormGroup({
    enabled: new FormControl(false, { nonNullable: true }),
    from_name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(80), Validators.pattern(/^[^\r\n"<>]*$/)],
    }),
    reply_to: new FormControl('', {
      nonNullable: true,
      validators: [Validators.email, Validators.maxLength(160)],
    }),
  });

  protected readonly smsState = computed<ChannelState>(() => {
    const channel = this.sms();
    if (this.loadError()) return { label: 'Error', variant: 'error' };
    if (!channel) return { label: 'Sin configurar', variant: 'neutral' };
    if (!channel.enabled) return { label: 'Desactivado', variant: 'neutral' };
    const { limit, remaining } = channel.spend;
    if (limit === null || limit === 0) {
      return { label: 'Pendiente: define un tope', variant: 'warning' };
    }
    if (remaining !== null && remaining <= 0) {
      return { label: 'Tope alcanzado', variant: 'error' };
    }
    return { label: 'Conectado', variant: 'success' };
  });

  protected readonly emailState = computed<ChannelState>(() => {
    const channel = this.email();
    if (this.loadError()) return { label: 'Error', variant: 'error' };
    if (!channel) return { label: 'Sin configurar', variant: 'neutral' };
    return channel.enabled
      ? { label: 'Conectado', variant: 'success' }
      : { label: 'Desactivado', variant: 'neutral' };
  });

  protected readonly spendPercent = computed(() => {
    const spend = this.sms()?.spend;
    if (!spend?.limit) return spend && spend.limit === 0 ? 100 : 0;
    return Math.min(100, Math.round((spend.used / spend.limit) * 100));
  });

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.apply(await firstValueFrom(this.service.list()));
    } catch (error) {
      this.loadError.set(parseApiError(error).userMessage);
    } finally {
      this.loading.set(false);
    }
  }

  protected async saveSms(): Promise<void> {
    this.submitted.update((n) => n + 1);
    if (this.smsForm.invalid) {
      this.smsForm.markAllAsTouched();
      return;
    }
    const value = this.smsForm.getRawValue();
    this.savingSms.set(true);
    try {
      const saved = await firstValueFrom(
        this.service.updateSms({
          enabled: value.enabled,
          sender_id: value.sender_id.trim() || null,
          monthly_spend_limit: Number(value.monthly_spend_limit),
        }),
      );
      this.sms.set(saved);
      this.toast.success('Canal SMS guardado');
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    } finally {
      this.savingSms.set(false);
    }
  }

  protected async saveEmail(): Promise<void> {
    this.submitted.update((n) => n + 1);
    if (this.emailForm.invalid) {
      this.emailForm.markAllAsTouched();
      return;
    }
    const value = this.emailForm.getRawValue();
    this.savingEmail.set(true);
    try {
      const saved = await firstValueFrom(
        this.service.updateEmail({
          enabled: value.enabled,
          from_name: value.from_name.trim() || null,
          reply_to: value.reply_to.trim() || null,
        }),
      );
      this.email.set(saved);
      this.toast.success('Canal de correo guardado');
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    } finally {
      this.savingEmail.set(false);
    }
  }

  /** Error text for a touched invalid control; reads `submitted` to re-render. */
  protected fieldError(control: FormControl<unknown>, message: string): string {
    this.submitted();
    return control.invalid && (control.touched || control.dirty) ? message : '';
  }

  protected usd(value: number): string {
    return `US$ ${value.toFixed(2)}`;
  }

  private apply(channels: MessagingChannels): void {
    this.sms.set(channels.sms);
    this.email.set(channels.email);
    if (channels.sms) {
      this.smsForm.reset({
        enabled: channels.sms.enabled,
        monthly_spend_limit: channels.sms.spend.limit,
        sender_id: channels.sms.sender_id ?? '',
      });
    }
    if (channels.email) {
      this.emailForm.reset({
        enabled: channels.email.enabled,
        from_name: channels.email.from_name ?? '',
        reply_to: channels.email.reply_to ?? '',
      });
    }
  }
}
