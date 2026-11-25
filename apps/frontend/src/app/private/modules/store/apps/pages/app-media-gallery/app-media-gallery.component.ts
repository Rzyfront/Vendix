import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Subject, debounceTime, switchMap, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { IconComponent, SpinnerComponent, ToastService } from '../../../../../../shared/components';
import { AppMediaItem, AppMediaService } from '../../services/app-media.service';

/**
 * `/admin/apps/gallery` — galería de medios de las apps.
 *
 * Todo lo que se sube queda en el storage de la tienda y se puede reutilizar en
 * cualquier app. Desde aquí se copia el enlace estable de cada foto (el que
 * sirve en producción sin vencer), se edita su texto alternativo y se quita de
 * la galería sin romper páginas ya publicadas.
 */
@Component({
  selector: 'app-app-media-gallery',
  standalone: true,
  imports: [DatePipe, DecimalPipe, IconComponent, SpinnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="w-full max-w-6xl mx-auto px-3 py-4 md:px-6 md:py-6">
      <header class="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-xl font-semibold text-[var(--color-text-primary)]">Galería de medios</h1>
          <p class="mt-1 text-sm text-[var(--color-text-secondary)]">
            Fotos guardadas en tu tienda. Úsalas en cualquier app y copia su enlace para donde lo necesites.
          </p>
        </div>
        <label class="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[var(--color-primary)] px-3 py-2 text-sm font-semibold text-[var(--color-text-on-primary,#fff)]">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            hidden
            (change)="upload($any($event.target).files)"
          />
          <app-icon name="upload" [size]="15"></app-icon>
          {{ uploading() ? 'Subiendo…' : 'Subir fotos' }}
        </label>
      </header>

      <div class="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          class="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
          placeholder="Buscar por nombre…"
          aria-label="Buscar en la galería"
          [value]="search()"
          (input)="onSearch($any($event.target).value)"
        />
        <span class="text-xs text-[var(--color-text-secondary)]">{{ total() }} archivos</span>
      </div>

      @if (loading() && items().length === 0) {
        <div class="flex justify-center py-16"><app-spinner size="md" color="primary"></app-spinner></div>
      } @else if (items().length === 0) {
        <div class="rounded-xl border border-dashed border-[var(--color-border)] p-10 text-center text-sm text-[var(--color-text-secondary)]">
          Todavía no hay fotos. Sube la primera para usarla en tus apps.
        </div>
      } @else {
        <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          @for (item of items(); track item.id) {
            <li class="flex flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
              <div class="aspect-[4/3] bg-[var(--color-background)]">
                @if (item.thumb_url || item.url) {
                  <img [src]="item.thumb_url || item.url" [alt]="item.alt ?? ''" class="h-full w-full object-cover" loading="lazy" />
                }
              </div>
              <div class="flex flex-1 flex-col gap-2 p-2.5">
                <input
                  type="text"
                  class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-xs text-[var(--color-text-primary)]"
                  placeholder="Texto alternativo"
                  aria-label="Texto alternativo"
                  [value]="item.alt ?? ''"
                  (change)="rename(item, $any($event.target).value)"
                />
                <div class="flex items-center justify-between gap-2 text-[11px] text-[var(--color-text-secondary)]">
                  <span>{{ item.size_bytes / 1024 | number: '1.0-0' }} KB</span>
                  <span>{{ item.created_at | date: 'dd/MM/yy' }}</span>
                </div>
                <div class="mt-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    class="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-[11px] font-semibold text-[var(--color-text-primary)]"
                    (click)="copyLink(item)"
                  >
                    <app-icon name="link" [size]="12"></app-icon>
                    Copiar enlace
                  </button>
                  <button
                    type="button"
                    class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-text-secondary)]"
                    aria-label="Quitar de la galería"
                    title="Quitar de la galería"
                    (click)="remove(item)"
                  >
                    <app-icon name="trash-2" [size]="13"></app-icon>
                  </button>
                </div>
              </div>
            </li>
          }
        </ul>
        @if (hasMore()) {
          <div class="mt-4 flex justify-center">
            <button
              type="button"
              class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--color-text-primary)]"
              [disabled]="loading()"
              (click)="loadMore()"
            >
              {{ loading() ? 'Cargando…' : 'Ver más' }}
            </button>
          </div>
        }
      }
    </div>
  `,
})
export class AppMediaGalleryComponent {
  private readonly media = inject(AppMediaService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly items = signal<AppMediaItem[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly uploading = signal(false);
  readonly search = signal('');
  readonly hasMore = computed(() => this.items().length < this.total());

  private page = 1;
  private readonly queries = new Subject<{ term: string; page: number; replace: boolean }>();
  private readonly lastQuery = signal<{ term: string; page: number; replace: boolean } | null>(null);

  constructor() {
    this.queries
      .pipe(
        debounceTime(250),
        tap(() => this.loading.set(true)),
        switchMap((query) =>
          this.media.list({ search: query.term, page: query.page, limit: 24 }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (result) => {
          const last = this.lastQuery();
          this.total.set(result.total);
          this.items.set(last?.replace ? result.data : [...this.items(), ...result.data]);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toast.error('No se pudo cargar la galería');
        },
      });
    this.emit(this.search(), 1, true);
  }

  onSearch(value: string): void {
    this.search.set(value);
    this.page = 1;
    this.emit(value, 1, true);
  }

  loadMore(): void {
    this.page += 1;
    this.emit(this.search(), this.page, false);
  }

  upload(files: FileList | null): void {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    this.uploading.set(true);
    this.media
      .upload(list)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (saved) => {
          this.uploading.set(false);
          this.items.set([...saved, ...this.items()]);
          this.total.update((n) => n + saved.length);
          this.toast.success(saved.length === 1 ? 'Foto subida' : `${saved.length} fotos subidas`);
        },
        error: () => {
          this.uploading.set(false);
          this.toast.error('No se pudieron subir las fotos');
        },
      });
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
    if (!confirm('¿Quitar esta foto de la galería? Las páginas publicadas que ya la usan la conservan.')) {
      return;
    }
    this.media
      .remove(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.items.set(this.items().filter((row) => row.id !== item.id));
          this.total.update((n) => Math.max(0, n - 1));
        },
        error: () => this.toast.error('No se pudo quitar la foto'),
      });
  }

  /** Enlace estable: sirve en producción y no vence como una firma. */
  async copyLink(item: AppMediaItem): Promise<void> {
    const url = item.url;
    if (!url) {
      this.toast.error('Esta foto no tiene enlace disponible');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      this.toast.success('Enlace copiado');
    } catch {
      this.toast.error('No se pudo copiar el enlace');
    }
  }

  private emit(term: string, page: number, replace: boolean): void {
    this.lastQuery.set({ term, page, replace });
    this.queries.next({ term, page, replace });
  }
}
