import {
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { VEX_MODEL_OPTIONS } from '../../models/vex.models';
import { VexChatStore } from '../../state/vex-chat.store';

const MAX_LINES = 8;

@Component({
  selector: 'vendix-vex-composer',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="w-full">
      <div
        class="rounded-3xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-lg px-3 py-2 flex items-end gap-2"
      >
        <button
          type="button"
          class="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          aria-label="Adjuntar"
          title="Próximamente"
        >
          <app-icon name="plus" [size]="20"></app-icon>
        </button>

        <textarea
          #input
          rows="1"
          class="flex-1 min-w-0 resize-none bg-transparent outline-none border-0 py-2 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]"
          placeholder="Pregúntale a Vex"
          aria-label="Mensaje para Vex"
          [value]="text()"
          (input)="onInput($event)"
          (keydown)="onKeydown($event)"
        ></textarea>

        <div class="relative shrink-0">
          <button
            type="button"
            class="h-10 px-3 rounded-full flex items-center gap-1 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            aria-haspopup="listbox"
            [attr.aria-expanded]="model_open()"
            (click)="toggleModelMenu($event)"
          >
            {{ selected_label() }}
            <app-icon name="chevron-down" [size]="16"></app-icon>
          </button>
          @if (model_open()) {
            <ul
              role="listbox"
              class="absolute bottom-full right-0 mb-2 min-w-32 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg py-1 z-10"
            >
              @for (option of model_options; track option.id) {
                <li role="option" [attr.aria-selected]="option.id === store.selected_model_id()">
                  <button
                    type="button"
                    class="w-full text-left min-h-10 px-3 text-sm hover:bg-[var(--color-background)] text-[var(--color-text-primary)]"
                    [class.font-semibold]="option.id === store.selected_model_id()"
                    (click)="selectModel(option.id)"
                  >
                    {{ option.label }}
                  </button>
                </li>
              }
            </ul>
          }
        </div>

        <button
          type="button"
          class="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          aria-label="Dictar"
        >
          <app-icon name="mic" [size]="20"></app-icon>
        </button>

        @if (can_send()) {
          <button
            type="button"
            class="w-10 h-10 shrink-0 rounded-full flex items-center justify-center bg-[var(--color-primary)] text-[var(--color-text-on-primary)] transition-opacity hover:opacity-90"
            aria-label="Enviar"
            (click)="send()"
          >
            <app-icon name="send" [size]="18"></app-icon>
          </button>
        }
      </div>
      <p class="mt-2 text-center text-xs text-[var(--color-text-secondary)]">
        Vex puede cometer errores. Verifica la información importante.
      </p>
    </div>
  `,
})
export class VexComposerComponent {
  readonly store = inject(VexChatStore);
  private readonly input = viewChild.required<ElementRef<HTMLTextAreaElement>>('input');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly model_options = VEX_MODEL_OPTIONS;
  readonly text = signal('');
  readonly model_open = signal(false);

  readonly can_send = computed(
    () => this.text().trim().length > 0 && !this.store.is_agent_typing(),
  );
  readonly selected_label = computed(
    () =>
      this.model_options.find((o) => o.id === this.store.selected_model_id())
        ?.label ?? this.model_options[0].label,
  );

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (
      this.model_open() &&
      !this.host.nativeElement.contains(event.target as Node)
    ) {
      this.model_open.set(false);
    }
  }

  toggleModelMenu(event: Event): void {
    event.stopPropagation();
    this.model_open.update((v) => !v);
  }

  selectModel(id: string): void {
    this.store.setModel(id);
    this.model_open.set(false);
  }

  onInput(event: Event): void {
    this.text.set((event.target as HTMLTextAreaElement).value);
    this.resize();
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    this.send();
  }

  send(): void {
    if (!this.can_send()) return;
    this.store.sendMessage(this.text());
    this.text.set('');
    this.input().nativeElement.value = '';
    this.resize();
  }

  private resize(): void {
    const el = this.input().nativeElement;
    el.style.height = 'auto';
    const line = parseFloat(getComputedStyle(el).lineHeight) || 24;
    const max = line * MAX_LINES;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }
}
