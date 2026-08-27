import {
  Component,
  inject,
  input,
  output,
  computed,
  signal,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { PrintTokenCatalogService, TokenGroup } from '../../../../../../../shared/services/print/print-token-catalog.service';

/**
 * MIME type shared with the canvas drop target. The dropped value is the
 * token's path (not the rendered `{{ path }}`); the canvas maps it to a
 * new section in P4.6.
 */
const TOKEN_DND_MIME = 'application/x-vendix-token';

/**
 * [print-editor-dsk P3.2 + P5.9] — Token catalog panel.
 *
 * Renders the `available_tokens` for the current print format grouped by
 * their first path segment (`store.*`, `customer.*`, `items.*`, …). A search
 * box filters by `token` or `path` substring (case-insensitive).
 *
 * Each token is a button the merchant can click to insert at the cursor —
 * the parent's `(tokenSelected)` output receives `{ token, path }` so the
 * caller can decide where to splice the token (composer field, custom
 * template textarea, etc.).
 *
 * [print-editor-dsk P5.9] — Each chip is also `draggable="true"`. On
 * `dragstart` we publish the token path under
 * `application/x-vendix-token` so the canvas can drop it as a new
 * section. This completes the drag-and-drop loop with P4.6.
 */
@Component({
  selector: 'app-print-token-catalog',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="space-y-3">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h3 class="text-sm font-semibold text-text-primary">Catálogo de Tokens</h3>
          <p class="text-xs text-text-secondary">
            Inserta un token en el campo activo haciendo clic sobre él.
          </p>
        </div>
        <span class="text-[10px] font-mono text-text-tertiary">
          {{ filteredGroups().length }} grupos / {{ filteredTokenCount() }} tokens
        </span>
      </div>

      <!-- Search input -->
      <div class="relative">
        <app-icon
          name="search"
          [size]="14"
          class="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
        ></app-icon>
        <input
          type="text"
          [(ngModel)]="searchQuery"
          (ngModelChange)="searchQueryChange.set($event)"
          placeholder="Buscar token (ej. customer, total, items.*.name)..."
          class="w-full pl-8 pr-3 py-2 text-xs bg-surface-secondary border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500 placeholder:text-text-tertiary"
        />
      </div>

      <!-- Groups -->
      <div class="space-y-3 max-h-[480px] overflow-y-auto pr-1">
        @if (catalog.isLoading()) {
          <div class="text-xs text-text-tertiary py-4 text-center animate-pulse">
            Cargando tokens disponibles...
          </div>
        } @else if (filteredGroups().length === 0) {
          <div class="text-xs text-text-tertiary py-4 text-center border border-dashed border-border rounded-lg">
            No hay tokens que coincidan con la búsqueda.
          </div>
        } @else {
          @for (group of filteredGroups(); track group.prefix) {
            <div class="rounded-lg border border-border bg-surface-secondary/40 p-2.5 space-y-1.5">
              <div class="flex items-center justify-between px-1">
                <span class="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
                  {{ group.label }}
                </span>
                <span class="text-[10px] font-mono text-text-tertiary">
                  {{ group.tokens.length }}
                </span>
              </div>
              <div class="grid grid-cols-1 gap-1">
                @for (t of group.tokens; track t.token) {
                  <button
                    type="button"
                    draggable="true"
                    class="text-left w-full px-2 py-1.5 rounded-md bg-surface hover:bg-surface-hover border border-transparent hover:border-primary-500/40 transition group/token cursor-grab active:cursor-grabbing"
                    [title]="t.description || t.token"
                    (click)="select(t.token, t.path)"
                    (dragstart)="onDragStart($event, t.token, t.path)"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <code class="text-[11px] font-mono text-primary-500 group-hover/token:text-primary-400 truncate">
                        {{ t.token }}
                      </code>
                      @if (t.example) {
                        <span class="text-[10px] text-text-tertiary truncate max-w-[40%]">
                          {{ t.example }}
                        </span>
                      }
                    </div>
                    @if (t.description) {
                      <p class="text-[10px] text-text-tertiary mt-0.5 line-clamp-2">
                        {{ t.description }}
                      </p>
                    }
                  </button>
                }
              </div>
            </div>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `],
})
export class PrintTokenCatalogComponent {
  readonly catalog = inject(PrintTokenCatalogService);

  readonly formatType = input.required<string>();

  /** Emitted with `{ token, path }` when the merchant picks a token. */
  readonly tokenSelected = output<{ token: string; path: string }>();

  /** Local mirror for the search input bound by ngModel. */
  readonly searchQueryChange = signal<string>('');
  /** Two-way bound mirror for the input element. */
  searchQuery = '';

  private readonly allGroups = computed(() => this.catalog.groups());

  readonly filteredGroups = computed<TokenGroup[]>(() => {
    const query = this.searchQueryChange().toLowerCase().trim();
    const groups = this.allGroups();
    if (!query) return groups;
    return groups
      .map((g) => ({
        ...g,
        tokens: g.tokens.filter(
          (t) =>
            t.token.toLowerCase().includes(query) ||
            (t.path ?? '').toLowerCase().includes(query),
        ),
      }))
      .filter((g) => g.tokens.length > 0);
  });

  readonly filteredTokenCount = computed(() =>
    this.filteredGroups().reduce((acc, g) => acc + g.tokens.length, 0),
  );

  constructor() {
    // Lazy-load on first render; reload whenever `formatType` changes.
    effect(() => {
      const ft = this.formatType();
      if (ft && this.catalog.lastFormatType() !== ft) {
        void this.catalog.load(ft);
      }
    });
  }

  select(token: string, path: string): void {
    this.tokenSelected.emit({ token, path });
  }

  /**
   * [print-editor-dsk P5.9] — Drag start for the chip. We push a JSON
   * envelope under our private MIME so the canvas drop target can
   * recover both `token` (rendered as `{{ token }}`) and `path` (the
   * dotted address used by the renderer). The canvas previously
   * expected just `path`; we send both for forward compatibility.
   */
  onDragStart(event: DragEvent, token: string, path: string): void {
    if (!event.dataTransfer) return;
    try {
      event.dataTransfer.setData(
        TOKEN_DND_MIME,
        JSON.stringify({ token, path }),
      );
      // Plain-text fallback for hosts that strip custom MIME types.
      event.dataTransfer.setData('text/plain', `{{ ${path} }}`);
    } catch {
      // Some browsers throw on setData for protected types; swallow.
    }
    event.dataTransfer.effectAllowed = 'copy';
  }
}