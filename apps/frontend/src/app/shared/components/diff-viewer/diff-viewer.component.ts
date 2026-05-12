import { Component, input, computed, ChangeDetectionStrategy } from '@angular/core';

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged' | 'header';
  content: string;
  lineNumber?: number;
}

@Component({
  selector: 'app-diff-viewer',
  standalone: true,
  imports: [],
  template: `
    <div class="diff-viewer font-mono text-xs rounded-lg overflow-hidden border border-border">
      @if (oldValue()) {
        <div class="bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 border-b border-red-100">
          Valor Anterior
        </div>
        <div class="max-h-60 overflow-auto">
          @for (line of oldLines(); track $index) {
            <div
              class="px-3 py-0.5 flex"
              [class.bg-red-50]="line.type === 'removed'"
              [class.bg-red-100]="line.type === 'header'"
              [class.text-red-800]="line.type === 'removed' || line.type === 'header'"
              [class.font-semibold]="line.type === 'header'"
            >
              <span class="w-8 text-gray-400 select-none text-right pr-2 flex-shrink-0">
                @if (line.lineNumber) {
                  {{ line.lineNumber }}
                }
              </span>
              <span
                class="flex-1"
                [class.text-red-700]="line.type === 'removed'"
                [class.text-red-800]="line.type === 'header'"
              >
                @if (line.type === 'removed' || line.type === 'header') {
                  {{ line.content }}
                } @else {
                  <span class="text-gray-400">{{ line.content }}</span>
                }
              </span>
            </div>
          }
        </div>
      }

      @if (newValue()) {
        <div class="bg-green-50 px-3 py-1 text-xs font-semibold text-green-700 border-b border-green-100"
             [class.border-t]="oldValue()"
             [class.mt-1]="oldValue()">
          Nuevo Valor
        </div>
        <div class="max-h-60 overflow-auto">
          @for (line of newLines(); track $index) {
            <div
              class="px-3 py-0.5 flex"
              [class.bg-green-50]="line.type === 'added'"
              [class.bg-green-100]="line.type === 'header'"
              [class.text-green-800]="line.type === 'added' || line.type === 'header'"
              [class.font-semibold]="line.type === 'header'"
            >
              <span class="w-8 text-gray-400 select-none text-right pr-2 flex-shrink-0">
                @if (line.lineNumber) {
                  {{ line.lineNumber }}
                }
              </span>
              <span
                class="flex-1"
                [class.text-green-700]="line.type === 'added'"
                [class.text-green-800]="line.type === 'header'"
              >
                @if (line.type === 'added' || line.type === 'header') {
                  {{ line.content }}
                } @else {
                  <span class="text-gray-400">{{ line.content }}</span>
                }
              </span>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiffViewerComponent {
  readonly oldValue = input<any>(undefined);
  readonly newValue = input<any>(undefined);

  readonly oldLines = computed<DiffLine[]>(() => {
    const value = this.oldValue();
    if (value === undefined || value === null) return [];
    return this.parseValue(value);
  });

  readonly newLines = computed<DiffLine[]>(() => {
    const value = this.newValue();
    if (value === undefined || value === null) return [];
    return this.parseValue(value);
  });

  private parseValue(value: any): DiffLine[] {
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        return [{ type: 'unchanged', content: value, lineNumber: 1 }];
      }
    }

    if (Array.isArray(value)) {
      return value.map((item, idx) => ({
        type: 'unchanged' as const,
        content: JSON.stringify(item, null, 2),
        lineNumber: idx + 1,
      }));
    }

    if (typeof value === 'object' && value !== null) {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        return [{ type: 'unchanged', content: '{}', lineNumber: 1 }];
      }
      return entries.map(([key, val], idx) => ({
        type: 'unchanged' as const,
        content: `  "${key}": ${JSON.stringify(val)}`,
        lineNumber: idx + 1,
      }));
    }

    return [{ type: 'unchanged', content: String(value), lineNumber: 1 }];
  }
}
