import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import * as AIChatActions from './ai-chat.actions';
import * as AIChatSelectors from './ai-chat.selectors';

@Injectable({ providedIn: 'root' })
export class AIChatFacade {
  private store = inject(Store);

  readonly conversations$ = this.store.select(AIChatSelectors.selectConversations);
  readonly activeConversationId$ = this.store.select(
    AIChatSelectors.selectActiveConversationId,
  );
  readonly messages$ = this.store.select(AIChatSelectors.selectMessages);
  readonly streamingContent$ = this.store.select(
    AIChatSelectors.selectStreamingContent,
  );
  readonly isStreaming$ = this.store.select(AIChatSelectors.selectIsStreaming);
  readonly isSending$ = this.store.select(AIChatSelectors.selectIsSending);
  readonly loading$ = this.store.select(AIChatSelectors.selectLoading);
  readonly error$ = this.store.select(AIChatSelectors.selectError);

  // ─── Signal parallels (Angular 20 — backward compatible) ──────────────────
  readonly conversations = toSignal(this.conversations$, { initialValue: [] as any[] });
  readonly activeConversationId = toSignal(this.activeConversationId$);
  readonly messages = toSignal(this.messages$, { initialValue: [] as any[] });
  readonly streamingContent = toSignal(this.streamingContent$);
  readonly isStreaming = toSignal(this.isStreaming$, { initialValue: false });
  readonly isSending = toSignal(this.isSending$, { initialValue: false });
  readonly loading = toSignal(this.loading$, { initialValue: false });
  readonly error = toSignal(this.error$);

  loadConversations(): void {
    this.store.dispatch(AIChatActions.loadConversations());
  }

  createConversation(appKey?: string, title?: string): void {
    this.store.dispatch(AIChatActions.createConversation({ appKey, title }));
  }

  selectConversation(conversationId: number): void {
    this.store.dispatch(
      AIChatActions.selectConversation({ conversationId }),
    );
  }

  sendMessage(conversationId: number, content: string): void {
    this.store.dispatch(
      AIChatActions.sendMessage({ conversationId, content }),
    );
  }

  archiveConversation(conversationId: number): void {
    this.store.dispatch(
      AIChatActions.archiveConversation({ conversationId }),
    );
  }

  clearActiveConversation(): void {
    this.store.dispatch(AIChatActions.clearActiveConversation());
  }
}
