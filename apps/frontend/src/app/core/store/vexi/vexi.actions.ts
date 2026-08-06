import { createAction, props } from '@ngrx/store';
import {
  AIConversation,
  AIMessage,
  VexiTask,
} from '../../services/vexi-api.service';

/**
 * The diff a write tool computed, mirroring the backend `ToolPreview`. Same
 * shape as a bulk-edit preview item so one card component renders both.
 */
export interface VexiProposalPreview {
  status: 'ok' | 'warning' | 'error';
  target: string;
  changes: Array<{ field: string; label: string; from: unknown; to: unknown }>;
  message?: string;
  domain?: string;
}

/** One line in the live trace of what Vexi is doing. */
export interface ToolStep {
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
  summary?: string;
  status: 'running' | 'done' | 'failed';
}

export interface VexiProposal {
  tool: string;
  arguments: Record<string, unknown>;
  confirmationToken: string;
  preview?: VexiProposalPreview;
  applying: boolean;
}

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
  props<{
    conversationId: number;
    content: string;
    /**
     * Handles of documents this turn carries (`att_41`).
     *
     * Uploaded before dispatching, so the action stays serialisable and the effect
     * has nothing to await: a `File` in an NgRx action would break the store's
     * serialisability contract and the devtools timeline with it.
     */
    attachmentIds?: string[];
    /**
     * Asks for the answer to be spoken as well as written.
     *
     * Carried on the turn rather than read from a mode flag in the store, because
     * the person can flip to chat mid-answer and the turn already in flight was
     * still asked by voice.
     */
    speak?: boolean;
  }>(),
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
  props<{
    content: string;
    appKey?: string;
    attachmentIds?: string[];
    speak?: boolean;
  }>(),
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
export const streamStarted = createAction(
  '[Vexi] Stream Started',
  props<{ conversationId: number }>(),
);

export const receiveStreamChunk = createAction(
  '[Vexi] Receive Stream Chunk',
  props<{ content: string }>(),
);

/**
 * Vexi began running a tool. Emitted before the call so the panel can narrate
 * the work in progress instead of showing a spinner for the 30-40s an agent
 * turn can take.
 */
export const toolCallStarted = createAction(
  '[Vexi] Tool Call Started',
  props<{ id: string; name: string; arguments?: Record<string, unknown> }>(),
);

export const toolCallFinished = createAction(
  '[Vexi] Tool Call Finished',
  props<{ id: string; name: string; summary?: string; failed?: boolean }>(),
);

/**
 * A write Vexi wants to make and has NOT made. Lives in the store rather than
 * in the panel component because it has to survive the user closing and
 * reopening the panel — the token is valid for five minutes and losing it to a
 * component teardown would make the user re-ask for the same change.
 */
export const proposalReceived = createAction(
  '[Vexi] Proposal Received',
  props<{
    tool: string;
    arguments: Record<string, unknown>;
    confirmationToken: string;
    preview?: VexiProposalPreview;
  }>(),
);

export const confirmProposal = createAction('[Vexi] Confirm Proposal');

export const confirmProposalSuccess = createAction(
  '[Vexi] Confirm Proposal Success',
  props<{ tool: string; output: string; domain?: string }>(),
);

export const confirmProposalFailure = createAction(
  '[Vexi] Confirm Proposal Failure',
  props<{ error: string }>(),
);

export const rejectProposal = createAction('[Vexi] Reject Proposal');

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

// ─── Trabajos de fondo ──────────────────────────────────────────────────────

/**
 * Vexi dejó un trabajo corriendo en la cola.
 *
 * Se descubre leyendo el resultado de `queue_task` en el propio stream, no con un
 * endpoint aparte: el trabajo se encola dentro del turno, así que el turno es el
 * único momento en que se sabe con certeza cuál es el trabajo de ESTA persona en
 * ESTA conversación. Un `GET /tasks` posterior traería también el trabajo que
 * dejó corriendo ayer.
 */
export const taskQueued = createAction(
  '[Vexi] Task Queued',
  props<{ taskId: number; goal?: string }>(),
);

export const pollTaskSuccess = createAction(
  '[Vexi] Poll Task Success',
  props<{ task: VexiTask }>(),
);

export const pollTaskFailure = createAction(
  '[Vexi] Poll Task Failure',
  props<{ error: string }>(),
);

/** La persona cerró la tira del trabajo. No cancela el trabajo, solo lo oculta. */
export const dismissTask = createAction('[Vexi] Dismiss Task');
