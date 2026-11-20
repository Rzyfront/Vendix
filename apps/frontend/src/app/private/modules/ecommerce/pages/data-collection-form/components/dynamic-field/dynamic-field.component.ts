import {Component, ChangeDetectionStrategy, input, output, computed, signal, inject, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { concatMap, from, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../../environments/environment';
import {
  InputComponent,
  SelectorComponent,
  TextareaComponent,
  ToggleComponent,
  IconComponent,
  ButtonComponent,
  SpinnerComponent,
  AttachmentListComponent,
  type AttachmentItem,
} from '../../../../../../../shared/components';
import {
  checkDocumentFile,
  DOCUMENT_KINDS,
  DOCUMENT_MAX_FILES,
  documentAcceptAttribute,
  resolveItemDocumentConfig,
  StoredDocument,
} from '../../../../../store/data-collection/utils/template-json.contract';
import {
  normalizeDocumentsValue,
  toStoredDocument,
  UploadedDocumentResponse,
} from '../../../../../store/data-collection/utils/document-responses.util';

@Component({
  selector: 'app-dynamic-field',
  standalone: true,
  imports: [FormsModule, InputComponent, SelectorComponent, TextareaComponent, ToggleComponent, IconComponent, ButtonComponent, SpinnerComponent, AttachmentListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div>
      <!-- Label with icon (custom or default by field type) -->
      @if (field().field_type !== 'checkbox') {
        <label class="flex items-center gap-1.5 text-xs font-medium mb-1.5" style="color: var(--color-text)">
          <app-icon [name]="resolvedIcon()" [size]="14" color="var(--color-text-muted)"></app-icon>
          {{ field().label }}
          @if (required()) {
            <span class="ml-0.5" style="color: var(--color-error)">*</span>
          }
        </label>
      }

      @if (field().description) {
        <p class="text-xs mb-1.5" style="color: var(--color-text-muted)">{{ field().description }}</p>
      }

      @switch (field().field_type) {
        @case ('text') {
          <app-input
            [size]="'sm'"
            type="text"
            [placeholder]="placeholder()"
            [ngModel]="value()"
            [ngModelOptions]="{ standalone: true }"
            (inputChange)="valueChange.emit($event)"
          />
        }
        @case ('number') {
          <app-input
            [size]="'sm'"
            type="number"
            [placeholder]="placeholder()"
            [ngModel]="value()"
            [ngModelOptions]="{ standalone: true }"
            [min]="field().options?.min"
            [max]="field().options?.max"
            (inputChange)="valueChange.emit($event)"
          />
        }
        @case ('date') {
          <app-input
            [size]="'sm'"
            type="date"
            [ngModel]="value()"
            [ngModelOptions]="{ standalone: true }"
            (inputChange)="valueChange.emit($event)"
          />
        }
        @case ('email') {
          <app-input
            [size]="'sm'"
            type="email"
            [placeholder]="placeholder()"
            [ngModel]="value()"
            [ngModelOptions]="{ standalone: true }"
            (inputChange)="valueChange.emit($event)"
          />
        }
        @case ('phone') {
          <app-input
            [size]="'sm'"
            type="tel"
            [placeholder]="placeholder()"
            [ngModel]="value()"
            [ngModelOptions]="{ standalone: true }"
            (inputChange)="valueChange.emit($event)"
          />
        }
        @case ('url') {
          <app-input
            [size]="'sm'"
            type="url"
            [placeholder]="placeholder()"
            [ngModel]="value()"
            [ngModelOptions]="{ standalone: true }"
            (inputChange)="valueChange.emit($event)"
          />
        }
        @case ('textarea') {
          <app-textarea
            [rows]="3"
            [placeholder]="placeholder()"
            [ngModel]="value()"
            (valueChange)="valueChange.emit($event)"
          />
        }
        @case ('select') {
          <app-selector
            [size]="'sm'"
            [options]="selectorOptions()"
            [placeholder]="'Seleccionar...'"
            [ngModel]="value()"
            (valueChange)="valueChange.emit($event)"
          />
        }
        @case ('checkbox') {
          <app-toggle
            [checked]="value() === 'true' || value() === true"
            [label]="field().label"
            (toggled)="valueChange.emit($event)"
          />
        }
        @case ('file') {
          @if (docs().length) {
            <div class="mb-2">
              <app-attachment-list
                [files]="attachmentItems()"
                [removable]="!uploading() && !!uploadToken()"
                (remove)="removeFile($event)"
              />
            </div>
          }
          @if (uploading()) {
            <div class="w-full px-3 py-2 border rounded-lg flex items-center gap-2"
                 style="border-color: var(--color-border); background: var(--color-surface); color: var(--color-text-muted)">
              <app-spinner size="sm" />
              <span class="text-xs">Subiendo {{ uploadingCount() === 1 ? 'archivo' : uploadingCount() + ' archivos' }}...</span>
            </div>
          } @else {
            <input #picker type="file" class="hidden"
                   [attr.accept]="acceptAttribute()"
                   [multiple]="docsConfig().multiple"
                   (change)="onFilesSelected($event)" />
            <app-button
              variant="outline"
              size="sm"
              [disabled]="!uploadToken() || !canAddMore()"
              (clicked)="picker.click()"
            >
              <app-icon name="upload" [size]="14" slot="icon"></app-icon>
              {{ uploadButtonLabel() }}
            </app-button>
            <p class="text-xs mt-1" style="color: var(--color-text-muted)">{{ docsHint() }}</p>
            @if (!uploadToken()) {
              <p class="text-xs mt-0.5" style="color: var(--color-text-muted)">
                La subida de archivos se habilita al diligenciar el formulario.
              </p>
            }
          }
          @if (uploadError()) {
            <p class="text-xs mt-1" role="alert" style="color: var(--color-error)">{{ uploadError() }}</p>
          }
        }
      }

      @if (helpText()) {
        <p class="text-xs mt-1" style="color: var(--color-text-muted)">{{ helpText() }}</p>
      }
    </div>
  `,
})
export class DynamicFieldComponent {
  private destroyRef = inject(DestroyRef);
  private http = inject(HttpClient);

  field = input.required<any>();
  value = input<any>('');
  required = input<boolean>(false);
  placeholder = input<string>('');
  helpText = input<string>('');
  uploadToken = input<string>('');
  icon = input<string>('');

  valueChange = output<any>();

  /** Item `validation_rules` (documents config for `file` fields). */
  validationRules = input<unknown>(null);

  uploading = signal(false);
  uploadingCount = signal(0);
  uploadError = signal<string>('');
  /** Signed URLs of files uploaded in this session (restored files have none). */
  private urlsByKey = signal<Record<string, string>>({});

  readonly docsConfig = computed(() => resolveItemDocumentConfig(this.validationRules()));
  readonly acceptAttribute = computed(() => documentAcceptAttribute(this.docsConfig()));
  /** Attached documents; the value may be a list or a legacy single key. */
  readonly docs = computed<StoredDocument[]>(() => normalizeDocumentsValue(this.value()));
  readonly attachmentItems = computed<AttachmentItem[]>(() =>
    this.docs().map((d) => ({ ...d, url: this.urlsByKey()[d.key] ?? null })),
  );
  readonly canAddMore = computed(() => this.docsConfig().multiple ? this.docs().length < DOCUMENT_MAX_FILES : true);
  readonly uploadButtonLabel = computed(() => {
    if (!this.docs().length) return this.docsConfig().multiple ? 'Subir archivos' : 'Subir archivo';
    return this.docsConfig().multiple ? 'Agregar otro archivo' : 'Reemplazar archivo';
  });
  readonly docsHint = computed(() => {
    const c = this.docsConfig();
    const kinds = c.accept.map((k) => DOCUMENT_KINDS[k].label).join(', ');
    const count = c.multiple ? ` · hasta ${DOCUMENT_MAX_FILES} archivos` : '';
    return `${kinds} · máx. ${c.max_size_mb} MB por archivo${count}`;
  });

  /** Resolved icon: custom icon if set, otherwise a default based on field_type */
  resolvedIcon = computed(() => {
    if (this.icon()) return this.icon();
    return this.getDefaultIconForType(this.field()?.field_type);
  });

  selectorOptions = computed(() => {
    const opts = this.field()?.options;
    const items = Array.isArray(opts) ? opts : (opts?.items || []);
    return items.map((opt: string) => ({ value: opt, label: opt }));
  });

  onFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const picked = Array.from(input.files ?? []);
    input.value = '';
    if (!picked.length) return;

    const token = this.uploadToken();
    if (!token) {
      this.uploadError.set('No se puede subir el archivo en este momento');
      return;
    }

    const config = this.docsConfig();
    const current = config.multiple ? this.docs() : [];
    const room = config.multiple ? DOCUMENT_MAX_FILES - current.length : 1;
    const messages: string[] = [];
    const accepted: File[] = [];
    for (const file of picked) {
      const problem = checkDocumentFile(config, { name: file.name, mime_type: file.type, size: file.size });
      if (problem) messages.push(`${file.name}: ${problem}`);
      else if (accepted.length >= room) messages.push(`${file.name}: se alcanzó el máximo de ${DOCUMENT_MAX_FILES} archivos.`);
      else accepted.push(file);
    }
    this.uploadError.set(messages.join(' '));
    if (!accepted.length) return;

    this.uploading.set(true);
    this.uploadingCount.set(accepted.length);
    // The parent updates `value` asynchronously: accumulate locally between uploads.
    const result: StoredDocument[] = [...current];
    const failures: string[] = [];

    from(accepted).pipe(
      concatMap((file) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('field_id', String(this.field()?.id));
        return this.http
          .post<{ data?: UploadedDocumentResponse } & UploadedDocumentResponse>(
            `${environment.apiUrl}/ecommerce/data-collection/${token}/upload`,
            formData,
          )
          .pipe(
            map((res) => ({ file, data: (res.data ?? res) as UploadedDocumentResponse, error: null as string | null })),
            catchError((err) => of({ file, data: null, error: (err?.error?.message as string) || 'Error al subir el archivo' })),
          );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: ({ file, data, error }) => {
        if (data) {
          result.push(toStoredDocument(data, { name: file.name, size: file.size, type: file.type }));
          const { key, url } = data;
          if (url) this.urlsByKey.update((m) => ({ ...m, [key]: url }));
          this.valueChange.emit([...result]);
        } else {
          failures.push(`${file.name}: ${error}`);
        }
      },
      complete: () => {
        this.uploading.set(false);
        this.uploadingCount.set(0);
        if (failures.length) this.uploadError.set([...messages, ...failures].join(' '));
      },
    });
  }

  removeFile(index: number) {
    this.uploadError.set('');
    this.valueChange.emit(this.docs().filter((_, i) => i !== index));
  }

  private getDefaultIconForType(fieldType?: string): string {
    switch (fieldType) {
      case 'text': return 'pencil';
      case 'textarea': return 'align-left';
      case 'number': return 'hash';
      case 'date': return 'calendar';
      case 'email': return 'mail';
      case 'phone': return 'phone';
      case 'url': return 'link';
      case 'checkbox': return 'check-square';
      case 'select': return 'list';
      case 'file': return 'paperclip';
      default: return 'pencil';
    }
  }
}
