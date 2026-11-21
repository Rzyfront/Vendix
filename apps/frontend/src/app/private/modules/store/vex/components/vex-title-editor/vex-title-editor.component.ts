import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { validateConversationTitle } from '../../state/vex-conversation-groups.util';

let nextEditorId = 0;

/**
 * Inline editor of a conversation name, shared by the chat list and the
 * thread header. Enter saves, Escape cancels, blur saves; a name outside
 * 1–80 characters shows its error and keeps the editor open. It emits at most
 * one of `saved` / `cancelled` per editing session; the parent decides where
 * focus goes next.
 */
@Component({
  selector: 'vendix-vex-title-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0 flex-1' },
  template: `
    <input
      #field
      type="text"
      class="w-full min-h-10 px-3 rounded-lg bg-background text-sm text-text-primary border outline-none focus-visible:ring-2 focus-visible:ring-primary"
      [class]="error() ? 'border-error' : 'border-border'"
      [value]="draft()"
      [attr.aria-label]="label()"
      [attr.aria-invalid]="error() ? 'true' : null"
      [attr.aria-describedby]="error() ? error_id : null"
      autocomplete="off"
      (input)="onInput($event)"
      (keydown.enter)="onEnter($event)"
      (keydown.escape)="onEscape($event)"
      (blur)="onBlur()"
    />
    @if (error(); as message) {
      <p [id]="error_id" class="px-1 pt-1 text-xs text-error" role="alert">
        {{ message }}
      </p>
    }
  `,
})
export class VexTitleEditorComponent {
  readonly value = input.required<string>();
  readonly label = input('Nombre de la conversación');

  readonly saved = output<string>();
  readonly cancelled = output<void>();

  protected readonly error_id = `vex-title-error-${nextEditorId++}`;
  protected readonly draft = signal('');
  protected readonly error = signal<string | null>(null);

  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');
  private finished = false;

  constructor() {
    afterNextRender(() => {
      this.draft.set(this.value());
      const el = this.field().nativeElement;
      el.value = this.value();
      el.focus();
      el.select();
    });
  }

  protected onInput(event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.draft.set(text);
    // Clears a shown error as soon as the text becomes valid.
    if (this.error() && validateConversationTitle(text) === null) {
      this.error.set(null);
    }
  }

  protected onEnter(event: Event): void {
    event.preventDefault();
    this.commit();
  }

  protected onEscape(event: Event): void {
    event.preventDefault();
    if (this.finished) return;
    this.finished = true;
    this.cancelled.emit();
  }

  protected onBlur(): void {
    if (this.finished) return;
    this.commit();
  }

  private commit(): void {
    if (this.finished) return;
    const text = this.field().nativeElement.value;
    const problem = validateConversationTitle(text);
    if (problem) {
      this.draft.set(text);
      this.error.set(problem);
      return;
    }
    this.finished = true;
    const title = text.trim();
    if (title === this.value().trim()) this.cancelled.emit();
    else this.saved.emit(title);
  }
}
