import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { IconComponent, SpinnerComponent } from '../../../../../../shared/components';
import { ToastService } from '../../../../../../shared/components';
import { AppMediaItem, AppMediaService } from '../../services/app-media.service';
import type { PageAppKind } from '../../templates';

/**
 * Galería de medios de las apps (apps-customization F1.1).
 *
 * Sube fotos al storage de la tienda (no URLs externas), las lista con su
 * miniatura y devuelve la elegida. Se usa desde Estilo para el logo y la
 * portada y, más adelante, desde cada bloque con imagen.
 */
@Component({
  selector: 'app-app-media-picker',
  standalone: true,
  imports: [DecimalPipe, IconComponent, SpinnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="amp-backdrop" (click)="close.emit()"></div>
      <div class="amp-modal" role="dialog" aria-modal="true" aria-label="Galería de la app">
        <header class="amp-head">
          <div>
            <h2>Galería de la app</h2>
            <p>Fotos guardadas en tu tienda. Se usan en todas las apps sin depender de enlaces externos.</p>
          </div>
          <button type="button" class="amp-icon" (click)="close.emit()" aria-label="Cerrar">
            <app-icon name="x" [size]="16"></app-icon>
          </button>
        </header>

        <div class="amp-toolbar">
          <input
            type="search"
            class="amp-search"
            placeholder="Buscar por nombre…"
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
                <button type="button" class="amp-thumb" (click)="choose(item)" [title]="item.alt ?? ''">
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
                  <button type="button" class="amp-icon" (click)="remove(item)" title="Eliminar">
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
    }
  `,
  styleUrl: './app-media-picker.component.scss',
})
export class AppMediaPickerComponent {
  private readonly media = inject(AppMediaService);
  private readonly toast = inject(ToastService);

  readonly open = input(false);
  readonly appKind = input<PageAppKind | null>(null);
  readonly close = output<void>();
  /** La app recibe la URL firmada para pintarla y el id para referenciarla. */
  readonly picked = output<AppMediaItem>();

  readonly items = signal<AppMediaItem[]>([]);
  readonly loading = signal(false);
  readonly uploading = signal(false);
  readonly search = signal('');
  private page = 1;
  private total = 0;

  readonly hasMore = computed(() => this.items().length < this.total);

  constructor() {
    // Cada vez que se abre, la primera página fresca.
    effect(() => {
      if (this.open()) this.reload();
    });
  }

  onSearch(value: string): void {
    this.search.set(value);
    this.reload();
  }

  onFiles(files: FileList | null): void {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;
    this.uploading.set(true);
    this.media.upload(list, this.appKind()).subscribe({
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
    this.media.updateAlt(item.id, alt || null).subscribe({
      next: (updated) =>
        this.items.set(this.items().map((row) => (row.id === updated.id ? updated : row))),
      error: () => this.toast.error('No se pudo guardar el texto'),
    });
  }

  remove(item: AppMediaItem): void {
    this.media.remove(item.id).subscribe({
      next: () => {
        this.items.set(this.items().filter((row) => row.id !== item.id));
        this.total = Math.max(0, this.total - 1);
      },
      error: () => this.toast.error('No se pudo eliminar la foto'),
    });
  }

  loadMore(): void {
    this.page += 1;
    this.fetch(false);
  }

  private reload(): void {
    this.page = 1;
    this.fetch(true);
  }

  private fetch(replace: boolean): void {
    this.loading.set(true);
    this.media
      .list({ appKind: this.appKind(), search: this.search(), page: this.page, limit: 24 })
      .subscribe({
        next: (result) => {
          this.total = result.total;
          this.items.set(replace ? result.data : [...this.items(), ...result.data]);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toast.error('No se pudo cargar la galería');
        },
      });
  }
}
