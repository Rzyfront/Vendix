import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DocumentViewerComponent } from '../../../../../../shared/components/record-documents/document-viewer.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { VEX_COPY } from '../../vex-copy';
import { VexApiService } from '../../services/vex-api.service';

/**
 * In-chat viewer of an attachment handle: asks the backend for a short-lived
 * signed URL when opened, then shows the image in a lightbox or the PDF in a
 * modal. The URL lives only in memory.
 */
@Component({
  selector: 'vendix-vex-attachment-viewer',
  standalone: true,
  imports: [DocumentViewerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-document-viewer
      [(isOpen)]="isOpen"
      [url]="url()"
      [mimeType]="mime()"
      [name]="name()"
    />
  `,
})
export class VexAttachmentViewerComponent {
  private readonly api = inject(VexApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly copy = VEX_COPY.attachment_viewer;

  readonly handle = input.required<string>();
  readonly isOpen = model<boolean>(false);

  readonly url = signal('');
  readonly mime = signal<string | null>(null);
  readonly name = signal('');

  constructor() {
    effect(() => {
      if (!this.isOpen()) {
        this.url.set('');
        return;
      }
      this.fetch(this.handle());
    });
  }

  private fetch(handle: string): void {
    this.api
      .getAttachmentUrl(handle)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.mime.set(result.mime_type);
          this.name.set(result.original_name || this.copy.default_name);
          this.url.set(result.url);
        },
        error: () => {
          this.isOpen.set(false);
          this.toast.error(this.copy.error);
        },
      });
  }
}
