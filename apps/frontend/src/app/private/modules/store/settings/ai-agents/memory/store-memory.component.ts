import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { ConfirmationModalComponent } from '../../../../../../shared/components/confirmation-modal/confirmation-modal.component';
import { EmptyStateComponent } from '../../../../../../shared/components/empty-state/empty-state.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { canConfigureAiAgents } from '../../../../../../core/guards/vexi-settings.guard';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { formatStoreDateTime } from '../../../../../../shared/utils/date.util';
import {
  StoreMemoryItem,
  StoreMemoryLimits,
} from './store-memory.interface';
import { StoreMemoryService } from './store-memory.service';

const DEFAULT_LIMITS: StoreMemoryLimits = {
  max_entries: 40,
  max_chars: 2000,
  used_entries: 0,
  used_chars: 0,
};

/** Per-entry cap of the backend column (`content` VarChar(500)). */
const MAX_ENTRY_CHARS = 500;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "Memoria de la tienda" (Ajustes → Agentes IA).
 *
 * Lists what Vex remembers about the store (shared by every user of the
 * store) and lets the owner/admin add, edit and delete entries. The page is
 * already gated by `aiAgentsSettingsGuard`; the block repeats the same role
 * check so any other role sees nothing (and never calls the API) instead of
 * a 403. Limits and secret-content rules are enforced server-side and their
 * messages are shown as returned.
 */
@Component({
  selector: 'app-store-memory',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    ConfirmationModalComponent,
    EmptyStateComponent,
    IconComponent,
    ModalComponent,
    TextareaComponent,
  ],
  template: `
    @if (canManage()) {
    <section
      class="mt-6 bg-surface rounded-lg shadow-sm border border-[var(--color-border)] p-4 sm:p-6"
      aria-labelledby="store-memory-title"
    >
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-start gap-3 min-w-0">
          <span
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)]"
            aria-hidden="true"
          >
            <app-icon name="brain" [size]="20" />
          </span>
          <div class="min-w-0">
            <h2
              id="store-memory-title"
              class="text-lg font-semibold text-[var(--color-text-primary)]"
            >
              Memoria de la tienda
            </h2>
            <p class="text-sm text-[var(--color-text-secondary)]" aria-live="polite">
              {{ countLabel() }}
            </p>
          </div>
        </div>
        <app-button
          variant="outline"
          size="sm"
          [ariaPressed]="expanded()"
          (clicked)="toggle()"
        >
          {{ expanded() ? 'Ocultar' : 'Ver recuerdos' }}
        </app-button>
      </div>

      @if (expanded()) {
        <div class="mt-5 border-t border-[var(--color-border)] pt-5">
          @if (loading()) {
            <p class="text-sm text-[var(--color-text-secondary)]" role="status">
              Cargando recuerdos…
            </p>
          } @else if (loadError(); as message) {
            <div
              class="rounded-lg border border-[var(--color-destructive)] p-4 text-sm text-[var(--color-text-primary)]"
              role="alert"
            >
              <p class="mb-3">{{ message }}</p>
              <app-button variant="outline" size="sm" (clicked)="load()">
                Reintentar
              </app-button>
            </div>
          } @else {
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div class="min-w-0 sm:flex-1">
                <p class="text-sm font-medium text-[var(--color-text-primary)]">
                  {{ limits().used_entries }} de {{ limits().max_entries }} recuerdos ·
                  {{ limits().used_chars }} de {{ limits().max_chars }} caracteres (clave incluida)
                </p>
                <div
                  class="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-secondary)]"
                  role="progressbar"
                  aria-label="Uso de la memoria de la tienda"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  [attr.aria-valuenow]="usagePercent()"
                >
                  <div
                    class="h-full rounded-full bg-primary-600 transition-all"
                    [style.width.%]="usagePercent()"
                  ></div>
                </div>
              </div>
              <div class="flex flex-wrap gap-2">
                <app-button variant="primary" size="sm" (clicked)="openCreate()">
                  <app-icon name="plus" [size]="16" slot="icon" />
                  Agregar recuerdo
                </app-button>
                @if (items().length > 0) {
                  <app-button
                    variant="outline-danger"
                    size="sm"
                    (clicked)="confirmClearAll.set(true)"
                  >
                    Borrar todo
                  </app-button>
                }
              </div>
            </div>

            @if (items().length === 0) {
              <div class="mt-5">
                <app-empty-state
                  icon="brain"
                  title="Todavía no hay recuerdos"
                  description="Vex guarda aquí las preferencias de tu tienda, por ejemplo si prefieres aprender con video o paso a paso. Todos los usuarios de la tienda las comparten."
                  [showActionButton]="false"
                />
              </div>
            } @else {
              <ul class="mt-5 space-y-3">
                @for (item of items(); track item.id) {
                  <li
                    class="rounded-lg border border-[var(--color-border)] p-4"
                  >
                    <p class="text-sm text-[var(--color-text-primary)] break-words whitespace-pre-line">
                      {{ item.content }}
                    </p>
                    <div
                      class="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div
                        class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-text-secondary)]"
                      >
                        <span
                          class="inline-flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-2 py-0.5 font-semibold text-[var(--color-text-primary)]"
                        >
                          {{ item.origin === 'manual' ? 'Manual' : 'Vex' }}
                        </span>
                        <span>{{ authorLabel(item) }}</span>
                        <span aria-hidden="true">·</span>
                        <time
                          [attr.datetime]="item.updated_at"
                          [attr.title]="absoluteDate(item.updated_at)"
                        >
                          {{ relativeDate(item.updated_at) }}
                        </time>
                      </div>
                      <div class="flex gap-2">
                        <app-button
                          variant="outline"
                          size="xsm"
                          (clicked)="openEdit(item)"
                        >
                          Editar
                        </app-button>
                        <app-button
                          variant="outline-danger"
                          size="xsm"
                          (clicked)="itemToDelete.set(item)"
                        >
                          Borrar
                        </app-button>
                      </div>
                    </div>
                  </li>
                }
              </ul>
            }
          }
        </div>
      }
    </section>

    <app-modal
      [isOpen]="editorOpen()"
      (isOpenChange)="onEditorOpenChange($event)"
      [title]="editing() ? 'Editar recuerdo' : 'Agregar recuerdo'"
      size="md"
    >
      <div class="space-y-2">
        <app-textarea
          label="Recuerdo"
          placeholder="Ej.: Prefiero que me expliquen con video."
          [rows]="4"
          [required]="true"
          [error]="editorError() ?? undefined"
          [helperText]="draft().length + ' de ' + maxEntryChars + ' caracteres'"
          [ngModel]="draft()"
          (ngModelChange)="onDraftChange($event)"
        />
      </div>
      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="outline" [disabled]="saving()" (clicked)="closeEditor()">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          [loading]="saving()"
          [disabled]="!canSave()"
          (clicked)="save()"
        >
          Guardar
        </app-button>
      </div>
    </app-modal>

    <app-confirmation-modal
      [isOpen]="itemToDelete() !== null"
      (isOpenChange)="onDeleteOpenChange($event)"
      title="Borrar recuerdo"
      message="Vex dejará de recordar esto. Esta acción no se puede deshacer."
      confirmText="Borrar"
      confirmVariant="danger"
      (confirm)="deleteItem()"
    />

    <app-confirmation-modal
      [isOpen]="confirmClearAll()"
      (isOpenChange)="confirmClearAll.set($event)"
      title="Borrar toda la memoria"
      message="Se borrarán todos los recuerdos de Vex sobre tu tienda. Esta acción no se puede deshacer."
      confirmText="Borrar todo"
      confirmVariant="danger"
      (confirm)="clearAll()"
    />
    }
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
})
export class StoreMemoryComponent {
  private readonly service = inject(StoreMemoryService);
  private readonly toast = inject(ToastService);
  private readonly settingsFacade = inject(StoreSettingsFacade);
  private readonly authFacade = inject(AuthFacade);

  /** Same owner/admin rule as the backend `@Roles(OWNER, ADMIN)`. */
  readonly canManage = computed(() => canConfigureAiAgents(this.authFacade));

  readonly maxEntryChars = MAX_ENTRY_CHARS;

  readonly expanded = signal(false);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly loaded = signal(false);
  readonly items = signal<StoreMemoryItem[]>([]);
  readonly limits = signal<StoreMemoryLimits>(DEFAULT_LIMITS);

  readonly editorOpen = signal(false);
  readonly editing = signal<StoreMemoryItem | null>(null);
  readonly draft = signal('');
  readonly editorError = signal<string | null>(null);
  readonly saving = signal(false);

  readonly itemToDelete = signal<StoreMemoryItem | null>(null);
  readonly confirmClearAll = signal(false);

  readonly usagePercent = computed(() => {
    const l = this.limits();
    const byEntries = l.max_entries > 0 ? l.used_entries / l.max_entries : 0;
    const byChars = l.max_chars > 0 ? l.used_chars / l.max_chars : 0;
    return Math.min(100, Math.round(Math.max(byEntries, byChars) * 100));
  });

  readonly countLabel = computed(() => {
    if (!this.loaded()) return 'Lo que Vex recuerda de tu negocio';
    const n = this.limits().used_entries;
    return n === 1 ? '1 recuerdo' : `${n} recuerdos`;
  });

  readonly canSave = computed(
    () =>
      !this.saving() &&
      this.draft().trim().length > 0 &&
      this.draft().length <= MAX_ENTRY_CHARS,
  );

  private readonly timezone = computed(
    () => this.settingsFacade.settings()?.general?.timezone || 'America/Bogota',
  );

  constructor() {
    // Load once so the entry shows its count before it is expanded.
    if (this.canManage()) void this.load(true);
  }

  toggle(): void {
    const next = !this.expanded();
    this.expanded.set(next);
    if (next && (!this.loaded() || this.loadError())) void this.load();
  }

  async load(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    this.loadError.set(null);
    try {
      const data = await firstValueFrom(this.service.list());
      this.items.set(data?.items ?? []);
      this.limits.set(data?.limits ?? DEFAULT_LIMITS);
      this.loaded.set(true);
    } catch (error) {
      if (!silent) {
        this.loadError.set(parseApiError(error).userMessage);
      }
    } finally {
      this.loading.set(false);
    }
  }

  openCreate(): void {
    this.editing.set(null);
    this.draft.set('');
    this.editorError.set(null);
    this.editorOpen.set(true);
  }

  openEdit(item: StoreMemoryItem): void {
    this.editing.set(item);
    this.draft.set(item.content);
    this.editorError.set(null);
    this.editorOpen.set(true);
  }

  closeEditor(): void {
    this.editorOpen.set(false);
  }

  onEditorOpenChange(open: boolean): void {
    this.editorOpen.set(open);
    if (!open) this.editorError.set(null);
  }

  onDraftChange(value: string): void {
    this.draft.set(value ?? '');
    this.editorError.set(null);
  }

  async save(): Promise<void> {
    if (!this.canSave()) return;
    const content = this.draft().trim();
    const target = this.editing();
    this.saving.set(true);
    this.editorError.set(null);
    try {
      if (target) {
        await firstValueFrom(this.service.update(target.id, content));
      } else {
        await firstValueFrom(this.service.create({ content }));
      }
      this.editorOpen.set(false);
      this.toast.success(target ? 'Recuerdo actualizado.' : 'Recuerdo agregado.');
      await this.load(true);
    } catch (error) {
      // AI_MEMORY_LIMIT_001 / AI_MEMORY_FORBIDDEN_001 carry their own copy.
      this.editorError.set(parseApiError(error).userMessage);
    } finally {
      this.saving.set(false);
    }
  }

  onDeleteOpenChange(open: boolean): void {
    if (!open) this.itemToDelete.set(null);
  }

  async deleteItem(): Promise<void> {
    const target = this.itemToDelete();
    this.itemToDelete.set(null);
    if (!target) return;
    try {
      await firstValueFrom(this.service.remove(target.id));
      this.toast.success('Recuerdo borrado.');
      await this.load(true);
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    }
  }

  async clearAll(): Promise<void> {
    this.confirmClearAll.set(false);
    try {
      await firstValueFrom(this.service.removeAll());
      this.toast.success('Memoria de la tienda borrada.');
      await this.load(true);
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    }
  }

  authorLabel(item: StoreMemoryItem): string {
    const actor = item.updated_by ?? item.created_by;
    if (actor?.name) return actor.name;
    return item.origin === 'manual' ? 'Usuario de la tienda' : 'Vex';
  }

  absoluteDate(iso: string): string {
    return formatStoreDateTime(iso, this.timezone());
  }

  relativeDate(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const diff = Date.now() - date.getTime();
    if (diff < MINUTE) return 'hace un momento';
    const rtf = new Intl.RelativeTimeFormat('es-CO', { numeric: 'auto' });
    if (diff < HOUR) return rtf.format(-Math.floor(diff / MINUTE), 'minute');
    if (diff < DAY) return rtf.format(-Math.floor(diff / HOUR), 'hour');
    if (diff < 30 * DAY) return rtf.format(-Math.floor(diff / DAY), 'day');
    return this.absoluteDate(iso);
  }
}
