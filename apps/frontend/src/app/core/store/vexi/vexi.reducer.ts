import { createReducer, on } from '@ngrx/store';
import * as VexiActions from './vexi.actions';
import { AIConversation, AIMessage } from '../../services/vexi-api.service';

export interface VexiState {
  conversations: AIConversation[];
  activeConversationId: number | null;
  messages: AIMessage[];
  streamingContent: string;
  isStreaming: boolean;
  isSending: boolean;
  loading: boolean;
  error: string | null;
}

export const initialVexiState: VexiState = {
  conversations: [],
  activeConversationId: null,
  messages: [],
  streamingContent: '',
  isStreaming: false,
  isSending: false,
  loading: false,
  error: null,
};

export const vexiReducer = createReducer(
  initialVexiState,

  on(VexiActions.loadConversations, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  // Coerced rather than trusted: `conversations` is the only writer of this
  // slice from the network, and every other handler spreads it. A single
  // non-array payload would turn `[conv, ...state.conversations]` into a
  // TypeError that takes down the whole panel.
  on(VexiActions.loadConversationsSuccess, (state, { conversations }) => ({
    ...state,
    conversations: Array.isArray(conversations) ? conversations : [],
    loading: false,
  })),

  on(VexiActions.loadConversationsFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(VexiActions.createConversationSuccess, (state, { conversation }) => ({
    ...state,
    conversations: [conversation, ...state.conversations],
    activeConversationId: conversation.id,
    messages: [],
    streamingContent: '',
  })),

  on(VexiActions.selectConversation, (state, { conversationId }) => ({
    ...state,
    activeConversationId: conversationId,
    messages: [],
    streamingContent: '',
    isStreaming: false,
  })),

  on(VexiActions.loadMessagesSuccess, (state, { messages }) => ({
    ...state,
    messages,
  })),

  on(VexiActions.createConversationFailure, (state, { error }) => ({
    ...state,
    error,
  })),

  on(VexiActions.selectConversationFailure, (state, { error }) => ({
    ...state,
    error,
    activeConversationId: null,
  })),

  on(VexiActions.loadMessagesFailure, (state, { error }) => ({
    ...state,
    error,
  })),

  on(VexiActions.sendMessage, (state, { content }) => {
    if (!state.activeConversationId) return state;
    return {
      ...state,
      isSending: true,
      messages: [
        ...state.messages,
        {
          id: -Date.now(),
          conversation_id: state.activeConversationId,
          role: 'user' as const,
          content,
          tool_calls: null,
          tokens_used: 0,
          cost_usd: 0,
          metadata: null,
          created_at: new Date().toISOString(),
        },
      ],
      streamingContent: '',
      isStreaming: true,
    };
  }),

  on(VexiActions.sendMessageSuccess, (state, { assistantMessage }) => ({
    ...state,
    isSending: false,
    isStreaming: false,
    streamingContent: '',
    messages: [
      ...state.messages,
      {
        id: assistantMessage.id,
        conversation_id: state.activeConversationId!,
        role: 'assistant' as const,
        content: assistantMessage.content,
        tool_calls: null,
        tokens_used: assistantMessage.tokens_used,
        cost_usd: 0,
        metadata: null,
        created_at: new Date().toISOString(),
      },
    ],
  })),

  on(VexiActions.sendMessageFailure, (state, { error }) => ({
    ...state,
    isSending: false,
    isStreaming: false,
    error,
  })),

  on(VexiActions.receiveStreamChunk, (state, { content }) => ({
    ...state,
    streamingContent: state.streamingContent + content,
  })),

  on(VexiActions.streamComplete, (state) => {
    if (!state.activeConversationId) return { ...state, isStreaming: false, isSending: false, streamingContent: '' };
    return {
      ...state,
      isStreaming: false,
      isSending: false,
      messages: [
        ...state.messages,
        {
          id: -Date.now(),
          conversation_id: state.activeConversationId,
          role: 'assistant' as const,
          content: state.streamingContent,
          tool_calls: null,
          tokens_used: 0,
          cost_usd: 0,
          metadata: null,
          created_at: new Date().toISOString(),
        },
      ],
      streamingContent: '',
    };
  }),

  on(VexiActions.streamError, (state, { error }) => ({
    ...state,
    isStreaming: false,
    isSending: false,
    error,
  })),

  on(VexiActions.archiveConversationFailure, (state, { error }) => ({
    ...state,
    error,
  })),

  on(VexiActions.archiveConversationSuccess, (state, { conversationId }) => ({
    ...state,
    conversations: state.conversations.filter((c) => c.id !== conversationId),
    activeConversationId:
      state.activeConversationId === conversationId
        ? null
        : state.activeConversationId,
  })),

  on(VexiActions.clearActiveConversation, (state) => ({
    ...state,
    activeConversationId: null,
    messages: [],
    streamingContent: '',
    isStreaming: false,
  })),
);
