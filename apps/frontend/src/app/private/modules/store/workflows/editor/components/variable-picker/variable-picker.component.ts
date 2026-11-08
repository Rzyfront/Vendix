import { Component, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import { ButtonComponent, IconComponent } from '../../../../../../../shared/components/index';
import { VariableGroup, filterVariableGroups, insertAtCursor } from './variable-picker.utils';

/**
 * "Insertar variable": a searchable, grouped list of `{{tokens}}`. Choosing one
 * inserts it at the caret of the text control found inside `container` (the
 * element that wraps the `app-input` / `app-textarea`) and emits the new text.
 */
@Component({
  selector: 'app-variable-picker',
  standalone: true,
  imports: [ButtonComponent, IconComponent],
  host: {
    class: 'relative inline-block',
    '(document:pointerdown)': 'onOutsidePointer($event)',
    '(keydown.escape)': 'close()',
  },
  template: `
    <app-button
      variant="outline"
      size="xsm"
      [ariaPressed]="open()"
      (clicked)="toggle()"
    >
      <app-icon name="code" [size]="12" slot="icon" />
      Insertar variable
    </app-button>
    @if (open()) {
      <div
        class="absolute left-0 top-full z-30 mt-1 flex w-72 max-w-[85vw] flex-col gap-2 rounded-xl border border-border bg-surface p-2 shadow-lg"
        role="dialog"
        aria-label="Elegir variable"
        data-testid="variable-picker-panel"
      >
        <input
          type="search"
          class="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          placeholder="Buscar variable…"
          aria-label="Buscar variable"
          [value]="query()"
          (input)="onQuery($event)"
        />
        <div class="max-h-64 overflow-auto">
          @for (group of visible(); track group.id) {
            <p class="px-2 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-text-secondary">{{ group.label }}</p>
            @for (option of group.options; track option.token) {
              <button
                type="button"
                class="flex w-full flex-col rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                (click)="pick(option.token)"
              >
                <span class="text-sm text-text-primary">{{ option.label }}</span>
                @if (option.hint) {
                  <span class="text-xs text-text-secondary">{{ option.hint }}</span>
                }
              </button>
            }
          } @empty {
            <p class="px-2 py-3 text-sm text-text-secondary">No hay variables que coincidan.</p>
          }
        </div>
      </div>
    }
  `,
})
export class VariablePickerComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly groups = input.required<VariableGroup[]>();
  /** Wrapper of the text control that receives the token. */
  readonly container = input.required<HTMLElement>();
  /** Current text of that control (the source of truth of the parent). */
  readonly text = input('');
  readonly textChange = output<string>();

  readonly open = signal(false);
  readonly query = signal('');
  readonly visible = computed(() => filterVariableGroups(this.groups(), this.query()));

  toggle(): void {
    this.query.set('');
    this.open.update((v) => !v);
  }

  onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  close(): void {
    this.open.set(false);
  }

  onOutsidePointer(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close();
  }

  pick(token: string): void {
    const control = this.container().querySelector<HTMLInputElement | HTMLTextAreaElement>('textarea, input');
    const current = this.text();
    // The control keeps its selection after losing focus; if it is out of sync with the text, append.
    const synced = control !== null && control.value === current;
    const next = insertAtCursor(
      current,
      token,
      synced ? control.selectionStart : null,
      synced ? control.selectionEnd : null,
    );
    this.textChange.emit(next.text);
    this.close();
    if (control) {
      // Wait for the parent to render the new value before restoring the caret.
      setTimeout(() => {
        control.focus();
        control.setSelectionRange(next.caret, next.caret);
      });
    }
  }
}
