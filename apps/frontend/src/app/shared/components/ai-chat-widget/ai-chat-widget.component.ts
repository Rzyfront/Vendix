import {
  Component,
  signal,
  ElementRef,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  viewChild
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AIChatFacade } from '../../../core/store/ai-chat/ai-chat.facade';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-ai-chat-widget',
  standalone: true,
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Floating Action Button -->
    <button
      class="ai-chat-fab"
      (click)="toggleChat()"
      [class.active]="isOpen()"
    >
      @if (isOpen()) {
        <app-icon name="x" [size]="20" />
      } @else {
        <app-icon name="sparkles" [size]="20" />
      }
    </button>

    <!-- Chat Panel -->
    @if (isOpen()) {
      <div class="ai-chat-panel" (click)="$event.stopPropagation()">
        <!-- Header -->
        <div class="ai-chat-header">
          <div class="flex items-center gap-2">
            <app-icon name="sparkles" [size]="16" />
            <span class="font-semibold text-sm">Vendix AI</span>
          </div>
          <div class="flex items-center gap-1">
            <button class="ai-chat-header-btn" (click)="newConversation()" title="New conversation">
              <app-icon name="plus" [size]="14" />
            </button>
            <button class="ai-chat-header-btn" (click)="toggleSidebar()" title="Conversations">
              <app-icon name="message-square" [size]="14" />
            </button>
          </div>
        </div>

        <div class="ai-chat-body">
          <!-- Sidebar -->
          @if (showSidebar()) {
            <div class="ai-chat-sidebar">
              <div class="text-xs font-medium text-text-secondary px-3 py-2">Conversations</div>
              @for (conv of conversations(); track conv.id) {
                <button
                  class="ai-chat-conv-item"
                  [class.active]="conv.id === activeConversationId()"
                  (click)="selectConversation(conv.id)"
                >
                  <span class="truncate text-xs">{{ conv.title || 'New conversation' }}</span>
                </button>
              } @empty {
                <div class="text-xs text-text-tertiary px-3 py-4 text-center">No conversations yet</div>
              }
            </div>
          }

          <!-- Messages Area -->
          <div class="ai-chat-messages" #messagesContainer>
            @if (messages().length === 0 && !isStreaming()) {
              <div class="ai-chat-empty">
                <app-icon name="sparkles" [size]="32" />
                <p class="text-sm text-text-secondary mt-2">How can I help you?</p>
              </div>
            }

            @for (msg of messages(); track msg.id) {
              <div class="ai-chat-msg" [class]="'ai-chat-msg--' + msg.role">
                @if (msg.role === 'assistant') {
                  <div class="ai-chat-msg-avatar">
                    <app-icon name="sparkles" [size]="12" />
                  </div>
                }
                <div class="ai-chat-msg-content">
                  <p class="text-sm whitespace-pre-wrap">{{ msg.content }}</p>
                </div>
              </div>
            }

            <!-- Streaming indicator -->
            @if (isStreaming() && streamingContent()) {
              <div class="ai-chat-msg ai-chat-msg--assistant">
                <div class="ai-chat-msg-avatar">
                  <app-icon name="sparkles" [size]="12" />
                </div>
                <div class="ai-chat-msg-content">
                  <p class="text-sm whitespace-pre-wrap">{{ streamingContent() }}</p>
                  <span class="ai-typing-cursor"></span>
                </div>
              </div>
            } @else if (isSending()) {
              <div class="ai-chat-msg ai-chat-msg--assistant">
                <div class="ai-chat-msg-avatar">
                  <app-icon name="loader-2" [size]="12" class="animate-spin" />
                </div>
                <div class="ai-chat-msg-content">
                  <div class="ai-thinking-dots">
                    <span></span><span></span><span></span>
                  </div>
                </div>
              </div>
            }
          </div>
        </div>

        <!-- Input Area -->
        <div class="ai-chat-input-area">
          <div class="ai-chat-input-wrapper">
            <input
              type="text"
              class="ai-chat-input"
              placeholder="Type a message..."
              [(ngModel)]="messageInput"
              (keydown.enter)="sendMessage()"
              [disabled]="isSending()"
            />
            <button
              class="ai-chat-send-btn"
              (click)="sendMessage()"
              [disabled]="!messageInput().trim() || isSending()"
            >
              <app-icon name="send" [size]="14" />
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 1000;
    }

    .ai-chat-fab {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      background: linear-gradient(
        135deg,
        rgba(var(--color-primary-rgb), 0.85) 0%,
        rgba(var(--color-secondary-rgb, var(--color-primary-rgb)), 0.95) 100%
      );
      box-shadow: 0 4px 16px rgba(var(--color-primary-rgb), 0.4);
      transition: all 0.3s ease;
    }

    .ai-chat-fab:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 24px rgba(var(--color-primary-rgb), 0.5);
    }

    .ai-chat-fab.active {
      background: var(--color-bg-tertiary);
      color: var(--color-text-primary);
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    }

    .ai-chat-panel {
      position: absolute;
      bottom: 60px;
      right: 0;
      width: 380px;
      max-height: 520px;
      background: var(--color-bg-primary);
      border: 1px solid var(--color-border);
      border-radius: 16px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.15);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .ai-chat-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--color-border);
      background: linear-gradient(
        135deg,
        rgba(var(--color-primary-rgb), 0.05) 0%,
        rgba(var(--color-primary-rgb), 0.02) 100%
      );
      color: var(--color-text-primary);
    }

    .ai-chat-header-btn {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      border: none;
      background: transparent;
      color: var(--color-text-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }

    .ai-chat-header-btn:hover {
      background: var(--color-bg-secondary);
      color: var(--color-text-primary);
    }

    .ai-chat-body {
      flex: 1;
      display: flex;
      overflow: hidden;
      min-height: 0;
    }

    .ai-chat-sidebar {
      width: 180px;
      border-right: 1px solid var(--color-border);
      overflow-y: auto;
      flex-shrink: 0;
    }

    .ai-chat-conv-item {
      display: block;
      width: 100%;
      text-align: left;
      padding: 8px 12px;
      border: none;
      background: transparent;
      color: var(--color-text-secondary);
      cursor: pointer;
      transition: all 0.15s;
    }

    .ai-chat-conv-item:hover { background: var(--color-bg-secondary); }
    .ai-chat-conv-item.active {
      background: rgba(var(--color-primary-rgb), 0.1);
      color: rgb(var(--color-primary-rgb));
    }

    .ai-chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .ai-chat-empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--color-text-tertiary);
      opacity: 0.6;
    }

    .ai-chat-msg {
      display: flex;
      gap: 8px;
      max-width: 90%;
    }

    .ai-chat-msg--user {
      align-self: flex-end;
      flex-direction: row-reverse;
    }

    .ai-chat-msg--user .ai-chat-msg-content {
      background: rgb(var(--color-primary-rgb));
      color: white;
      border-radius: 12px 12px 2px 12px;
    }

    .ai-chat-msg--assistant .ai-chat-msg-content {
      background: var(--color-bg-secondary);
      color: var(--color-text-primary);
      border-radius: 12px 12px 12px 2px;
    }

    .ai-chat-msg-avatar {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: rgba(var(--color-primary-rgb), 0.1);
      color: rgb(var(--color-primary-rgb));
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .ai-chat-msg-content {
      padding: 8px 12px;
      line-height: 1.5;
    }

    .ai-typing-cursor {
      display: inline-block;
      width: 2px;
      height: 14px;
      background: rgb(var(--color-primary-rgb));
      margin-left: 2px;
      vertical-align: text-bottom;
      animation: blink 0.8s ease-in-out infinite;
    }

    .ai-thinking-dots {
      display: flex;
      gap: 4px;
      padding: 4px 0;
    }

    .ai-thinking-dots span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--color-text-tertiary);
      animation: dot-bounce 1.2s ease-in-out infinite;
    }

    .ai-thinking-dots span:nth-child(2) { animation-delay: 0.15s; }
    .ai-thinking-dots span:nth-child(3) { animation-delay: 0.3s; }

    .ai-chat-input-area {
      padding: 12px;
      border-top: 1px solid var(--color-border);
    }

    .ai-chat-input-wrapper {
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--color-bg-secondary);
      border-radius: 10px;
      padding: 4px 4px 4px 12px;
    }

    .ai-chat-input {
      flex: 1;
      border: none;
      background: transparent;
      outline: none;
      font-size: 13px;
      color: var(--color-text-primary);
      line-height: 1.5;
    }

    .ai-chat-input::placeholder { color: var(--color-text-tertiary); }

    .ai-chat-send-btn {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      border: none;
      background: rgb(var(--color-primary-rgb));
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
      flex-shrink: 0;
    }

    .ai-chat-send-btn:hover { opacity: 0.9; }
    .ai-chat-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }

    @keyframes dot-bounce {
      0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
      40% { transform: scale(1); opacity: 1; }
    }

    @media (max-width: 480px) {
      .ai-chat-panel {
        width: calc(100vw - 32px);
        max-height: calc(100vh - 100px);
        right: -4px;
      }
      .ai-chat-sidebar { width: 140px; }
    }
  `],
})
export class AIChatWidgetComponent implements OnInit, OnDestroy {
  readonly messagesContainer = viewChild.required<ElementRef>('messagesContainer');

  isOpen = signal(false);
  showSidebar = signal(false);
  messageInput = signal('');

  conversations = signal<any[]>([]);
  messages = signal<any[]>([]);
  activeConversationId = signal<number | null>(null);
  streamingContent = signal('');
  isStreaming = signal(false);
  isSending = signal(false);

  private subscriptions: Subscription[] = [];

  constructor(private readonly chatFacade: AIChatFacade) {}

  ngOnInit(): void {
    this.subscriptions.push(
      this.chatFacade.conversations$.subscribe((c) => this.conversations.set(c)),
      this.chatFacade.messages$.subscribe((m) => {
        this.messages.set(m);
        this.scrollToBottom();
      }),
      this.chatFacade.activeConversationId$.subscribe((id) => this.activeConversationId.set(id)),
      this.chatFacade.streamingContent$.subscribe((s) => {
        this.streamingContent.set(s);
        this.scrollToBottom();
      }),
      this.chatFacade.isStreaming$.subscribe((s) => this.isStreaming.set(s)),
      this.chatFacade.isSending$.subscribe((s) => this.isSending.set(s)),
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  toggleChat(): void {
    const opening = !this.isOpen();
    this.isOpen.set(opening);
    if (opening) {
      this.chatFacade.loadConversations();
    }
  }

  toggleSidebar(): void {
    this.showSidebar.update((v) => !v);
  }

  newConversation(): void {
    this.chatFacade.createConversation();
    this.showSidebar.set(false);
  }

  selectConversation(id: number): void {
    this.chatFacade.selectConversation(id);
    this.showSidebar.set(false);
  }

  sendMessage(): void {
    const content = this.messageInput().trim();
    if (!content || this.isSending()) return;

    const conversationId = this.activeConversationId();

    if (!conversationId) {
      this.chatFacade.createConversation();
      // Wait for conversation to be created, then send
      const sub = this.chatFacade.activeConversationId$.subscribe((id) => {
        if (id) {
          this.chatFacade.sendMessage(id, content);
          sub.unsubscribe();
        }
      });
      this.subscriptions.push(sub);
    } else {
      this.chatFacade.sendMessage(conversationId, content);
    }

    this.messageInput.set('');
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      const container = this.messagesContainer()?.nativeElement;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }, 50);
  }
}
