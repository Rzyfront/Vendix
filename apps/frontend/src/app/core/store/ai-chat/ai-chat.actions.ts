import { createAction, props } from '@ngrx/store';
import { AIConversation, AIMessage } from '../../services/ai-chat-api.service';

// Load conversations
export const loadConversations = createAction('[AI Chat] Load Conversations');

export const loadConversationsSuccess = createAction(
  '[AI Chat] Load Conversations Success',
  props<{ conversations: AIConversation[] }>(),
);

export const loadConversationsFailure = createAction(
  '[AI Chat] Load Conversations Failure',
  props<{ error: string }>(),
);

// Create conversation
export const createConversation = createAction(
  '[AI Chat] Create Conversation',
  props<{ appKey?: string; title?: string }>(),
);

export const createConversationSuccess = createAction(
  '[AI Chat] Create Conversation Success',
  props<{ conversation: AIConversation }>(),
);

// Select conversation
export const selectConversation = createAction(
  '[AI Chat] Select Conversation',
  props<{ conversationId: number }>(),
);

// Load messages
export const loadMessages = createAction(
  '[AI Chat] Load Messages',
  props<{ conversationId: number }>(),
);

export const loadMessagesSuccess = createAction(
  '[AI Chat] Load Messages Success',
  props<{ messages: AIMessage[] }>(),
);

// Send message
export const sendMessage = createAction(
  '[AI Chat] Send Message',
  props<{ conversationId: number; content: string }>(),
);

export const sendMessageSuccess = createAction(
  '[AI Chat] Send Message Success',
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
  '[AI Chat] Send Message Failure',
  props<{ error: string }>(),
);

// Streaming
export const receiveStreamChunk = createAction(
  '[AI Chat] Receive Stream Chunk',
  props<{ content: string }>(),
);

export const streamComplete = createAction('[AI Chat] Stream Complete');

export const streamError = createAction(
  '[AI Chat] Stream Error',
  props<{ error: string }>(),
);

// Archive conversation
export const archiveConversation = createAction(
  '[AI Chat] Archive Conversation',
  props<{ conversationId: number }>(),
);

export const archiveConversationSuccess = createAction(
  '[AI Chat] Archive Conversation Success',
  props<{ conversationId: number }>(),
);

// Failure actions
export const createConversationFailure = createAction(
  '[AI Chat] Create Conversation Failure',
  props<{ error: string }>(),
);

export const selectConversationFailure = createAction(
  '[AI Chat] Select Conversation Failure',
  props<{ error: string }>(),
);

export const loadMessagesFailure = createAction(
  '[AI Chat] Load Messages Failure',
  props<{ error: string }>(),
);

export const archiveConversationFailure = createAction(
  '[AI Chat] Archive Conversation Failure',
  props<{ error: string }>(),
);

// Clear active conversation
export const clearActiveConversation = createAction(
  '[AI Chat] Clear Active Conversation',
);
