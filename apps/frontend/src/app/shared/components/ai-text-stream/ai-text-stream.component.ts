import {
  Component,
  DestroyRef,
  input,
  signal,
  effect,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-ai-text-stream',
  standalone: true,
  template: `
    <span class="ai-streamed-text">{{ displayText() }}</span>
    @if (isStreaming()) {
      <span class="ai-cursor"></span>
    }
  `,
  styles: [
    `
      :host {
        display: inline;
      }

      .ai-streamed-text {
        white-space: pre-wrap;
        word-break: break-word;
      }

      .ai-cursor {
        display: inline-block;
        width: 2px;
        height: 1em;
        background: rgba(var(--color-primary-rgb, 99, 102, 241), 0.8);
        margin-left: 1px;
        vertical-align: text-bottom;
        animation: ai-cursor-blink 0.8s ease-in-out infinite;
      }

      @keyframes ai-cursor-blink {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0;
        }
      }
    `,
  ],
})
export class AITextStreamComponent {
  stream$ = input<Observable<string> | null>(null);

  displayText = signal('');
  isStreaming = signal(false);

  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    effect(() => {
      const stream = this.stream$();

      if (!stream) return;

      this.displayText.set('');
      this.isStreaming.set(true);

      stream.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (text) => {
          this.displayText.update((current) => current + text);
        },
        complete: () => {
          this.isStreaming.set(false);
        },
        error: () => {
          this.isStreaming.set(false);
        },
      });
    });
  }
}
