import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';

import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import type { AppMediaItem } from '../../services/app-media.service';
import type { PageAppKind } from '../../templates/app-page.types';
import { AppMediaPickerComponent } from '../app-media-picker/app-media-picker.component';

const HTTPS_URL_RE = /^https:\/\/\S+$/i;
let nextMediaFieldId = 0;

/**
 * Campo reutilizable de imagen para el editor de apps.
 *
 * La galería de la tienda (`AppMediaPickerComponent`) es la vía principal:
 * muestra miniatura de la imagen elegida, botón «Galería», acción para quitar
 * y un campo de URL opcional (para pegar un enlace https si se prefiere).
 * El modal de galería solo se monta mientras está abierto.
 */
@Component({
  selector: 'app-media-field',
  standalone: true,
  imports: [IconComponent, AppMediaPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-1.5" data-testid="app-media-field">
      <div class="flex items-center gap-2">
        <div
          class="flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-text-secondary)]"
          [class]="compact() ? 'h-10 w-10' : 'h-12 w-12'"
          data-testid="media-field-preview"
        >
          @if (previewUrl(); as src) {
            <img [src]="src" alt="" class="h-full w-full object-cover" loading="lazy" />
          } @else {
            <app-icon name="image" [size]="compact() ? 16 : 18" />
          }
        </div>

        <div class="flex min-w-0 flex-1 flex-col gap-1.5">
          <div class="flex items-center gap-1.5">
            <button
              #galleryBtn
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-background)]"
              aria-haspopup="dialog"
              data-testid="media-field-gallery"
              (click)="openPicker()"
            >
              <app-icon name="images" [size]="14" />
              {{ hasValue() ? 'Cambiar de galería' : 'Galería' }}
            </button>

            @if (hasValue()) {
              <button
                type="button"
                class="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background)] hover:text-[var(--color-error,#dc2626)]"
                data-testid="media-field-clear"
                aria-label="Quitar imagen"
                title="Quitar imagen"
                (click)="clear()"
              >
                <app-icon name="x" [size]="14" />
              </button>
            }
          </div>

          <input
            type="url"
            class="w-full rounded-md border bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text-primary)]"
            [class]="invalidUrl() ? 'border-[var(--color-error,#dc2626)]' : 'border-[var(--color-border)]'"
            [placeholder]="placeholder()"
            [attr.aria-label]="ariaLabel()"
            [attr.aria-invalid]="invalidUrl() ? 'true' : null"
            [attr.aria-describedby]="invalidUrl() ? errorId : null"
            [value]="value()"
            data-testid="media-field-input"
            (input)="onInput($any($event.target).value)"
          />
        </div>
      </div>

      @if (invalidUrl()) {
        <span
          [id]="errorId"
          role="alert"
          class="block text-[11px] text-[var(--color-error,#dc2626)]"
          data-testid="media-field-error"
        >
          Usa un enlace que empiece por https://
        </span>
      }
    </div>

    @if (pickerOpen()) {
      <app-app-media-picker
        [open]="true"
        [appKind]="appKind()"
        (close)="closePicker()"
        (picked)="onPicked($event)"
      />
    }
  `,
})
export class AppMediaFieldComponent {
  readonly value = input<string>('');
  readonly appKind = input<PageAppKind | null>(null);
  readonly placeholder = input('O pega una URL https://…');
  readonly ariaLabel = input('URL de imagen');
  readonly compact = input(false);

  /** Emite la URL estable elegida en la galería, escrita a mano o vacía al limpiar. */
  readonly valueChange = output<string>();

  readonly errorId = `app-media-field-error-${++nextMediaFieldId}`;
  readonly pickerOpen = signal(false);
  private readonly galleryButton = viewChild<ElementRef<HTMLButtonElement>>('galleryBtn');

  readonly trimmed = computed(() => (this.value() ?? '').trim());
  readonly hasValue = computed(() => this.trimmed().length > 0);
  readonly invalidUrl = computed(() => this.hasValue() && !HTTPS_URL_RE.test(this.trimmed()));
  readonly previewUrl = computed(() => (HTTPS_URL_RE.test(this.trimmed()) ? this.trimmed() : null));

  openPicker(): void {
    this.pickerOpen.set(true);
  }

  closePicker(): void {
    this.pickerOpen.set(false);
    this.restoreFocus();
  }

  onInput(raw: string): void {
    this.valueChange.emit(raw);
  }

  clear(): void {
    this.valueChange.emit('');
  }

  onPicked(item: AppMediaItem): void {
    this.pickerOpen.set(false);
    if (item.url) {
      this.valueChange.emit(item.url);
    }
    this.restoreFocus();
  }

  private restoreFocus(): void {
    this.galleryButton()?.nativeElement.focus();
  }
}
