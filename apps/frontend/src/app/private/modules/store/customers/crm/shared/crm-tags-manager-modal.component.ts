import { Component, computed, effect, inject, model, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import {
  ButtonComponent,
  ConfirmationModalComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SpinnerComponent,
  ToastService,
} from '../../../../../../shared/components';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { CrmService } from './crm.service';
import { CrmTag, SaveCrmTag } from './crm.interface';

/** Sober palette for tags; a tag keeps a custom color it already had. */
export const CRM_TAG_COLORS = [
  '#64748B',
  '#3B82F6',
  '#14B8A6',
  '#16A34A',
  '#F59E0B',
  '#F97316',
  '#DC2626',
  '#EC4899',
  '#8B5CF6',
] as const;

const DUPLICATE_NAME = 'Ya existe una etiqueta con ese nombre. Usa otro nombre.';

/** The confirmation modal renders its message as HTML: escape user text. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function byName(a: CrmTag, b: CrmTag): number {
  return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
}

function sameColor(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '').toUpperCase() === (b ?? '').toUpperCase();
}

/** "1 cliente" / "N clientes". */
export function crmTagCustomersLabel(count: number): string {
  return count === 1 ? '1 cliente' : `${count} clientes`;
}

/**
 * Tag catalog of the store: create, rename, recolor and delete tags.
 *
 * Deleting a tag removes it from its customers, never the customers. Every
 * change emits `changed` with the whole catalog (sorted by name), so the
 * caller can update its catalog and the tags it shows without reloading.
 * Gate it with `store:crm_segments:manage`, the permission the API asks for.
 */
@Component({
  selector: 'app-crm-tags-manager-modal',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    ConfirmationModalComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    SpinnerComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      title="Gestionar etiquetas"
      subtitle="Crea, renombra, cambia el color o elimina las etiquetas de tus clientes."
      size="md"
      [fullScreenOnMobile]="true"
    >
      <div class="flex flex-col gap-2 sm:flex-row sm:items-end">
        <app-input
          class="flex-1"
          label="Nueva etiqueta"
          placeholder="Nombre de la etiqueta"
          [maxlength]="60"
          [disabled]="creating()"
          [ngModel]="newName()"
          (ngModelChange)="newName.set($event)"
          (keydown.enter)="create()"
        ></app-input>
        <app-button
          variant="outline"
          size="md"
          [disabled]="!newName().trim()"
          [loading]="creating()"
          (clicked)="create()"
        >
          <app-icon slot="icon" name="plus" [size]="14"></app-icon>
          Crear
        </app-button>
      </div>

      <div class="mt-4 border-t border-border pt-4">
        @if (loading()) {
          <div class="flex justify-center py-10"><app-spinner></app-spinner></div>
        } @else if (loadError(); as message) {
          <div class="flex flex-col items-center gap-3 py-6 text-center">
            <p class="text-sm text-[var(--color-error)]">{{ message }}</p>
            <app-button variant="outline" size="sm" (clicked)="load()">Reintentar</app-button>
          </div>
        } @else {
          <ul class="flex flex-col gap-2" role="list">
            @for (tag of tags(); track tag.id) {
              <li class="rounded-xl border border-border bg-surface p-3" [attr.data-tag-id]="tag.id">
                @if (editingId() === tag.id) {
                  <div class="flex flex-col gap-3">
                    <app-input
                      label="Nombre"
                      placeholder="Nombre de la etiqueta"
                      [maxlength]="60"
                      [disabled]="saving()"
                      [ngModel]="draftName()"
                      (ngModelChange)="draftName.set($event)"
                      (keydown.enter)="saveEdit()"
                    ></app-input>
                    <div>
                      <p class="mb-2 text-sm font-medium text-text-primary">Color</p>
                      <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Color de la etiqueta">
                        <button
                          type="button"
                          role="radio"
                          class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-text-secondary"
                          [class.ring-2]="draftColor() === null"
                          [class.ring-primary]="draftColor() === null"
                          [attr.aria-checked]="draftColor() === null"
                          aria-label="Sin color"
                          title="Sin color"
                          [disabled]="saving()"
                          (click)="draftColor.set(null)"
                        >
                          <app-icon name="x" [size]="14"></app-icon>
                        </button>
                        @for (color of colorOptions(); track color) {
                          <button
                            type="button"
                            role="radio"
                            class="h-8 w-8 rounded-full border border-border"
                            [class.ring-2]="isDraftColor(color)"
                            [class.ring-primary]="isDraftColor(color)"
                            [class.ring-offset-2]="isDraftColor(color)"
                            [style.background]="color"
                            [attr.aria-checked]="isDraftColor(color)"
                            [attr.aria-label]="'Color ' + color"
                            [title]="color"
                            [disabled]="saving()"
                            (click)="draftColor.set(color)"
                          ></button>
                        }
                      </div>
                    </div>
                    <div class="flex flex-wrap justify-end gap-2">
                      <app-button variant="outline" size="sm" [disabled]="saving()" (clicked)="cancelEdit()">
                        Cancelar
                      </app-button>
                      <app-button
                        variant="primary"
                        size="sm"
                        [disabled]="!draftName().trim()"
                        [loading]="saving()"
                        (clicked)="saveEdit()"
                      >
                        Guardar
                      </app-button>
                    </div>
                  </div>
                } @else {
                  <div class="flex items-center justify-between gap-3">
                    <div class="flex min-w-0 flex-col items-start gap-1">
                      <span [class]="chip">
                        <app-icon name="tag" [size]="12" [style.color]="tag.color"></app-icon>
                        <span class="truncate">{{ tag.name }}</span>
                      </span>
                      <span class="text-xs text-text-secondary">{{ customersLabel(tag.customers_count ?? 0) }}</span>
                    </div>
                    <div class="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        class="inline-flex h-9 w-9 items-center justify-center rounded-md text-text-secondary hover:bg-[var(--color-background)] disabled:opacity-50"
                        [attr.aria-label]="'Editar etiqueta ' + tag.name"
                        title="Editar"
                        [disabled]="busy()"
                        (click)="startEdit(tag)"
                      >
                        <app-icon name="pencil" [size]="15"></app-icon>
                      </button>
                      <button
                        type="button"
                        class="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--color-error)] hover:bg-[var(--color-background)] disabled:opacity-50"
                        [attr.aria-label]="'Eliminar etiqueta ' + tag.name"
                        title="Eliminar"
                        [disabled]="busy()"
                        (click)="askDelete(tag)"
                      >
                        @if (deletingId() === tag.id) {
                          <app-spinner size="sm"></app-spinner>
                        } @else {
                          <app-icon name="trash-2" [size]="15"></app-icon>
                        }
                      </button>
                    </div>
                  </div>
                }
              </li>
            } @empty {
              <li class="py-6 text-center text-sm text-text-secondary">
                Aún no hay etiquetas. Crea la primera arriba.
              </li>
            }
          </ul>
        }
      </div>

      <div slot="footer" class="flex justify-end">
        <app-button variant="outline" size="md" (clicked)="isOpen.set(false)">Cerrar</app-button>
      </div>
    </app-modal>

    <app-confirmation-modal
      [isOpen]="!!toDelete()"
      (isOpenChange)="!$event && toDelete.set(null)"
      title="Eliminar etiqueta"
      [message]="deleteMessage()"
      confirmText="Eliminar"
      cancelText="Cancelar"
      confirmVariant="danger"
      (confirm)="confirmDelete()"
      (cancel)="toDelete.set(null)"
    ></app-confirmation-modal>
  `,
})
export class CrmTagsManagerModalComponent {
  private readonly crm = inject(CrmService);
  private readonly toast = inject(ToastService);

  readonly isOpen = model(false);
  /** The whole catalog, sorted by name, after every create, edit or delete. */
  readonly changed = output<CrmTag[]>();

  protected readonly chip =
    'inline-flex h-7 max-w-full items-center gap-1 rounded-full border border-border bg-surface px-3 text-xs font-semibold text-text-secondary';

  protected readonly tags = signal<CrmTag[]>([]);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);

  protected readonly newName = signal('');
  protected readonly creating = signal(false);

  protected readonly editingId = signal<number | null>(null);
  protected readonly draftName = signal('');
  protected readonly draftColor = signal<string | null>(null);
  protected readonly saving = signal(false);

  protected readonly toDelete = signal<CrmTag | null>(null);
  protected readonly deletingId = signal<number | null>(null);

  protected readonly busy = computed(
    () => this.creating() || this.saving() || this.deletingId() !== null,
  );
  protected readonly editingTag = computed(
    () => this.tags().find((tag) => tag.id === this.editingId()) ?? null,
  );
  /** The palette plus the custom color the edited tag already had. */
  protected readonly colorOptions = computed<string[]>(() => {
    const current = this.editingTag()?.color;
    const palette: string[] = [...CRM_TAG_COLORS];
    return current && !palette.some((color) => sameColor(color, current))
      ? [...palette, current]
      : palette;
  });
  protected readonly deleteMessage = computed(() => {
    const tag = this.toDelete();
    if (!tag) return '';
    const count = tag.customers_count ?? 0;
    const impact =
      count > 0
        ? `Se quitará de ${crmTagCustomersLabel(count)}. Los clientes no se borran.`
        : 'No está asignada a ningún cliente.';
    return `¿Eliminar la etiqueta «${escapeHtml(tag.name)}»? ${impact}`;
  });

  /** Latest request wins: reopening supersedes a load in flight. */
  private loadRequest = 0;

  constructor() {
    effect(() => {
      if (!this.isOpen()) return;
      untracked(() => {
        this.newName.set('');
        this.editingId.set(null);
        this.toDelete.set(null);
        void this.load();
      });
    });
  }

  protected customersLabel(count: number): string {
    return crmTagCustomersLabel(count);
  }

  protected isDraftColor(color: string): boolean {
    return sameColor(this.draftColor(), color);
  }

  async load(): Promise<void> {
    const request = ++this.loadRequest;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const rows = await firstValueFrom(this.crm.tags());
      if (request !== this.loadRequest) return;
      this.tags.set([...rows].sort(byName));
    } catch (error) {
      if (request !== this.loadRequest) return;
      this.loadError.set(parseApiError(error).userMessage);
    } finally {
      if (request === this.loadRequest) this.loading.set(false);
    }
  }

  async create(): Promise<void> {
    const name = this.newName().trim();
    if (!name || this.creating()) return;
    this.creating.set(true);
    try {
      const created = await firstValueFrom(this.crm.createTag({ name }));
      this.commit([
        ...this.tags(),
        { id: created.id, name: created.name, color: created.color ?? null, customers_count: 0 },
      ]);
      this.newName.set('');
      this.toast.success('Etiqueta creada');
    } catch (error) {
      this.toast.error(this.errorMessage(error));
    } finally {
      this.creating.set(false);
    }
  }

  startEdit(tag: CrmTag): void {
    this.editingId.set(tag.id);
    this.draftName.set(tag.name);
    this.draftColor.set(tag.color ?? null);
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  /** Sends only what changed; with no change it just closes the editor. */
  async saveEdit(): Promise<void> {
    const tag = this.editingTag();
    const name = this.draftName().trim();
    if (!tag || !name || this.saving()) return;
    const body: SaveCrmTag = {};
    if (name !== tag.name) body.name = name;
    if (!sameColor(this.draftColor(), tag.color)) body.color = this.draftColor();
    if (body.name === undefined && body.color === undefined) {
      this.cancelEdit();
      return;
    }
    this.saving.set(true);
    try {
      const updated = await firstValueFrom(this.crm.updateTag(tag.id, body));
      this.commit(
        this.tags().map((row) =>
          row.id === tag.id
            ? { ...row, name: updated.name, color: updated.color ?? null }
            : row,
        ),
      );
      this.editingId.set(null);
      this.toast.success('Etiqueta actualizada');
    } catch (error) {
      this.toast.error(this.errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  askDelete(tag: CrmTag): void {
    this.toDelete.set(tag);
  }

  async confirmDelete(): Promise<void> {
    const tag = this.toDelete();
    this.toDelete.set(null);
    if (!tag || this.deletingId() !== null) return;
    this.deletingId.set(tag.id);
    try {
      await firstValueFrom(this.crm.deleteTag(tag.id));
      if (this.editingId() === tag.id) this.editingId.set(null);
      this.commit(this.tags().filter((row) => row.id !== tag.id));
      this.toast.success('Etiqueta eliminada');
    } catch (error) {
      this.toast.error(this.errorMessage(error));
    } finally {
      this.deletingId.set(null);
    }
  }

  private commit(rows: CrmTag[]): void {
    const sorted = [...rows].sort(byName);
    this.tags.set(sorted);
    this.changed.emit(sorted);
  }

  private errorMessage(error: unknown): string {
    const parsed = parseApiError(error);
    return parsed.errorCode === 'CRM_TAG_002' ? DUPLICATE_NAME : parsed.userMessage;
  }
}
