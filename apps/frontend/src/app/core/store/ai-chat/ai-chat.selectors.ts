import { createSelector, createFeatureSelector } from '@ngrx/store';
import { AIChatState } from './ai-chat.reducer';

export const selectAIChatState =
  createFeatureSelector<AIChatState>('aiChat');

export const selectConversations = createSelector(
  selectAIChatState,
  (state) => state.conversations,
);

export const selectActiveConversationId = createSelector(
  selectAIChatState,
  (state) => state.activeConversationId,
);

export const selectMessages = createSelector(
  selectAIChatState,
  (state) => state.messages,
);

export const selectStreamingContent = createSelector(
  selectAIChatState,
  (state) => state.streamingContent,
);

export const selectIsStreaming = createSelector(
  selectAIChatState,
  (state) => state.isStreaming,
);

export const selectIsSending = createSelector(
  selectAIChatState,
  (state) => state.isSending,
);

export const selectLoading = createSelector(
  selectAIChatState,
  (state) => state.loading,
);

export const selectError = createSelector(
  selectAIChatState,
  (state) => state.error,
);
