import { Component, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
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
  ToastService,
} from '../../../../../shared/components/index';
import { formatStoreDateTime } from '../../../../../shared/utils/date.util';
import { environment } from '../../../../../../environments/environment';
import { SecretOnceModalComponent } from '../integrations/components/secret-once-modal.component';
import { toWorkflowError } from '../utils/workflow-errors.util';
import { WorkflowInboundApiService } from './workflow-inbound-api.service';
import { InboundHookState, MailboxState } from './workflow-inbound.interfaces';
import { inboundCurlExample, inboundHookUrl, parseRateLimit } from './workflow-inbound.utils';

/**
 * "Conexiones del flujo": the signed inbound webhook and the mailbox of a flow.
 * Shown by the editor only when the draft declares those triggers; activation
 * needs the flow published (the backend answers with the reason otherwise).
 */
@Component({
  selector: 'app-workflow-connections',
  standalone: true,
  imports: [
    FormsModule,
    AlertBannerComponent,
    BadgeComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SecretOnceModalComponent,
  ],
  template: `
    <section class="flex flex-col gap-4" aria-label="Conexiones del flujo">
      <div>
        <h2 class="text-sm font-bold text-text-primary">Conexiones del flujo</h2>
        <p class="text-xs text-text-secondary">Lo que otros sistemas necesitan para iniciar solicitudes de este flujo.</p>
      </div>

      @if (!published()) {
        <app-alert-banner variant="info" icon="info" data-testid="connections-unpublished">
          Publica el flujo para poder activar sus conexiones.
        </app-alert-banner>
      } @else if (hasUnpublishedChanges()) {
        <app-alert-banner variant="info" icon="info" data-testid="connections-unpublished-changes">
          Los disparadores nuevos o quitados rigen desde que publiques la versión.
        </app-alert-banner>
      }

      @if (hasWebhook()) {
        <div class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3" data-testid="webhook-connection">
          <div class="flex flex-wrap items-center gap-2">
            <p class="text-sm font-semibold text-text-primary">Webhook de entrada</p>
            @if (hook(); as h) {
              <app-badge [variant]="h.is_active ? 'success' : 'neutral'" size="sm">{{ h.is_active ? 'Activo' : 'Desactivado' }}</app-badge>
            }
          </div>
          @if (hookError(); as message) {
            <app-alert-banner variant="danger" icon="alert-circle">{{ message }}</app-alert-banner>
          }
          @if (hook(); as h) {
            <div class="flex flex-col gap-1">
              <p class="text-xs font-semibold text-text-secondary">URL</p>
              <div class="flex items-center gap-2">
                <p class="min-w-0 flex-1 break-all rounded-lg bg-background px-2 py-1.5 font-mono text-xs text-text-primary" data-testid="hook-url">{{ hookUrl(h) }}</p>
                <app-button variant="outline" size="xsm" ariaLabel="Copiar la URL" (clicked)="copy(hookUrl(h), 'URL copiada')">
                  <app-icon name="copy" [size]="12" slot="icon" />
                </app-button>
              </div>
            </div>
            <p class="text-xs text-text-secondary">
              {{ h.recent_requests_24h }} llamadas en las últimas 24 h
              @if (h.last_used_at) { · Último uso: {{ dateText(h.last_used_at) }} }
            </p>
            <div class="flex items-end gap-2">
              <div class="w-40">
                <app-input
                  label="Límite por minuto"
                  type="number"
                  min="1"
                  max="600"
                  size="sm"
                  [error]="limitError()"
                  [ngModel]="limit()"
                  (ngModelChange)="limit.set($event)"
                />
              </div>
              <app-button variant="outline" size="sm" [disabled]="busy() || !limitChanged(h)" (clicked)="saveLimit()">Guardar límite</app-button>
            </div>
            <div class="flex flex-wrap gap-2">
              <app-button variant="outline" size="sm" [disabled]="busy()" (clicked)="rotate()">
                <app-icon name="refresh-cw" [size]="14" slot="icon" />Rotar secreto
              </app-button>
              @if (h.is_active) {
                <app-button variant="outline-danger" size="sm" [disabled]="busy()" (clicked)="setHookActive(false)">Desactivar</app-button>
              } @else {
                <app-button variant="outline" size="sm" [disabled]="busy()" (clicked)="activate()">Activar de nuevo</app-button>
              }
            </div>
            <div class="flex flex-col gap-1">
              <div class="flex items-center justify-between gap-2">
                <p class="text-xs font-semibold text-text-secondary">Ejemplo firmado (bash + openssl)</p>
                <app-button variant="outline" size="xsm" ariaLabel="Copiar el ejemplo" (clicked)="copy(curl(h), 'Ejemplo copiado')">
                  <app-icon name="copy" [size]="12" slot="icon" />
                </app-button>
              </div>
              <pre class="overflow-x-auto rounded-lg bg-background p-2 font-mono text-xs text-text-primary" data-testid="hook-curl">{{ curl(h) }}</pre>
              <p class="text-xs text-text-secondary">
                Guarda el secreto en <span class="font-mono">VENDIX_WEBHOOK_SECRET</span>. La firma es el HMAC-SHA256 de
                <span class="font-mono">"marca de tiempo.cuerpo"</span> y la marca de tiempo no puede tener más de 5 minutos.
                Repetir la misma <span class="font-mono">Idempotency-Key</span> devuelve la misma referencia sin duplicar.
              </p>
            </div>
          } @else if (hookLoaded()) {
            <p class="text-xs text-text-secondary">Aún no está activo. Al activarlo verás la URL y un secreto (se muestra una sola vez).</p>
            <div>
              <app-button variant="primary" size="sm" [disabled]="busy() || !published()" (clicked)="activate()">Activar webhook</app-button>
            </div>
          } @else {
            <p class="text-xs text-text-secondary" role="status">Cargando…</p>
          }
        </div>
      }

      @if (hasEmail()) {
        <div class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3" data-testid="mailbox-connection">
          <div class="flex flex-wrap items-center gap-2">
            <p class="text-sm font-semibold text-text-primary">Correo entrante</p>
            @if (mailbox(); as m) {
              <app-badge [variant]="m.is_active ? 'success' : 'neutral'" size="sm">{{ m.is_active ? 'Activo' : 'Desactivado' }}</app-badge>
            }
          </div>
          @if (mailboxError(); as message) {
            <app-alert-banner variant="danger" icon="alert-circle">{{ message }}</app-alert-banner>
          }
          @if (mailbox(); as m) {
            <div class="flex flex-col gap-1">
              <p class="text-xs font-semibold text-text-secondary">Dirección del buzón</p>
              <div class="flex items-center gap-2">
                <p class="min-w-0 flex-1 break-all rounded-lg bg-background px-2 py-1.5 font-mono text-xs text-text-primary" data-testid="mailbox-address">{{ m.address }}</p>
                <app-button variant="outline" size="xsm" ariaLabel="Copiar la dirección" (clicked)="copy(m.address, 'Dirección copiada')">
                  <app-icon name="copy" [size]="12" slot="icon" />
                </app-button>
              </div>
            </div>
            <p class="text-xs text-text-secondary">
              {{ m.received_24h }} correos en las últimas 24 h
              @if (m.last_received_at) { · Último: {{ dateText(m.last_received_at) }} }
            </p>
            <p class="text-xs text-text-secondary">Los adjuntos de hasta 25 MB quedan en el expediente de la solicitud.</p>
            <div>
              @if (m.is_active) {
                <app-button variant="outline-danger" size="sm" [disabled]="busy()" (clicked)="setMailboxActive(false)">Desactivar buzón</app-button>
              } @else {
                <app-button variant="outline" size="sm" [disabled]="busy() || !published()" (clicked)="setMailboxActive(true)">Activar de nuevo</app-button>
              }
            </div>
          } @else if (mailboxLoaded()) {
            <p class="text-xs text-text-secondary">Aún no tiene buzón. Al activarlo se crea una dirección propia de este flujo.</p>
            <div>
              <app-button variant="primary" size="sm" [disabled]="busy() || !published()" (clicked)="activateMailbox()">Activar buzón</app-button>
            </div>
          } @else {
            <p class="text-xs text-text-secondary" role="status">Cargando…</p>
          }
        </div>
      }
    </section>

    <app-secret-once-modal
      [(isOpen)]="secretOpen"
      title="Secreto del webhook"
      subtitle="Úsalo para firmar las llamadas"
      label="Secreto de firma"
      [secret]="secret()"
    />
  `,
})
export class WorkflowConnectionsComponent {
  private readonly api = inject(WorkflowInboundApiService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly definitionId = input.required<number>();
  readonly hasWebhook = input(false);
  readonly hasEmail = input(false);
  /** The flow has a published version. */
  readonly published = input(false);
  readonly hasUnpublishedChanges = input(false);
  /** Keys of the declared form fields, used in the `curl` example. */
  readonly fieldKeys = input<readonly string[]>([]);

  readonly hook = signal<InboundHookState | null>(null);
  readonly hookLoaded = signal(false);
  readonly hookError = signal<string | null>(null);
  readonly mailbox = signal<MailboxState | null>(null);
  readonly mailboxLoaded = signal(false);
  readonly mailboxError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly limit = signal<string | number | null>(null);
  readonly secret = signal('');
  readonly secretOpen = signal(false);

  constructor() {
    effect(() => {
      const id = this.definitionId();
      if (this.hasWebhook()) untracked(() => this.loadHook(id));
    });
    effect(() => {
      const id = this.definitionId();
      if (this.hasEmail()) untracked(() => this.loadMailbox(id));
    });
  }

  hookUrl(hook: InboundHookState): string {
    return inboundHookUrl(environment.apiUrl, hook.path);
  }

  curl(hook: InboundHookState): string {
    return inboundCurlExample(this.hookUrl(hook), this.fieldKeys());
  }

  dateText(value: string): string {
    return formatStoreDateTime(value, this.settings.timezone());
  }

  limitError(): string | undefined {
    return parseRateLimit(this.limit()) === null ? 'Un número entero entre 1 y 600.' : undefined;
  }

  limitChanged(hook: InboundHookState): boolean {
    const parsed = parseRateLimit(this.limit());
    return parsed !== null && parsed !== hook.rate_limit_per_minute;
  }

  async copy(text: string, message: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.toast.success(message);
    } catch {
      this.toast.warning('No se pudo copiar; selecciona el texto y cópialo a mano.');
    }
  }

  private loadHook(id: number): void {
    this.api
      .hook(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (state) => {
          this.setHook(state);
          this.hookLoaded.set(true);
        },
        error: (error) => {
          this.hookLoaded.set(true);
          this.hookError.set(toWorkflowError(error).message);
        },
      });
  }

  private setHook(state: InboundHookState | null): void {
    this.hook.set(state);
    this.limit.set(state?.rate_limit_per_minute ?? null);
  }

  activate(): void {
    this.busy.set(true);
    this.hookError.set(null);
    this.api
      .activateHook(this.definitionId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ secret, ...state }) => {
          this.busy.set(false);
          this.setHook(state);
          this.showSecret(secret);
        },
        error: (error) => this.fail(error, this.hookError),
      });
  }

  async rotate(): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'Rotar secreto',
      message: 'El secreto anterior dejará de funcionar. Actualiza tu sistema con el nuevo. ¿Rotarlo?',
      confirmText: 'Rotar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    this.busy.set(true);
    this.hookError.set(null);
    this.api
      .rotateHook(this.definitionId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ secret, ...state }) => {
          this.busy.set(false);
          this.setHook(state);
          this.showSecret(secret);
        },
        error: (error) => this.fail(error, this.hookError),
      });
  }

  setHookActive(active: boolean): void {
    this.patchHook({ is_active: active }, active ? 'Webhook activado' : 'Webhook desactivado');
  }

  saveLimit(): void {
    const parsed = parseRateLimit(this.limit());
    if (parsed === null) return;
    this.patchHook({ rate_limit_per_minute: parsed }, 'Límite guardado');
  }

  private patchHook(patch: { is_active?: boolean; rate_limit_per_minute?: number }, done: string): void {
    this.busy.set(true);
    this.hookError.set(null);
    this.api
      .updateHook(this.definitionId(), patch)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (state) => {
          this.busy.set(false);
          this.setHook(state);
          this.toast.success(done);
        },
        error: (error) => this.fail(error, this.hookError),
      });
  }

  private showSecret(secret: string): void {
    this.secret.set(secret);
    this.secretOpen.set(true);
  }

  private loadMailbox(id: number): void {
    this.api
      .mailbox(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (state) => {
          this.mailbox.set(state);
          this.mailboxLoaded.set(true);
        },
        error: (error) => {
          this.mailboxLoaded.set(true);
          this.mailboxError.set(toWorkflowError(error).message);
        },
      });
  }

  activateMailbox(): void {
    this.busy.set(true);
    this.mailboxError.set(null);
    this.api
      .activateMailbox(this.definitionId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (state) => {
          this.busy.set(false);
          this.mailbox.set(state);
          this.toast.success('Buzón activado');
        },
        error: (error) => this.fail(error, this.mailboxError),
      });
  }

  setMailboxActive(active: boolean): void {
    this.busy.set(true);
    this.mailboxError.set(null);
    this.api
      .updateMailbox(this.definitionId(), active)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (state) => {
          this.busy.set(false);
          this.mailbox.set(state);
          this.toast.success(active ? 'Buzón activado' : 'Buzón desactivado');
        },
        error: (error) => this.fail(error, this.mailboxError),
      });
  }

  private fail(error: unknown, target: { set(value: string | null): void }): void {
    this.busy.set(false);
    target.set(toWorkflowError(error).message);
  }
}
