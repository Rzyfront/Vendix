import {
  Component,
  input,
  output,
  signal,
  computed,
  effect,
  untracked,
  OnDestroy,
  ChangeDetectionStrategy,
  inject,
  ViewChild,
  ElementRef,
  AfterViewChecked,
} from '@angular/core';

import { Subscription } from 'rxjs';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
} from '../../../../../shared/components';
import { markdownToHtml } from '../../../../../shared/utils/markdown.util';
import {
  PosCashRegisterService,
  AIStreamEvent,
} from '../services/pos-cash-register.service';

@Component({
  selector: 'app-pos-ai-summary-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ModalComponent,
    ButtonComponent,
    IconComponent
],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="$event || onClose()"
      size="md"
    >
      <!-- Header with AI styling -->
      <div slot="header" class="ai-summary-header">
        <div class="ai-summary-icon">
          <app-icon name="sparkles" [size]="20"></app-icon>
        </div>
        <div>
          <h2 class="text-lg font-semibold" style="color: var(--color-text-primary)">Resumen IA del Cierre</h2>
          <p class="text-sm" style="color: var(--color-text-secondary)">Analisis generado por inteligencia artificial</p>
        </div>
      </div>

      <!-- Body -->
      <div class="ai-summary-body" #scrollContainer>
        @if (status() === 'loading') {
          <div class="ai-loading-state">
            <div class="ai-thinking-dots">
              <span></span><span></span><span></span>
            </div>
            <p class="text-sm" style="color: var(--color-text-secondary); margin-top: 8px">
              Analizando movimientos del turno...
            </p>
          </div>
        }

        @if (status() === 'streaming' || status() === 'done') {
          <div class="ai-content-area">
            <div class="ai-markdown-content" [innerHTML]="renderedHtml()"></div>
            @if (status() === 'streaming') {
              <span class="ai-cursor"></span>
            }
          </div>
          @if (status() === 'done') {
            <div class="ai-saved-indicator">
              <app-icon name="check-circle" [size]="14"></app-icon>
              Resumen guardado automaticamente
            </div>
          }
        }

        @if (status() === 'error') {
          <div class="ai-error-state">
            <app-icon name="alert-circle" [size]="24"></app-icon>
            <p class="text-sm">{{ errorMessage() }}</p>
            <button class="ai-retry-btn" (click)="retry()">Reintentar</button>
          </div>
        }
      </div>

      <!-- Footer -->
      <div slot="footer" class="flex justify-end">
        <app-button [variant]="'secondary'" [size]="'md'" (clicked)="onClose()">
          Cerrar
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      .ai-summary-header {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .ai-summary-icon {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(
          135deg,
          rgba(var(--color-primary-rgb), 0.15) 0%,
          rgba(var(--color-primary-rgb), 0.05) 100%
        );
        color: rgb(var(--color-primary-rgb));
      }

      .ai-summary-body {
        min-height: 120px;
        max-height: 60vh;
        overflow-y: auto;
      }

      .ai-content-area {
        padding: 16px;
        background: linear-gradient(
          135deg,
          rgba(var(--color-primary-rgb), 0.04) 0%,
          rgba(var(--color-primary-rgb), 0.01) 100%
        );
        border-radius: 12px;
        border: 1px solid rgba(var(--color-primary-rgb), 0.08);
        line-height: 1.7;
        font-size: 14px;
        color: var(--color-text-primary);
      }

      .ai-markdown-content :host ::ng-deep h2 {
        font-size: 16px;
        font-weight: 600;
        margin: 12px 0 6px;
      }

      .ai-markdown-content :host ::ng-deep h3 {
        font-size: 15px;
        font-weight: 600;
        margin: 10px 0 4px;
      }

      .ai-markdown-content :host ::ng-deep p {
        margin: 4px 0;
      }

      .ai-markdown-content :host ::ng-deep ul {
        margin: 4px 0;
        padding-left: 20px;
      }

      .ai-markdown-content :host ::ng-deep li {
        margin: 2px 0;
      }

      .ai-markdown-content :host ::ng-deep strong {
        font-weight: 600;
      }

      .ai-cursor {
        display: inline-block;
        width: 2px;
        height: 1em;
        background: rgba(var(--color-primary-rgb, 99, 102, 241), 0.8);
        margin-left: 2px;
        vertical-align: text-bottom;
        animation: ai-cursor-blink 0.8s ease-in-out infinite;
      }

      @keyframes ai-cursor-blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0; }
      }

      .ai-loading-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 48px 0;
      }

      .ai-thinking-dots {
        display: flex;
        gap: 6px;
      }

      .ai-thinking-dots span {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: rgb(var(--color-primary-rgb));
        animation: ai-dot-bounce 1.2s ease-in-out infinite;
      }

      .ai-thinking-dots span:nth-child(2) {
        animation-delay: 0.15s;
      }

      .ai-thinking-dots span:nth-child(3) {
        animation-delay: 0.3s;
      }

      @keyframes ai-dot-bounce {
        0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
        40% { transform: scale(1); opacity: 1; }
      }

      .ai-error-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        padding: 48px 0;
        color: var(--color-text-secondary);
      }

      .ai-retry-btn {
        padding: 6px 16px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 500;
        background: rgba(var(--color-primary-rgb), 0.1);
        color: rgb(var(--color-primary-rgb));
        border: 1px solid rgba(var(--color-primary-rgb), 0.2);
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .ai-retry-btn:hover {
        background: rgba(var(--color-primary-rgb), 0.15);
      }

      .ai-saved-indicator {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 12px;
        font-size: 12px;
        color: var(--color-text-secondary);
      }

      .ai-saved-indicator app-icon {
        color: #22c55e;
      }
    `,
  ],
})
export class PosAISummaryModalComponent implements OnDestroy, AfterViewChecked {
  @ViewChild('scrollContainer') private scrollContainer?: ElementRef<HTMLElement>;
  private shouldAutoScroll = false;
  readonly isOpen = input<boolean>(false);
  readonly sessionId = input<number | null>(null);
  readonly isOpenChange = output<boolean>();

  readonly status = signal<'idle' | 'loading' | 'streaming' | 'done' | 'error'>('idle');
  readonly errorMessage = signal<string | null>(null);
  readonly rawText = signal('');
  readonly renderedHtml = computed(() => markdownToHtml(this.rawText()));

  private subscription: Subscription | null = null;
  private readonly cashRegisterService = inject(PosCashRegisterService);

  constructor() {
    effect(() => {
      const open = this.isOpen();
      const sid = this.sessionId();
      if (open && sid) {
        untracked(() => this.startStream(sid));
      }
    });
  }

  ngAfterViewChecked(): void {
    if (this.shouldAutoScroll && this.scrollContainer) {
      const el = this.scrollContainer.nativeElement;
      el.scrollTop = el.scrollHeight;
      this.shouldAutoScroll = false;
    }
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  retry(): void {
    const sid = this.sessionId();
    if (sid) {
      this.startStream(sid);
    }
  }

  onClose(): void {
    this.isOpenChange.emit(false);
    this.cleanup();
    this.status.set('idle');
    this.rawText.set('');
    this.errorMessage.set(null);
  }

  private startStream(sessionId: number): void {
    this.cleanup();
    this.status.set('loading');
    this.errorMessage.set(null);
    this.rawText.set('');

    this.subscription = this.cashRegisterService
      .streamClosingSummary(sessionId)
      .subscribe({
        next: (event: AIStreamEvent) => {
          if (event.type === 'text' && event.content) {
            if (this.status() === 'loading') {
              this.status.set('streaming');
            }
            this.rawText.update((current) => current + event.content);
            this.shouldAutoScroll = true;
          }
          if (event.type === 'done') {
            this.status.set('done');
          }
          if (event.type === 'error') {
            this.errorMessage.set(event.error || 'Error al generar el resumen');
            this.status.set('error');
          }
        },
        error: () => {
          this.errorMessage.set('Error inesperado al conectar con el servidor');
          this.status.set('error');
        },
      });
  }

  private cleanup(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }
}
