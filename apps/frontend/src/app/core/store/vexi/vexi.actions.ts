import { createAction, props } from '@ngrx/store';
import { AIConversation, AIMessage } from '../../services/vexi-api.service';

// Load conversations
export const loadConversations = createAction('[Vexi] Load Conversations');

export const loadConversationsSuccess = createAction(
  '[Vexi] Load Conversations Success',
  props<{ conversations: AIConversation[] }>(),
);

export const loadConversationsFailure = createAction(
  '[Vexi] Load Conversations Failure',
  props<{ error: string }>(),
);

// Create conversation
export const createConversation = createAction(
  '[Vexi] Create Conversation',
  props<{ appKey?: string; title?: string }>(),
);

export const createConversationSuccess = createAction(
  '[Vexi] Create Conversation Success',
  props<{ conversation: AIConversation }>(),
);

// Select conversation
export const selectConversation = createAction(
  '[Vexi] Select Conversation',
  props<{ conversationId: number }>(),
);

// Load messages
export const loadMessages = createAction(
  '[Vexi] Load Messages',
  props<{ conversationId: number }>(),
);

export const loadMessagesSuccess = createAction(
  '[Vexi] Load Messages Success',
  props<{ messages: AIMessage[] }>(),
);

// Send message
export const sendMessage = createAction(
  '[Vexi] Send Message',
  props<{ conversationId: number; content: string }>(),
);

/**
 * First message when no conversation exists yet.
 *
 * Create-then-send is a single effect chain on purpose. Doing it in the
 * component means subscribing to `activeConversationId$` and firing on its
 * next emission — but that stream never completes, so the subscription
 * survives and re-sends the captured text every later time the user switches
 * conversations.
 */
export const startConversation = createAction(
  '[Vexi] Start Conversation',
  props<{ content: string; appKey?: string }>(),
);

export const sendMessageSuccess = createAction(
  '[Vexi] Send Message Success',
  props<{
    userMessage: { role: string; content: string };
    assistantMessage: {
      id: number;
      role: string;
      content: string;
      tokens_used: number;
    };
  }>(),
);

export const sendMessageFailure = createAction(
  '[Vexi] Send Message Failure',
  props<{ error: string }>(),
);

// Streaming
export const receiveStreamChunk = createAction(
  '[Vexi] Receive Stream Chunk',
  props<{ content: string }>(),
);

export const streamComplete = createAction('[Vexi] Stream Complete');

export const streamError = createAction(
  '[Vexi] Stream Error',
  props<{ error: string }>(),
);

// Archive conversation
export const archiveConversation = createAction(
  '[Vexi] Archive Conversation',
  props<{ conversationId: number }>(),
);

export const archiveConversationSuccess = createAction(
  '[Vexi] Archive Conversation Success',
  props<{ conversationId: number }>(),
);

// Failure actions
export const createConversationFailure = createAction(
  '[Vexi] Create Conversation Failure',
  props<{ error: string }>(),
);

export const selectConversationFailure = createAction(
  '[Vexi] Select Conversation Failure',
  props<{ error: string }>(),
);

export const loadMessagesFailure = createAction(
  '[Vexi] Load Messages Failure',
  props<{ error: string }>(),
);

export const archiveConversationFailure = createAction(
  '[Vexi] Archive Conversation Failure',
  props<{ error: string }>(),
);

// Clear active conversation
export const clearActiveConversation = createAction(
  '[Vexi] Clear Active Conversation',
);
