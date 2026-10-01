import {
  Component,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  Injector,
  viewChild,
} from '@angular/core';
import { VexChatStore } from '../../state/vex-chat.store';

@Component({
  selector: 'vendix-vex-thread',
  standalone: true,
  template: `
    <div
      #scroller
      class="h-full overflow-y-auto"
      role="log"
      aria-live="polite"
    >
      <div class="max-w-3xl mx-auto w-full px-4 py-4 flex flex-col gap-6">
        @for (message of messages(); track message.id) {
          @if (message.role === 'user') {
            <div class="flex justify-end">
              <div
                class="max-w-[80%] rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] px-4 py-2 whitespace-pre-wrap leading-relaxed text-[var(--color-text-primary)]"
              >
                {{ message.content }}
              </div>
            </div>
          } @else {
            <div class="flex items-start gap-3">
              <img
                src="assets/vex/vexicon-96.webp"
                alt=""
                class="w-7 h-7 object-contain shrink-0"
              />
              <p
                class="whitespace-pre-wrap leading-relaxed text-[var(--color-text-primary)] min-w-0"
              >
                {{ message.content }}
              </p>
            </div>
          }
        }
        @if (store.is_agent_typing()) {
          <div class="flex items-center gap-3" aria-label="Vex está escribiendo">
            <img
              src="assets/vex/vexicon-96.webp"
              alt=""
              class="w-7 h-7 object-contain shrink-0"
            />
            <div class="flex items-center gap-1">
              <span
                class="w-2 h-2 rounded-full bg-[var(--color-text-secondary)] animate-bounce"
              ></span>
              <span
                class="w-2 h-2 rounded-full bg-[var(--color-text-secondary)] animate-bounce [animation-delay:150ms]"
              ></span>
              <span
                class="w-2 h-2 rounded-full bg-[var(--color-text-secondary)] animate-bounce [animation-delay:300ms]"
              ></span>
            </div>
          </div>
        }
      </div>
    </div>
  `,
})
export class VexThreadComponent {
  readonly store = inject(VexChatStore);
  private readonly injector = inject(Injector);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  readonly messages = () => this.store.active_conversation()?.messages ?? [];

  constructor() {
    effect(() => {
      this.messages();
      this.store.is_agent_typing();
      afterNextRender(
        () => {
          const el = this.scroller()?.nativeElement;
          if (el) el.scrollTop = el.scrollHeight;
        },
        { injector: this.injector },
      );
    });
  }
}
