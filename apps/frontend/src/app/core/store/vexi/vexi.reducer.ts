import { createReducer, on } from '@ngrx/store';
import * as VexiActions from './vexi.actions';
import type { ToolStep, VexiProposal } from './vexi.actions';
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
  /** Live trace of the current turn, cleared when the next one starts. */
  toolSteps: ToolStep[];
  /** A write awaiting the user's approval. Survives closing the panel. */
  pendingProposal: VexiProposal | null;
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
  toolSteps: [],
  pendingProposal: null,
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

  // A new turn wipes the previous trace. Keeping it would stack the tools of
  // every question in the conversation into one ever-growing list.
  on(VexiActions.streamStarted, (state) => ({
    ...state,
    toolSteps: [],
    streamingContent: '',
    isStreaming: true,
    isSending: true,
    error: null,
  })),

  on(VexiActions.receiveStreamChunk, (state, { content }) => ({
    ...state,
    streamingContent: state.streamingContent + content,
  })),

  on(VexiActions.toolCallStarted, (state, { id, name, arguments: args }) => ({
    ...state,
    toolSteps: [
      ...state.toolSteps,
      { id, name, arguments: args, status: 'running' as const },
    ],
  })),

  on(VexiActions.toolCallFinished, (state, { id, name, summary, failed }) => {
    const index = state.toolSteps.findIndex((step) => step.id === id);
    const resolved: ToolStep = {
      id,
      name,
      arguments: index >= 0 ? state.toolSteps[index].arguments : undefined,
      summary,
      status: failed ? 'failed' : 'done',
    };

    // A result with no matching call happens when the stream drops the
    // `tool_call` frame (reconnect mid-turn). Appending rather than discarding
    // keeps the trace truthful about what ran.
    return {
      ...state,
      toolSteps:
        index >= 0
          ? state.toolSteps.map((step, i) => (i === index ? resolved : step))
          : [...state.toolSteps, resolved],
    };
  }),

  on(
    VexiActions.proposalReceived,
    (state, { tool, arguments: args, confirmationToken, preview }) => ({
      ...state,
      pendingProposal: {
        tool,
        arguments: args,
        confirmationToken,
        preview,
        applying: false,
      },
    }),
  ),

  on(VexiActions.confirmProposal, (state) => ({
    ...state,
    pendingProposal: state.pendingProposal
      ? { ...state.pendingProposal, applying: true }
      : null,
  })),

  on(VexiActions.confirmProposalSuccess, (state) => ({
    ...state,
    pendingProposal: null,
  })),

  // The proposal is dropped, not left pending: the token is single-use and
  // consumed on the failed attempt, so retrying it would fail again. Vexi has
  // to re-propose.
  on(VexiActions.confirmProposalFailure, (state, { error }) => ({
    ...state,
    pendingProposal: null,
    error,
  })),

  on(VexiActions.rejectProposal, (state) => ({
    ...state,
    pendingProposal: null,
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
