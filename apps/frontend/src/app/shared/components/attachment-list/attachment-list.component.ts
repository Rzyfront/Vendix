import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { ModalComponent } from '../modal/modal.component';
import { AttachmentItem, attachmentKind, formatFileSize } from './attachment-list.util';

/**
 * List of attachments: name, size, inline preview for images (thumbnail that
 * opens a larger view), a "Ver" link for PDFs and a download link. Emits
 * `remove` with the index when `removable` is on.
 */
@Component({
  selector: 'app-attachment-list',
  standalone: true,
  imports: [IconComponent, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows().length === 0) {
      @if (emptyText()) {
        <p class="text-xs text-text-secondary">{{ emptyText() }}</p>
      }
    } @else {
      <ul class="space-y-2">
        @for (row of rows(); track $index) {
          <li
            class="flex items-center gap-3 p-2 rounded-xl border border-border bg-surface"
          >
            @if (row.kind === 'image' && row.item.url) {
              <button
                type="button"
                class="shrink-0 w-12 h-12 rounded-lg overflow-hidden border border-border bg-surface-secondary"
                [attr.aria-label]="'Ver ' + row.item.name"
                (click)="openImage(row.item)"
              >
                <img [src]="row.item.url" [alt]="row.item.name" class="w-full h-full object-cover" loading="lazy" />
              </button>
            } @else {
              <div
                class="shrink-0 w-12 h-12 rounded-lg flex items-center justify-center bg-surface-secondary text-text-secondary"
              >
                <app-icon [name]="row.kind === 'image' ? 'image' : 'file-text'" [size]="20" />
              </div>
            }

            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-text-primary truncate" [title]="row.item.name">
                {{ row.item.name }}
              </p>
              @if (row.sizeLabel) {
                <p class="text-xs text-text-secondary">{{ row.sizeLabel }}</p>
              } @else if (!row.item.url) {
                <p class="text-xs text-text-secondary">Vista previa no disponible</p>
              }
            </div>

            <div class="flex items-center gap-1 shrink-0">
              @if (row.item.url) {
                @if (row.kind === 'image') {
                  <button
                    type="button"
                    class="p-2 rounded-lg text-text-secondary hover:bg-surface-secondary"
                    aria-label="Ver imagen"
                    title="Ver"
                    (click)="openImage(row.item)"
                  >
                    <app-icon name="eye" [size]="16" />
                  </button>
                } @else if (row.kind === 'pdf') {
                  <a
                    class="p-2 rounded-lg text-text-secondary hover:bg-surface-secondary inline-flex"
                    [href]="row.item.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Abrir PDF en una pestaña nueva"
                    title="Abrir"
                  >
                    <app-icon name="external-link" [size]="16" />
                  </a>
                }
                <a
                  class="p-2 rounded-lg text-text-secondary hover:bg-surface-secondary inline-flex"
                  [href]="row.item.url"
                  [attr.download]="row.item.name"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Descargar"
                  title="Descargar"
                >
                  <app-icon name="download" [size]="16" />
                </a>
              }
              @if (removable()) {
                <button
                  type="button"
                  class="p-2 rounded-lg hover:bg-surface-secondary"
                  style="color: var(--color-error)"
                  aria-label="Quitar archivo"
                  title="Quitar"
                  (click)="remove.emit($index)"
                >
                  <app-icon name="trash-2" [size]="16" />
                </button>
              }
            </div>
          </li>
        }
      </ul>
    }

    @if (previewImage(); as image) {
      <app-modal
        [isOpen]="true"
        (isOpenChange)="!$event && previewImage.set(null)"
        [title]="image.name"
        size="lg"
      >
        <div class="flex items-center justify-center">
          <img [src]="image.url" [alt]="image.name" class="max-w-full max-h-[70vh] object-contain rounded-lg" />
        </div>
      </app-modal>
    }
  `,
})
export class AttachmentListComponent {
  readonly files = input<AttachmentItem[]>([]);
  readonly removable = input(false);
  /** Text shown when the list is empty; nothing when blank. */
  readonly emptyText = input('');
  readonly remove = output<number>();

  protected readonly previewImage = signal<AttachmentItem | null>(null);

  protected readonly rows = computed(() =>
    this.files().map((item) => ({
      item,
      kind: attachmentKind(item),
      sizeLabel: formatFileSize(item.size),
    })),
  );

  protected openImage(item: AttachmentItem): void {
    this.previewImage.set(item);
  }
}
