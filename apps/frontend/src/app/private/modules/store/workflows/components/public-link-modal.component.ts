import {
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import {
  AlertBannerComponent,
  BadgeComponent,
  ButtonComponent,
  DialogService,
  IconComponent,
  ModalComponent,
  ToastService,
} from '../../../../../shared/components/index';
import { formatStoreDateTime } from '../../../../../shared/utils/date.util';
import { WorkflowDefinitionRow } from '../interfaces/workflow.interfaces';
import { PublicLinkStatus } from '../interfaces/workflow-ops.interfaces';
import { WorkflowsApiService } from '../services/workflows-api.service';
import { toWorkflowError } from '../utils/workflow-errors.util';

/**
 * "Enlace público": one active link per flow that opens the public request
 * form (`/flujos/<token>`) on the store's own domain. The raw token only
 * exists in the response of create/rotate, so it is shown once here.
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
              {{ fullUrl(link.url_path) }}
            </p>
            <p class="mt-1 text-xs text-text-secondary">
              Va después del dominio público de tu tienda, por ejemplo
              <span class="font-mono">https://tu-tienda.com{{ link.url_path }}</span>.
            </p>
            <div class="mt-2 flex justify-end">
              <app-button variant="outline" size="sm" (clicked)="copy(link.url_path)">
                <app-icon name="copy" [size]="14" slot="icon" />
                Copiar enlace
              </app-button>
            </div>
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
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  readonly definition = input<WorkflowDefinitionRow | null>(null);

  readonly status = signal<PublicLinkStatus | null>(null);
  readonly created = signal<{ url_path: string; token: string } | null>(null);
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
  fullUrl(path: string): string {
    return path;
  }

  async copy(path: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.fullUrl(path));
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
        next: (link) => {
          this.busy.set(false);
          this.created.set(link);
          this.status.update((s) => ({
            active: true,
            created_at: new Date().toISOString(),
            expires_at: s?.expires_at ?? null,
            last_used_at: null,
          }));
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
          this.status.update((s) => (s ? { ...s, active: false } : s));
          this.toast.success('Enlace desactivado');
        },
        error: (error) => {
          this.busy.set(false);
          this.errorMessage.set(toWorkflowError(error).message);
        },
      });
  }

  private load(id: number): void {
    this.loading.set(true);
    this.api
      .getPublicLink(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (status) => {
          this.status.set(status);
          this.loading.set(false);
        },
        error: (error) => {
          this.loading.set(false);
          this.errorMessage.set(toWorkflowError(error).message);
        },
      });
  }
}
