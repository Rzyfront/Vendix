import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import * as VexiActions from './vexi.actions';
import type { ToolStep, VexiProposal } from './vexi.actions';
import * as VexiSelectors from './vexi.selectors';
import {
  AIConversation,
  AIMessage,
  VexiTask,
} from '../../services/vexi-api.service';

@Injectable({ providedIn: 'root' })
export class VexiFacade {
  private store = inject(Store);

  readonly conversations$ = this.store.select(VexiSelectors.selectConversations);
  readonly activeConversationId$ = this.store.select(
    VexiSelectors.selectActiveConversationId,
  );
  readonly messages$ = this.store.select(VexiSelectors.selectMessages);
  readonly streamingContent$ = this.store.select(
    VexiSelectors.selectStreamingContent,
  );
  readonly isStreaming$ = this.store.select(VexiSelectors.selectIsStreaming);
  readonly isSending$ = this.store.select(VexiSelectors.selectIsSending);
  readonly loading$ = this.store.select(VexiSelectors.selectLoading);
  readonly error$ = this.store.select(VexiSelectors.selectError);
  readonly toolSteps$ = this.store.select(VexiSelectors.selectToolSteps);
  readonly pendingProposal$ = this.store.select(
    VexiSelectors.selectPendingProposal,
  );
  readonly activeTask$ = this.store.select(VexiSelectors.selectActiveTask);

  // ─── Signal parallels (Angular 20 — backward compatible) ──────────────────
  readonly conversations = toSignal(this.conversations$, {
    initialValue: [] as AIConversation[],
  });
  readonly activeConversationId = toSignal(this.activeConversationId$, {
    initialValue: null as number | null,
  });
  readonly messages = toSignal(this.messages$, {
    initialValue: [] as AIMessage[],
  });
  readonly streamingContent = toSignal(this.streamingContent$, { initialValue: '' });
  readonly isStreaming = toSignal(this.isStreaming$, { initialValue: false });
  readonly isSending = toSignal(this.isSending$, { initialValue: false });
  readonly loading = toSignal(this.loading$, { initialValue: false });
  readonly error = toSignal(this.error$, { initialValue: null as string | null });
  readonly toolSteps = toSignal(this.toolSteps$, {
    initialValue: [] as ToolStep[],
  });
  readonly pendingProposal = toSignal(this.pendingProposal$, {
    initialValue: null as VexiProposal | null,
  });
  readonly activeTask = toSignal(this.activeTask$, {
    initialValue: null as VexiTask | null,
  });

  loadConversations(): void {
    this.store.dispatch(VexiActions.loadConversations());
  }

  createConversation(appKey?: string, title?: string): void {
    this.store.dispatch(VexiActions.createConversation({ appKey, title }));
  }

  selectConversation(conversationId: number): void {
    this.store.dispatch(
      VexiActions.selectConversation({ conversationId }),
    );
  }

  /**
   * `speak` only adds audio frames to the answer. It never changes the text, the
   * tools, or what gets persisted — a spoken turn is the same turn.
   */
  sendMessage(
    conversationId: number,
    content: string,
    attachmentIds?: string[],
    speak?: boolean,
  ): void {
    this.store.dispatch(
      VexiActions.sendMessage({
        conversationId,
        content,
        attachmentIds,
        speak,
      }),
    );
  }

  /** Sends the first message when no conversation is active yet. */
  startConversation(
    content: string,
    appKey?: string,
    attachmentIds?: string[],
    speak?: boolean,
  ): void {
    this.store.dispatch(
      VexiActions.startConversation({
        content,
        appKey,
        attachmentIds,
        speak,
      }),
    );
  }

  archiveConversation(conversationId: number): void {
    this.store.dispatch(
      VexiActions.archiveConversation({ conversationId }),
    );
  }

  clearActiveConversation(): void {
    this.store.dispatch(VexiActions.clearActiveConversation());
  }

  /** Applies the pending write. The effect reads the token from the store. */
  confirmProposal(): void {
    this.store.dispatch(VexiActions.confirmProposal());
  }

  rejectProposal(): void {
    this.store.dispatch(VexiActions.rejectProposal());
  }

  /** Hides the background-task strip. The job keeps running. */
  dismissTask(): void {
    this.store.dispatch(VexiActions.dismissTask());
  }
}
