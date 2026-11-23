import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';
import { ImageLightboxComponent } from '../image-lightbox/image-lightbox.component';
import { ModalComponent } from '../modal/modal.component';

/** How a file is shown: image lightbox, PDF modal or plain download. */
export type DocumentViewerKind = 'image' | 'pdf' | 'other';

export function documentViewerKind(mime: string | null | undefined, name?: string): DocumentViewerKind {
  const type = (mime ?? '').toLowerCase();
  const file = (name ?? '').toLowerCase();
  if (type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/.test(file)) return 'image';
  if (type.includes('pdf') || file.endsWith('.pdf')) return 'pdf';
  return 'other';
}

/**
 * Viewer of a stored file through a signed URL: images open in the shared
 * lightbox, PDFs inside a modal with the browser's native viewer, anything
 * else offers a download. The URL is never persisted.
 */
@Component({
  selector: 'app-document-viewer',
  standalone: true,
  imports: [ModalComponent, ImageLightboxComponent, ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (kind()) {
      @case ('image') {
        <app-image-lightbox
          [isOpen]="isOpen()"
          [currentImage]="url()"
          [alt]="name() || 'Imagen adjunta'"
          [title]="name()"
          (close)="isOpen.set(false)"
        />
      }
      @case ('pdf') {
        <app-modal
          [(isOpen)]="isOpen"
          [title]="name() || 'Documento'"
          size="xl"
          [fullScreenOnMobile]="true"
          (closed)="isOpen.set(false)"
        >
          @if (safeUrl(); as src) {
            <iframe
              [src]="src"
              [title]="'Vista del documento ' + name()"
              class="w-full h-[70vh] rounded-xl border border-border bg-background"
            ></iframe>
          }
          <div slot="footer" class="flex justify-end gap-2">
            <a
              [href]="url()"
              target="_blank"
              rel="noopener"
              class="min-h-10 inline-flex items-center gap-2 px-4 rounded-xl border border-border text-sm font-medium text-text-primary hover:bg-surface"
            >
              <app-icon name="download" [size]="16" />
              Descargar
            </a>
          </div>
        </app-modal>
      }
    }
  `,
})
export class DocumentViewerComponent {
  private readonly sanitizer = inject(DomSanitizer);

  readonly isOpen = model<boolean>(false);
  readonly url = input<string>('');
  readonly mimeType = input<string | null>(null);
  readonly name = input<string>('');

  readonly kind = computed(() => documentViewerKind(this.mimeType(), this.name()));

  /** Signed URL minted by our own backend, hence trusted for the iframe. */
  readonly safeUrl = computed<SafeResourceUrl | null>(() => {
    const url = this.url();
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  });
}
