import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

import { parseApiError } from '../../../../../core/utils/parse-api-error';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { StoreAppDetail, StoreHomeConfig } from '../interfaces/store-app.interface';
import { StoreAppsService } from '../services/store-apps.service';

/** Same limit as the backend (`store-home.reader.ts`). */
export const MAX_STORE_HOME_FOOTER = 160;

/**
 * Apps · store home settings (Fase 5): the entry page of the store's own
 * `{tienda}-store` domain. Publishing switches that domain from the store
 * landing to the store home (same URL); unpublishing gives the landing back.
 * The only setting is the footer line about Vendix.
 */
@Component({
  selector: 'app-store-home-settings-modal',
  standalone: true,
  imports: [ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      title="Inicio de tienda"
      subtitle="Portada de entrada de tu tienda con tu marca y el botón de ingreso."
      size="md"
    >
      @if (loading()) {
        <p class="text-sm text-[var(--color-text-secondary)]">Cargando…</p>
      } @else {
        <div class="space-y-5 text-sm" data-testid="store-home-settings">
          <div class="rounded-lg border border-[var(--color-border)] p-3">
            <p class="text-[var(--color-text-primary)]">
              Estado: <strong data-testid="store-home-status">{{ statusLabel() }}</strong>
            </p>
            @if (detail()?.public_url; as url) {
              <p class="mt-1 text-[var(--color-text-secondary)]">
                Publicado en
                <a [href]="url" target="_blank" rel="noopener noreferrer"
                   class="text-[var(--color-primary)] hover:underline" data-testid="store-home-url">{{ url }}</a>
              </p>
            }
            <p class="mt-1 text-xs text-[var(--color-text-secondary)]">
              Se publica en la dirección principal de tu tienda (tutienda-store.vendix.online). Mientras esté publicado, esa dirección muestra el inicio de tienda en lugar de tu landing actual; al despublicarlo vuelve a mostrar la landing tal como estaba.
            </p>
          </div>

          <section>
            <label class="font-semibold text-[var(--color-text-primary)]" for="store-home-footer">
              Texto del pie de página
            </label>
            <p class="text-xs text-[var(--color-text-secondary)]">
              Aparece junto al enlace a Vendix. Déjalo vacío para usar el lema de Vendix.
            </p>
            <input id="store-home-footer" type="text"
                   class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                   [maxLength]="maxFooter" [value]="footerText()" data-testid="store-home-footer-input"
                   (input)="footerText.set($any($event.target).value)" />
            <p class="mt-1 text-right text-xs text-[var(--color-text-secondary)]">
              {{ footerText().length }}/{{ maxFooter }}
            </p>
          </section>

          @if (error()) {
            <p class="rounded-lg bg-[var(--color-background)] p-3 text-[var(--color-error,#b91c1c)]" role="alert">{{ error() }}</p>
          }
        </div>
      }

      <div slot="footer" class="flex flex-wrap justify-end gap-2">
        @if (isPublished()) {
          <button type="button" class="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
                  [disabled]="busy()" (click)="unpublish()" data-testid="store-home-unpublish">Despublicar</button>
        }
        <button type="button" class="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
                [disabled]="busy() || loading()" (click)="save(false)" data-testid="store-home-save">Guardar</button>
        @if (!isPublished()) {
          <button type="button" class="rounded-lg bg-[var(--color-primary)] px-3 py-2 text-sm font-semibold text-[var(--color-text-on-primary)] disabled:opacity-50"
                  [disabled]="busy() || loading()" (click)="save(true)" data-testid="store-home-publish">Publicar</button>
        }
      </div>
    </app-modal>
  `,
})
export class StoreHomeSettingsModalComponent {
  private readonly appsService = inject(StoreAppsService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model(false);
  /** Emitted after a save, publish or unpublish, so the catalog reloads. */
  readonly changed = output<void>();

  readonly maxFooter = MAX_STORE_HOME_FOOTER;

  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly detail = signal<StoreAppDetail | null>(null);
  readonly footerText = signal('');

  readonly isPublished = computed(() => this.detail()?.status === 'published');

  readonly statusLabel = computed(() => {
    switch (this.detail()?.status) {
      case 'published':
        return 'Publicado';
      case 'draft':
        return 'Borrador';
      case 'disabled':
        return 'Despublicado';
      default:
        return 'Sin configurar';
    }
  });

  constructor() {
    effect(() => {
      if (this.isOpen()) untracked(() => this.load());
    });
  }

  save(publish: boolean): void {
    this.busy.set(true);
    this.error.set(null);
    this.appsService
      .saveStoreHomeConfig({ footer_text: this.footerText().trim() || null })
      .pipe(
        switchMap(() => (publish ? this.appsService.publishStoreHome() : of(null))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.toast.success(publish ? 'Inicio de tienda publicado' : 'Inicio de tienda guardado');
          this.done();
        },
        error: (err) => this.fail(err),
      });
  }

  unpublish(): void {
    this.busy.set(true);
    this.error.set(null);
    this.appsService
      .unpublishStoreHome()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Inicio de tienda despublicado');
          this.done();
        },
        error: (err) => this.fail(err),
      });
  }

  private done(): void {
    this.busy.set(false);
    this.changed.emit();
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.appsService
      .get('store_home')
      .pipe(
        map((res) => res.data),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (detail) => {
          const config = detail.config as Partial<StoreHomeConfig>;
          this.detail.set(detail);
          this.footerText.set(typeof config.footer_text === 'string' ? config.footer_text : '');
          this.loading.set(false);
        },
        error: (err) => {
          this.fail(err);
          this.loading.set(false);
        },
      });
  }

  private fail(err: unknown): void {
    this.busy.set(false);
    this.error.set(parseApiError(err).userMessage ?? 'No se pudo completar la acción.');
  }
}
