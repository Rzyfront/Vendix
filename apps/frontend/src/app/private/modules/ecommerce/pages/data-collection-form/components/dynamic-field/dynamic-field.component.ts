import { Component, ChangeDetectionStrategy, input, output, computed, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../../../../../environments/environment';
import {
  InputComponent,
  SelectorComponent,
  TextareaComponent,
  ToggleComponent,
  IconComponent,
} from '../../../../../../../shared/components';

@Component({
  selector: 'app-dynamic-field',
  standalone: true,
  imports: [CommonModule, FormsModule, InputComponent, SelectorComponent, TextareaComponent, ToggleComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div>
      <!-- Label with icon (custom or default by field type) -->
      @if (field().field_type !== 'checkbox') {
        <label class="flex items-center gap-1.5 text-xs font-medium mb-1.5" style="color: var(--color-text)">
          <app-icon [name]="resolvedIcon()" [size]="14" color="var(--color-text-muted)"></app-icon>
          {{ field().label }}
          @if (required()) {
            <span class="text-red-500 ml-0.5">*</span>
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
            [value]="value()"
            (inputChange)="valueChange.emit($event)"
          />
        }
        @case ('number') {
          <app-input
            [size]="'sm'"
            type="number"
            [placeholder]="placeholder()"
            [value]="value()"
            [min]="field().options?.min"
            [max]="field().options?.max"
            (inputChange)="valueChange.emit($event)"
          />
        }
        @case ('date') {
          <app-input
            [size]="'sm'"
            type="date"
            [value]="value()"
            (inputChange)="valueChange.emit($event)"
          />
        }
        @case ('email') {
          <app-input
            [size]="'sm'"
            type="email"
            [placeholder]="placeholder()"
            [value]="value()"
            (inputChange)="valueChange.emit($event)"
          />
        }
        @case ('phone') {
          <app-input
            [size]="'sm'"
            type="tel"
            [placeholder]="placeholder()"
            [value]="value()"
            (inputChange)="valueChange.emit($event)"
          />
        }
        @case ('url') {
          <app-input
            [size]="'sm'"
            type="url"
            [placeholder]="placeholder()"
            [value]="value()"
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
          @if (uploading()) {
            <div class="w-full px-3 py-2 border rounded-lg text-sm flex items-center gap-2"
                 style="border-color: var(--color-border); background: var(--color-surface); color: var(--color-text-muted)">
              <div class="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
                   style="border-color: var(--color-primary); border-top-color: transparent"></div>
              <span class="text-xs">Subiendo archivo...</span>
            </div>
          } @else if (uploadedFileName()) {
            <div class="w-full px-3 py-2 border rounded-lg text-sm flex items-center justify-between"
                 style="border-color: var(--color-border); background: var(--color-surface); color: var(--color-text)">
              <div class="flex items-center gap-2 min-w-0">
                <app-icon name="check-circle" [size]="14" color="var(--color-primary)"></app-icon>
                <span class="truncate text-xs">{{ uploadedFileName() }}</span>
              </div>
              <button type="button"
                      class="text-xs px-2 py-1 rounded shrink-0"
                      style="color: var(--color-text-muted)"
                      (click)="clearFile()">
                Cambiar
              </button>
            </div>
          } @else {
            <input type="file"
                   class="w-full px-3 py-2 border rounded-lg text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20"
                   style="border-color: var(--color-border); background: var(--color-surface); color: var(--color-text)"
                   [accept]="field().options?.accept || '*'"
                   (change)="onFileChange($event)" />
          }
          @if (uploadError()) {
            <p class="text-xs mt-1 text-red-500">{{ uploadError() }}</p>
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
  private http = inject(HttpClient);

  field = input.required<any>();
  value = input<any>('');
  required = input<boolean>(false);
  placeholder = input<string>('');
  helpText = input<string>('');
  uploadToken = input<string>('');
  icon = input<string>('');

  valueChange = output<any>();

  uploading = signal(false);
  uploadedFileName = signal<string>('');
  uploadError = signal<string>('');

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

  onFileChange(event: Event) {
    const target = event.target as HTMLInputElement;
    if (!target.files?.length) return;

    const file = target.files[0];
    const token = this.uploadToken();

    if (!token) {
      this.uploadError.set('No se puede subir el archivo en este momento');
      return;
    }

    this.uploading.set(true);
    this.uploadError.set('');

    const formData = new FormData();
    formData.append('file', file);

    this.http.post<any>(
      `${environment.apiUrl}/ecommerce/data-collection/${token}/upload`,
      formData,
    ).subscribe({
      next: (res) => {
        const data = res.data || res;
        this.valueChange.emit(data.key);
        this.uploadedFileName.set(data.originalName || file.name);
        this.uploading.set(false);
      },
      error: (err) => {
        this.uploadError.set(err.error?.message || 'Error al subir el archivo');
        this.uploading.set(false);
        target.value = '';
      },
    });
  }

  clearFile() {
    this.uploadedFileName.set('');
    this.uploadError.set('');
    this.valueChange.emit(null);
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
