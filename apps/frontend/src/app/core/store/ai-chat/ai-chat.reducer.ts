import { createReducer, on } from '@ngrx/store';
import * as AIChatActions from './ai-chat.actions';
import { AIConversation, AIMessage } from '../../services/ai-chat-api.service';

export interface AIChatState {
  conversations: AIConversation[];
  activeConversationId: number | null;
  messages: AIMessage[];
  streamingContent: string;
  isStreaming: boolean;
  isSending: boolean;
  loading: boolean;
  error: string | null;
}

export const initialAIChatState: AIChatState = {
  conversations: [],
  activeConversationId: null,
  messages: [],
  streamingContent: '',
  isStreaming: false,
  isSending: false,
  loading: false,
  error: null,
};

export const aiChatReducer = createReducer(
  initialAIChatState,

  on(AIChatActions.loadConversations, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(AIChatActions.loadConversationsSuccess, (state, { conversations }) => ({
    ...state,
    conversations,
    loading: false,
  })),

  on(AIChatActions.loadConversationsFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(AIChatActions.createConversationSuccess, (state, { conversation }) => ({
    ...state,
    conversations: [conversation, ...state.conversations],
    activeConversationId: conversation.id,
    messages: [],
    streamingContent: '',
  })),

  on(AIChatActions.selectConversation, (state, { conversationId }) => ({
    ...state,
    activeConversationId: conversationId,
    messages: [],
    streamingContent: '',
    isStreaming: false,
  })),

  on(AIChatActions.loadMessagesSuccess, (state, { messages }) => ({
    ...state,
    messages,
  })),

  on(AIChatActions.createConversationFailure, (state, { error }) => ({
    ...state,
    error,
  })),

  on(AIChatActions.selectConversationFailure, (state, { error }) => ({
    ...state,
    error,
    activeConversationId: null,
  })),

  on(AIChatActions.loadMessagesFailure, (state, { error }) => ({
    ...state,
    error,
  })),

  on(AIChatActions.sendMessage, (state, { content }) => {
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

  on(AIChatActions.sendMessageSuccess, (state, { assistantMessage }) => ({
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

  on(AIChatActions.sendMessageFailure, (state, { error }) => ({
    ...state,
    isSending: false,
    isStreaming: false,
    error,
  })),

  on(AIChatActions.receiveStreamChunk, (state, { content }) => ({
    ...state,
    streamingContent: state.streamingContent + content,
  })),

  on(AIChatActions.streamComplete, (state) => {
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

  on(AIChatActions.streamError, (state, { error }) => ({
    ...state,
    isStreaming: false,
    isSending: false,
    error,
  })),

  on(AIChatActions.archiveConversationFailure, (state, { error }) => ({
    ...state,
    error,
  })),

  on(AIChatActions.archiveConversationSuccess, (state, { conversationId }) => ({
    ...state,
    conversations: state.conversations.filter((c) => c.id !== conversationId),
    activeConversationId:
      state.activeConversationId === conversationId
        ? null
        : state.activeConversationId,
  })),

  on(AIChatActions.clearActiveConversation, (state) => ({
    ...state,
    activeConversationId: null,
    messages: [],
    streamingContent: '',
    isStreaming: false,
  })),
);
