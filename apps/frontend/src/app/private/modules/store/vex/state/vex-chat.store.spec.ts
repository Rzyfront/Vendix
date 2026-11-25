import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';

import { VexiApiService } from '../../../../../core/services/vexi-api.service';
import { VexiVoicePipelineService } from '../../../../../core/services/vexi-voice-pipeline.service';
import { VexiVoiceSafetyService } from '../../../../../core/services/vexi-voice-safety.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import {
  VexApiService,
  VexBackendConversation,
  VexBackendMessage,
  VexConversationsPage,
  VexStreamChunk,
} from '../services/vex-api.service';
import { VexChatStore } from './vex-chat.store';

const SEARCH_DEBOUNCE_MS = 300;

interface IntentCall {
  conversation_id: number;
  content: string;
  options?: { skipUserMessage?: boolean; continuation?: string };
}

/**
 * In-memory `/store/ai-chat` of one user: the list carries no messages, the
 * detail carries them all, and — like the server — the user row of a turn is
 * written when its stream opens, before any answer exists.
 */
class FakeVexApi {
  rows: VexBackendConversation[] = [];
  detailCalls: number[] = [];
  listCalls: Array<{ page?: number; search?: string }> = [];
  intents: IntentCall[] = [];
  streams: Subject<VexStreamChunk>[] = [];
  /** `false` reproduces a stream that never reached the server. */
  storeUserRowOnStream = true;
  failDetail = false;
  failListPages = new Set<number>();
  totalPages = 1;
  private next_message_id = 100;
  private pending = new Map<string, IntentCall>();

  listConversations(params?: {
    page?: number;
    limit?: number;
    search?: string;
  }): Observable<VexConversationsPage> {
    this.listCalls.push({ page: params?.page, search: params?.search });
    if (this.failListPages.has(params?.page ?? 1)) {
      return throwError(() => new Error('boom'));
    }
    const term = (params?.search ?? '').toLowerCase();
    const data = this.rows
      .filter((r) => !term || (r.title ?? '').toLowerCase().includes(term))
      .map((r) => ({ ...r, messages: undefined }));
    return of({
      data,
      meta: {
        total: data.length,
        page: params?.page ?? 1,
        limit: params?.limit ?? 30,
        totalPages: this.totalPages,
      },
    });
  }

  getConversation(id: number): Observable<VexBackendConversation> {
    this.detailCalls.push(id);
    if (this.failDetail) return throwError(() => new Error('boom'));
    const row = this.rows.find((r) => r.id === id);
    if (!row) return throwError(() => ({ status: 404 }));
    return of({ ...row, messages: [...(row.messages ?? [])] });
  }

  createStreamIntent(
    conversation_id: number,
    content: string,
    options?: IntentCall['options'],
  ): Observable<string> {
    const call = { conversation_id, content, options };
    this.intents.push(call);
    const stream_id = `stream-${this.intents.length}`;
    this.pending.set(stream_id, call);
    return of(stream_id);
  }

  streamConversation(
    conversation_id: number,
    stream_id: string,
  ): Observable<VexStreamChunk> {
    const call = this.pending.get(stream_id);
    const row = this.rows.find((r) => r.id === conversation_id);
    if (
      this.storeUserRowOnStream &&
      row &&
      call &&
      !call.options?.skipUserMessage &&
      !call.options?.continuation
    ) {
      row.messages = [
        ...(row.messages ?? []),
        message(this.next_message_id++, 'user', call.content),
      ];
    }
    const subject = new Subject<VexStreamChunk>();
    this.streams.push(subject);
    return subject.asObservable();
  }

  userRows(conversation_id: number): string[] {
    return (this.rows.find((r) => r.id === conversation_id)?.messages ?? [])
      .filter((m) => m.role === 'user')
      .map((m) => m.content);
  }
}

function message(
  id: number,
  role: VexBackendMessage['role'],
  content: string,
): VexBackendMessage {
  return {
    id,
    role,
    content,
    tool_calls: null,
    metadata: null,
    created_at: '2026-11-20T15:00:00Z',
  };
}

function conversation(
  id: number,
  title: string,
  messages: VexBackendMessage[],
): VexBackendConversation {
  return {
    id,
    title,
    status: 'active',
    metadata: { agent_key: 'vex' },
    created_at: '2026-11-20T14:00:00Z',
    updated_at: `2026-11-20T15:0${id}:00Z`,
    messages,
  };
}

/** Lets every promise chain queued by the store settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

describe('VexChatStore', () => {
  let api: FakeVexApi;
  let store: VexChatStore;
  let spoken_streams: string[];

  beforeEach(async () => {
    spoken_streams = [];
    jasmine.clock().install();
    api = new FakeVexApi();
    api.rows = [
      conversation(1, 'Ventas de la semana', [
        message(11, 'user', '¿Cuánto vendí esta semana?'),
        message(12, 'assistant', 'Vendiste 42 pedidos.'),
      ]),
      conversation(2, 'Inventario bajo', [
        message(21, 'user', '¿Qué productos están por agotarse?'),
        message(22, 'assistant', 'Tres productos están bajo el mínimo.'),
      ]),
    ];
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        VexChatStore,
        { provide: VexApiService, useValue: api },
        {
          provide: VexiVoicePipelineService,
          useValue: {
            interrupt: () => undefined,
            startTurn: (stream_id: string) => spoken_streams.push(stream_id),
            finishTurn: () => undefined,
            enqueue: () => undefined,
          },
        },
        {
          provide: VexiVoiceSafetyService,
          useValue: { invalidate: () => undefined },
        },
        { provide: VexiApiService, useValue: {} },
        {
          provide: ToastService,
          useValue: {
            error: () => undefined,
            success: () => undefined,
            info: () => undefined,
            warning: () => undefined,
          },
        },
      ],
    });
    store = TestBed.inject(VexChatStore);
    await settle();
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  async function search(term: string): Promise<void> {
    store.setSearchTerm(term);
    jasmine.clock().tick(SEARCH_DEBOUNCE_MS);
    await settle();
  }

  async function open(id: string): Promise<void> {
    store.selectConversation(id);
    await settle();
  }

  describe('opening a conversation after a search (B2)', () => {
    it('shows the messages of a conversation the search had dropped from the list', async () => {
      await open('1');
      expect(store.active_conversation()?.messages.length).toBe(2);
      await open('2');
      expect(store.active_conversation()?.messages.length).toBe(2);

      // The search matches B only: A leaves the list.
      await search('inventario');
      expect(store.conversations().map((c) => c.id)).toEqual(['2']);

      await search('');
      expect(
        store
          .conversations()
          .map((c) => c.id)
          .sort(),
      ).toEqual(['1', '2']);

      await open('1');
      const thread = store.active_conversation();
      expect(thread?.id).toBe('1');
      expect(thread?.messages.map((m) => m.content)).toEqual([
        '¿Cuánto vendí esta semana?',
        'Vendiste 42 pedidos.',
      ]);
      expect(store.loading_thread()).toBe(false);
    });

    it('keeps the open conversation and its messages while a search hides it', async () => {
      await open('1');
      await search('inventario');
      // A is open: it stays in memory (not in the filtered list) with its thread.
      expect(store.conversations().map((c) => c.id)).toEqual(['2']);
      expect(store.active_conversation()?.messages.length).toBe(2);
      await search('');
      expect(store.active_conversation()?.messages.length).toBe(2);
    });

    it('does not fetch again a thread that is still in memory', async () => {
      await open('1');
      await open('2');
      await open('1');
      expect(api.detailCalls.filter((id) => id === 1).length).toBe(1);
    });
  });

  describe('retrying a cut answer (B3)', () => {
    const QUESTION = '¿Cuál fue mi mejor día?';

    async function askAndCut(): Promise<void> {
      await open('1');
      store.sendMessage(QUESTION);
      await settle();
      api.streams[api.streams.length - 1].error(new Error('cut'));
      await settle();
    }

    it('marks the cut answer as retryable and leaves the question stored once', async () => {
      await askAndCut();
      expect(api.intents.length).toBe(1);
      expect(api.intents[0].options?.skipUserMessage).toBeUndefined();
      const last = store.active_conversation()?.messages.at(-1);
      expect(last?.role).toBe('agent');
      expect(last?.can_retry).toBe(true);
      expect(api.userRows(1).filter((c) => c === QUESTION).length).toBe(1);
    });

    it('does not store the question a second time on retry', async () => {
      await askAndCut();

      await store.retryAnswer();
      await settle();

      expect(api.intents.length).toBe(2);
      expect(api.intents[1].content).toBe(QUESTION);
      expect(api.intents[1].options?.skipUserMessage).toBe(true);
      // What a reload would show: the question once.
      expect(api.userRows(1).filter((c) => c === QUESTION).length).toBe(1);
      // And the thread on screen: one question, one fresh answer in progress.
      const messages = store.active_conversation()?.messages ?? [];
      expect(messages.filter((m) => m.content === QUESTION).length).toBe(1);
      expect(messages.filter((m) => m.can_retry).length).toBe(0);
      expect(messages.at(-1)?.streaming).toBe(true);
    });

    it('still stores the question when the cut turn never reached the server', async () => {
      api.storeUserRowOnStream = false;
      await askAndCut();
      expect(api.userRows(1).filter((c) => c === QUESTION).length).toBe(0);

      api.storeUserRowOnStream = true;
      await store.retryAnswer();
      await settle();

      expect(api.intents[1].options?.skipUserMessage).toBeUndefined();
      expect(api.userRows(1).filter((c) => c === QUESTION).length).toBe(1);
    });

    it('assumes the question is stored when the server cannot be read', async () => {
      await askAndCut();
      api.failDetail = true;

      await store.retryAnswer();
      await settle();

      expect(api.intents[1].options?.skipUserMessage).toBe(true);
      expect(api.userRows(1).filter((c) => c === QUESTION).length).toBe(1);
    });

    it('ignores a second click while the retry is starting', async () => {
      await askAndCut();
      const first = store.retryAnswer();
      const second = store.retryAnswer();
      await Promise.all([first, second]);
      await settle();
      expect(api.intents.length).toBe(2);
    });

    it('a message that was never sent is resent with its user row', async () => {
      await open('1');
      const failing = spyOn(api, 'createStreamIntent').and.returnValue(
        throwError(() => new Error('offline')),
      );
      store.sendMessage(QUESTION);
      await settle();
      const unsent = store
        .active_conversation()
        ?.messages.find((m) => m.send_failed);
      expect(unsent?.content).toBe(QUESTION);

      failing.and.callThrough();
      store.retrySend(unsent!.id);
      await settle();
      expect(api.intents.length).toBe(1);
      expect(api.intents[0].options?.skipUserMessage).toBeUndefined();
      expect(api.userRows(1).filter((c) => c === QUESTION).length).toBe(1);
    });
  });

  describe('turn closed incomplete: «Continuar» (pending_continuation)', () => {
    async function askAndLeavePending(): Promise<void> {
      await open('1');
      store.sendMessage('Revisa el inventario');
      await settle();
      const stream = api.streams.at(-1)!;
      stream.next({ type: 'text', content: 'Ya voy a revisar.' } as VexStreamChunk);
      stream.next({ type: 'done', pending_continuation: true } as VexStreamChunk);
      stream.complete();
      await settle();
    }

    it('marks the answer when the done frame says the turn stayed pending', async () => {
      await askAndLeavePending();
      const last = store.active_conversation()?.messages.at(-1);
      expect(last?.role).toBe('agent');
      expect(last?.pending_continuation).toBeTrue();
      expect(last?.streaming).toBeFalse();
    });

    it('a normally closed answer offers nothing', async () => {
      await open('1');
      store.sendMessage('Hola');
      await settle();
      api.streams.at(-1)!.next({ type: 'done' } as VexStreamChunk);
      api.streams.at(-1)!.complete();
      await settle();
      expect(store.active_conversation()?.messages.at(-1)?.pending_continuation).toBeFalsy();
    });

    it('«Continuar» sends the next turn through sendMessage and drops the offer', async () => {
      await askAndLeavePending();
      const pending = store.active_conversation()!.messages.at(-1)!;

      store.continuePending(pending.id);
      await settle();

      expect(api.intents.length).toBe(2);
      expect(api.intents[1].content).toBe('Continúa con lo que quedó pendiente.');
      const messages = store.active_conversation()?.messages ?? [];
      expect(messages.find((m) => m.id === pending.id)?.pending_continuation).toBeFalse();
      expect(messages.at(-1)?.streaming).toBeTrue();
    });

    it('a reload keeps the offer from the persisted metadata', async () => {
      const pending = message(14, 'assistant', 'Ya voy a revisar.');
      pending.metadata = { pending_continuation: true, pending_text: 'Ya voy a revisar.' };
      api.rows[0].messages = [message(13, 'user', 'Revisa el inventario'), pending];
      await open('1');
      expect(store.active_conversation()?.messages.at(-1)?.pending_continuation).toBeTrue();
    });
  });

  describe('message read aloud (T6)', () => {
    it('points at the answer of the spoken turn, even after a newer written one', async () => {
      await open('1');
      // The mic is input only: the answer is spoken because voice mode (waves) is on.
      store.toggleVoiceMode();
      store.sendVoiceMessage('¿Cómo cerró la caja?');
      await settle();
      expect(spoken_streams.length).toBe(1);
      const spoken = store.active_conversation()?.messages.at(-1);
      expect(spoken?.role).toBe('agent');
      expect(store.spoken_message_id()).toBe(spoken!.id);

      api.streams.at(-1)!.next({ type: 'done' } as VexStreamChunk);
      api.streams.at(-1)!.complete();
      await settle();
      // Voice mode off: the next turn is written only.
      store.toggleVoiceMode();
      store.sendMessage('Gracias');
      await settle();

      const last = store.active_conversation()?.messages.at(-1);
      expect(last?.id).not.toBe(spoken!.id);
      // The audio that may still be playing belongs to the earlier answer.
      expect(store.spoken_message_id()).toBe(spoken!.id);
    });

    it('a written turn is never marked as spoken', async () => {
      await open('1');
      store.sendMessage('Hola');
      await settle();
      expect(spoken_streams.length).toBe(0);
      expect(store.spoken_message_id()).toBeNull();
    });
  });

  describe('loading more chats (N1)', () => {
    beforeEach(async () => {
      api.totalPages = 2;
      await search('ventas');
      await search('');
      expect(store.has_more()).toBe(true);
    });

    it('stops asking after a failed page until the person retries', async () => {
      api.failListPages.add(2);
      const before = api.listCalls.length;

      store.loadMore();
      await settle();
      expect(api.listCalls.length).toBe(before + 1);
      expect(store.load_more_failed()).toBe(true);
      expect(store.loading_more()).toBe(false);

      // The end of the list is still in view: the observer keeps firing.
      store.loadMore();
      store.loadMore();
      store.loadMore();
      await settle();
      expect(api.listCalls.length).toBe(before + 1);

      api.failListPages.clear();
      store.retryLoadMore();
      await settle();
      expect(api.listCalls.length).toBe(before + 2);
      expect(api.listCalls.at(-1)?.page).toBe(2);
      expect(store.load_more_failed()).toBe(false);
    });

    it('keeps the chats already listed when a page fails', async () => {
      api.failListPages.add(2);
      store.loadMore();
      await settle();
      expect(
        store
          .conversations()
          .map((c) => c.id)
          .sort(),
      ).toEqual(['1', '2']);
    });
  });

  describe('«Contexto N %» after a reload (F3 FIX B1)', () => {
    const budget = (tokens: number) => ({
      estimated_input_tokens: tokens,
      omitted_messages: 0,
      context_window_tokens: 100000,
      provenance: 'configured' as const,
      method: 'conservative_estimate' as const,
    });

    it('shows the budget persisted with the newest answer, warning included', async () => {
      const older = message(12, 'assistant', 'Vendiste 42 pedidos.');
      older.metadata = { context_budget: budget(40000) };
      const newest = message(14, 'assistant', 'Listo.');
      newest.metadata = { context_budget: budget(78000) };
      api.rows[0].messages = [
        message(11, 'user', '¿Cuánto vendí esta semana?'),
        older,
        message(13, 'user', '¿Y el mes?'),
        newest,
      ];
      await open('1');
      expect(store.context_percent()).toBe(78);
      expect(store.context_warning()).toBeTrue();
    });

    it('warns at the threshold stamped on the budget, the one the server compacts at (F3 P1-2)', async () => {
      const newest = message(14, 'assistant', 'Listo.');
      newest.metadata = {
        context_budget: { ...budget(60000), max_output_tokens: 8192, compaction_percent: 54 },
      };
      api.rows[0].messages = [message(13, 'user', '¿Y el mes?'), newest];
      await open('1');
      expect(store.context_percent()).toBe(60);
      expect(store.context_warning()).toBeTrue();
    });

    it('shows no ring when no answer carries a budget', async () => {
      await open('2');
      expect(store.context_percent()).toBeNull();
      expect(store.context_warning()).toBeFalse();
    });
  });
});
