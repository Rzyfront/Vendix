import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { VexChatStore } from './vex-chat.store';
import { VexApiService, VexStreamChunk } from '../services/vex-api.service';
import { VexiApiService } from '../../../../../core/services/vexi-api.service';
import { VexiVoicePipelineService } from '../../../../../core/services/vexi-voice-pipeline.service';
import { VexiVoiceSafetyService } from '../../../../../core/services/vexi-voice-safety.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import type { VexMessage } from '../models/vex.models';

/** Lets every promise chain queued by the store settle (intent -> stream subscription). */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

describe('VexChatStore voice mode, mic input and on-demand listen', () => {
  let store: VexChatStore;
  let api: jasmine.SpyObj<VexApiService>;
  let voice: {
    activeTurnId: ReturnType<typeof signal<string | null>>;
    primeAudio: jasmine.Spy;
    warm: jasmine.Spy;
    startTurn: jasmine.Spy;
    enqueue: jasmine.Spy;
    finishTurn: jasmine.Spy;
    interrupt: jasmine.Spy;
    cancelRecording: jasmine.Spy;
  };
  let stream$: Subject<VexStreamChunk>;

  const seedConversations = () => {
    (store as any)._conversations.set([
      {
        id: '10',
        title: 'Chat A',
        created_at: new Date(),
        updated_at: new Date(),
        messages: [
          {
            id: 'm-1',
            role: 'agent',
            content: 'Ventas totales: $1.500.000. Excelente día.',
            created_at: new Date(),
          },
        ],
      },
      {
        id: '20',
        title: 'Chat B',
        created_at: new Date(),
        updated_at: new Date(),
        messages: [],
      },
    ]);
    (store as any).loaded_ids.add('10');
    (store as any).loaded_ids.add('20');
    (store as any)._active_id.set('10');
  };

  beforeEach(async () => {
    stream$ = new Subject<VexStreamChunk>();
    api = jasmine.createSpyObj('VexApiService', [
      'listConversations',
      'getConversation',
      'createStreamIntent',
      'streamConversation',
      'synthesizeSpeech',
    ]);
    api.listConversations.and.returnValue(
      of({ data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } }),
    );
    api.getConversation.and.callFake((id: number) =>
      of({
        id,
        title: `Chat ${id}`,
        status: 'active',
        metadata: { agent_key: 'vex' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        messages: [],
      } as any),
    );
    api.createStreamIntent.and.returnValue(of('stream-1'));
    api.streamConversation.and.returnValue(stream$.asObservable());
    api.synthesizeSpeech.and.returnValue(
      of([
        { index: 0, audio_base64: 'AAA', content_type: 'audio/mpeg' },
        { index: 1, audio_base64: 'BBB', content_type: 'audio/mpeg' },
      ]),
    );

    const activeTurnId = signal<string | null>(null);
    voice = {
      activeTurnId,
      primeAudio: jasmine.createSpy('primeAudio'),
      warm: jasmine.createSpy('warm').and.returnValue(Promise.resolve()),
      startTurn: jasmine
        .createSpy('startTurn')
        .and.callFake((id: string) => activeTurnId.set(id)),
      enqueue: jasmine.createSpy('enqueue'),
      finishTurn: jasmine.createSpy('finishTurn'),
      interrupt: jasmine
        .createSpy('interrupt')
        .and.callFake(() => activeTurnId.set(null)),
      cancelRecording: jasmine.createSpy('cancelRecording'),
    };

    TestBed.configureTestingModule({
      providers: [
        VexChatStore,
        { provide: VexApiService, useValue: api },
        { provide: VexiApiService, useValue: {} },
        { provide: VexiVoicePipelineService, useValue: voice },
        {
          provide: VexiVoiceSafetyService,
          useValue: { invalidate: jasmine.createSpy('invalidate') },
        },
        {
          provide: ToastService,
          useValue: {
            error: jasmine.createSpy('error'),
            warning: jasmine.createSpy('warning'),
          },
        },
      ],
    });
    store = TestBed.inject(VexChatStore);
    await Promise.resolve();
    seedConversations();
  });

  it('keeps voice_mode active when switching or creating conversations', () => {
    expect(store.voice_mode()).toBeFalse();

    store.toggleVoiceMode();
    expect(store.voice_mode()).toBeTrue();
    expect(voice.primeAudio).toHaveBeenCalled();
    expect(voice.warm).toHaveBeenCalled();

    store.selectConversation('20');
    expect(store.active_id()).toBe('20');
    expect(store.voice_mode()).toBeTrue();

    store.newConversation();
    expect(store.active_id()).toBeNull();
    expect(store.voice_mode()).toBeTrue();

    store.toggleVoiceMode();
    expect(store.voice_mode()).toBeFalse();
    expect(voice.interrupt).toHaveBeenCalled();
  });

  it('mic input sends text-only when voice_mode is OFF and spoken when voice_mode is ON', async () => {
    // Mic with waves OFF -> speak is NOT sent (response stays text).
    store.sendVoiceMessage('¿Cómo van las ventas?');
    await settle();
    expect(api.createStreamIntent).toHaveBeenCalledWith(
      10,
      '¿Cómo van las ventas?',
      { attachmentIds: undefined },
    );
    stream$.next({ type: 'done' });
    stream$.complete();

    // Turn waves ON -> both text and mic send speak: true.
    stream$ = new Subject<VexStreamChunk>();
    api.streamConversation.and.returnValue(stream$.asObservable());
    api.createStreamIntent.calls.reset();

    store.toggleVoiceMode();
    store.sendMessage('Dame el detalle de hoy');
    await settle();

    expect(api.createStreamIntent).toHaveBeenCalledWith(
      10,
      'Dame el detalle de hoy',
      { attachmentIds: undefined, speak: true },
    );
    expect(voice.startTurn).toHaveBeenCalledWith('stream-1');
  });

  it('delivers all streamed audio segments before finishing the turn and caches them for «Escuchar»', async () => {
    store.toggleVoiceMode();
    store.sendMessage('Resumen del día');
    await settle();

    stream$.next({
      type: 'audio',
      index: 0,
      audio_base64: 'FILLER',
      content_type: 'audio/mpeg',
      filler: true,
    });
    stream$.next({ type: 'text', content: 'Primera parte. Segunda parte.' });
    stream$.next({
      type: 'audio',
      index: 1,
      audio_base64: 'SEG1',
      content_type: 'audio/mpeg',
    });
    stream$.next({
      type: 'audio',
      index: 2,
      audio_base64: 'SEG2',
      content_type: 'audio/mpeg',
    });

    // Must NOT have called finishTurn after segment 0 or 1.
    expect(voice.finishTurn).not.toHaveBeenCalled();
    expect(voice.enqueue).toHaveBeenCalledTimes(3);

    stream$.next({ type: 'done' });
    stream$.complete();
    expect(voice.finishTurn).toHaveBeenCalledTimes(1);
    expect(voice.finishTurn).toHaveBeenCalledWith('stream-1');

    // Simulate playback finishing, then click «Escuchar» on the reply:
    // must replay from cache without calling POST /store/vex/speech!
    voice.activeTurnId.set(null);
    voice.enqueue.calls.reset();
    const reply = store.active_conversation()!.messages.at(-1)!;
    store.toggleListenMessage(reply);
    expect(api.synthesizeSpeech).not.toHaveBeenCalled();
    expect(voice.enqueue).toHaveBeenCalledTimes(2);
  });

  it('«Escuchar» synthesizes ONLY on click, reuses cache on second click, and stops on click while playing', async () => {
    // Nothing pre-generated before click.
    expect(api.synthesizeSpeech).not.toHaveBeenCalled();

    const msg: VexMessage = store.active_conversation()!.messages[0];
    store.toggleListenMessage(msg);
    await Promise.resolve();
    await Promise.resolve();

    expect(api.synthesizeSpeech).toHaveBeenCalledTimes(1);
    expect(api.synthesizeSpeech).toHaveBeenCalledWith(msg.content);
    expect(voice.enqueue).toHaveBeenCalledTimes(2);
    expect(voice.finishTurn).toHaveBeenCalledTimes(1);
    expect(store.speaking_message_id()).toBe(msg.id);

    // Click again while playing -> stops audio.
    store.toggleListenMessage(msg);
    expect(voice.interrupt).toHaveBeenCalled();
    expect(store.speaking_message_id()).toBeNull();

    // Click again after stopped -> replays from cache (0 new API calls!).
    voice.enqueue.calls.reset();
    store.toggleListenMessage(msg);
    expect(api.synthesizeSpeech).toHaveBeenCalledTimes(1);
    expect(voice.enqueue).toHaveBeenCalledTimes(2);
  });
});
