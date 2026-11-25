import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Subject, debounceTime, switchMap, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IconComponent, ModalComponent, SpinnerComponent, ToastService } from '../../../../../../shared/components';
import { AppMediaItem, AppMediaService } from '../../services/app-media.service';
import type { PageAppKind } from '../../templates';

/**
 * Galería de medios de las apps (apps-customization F1.1).
 *
 * Sube fotos al storage de la tienda, las lista con miniatura y devuelve la
 * elegida. La URL que entrega es estable (la API firma al vuelo), así que la
 * app publicada no se rompe cuando vence una firma.
 */
@Component({
  selector: 'app-app-media-picker',
  standalone: true,
  imports: [DecimalPipe, IconComponent, ModalComponent, SpinnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [isOpen]="open()"
      title="Galería de la app"
      subtitle="Fotos guardadas en tu tienda: se usan en la app sin depender de enlaces externos."
      size="xl-mid"
      (closed)="close.emit()"
    >
      <div class="amp">
        <div class="amp-toolbar">
          <input
            type="search"
            class="amp-search"
            placeholder="Buscar por nombre…"
            aria-label="Buscar en la galería"
            [value]="search()"
            (input)="onSearch($any($event.target).value)"
          />
          <label class="amp-upload" [class.amp-upload--busy]="uploading()">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              multiple
              hidden
              (change)="onFiles($any($event.target).files)"
            />
            <app-icon name="upload" [size]="14"></app-icon>
            {{ uploading() ? 'Subiendo…' : 'Subir fotos' }}
          </label>
        </div>

        @if (loading() && items().length === 0) {
          <div class="amp-center"><app-spinner size="md" color="primary"></app-spinner></div>
        } @else if (items().length === 0) {
          <div class="amp-center amp-empty">
            <app-icon name="image" [size]="28"></app-icon>
            <p>Todavía no hay fotos. Sube la primera con «Subir fotos».</p>
          </div>
        } @else {
          <ul class="amp-grid">
            @for (item of items(); track item.id) {
              <li class="amp-card">
                <button type="button" class="amp-thumb" (click)="choose(item)" [attr.aria-label]="'Elegir ' + (item.alt ?? 'foto')">
                  @if (item.thumb_url || item.url) {
                    <img [src]="item.thumb_url || item.url" [alt]="item.alt ?? ''" loading="lazy" />
                  } @else {
                    <app-icon name="image" [size]="22"></app-icon>
                  }
                </button>
                <div class="amp-meta">
                  <input
                    type="text"
                    class="amp-alt"
                    placeholder="Texto alternativo"
                    [value]="item.alt ?? ''"
                    (change)="rename(item, $any($event.target).value)"
                    aria-label="Texto alternativo"
                  />
                  <span class="amp-size">{{ item.size_bytes / 1024 | number: '1.0-0' }} KB</span>
                  <button type="button" class="amp-icon" (click)="remove(item)" aria-label="Eliminar foto" title="Eliminar foto">
                    <app-icon name="trash-2" [size]="14"></app-icon>
                  </button>
                </div>
              </li>
            }
          </ul>
          @if (hasMore()) {
            <button type="button" class="amp-more" (click)="loadMore()" [disabled]="loading()">
              {{ loading() ? 'Cargando…' : 'Ver más' }}
            </button>
          }
        }
      </div>
    </app-modal>
  `,
  styleUrl: './app-media-picker.component.scss',
})
export class AppMediaPickerComponent {
  private readonly media = inject(AppMediaService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = input(false);
  readonly appKind = input<PageAppKind | null>(null);
  readonly close = output<void>();
  /** La app recibe la URL estable para pintarla y el medio completo. */
  readonly picked = output<AppMediaItem>();

  readonly items = signal<AppMediaItem[]>([]);
  readonly loading = signal(false);
  readonly uploading = signal(false);
  readonly search = signal('');
  private page = 1;
  private total = 0;
  private readonly queries = new Subject<{ term: string; page: number; replace: boolean }>();
  private readonly lastQuery = signal<{ term: string; page: number; replace: boolean } | null>(null);

  readonly hasMore = computed(() => this.items().length < this.total);

  constructor() {
    // Una sola tubería para búsqueda y paginación: debounce + cancelación, sin
    // respuestas viejas pisando a la nueva.
    this.queries
      .pipe(
        debounceTime(250),
        tap(() => this.loading.set(true)),
        switchMap((query) =>
          this.media.list({
            appKind: untracked(() => this.appKind()),
            search: query.term,
            page: query.page,
            limit: 24,
          }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (result) => {
          const last = this.lastQuery();
          this.total = result.total;
          this.items.set(last?.replace ? result.data : [...this.items(), ...result.data]);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toast.error('No se pudo cargar la galería');
        },
      });

    // Al abrir, primera página fresca.
    effect(() => {
      if (this.open()) {
        this.page = 1;
        this.emitQuery(this.search(), 1, true);
      }
    });
  }

  onSearch(value: string): void {
    this.search.set(value);
    this.page = 1;
    this.emitQuery(value, 1, true);
  }

  onFiles(files: FileList | null): void {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;
    this.uploading.set(true);
    this.media
      .upload(list, this.appKind())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (saved) => {
          this.uploading.set(false);
          this.items.set([...saved, ...this.items()]);
          this.total += saved.length;
          this.toast.success(saved.length === 1 ? 'Foto subida' : `${saved.length} fotos subidas`);
        },
        error: () => {
          this.uploading.set(false);
          this.toast.error('No se pudieron subir las fotos');
        },
      });
  }

  choose(item: AppMediaItem): void {
    this.picked.emit(item);
    this.close.emit();
  }

  rename(item: AppMediaItem, alt: string): void {
    this.media
      .updateAlt(item.id, alt || null)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) =>
          this.items.set(this.items().map((row) => (row.id === updated.id ? updated : row))),
        error: () => this.toast.error('No se pudo guardar el texto'),
      });
  }

  remove(item: AppMediaItem): void {
    if (!confirm('¿Quitar esta foto de la galería? La app publicada conserva la que ya usa.')) {
      return;
    }
    this.media
      .remove(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.items.set(this.items().filter((row) => row.id !== item.id));
          this.total = Math.max(0, this.total - 1);
        },
        error: () => this.toast.error('No se pudo eliminar la foto'),
      });
  }

  loadMore(): void {
    this.page += 1;
    this.emitQuery(this.search(), this.page, false);
  }

  private emitQuery(term: string, page: number, replace: boolean): void {
    this.lastQuery.set({ term, page, replace });
    this.queries.next({ term, page, replace });
  }
}
