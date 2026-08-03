import { createSelector, createFeatureSelector } from '@ngrx/store';
import { VexiState } from './vexi.reducer';

export const selectVexiState = createFeatureSelector<VexiState>('vexi');

export const selectConversations = createSelector(
  selectVexiState,
  (state) => state.conversations,
);

export const selectActiveConversationId = createSelector(
  selectVexiState,
  (state) => state.activeConversationId,
);

export const selectMessages = createSelector(
  selectVexiState,
  (state) => state.messages,
);

export const selectStreamingContent = createSelector(
  selectVexiState,
  (state) => state.streamingContent,
);

export const selectIsStreaming = createSelector(
  selectVexiState,
  (state) => state.isStreaming,
);

export const selectIsSending = createSelector(
  selectVexiState,
  (state) => state.isSending,
);

export const selectLoading = createSelector(
  selectVexiState,
  (state) => state.loading,
);

export const selectError = createSelector(
  selectVexiState,
  (state) => state.error,
);

export const selectToolSteps = createSelector(
  selectVexiState,
  (state) => state.toolSteps,
);

export const selectPendingProposal = createSelector(
  selectVexiState,
  (state) => state.pendingProposal,
);
