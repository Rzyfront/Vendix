import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import * as AIChatActions from './ai-chat.actions';
import * as AIChatSelectors from './ai-chat.selectors';

@Injectable({ providedIn: 'root' })
export class AIChatFacade {
  private store = inject(Store);

  conversations$ = this.store.select(AIChatSelectors.selectConversations);
  activeConversationId$ = this.store.select(
    AIChatSelectors.selectActiveConversationId,
  );
  messages$ = this.store.select(AIChatSelectors.selectMessages);
  streamingContent$ = this.store.select(
    AIChatSelectors.selectStreamingContent,
  );
  isStreaming$ = this.store.select(AIChatSelectors.selectIsStreaming);
  isSending$ = this.store.select(AIChatSelectors.selectIsSending);
  loading$ = this.store.select(AIChatSelectors.selectLoading);
  error$ = this.store.select(AIChatSelectors.selectError);

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
