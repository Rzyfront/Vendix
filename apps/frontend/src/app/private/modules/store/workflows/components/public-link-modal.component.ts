import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import {
  AlertBannerComponent,
  BadgeComponent,
  ButtonComponent,
  DialogService,
  IconComponent,
  InputComponent,
  ModalComponent,
  ToastService,
  ToggleComponent,
} from '../../../../../shared/components/index';
import { formatStoreDateTime } from '../../../../../shared/utils/date.util';
import { WorkflowDefinitionRow } from '../interfaces/workflow.interfaces';
import { PublicLinkStatus } from '../interfaces/workflow-ops.interfaces';
import {
  PublicLinkSettingsStatus,
  WorkflowLinksApiService,
} from '../services/workflow-links-api.service';
import { WorkflowsApiService } from '../services/workflows-api.service';
import { toWorkflowError } from '../utils/workflow-errors.util';

/** Calendar day (browser local) of an ISO instant, for `<input type="date">`. */
function localDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The link stops working at the end of the chosen day (browser local time). */
function endOfDayIso(date: string): string {
  return new Date(`${date}T23:59:59`).toISOString();
}

/**
 * "Enlace público": one active link per flow that opens the public request
 * form (`/flujos/<token>`) on the store's own domain. The raw token only
 * exists in the response of create/rotate, so it is shown once here, with its
 * QR (PNG download). Expiry and "Exigir captcha" apply to the active link.
 */
@Component({
  selector: 'app-workflow-public-link-modal',
  standalone: true,
  imports: [
    ModalComponent,
    ButtonComponent,
    BadgeComponent,
    IconComponent,
    AlertBannerComponent,
    FormsModule,
    InputComponent,
    ToggleComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      title="Enlace público"
      [subtitle]="definition()?.name ?? ''"
      size="md"
    >
      @if (loading()) {
        <p class="py-6 text-center text-sm text-text-secondary">Cargando...</p>
      } @else {
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <span class="text-sm text-text-secondary">Estado:</span>
          <app-badge [variant]="status()?.active ? 'success' : 'neutral'" size="sm">
            {{ status()?.active ? 'Activo' : 'Desactivado' }}
          </app-badge>
          @if (status()?.active && status()?.last_used_at) {
            <span class="text-xs text-text-secondary">
              Último uso: {{ dateText(status()!.last_used_at!) }}
            </span>
          }
        </div>
        <p class="text-sm text-text-secondary">
          Cualquier persona con el enlace puede enviar una solicitud de este flujo sin iniciar
          sesión. Compártelo solo con quien corresponda.
        </p>

        @if (created(); as link) {
          <div class="mt-4 rounded-xl border border-border p-3" data-testid="new-link">
            <p class="text-sm font-semibold text-text-primary">Tu enlace</p>
            <p class="mt-1 break-all rounded-lg bg-background px-2 py-1.5 font-mono text-xs">
              {{ fullUrl(link) }}
            </p>
            <p class="mt-1 text-xs text-text-secondary">
              Va después del dominio público de tu tienda, por ejemplo
              <span class="font-mono">https://tu-tienda.com{{ link.url_path }}</span>.
            </p>
            <div class="mt-2 flex justify-end">
              <app-button variant="outline" size="sm" (clicked)="copy(link)">
                <app-icon name="copy" [size]="14" slot="icon" />
                Copiar enlace
              </app-button>
            </div>
            @if (qrDataUrl(); as qr) {
              <div class="mt-3 flex flex-col items-center gap-2" data-testid="qr">
                <img [src]="qr" alt="Código QR del enlace público"
                  class="h-44 w-44 rounded-lg border border-border bg-white" />
                <app-button variant="outline" size="sm" (clicked)="downloadQr()">
                  <app-icon name="download" [size]="14" slot="icon" />
                  Descargar QR
                </app-button>
              </div>
            } @else if (!link.url) {
              <p class="mt-3 text-xs text-text-secondary">
                Para generar el código QR tu tienda necesita un dominio público activo.
              </p>
            }
          </div>
          <app-alert-banner variant="warning" icon="alert-triangle" class="mt-3">
            Cópialo ahora: por seguridad solo se muestra esta vez. Si lo pierdes, rota el enlace
            para generar uno nuevo.
          </app-alert-banner>
        } @else if (status()?.active) {
          <app-alert-banner variant="info" icon="info" class="mt-4">
            El enlace ya existe, pero no se puede volver a mostrar. Si lo perdiste, rótalo: el
            anterior dejará de funcionar.
          </app-alert-banner>
        }
        @if (status()?.active) {
          <div class="mt-4 rounded-xl border border-border p-3" data-testid="link-settings">
            <p class="text-sm font-semibold text-text-primary">Ajustes del enlace</p>
            <div class="mt-2 grid gap-3 sm:grid-cols-2">
              <app-input
                type="date"
                label="Vence el"
                helperText="Vacío: no vence. El enlace deja de funcionar al terminar ese día."
                [ngModel]="expiryDate()"
                [ngModelOptions]="{ standalone: true }"
                (ngModelChange)="expiryDate.set($event ?? '')"
              />
              <div class="flex flex-col gap-1">
                <app-toggle
                  label="Exigir captcha"
                  [checked]="captchaRequired()"
                  (toggled)="captchaRequired.set($event)"
                />
                <span class="text-xs text-text-secondary">
                  La persona resuelve una verificación automática antes de enviar.
                </span>
              </div>
            </div>
            <div class="mt-3 flex justify-end">
              <app-button variant="outline" size="sm" [loading]="savingSettings()"
                [disabled]="!settingsDirty()" (clicked)="saveSettings()">
                Guardar ajustes
              </app-button>
            </div>
          </div>
        }
        @if (errorMessage()) {
          <p class="mt-3 text-sm text-error" role="alert">{{ errorMessage() }}</p>
        }
      }

      <div slot="footer" class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <app-button variant="outline" (clicked)="onOpenChange(false)">Cerrar</app-button>
        @if (status()?.active) {
          <app-button variant="outline-danger" [loading]="busy()" (clicked)="revoke()">
            Desactivar
          </app-button>
          <app-button variant="primary" [loading]="busy()" (clicked)="create(true)">
            Rotar enlace
          </app-button>
        } @else {
          <app-button variant="primary" [loading]="busy()" (clicked)="create(false)">
            Crear enlace
          </app-button>
        }
      </div>
    </app-modal>
  `,
})
export class WorkflowPublicLinkModalComponent {
  private readonly api = inject(WorkflowsApiService);
  private readonly linksApi = inject(WorkflowLinksApiService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  readonly definition = input<WorkflowDefinitionRow | null>(null);

  readonly status = signal<(PublicLinkStatus & { captcha_required?: boolean }) | null>(null);
  readonly created = signal<{ url_path: string; token: string; url?: string | null } | null>(null);
  readonly qrDataUrl = signal<string | null>(null);
  readonly expiryDate = signal('');
  readonly captchaRequired = signal(false);
  readonly savingSettings = signal(false);
  /** The inputs differ from what the server has for the active link. */
  readonly settingsDirty = computed(() => {
    const s = this.status();
    return (
      !!s &&
      (this.expiryDate() !== localDateInput(s.expires_at) ||
        this.captchaRequired() !== (s.captcha_required ?? false))
    );
  });
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly errorMessage = signal('');

  constructor() {
    effect(() => {
      const open = this.isOpen();
      const definition = this.definition();
      untracked(() => {
        if (open && definition) this.load(definition.id);
      });
    });
  }

  onOpenChange(open: boolean): void {
    this.isOpen.set(open);
    if (!open) {
      this.created.set(null);
      this.qrDataUrl.set(null);
      this.status.set(null);
      this.errorMessage.set('');
    }
  }

  dateText(value: string): string {
    return formatStoreDateTime(value, this.settings.timezone());
  }

  /**
   * The admin does not know the store's public host, so the link is the path
   * under that domain; the hint in the template says where to prepend it.
   */
  fullUrl(link: { url_path: string; url?: string | null }): string {
    return link.url ?? link.url_path;
  }

  async copy(link: { url_path: string; url?: string | null }): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.fullUrl(link));
      this.toast.success('Enlace copiado');
    } catch {
      this.toast.warning('No se pudo copiar; selecciona el texto y cópialo a mano.');
    }
  }

  async create(rotating: boolean): Promise<void> {
    const definition = this.definition();
    if (!definition || this.busy()) return;
    if (rotating) {
      const confirmed = await this.dialog.confirm({
        title: 'Rotar enlace',
        message: 'El enlace anterior dejará de funcionar. ¿Rotar el enlace?',
        confirmText: 'Rotar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      });
      if (!confirmed) return;
    }
    this.busy.set(true);
    this.errorMessage.set('');
    this.api
      .createPublicLink(definition.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (link: { url_path: string; token: string; url?: string | null }) => {
          this.busy.set(false);
          this.created.set(link);
          // A new link starts without expiry or captcha.
          this.status.set({
            active: true,
            created_at: new Date().toISOString(),
            expires_at: null,
            last_used_at: null,
            captcha_required: false,
          });
          this.expiryDate.set('');
          this.captchaRequired.set(false);
          void this.buildQr(link.url ?? null);
        },
        error: (error) => {
          this.busy.set(false);
          this.errorMessage.set(toWorkflowError(error).message);
        },
      });
  }

  revoke(): void {
    const definition = this.definition();
    if (!definition || this.busy()) return;
    this.busy.set(true);
    this.errorMessage.set('');
    this.api
      .revokePublicLink(definition.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.created.set(null);
          this.qrDataUrl.set(null);
          this.status.update((s) => (s ? { ...s, active: false } : s));
          this.toast.success('Enlace desactivado');
        },
        error: (error) => {
          this.busy.set(false);
          this.errorMessage.set(toWorkflowError(error).message);
        },
      });
  }

  saveSettings(): void {
    const definition = this.definition();
    if (!definition || this.savingSettings() || !this.settingsDirty()) return;
    this.savingSettings.set(true);
    this.errorMessage.set('');
    this.linksApi
      .updatePublicLinkSettings(definition.id, {
        captcha_required: this.captchaRequired(),
        expires_at: this.expiryDate() ? endOfDayIso(this.expiryDate()) : null,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (status: PublicLinkSettingsStatus) => {
          this.savingSettings.set(false);
          this.status.set(status);
          this.expiryDate.set(localDateInput(status.expires_at));
          this.captchaRequired.set(status.captcha_required);
          this.toast.success('Ajustes del enlace guardados');
        },
        error: (error) => {
          this.savingSettings.set(false);
          this.errorMessage.set(toWorkflowError(error).message);
        },
      });
  }

  downloadQr(): void {
    const dataUrl = this.qrDataUrl();
    if (!dataUrl) return;
    const anchor = document.createElement('a');
    anchor.href = dataUrl;
    anchor.download = `qr-${this.definition()?.key ?? 'flujo'}.png`;
    anchor.click();
  }

  /** QR of the full public URL (needs an active public domain of the store). */
  private async buildQr(url: string | null): Promise<void> {
    this.qrDataUrl.set(null);
    if (!url) return;
    try {
      const QRCode = await import('qrcode');
      this.qrDataUrl.set(
        await QRCode.toDataURL(url, {
          width: 480,
          margin: 2,
          color: { dark: '#0f172a', light: '#ffffff' },
        }),
      );
    } catch {
      this.toast.warning('No se pudo generar el código QR.');
    }
  }

  private load(id: number): void {
    this.loading.set(true);
    this.api
      .getPublicLink(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (status: PublicLinkStatus & { captcha_required?: boolean }) => {
          this.status.set(status);
          this.expiryDate.set(localDateInput(status.expires_at));
          this.captchaRequired.set(status.captcha_required ?? false);
          this.loading.set(false);
        },
        error: (error) => {
          this.loading.set(false);
          this.errorMessage.set(toWorkflowError(error).message);
        },
      });
  }
}
