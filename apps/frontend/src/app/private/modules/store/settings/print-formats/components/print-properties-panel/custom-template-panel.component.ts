import {
  Component,
  ElementRef,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  PrintFormatDefinition,
  PrintTokenDefinition,
} from '../../../../../../../core/models/print-formats.model';

/**
 * [print-editor-dsk P5.8] — Custom template panel.
 *
 * Textarea bound to `definition.custom_template`. Provides token
 * autocomplete: when the user types `{{` we surface suggestions pulled
 * from `available_tokens` (read from the parent format detail) and
 * clicking a suggestion inserts the full `{{ path }}` token at the
 * cursor position.
 */
@Component({
  selector: 'app-print-custom-template-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="vendix-subpanel">
      <h4 class="text-xs font-bold uppercase tracking-wider text-text-secondary mb-2">
        Plantilla Personalizada
      </h4>

      <div class="space-y-2">
        <p class="text-[11px] text-text-tertiary">
          Escribe HTML/CSS libre. Inserta tokens escribiendo <code class="font-mono">{{ '{{' }}</code> y eligiendo de la lista.
        </p>

        <!-- Token autocomplete -->
        @if (showSuggestions()) {
          <div
            class="rounded-lg border border-primary-500/40 bg-surface shadow-sm p-1.5 max-h-40 overflow-y-auto"
          >
            @if (filteredTokens().length === 0) {
              <p class="text-[11px] text-text-tertiary py-2 text-center">
                Sin coincidencias.
              </p>
            } @else {
              @for (t of filteredTokens(); track t.path) {
                <button
                  type="button"
                  class="block w-full text-left px-2 py-1 rounded hover:bg-surface-hover transition"
                  (click)="insertToken(t)"
                >
                  <code class="text-[11px] font-mono text-primary-500">{{ t.token }}</code>
                  <span class="text-[10px] text-text-tertiary ml-2">{{ t.path }}</span>
                </button>
              }
            }
          </div>
        }

        <!-- Textarea -->
        <textarea
          #editor
          rows="10"
          [ngModel]="template()"
          (ngModelChange)="onInput($event)"
          (keyup)="onKeyUp()"
          (blur)="closeSuggestions()"
          placeholder="{{ '{{ path.to.field }}' }}"
          class="w-full p-3 font-mono text-xs bg-slate-950 text-emerald-400 border border-slate-800 rounded-lg focus:border-primary-500 focus:outline-none leading-relaxed"
        ></textarea>

        <!-- Footer -->
        <div class="flex items-center justify-between text-[10px] text-text-tertiary">
          <span>{{ template().length }} caracteres</span>
          @if (template()) {
            <button
              type="button"
              (click)="clearTemplate()"
              class="text-red-500 hover:text-red-400 underline"
            >
              Volver a modo estructurado
            </button>
          }
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .vendix-subpanel {
        padding: 0.625rem;
        border: 1px solid var(--color-border, #e5e7eb);
        border-radius: 0.5rem;
        background: var(--color-surface, #ffffff);
      }
    `,
  ],
})
export class PrintCustomTemplatePanelComponent {
  readonly definition = input.required<PrintFormatDefinition>();
  readonly definitionChanged = output<PrintFormatDefinition>();

  private readonly editorRef = viewChild<ElementRef<HTMLTextAreaElement>>('editor');

  readonly template = computed<string>(() => {
    return this.definition().custom_template ?? '';
  });

  readonly availableTokens = computed<PrintTokenDefinition[]>(() => {
    return (this.definition() as any)?.available_tokens ?? [];
  });

  /** Trigger prefix typed by the user; opens the suggestion popover. */
  readonly suggestionPrefix = signal<string>('');
  readonly showSuggestions = computed(() => this.suggestionPrefix().length > 0);

  readonly filteredTokens = computed<PrintTokenDefinition[]>(() => {
    const prefix = this.suggestionPrefix().toLowerCase();
    if (!prefix) return this.availableTokens();
    return this.availableTokens().filter(
      (t) =>
        t.path.toLowerCase().includes(prefix) ||
        t.token.toLowerCase().includes(prefix),
    );
  });

  emit(next: PrintFormatDefinition): void {
    this.definitionChanged.emit(next);
  }

  onInput(value: string): void {
    this.emit({ ...this.definition(), custom_template: value });
    this.updateSuggestionState();
  }

  onKeyUp(): void {
    this.updateSuggestionState();
  }

  closeSuggestions(): void {
    // Slight delay so click handlers on the suggestion list still fire.
    setTimeout(() => this.suggestionPrefix.set(''), 120);
  }

  insertToken(token: PrintTokenDefinition): void {
    const editor = this.editorRef()?.nativeElement;
    const current = this.template();
    const start = editor?.selectionStart ?? current.length;
    const end = editor?.selectionEnd ?? current.length;
    const snippet = `{{ ${token.path} }}`;
    const next = current.slice(0, start) + snippet + current.slice(end);
    this.emit({ ...this.definition(), custom_template: next });
    this.suggestionPrefix.set('');
    // Restore caret just after the inserted token.
    queueMicrotask(() => {
      const el = this.editorRef()?.nativeElement;
      if (!el) return;
      const caret = start + snippet.length;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  clearTemplate(): void {
    this.emit({ ...this.definition(), custom_template: '' });
    this.suggestionPrefix.set('');
  }

  /**
   * Reads the textarea caret neighborhood and updates `suggestionPrefix`.
   * If the user just typed `{{` we look for the next `}}` — if missing,
   * we surface the picker with an empty prefix; if present, we hide it.
   */
  private updateSuggestionState(): void {
    const editor = this.editorRef()?.nativeElement;
    if (!editor) return;
    const caret = editor.selectionStart ?? 0;
    const value = this.template();
    // Look back at most 80 chars for an unterminated `{{`.
    const window = value.slice(Math.max(0, caret - 80), caret);
    const lastOpen = window.lastIndexOf('{{');
    if (lastOpen < 0) {
      this.suggestionPrefix.set('');
      return;
    }
    const tail = window.slice(lastOpen + 2);
    if (tail.includes('}}')) {
      this.suggestionPrefix.set('');
      return;
    }
    this.suggestionPrefix.set(tail.trim());
  }
}