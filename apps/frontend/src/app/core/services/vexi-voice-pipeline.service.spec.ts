import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { VexiVoicePipelineService } from './vexi-voice-pipeline.service';
import { VexiVoiceSafetyService } from './vexi-voice-safety.service';

class FakeAudio {
  static instances: FakeAudio[] = [];
  src = '';
  muted = false;
  paused = true;
  playedSrcs: string[] = [];
  playImpl: () => Promise<void> = () => Promise.resolve();
  private listeners = new Map<string, Set<() => void>>();

  constructor(src?: string) {
    if (src) this.src = src;
    FakeAudio.instances.push(this);
  }

  addEventListener(event: string, cb: () => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
  }

  removeEventListener(event: string, cb: () => void): void {
    this.listeners.get(event)?.delete(cb);
  }

  emit(event: string): void {
    for (const cb of [...(this.listeners.get(event) ?? [])]) cb();
  }

  play(): Promise<void> {
    this.paused = false;
    this.playedSrcs.push(this.src);
    return this.playImpl();
  }

  pause(): void {
    this.paused = true;
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }

  load(): void {
    /* noop */
  }
}

describe('VexiVoicePipelineService playback ordering and continuity', () => {
  let service: VexiVoicePipelineService;
  let originalAudio: typeof Audio;
  let blobCounter: number;

  beforeEach(() => {
    FakeAudio.instances = [];
    blobCounter = 0;
    originalAudio = globalThis.Audio;
    (globalThis as any).Audio = FakeAudio;
    spyOn(URL, 'createObjectURL').and.callFake(
      () => `blob:seg-${blobCounter++}`,
    );
    spyOn(URL, 'revokeObjectURL').and.stub();

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        VexiVoicePipelineService,
        {
          provide: VexiVoiceSafetyService,
          useValue: { invalidate: jasmine.createSpy('invalidate') },
        },
      ],
    });
    service = TestBed.inject(VexiVoicePipelineService);
  });

  afterEach(() => {
    (globalThis as any).Audio = originalAudio;
  });

  const frame = (index: number, label: string, filler?: boolean) => ({
    index,
    audio_base64: btoa(label),
    content_type: 'audio/mpeg',
    ...(filler ? { filler: true } : {}),
  });

  it('reuses a single unlocked Audio element and plays every segment in strict order until the end', () => {
    service.primeAudio();
    expect(FakeAudio.instances).toHaveSize(1);
    const player = FakeAudio.instances[0];

    service.startTurn('turn-1');
    expect(service.activeTurnId()).toBe('turn-1');

    // Filler plays first (blob:seg-0).
    service.enqueue('turn-1', frame(0, 'filler', true));
    expect(service.speaking()).toBeTrue();
    expect(player.src).toBe('blob:seg-0');

    // Out-of-order content arrival: index 2 arrives before index 1.
    service.enqueue('turn-1', frame(2, 'part-2')); // blob:seg-1
    service.enqueue('turn-1', frame(1, 'part-1')); // blob:seg-2
    service.enqueue('turn-1', frame(3, 'part-3')); // blob:seg-3
    service.finishTurn('turn-1');

    // Finish filler -> must play index 1 (blob:seg-2), NOT index 2!
    player.emit('ended');
    expect(player.src).toBe('blob:seg-2');
    expect(service.speaking()).toBeTrue();

    // Finish index 1 -> plays index 2 (blob:seg-1).
    player.emit('ended');
    expect(player.src).toBe('blob:seg-1');

    // Finish index 2 -> plays index 3 (blob:seg-3).
    player.emit('ended');
    expect(player.src).toBe('blob:seg-3');

    // Finish index 3 -> turn complete, returns to idle and clears activeTurnId.
    player.emit('ended');
    expect(service.state()).toBe('idle');
    expect(service.activeTurnId()).toBeNull();
    // Same single HTMLAudioElement reused across every segment.
    expect(FakeAudio.instances).toHaveSize(1);
  });

  it('does not double-advance when play() rejects and an error event also fires', async () => {
    service.primeAudio();
    const player = FakeAudio.instances[0];

    service.startTurn('turn-2');
    let call = 0;
    player.playImpl = () => {
      call++;
      if (call === 1) return Promise.reject(new Error('decode error'));
      return Promise.resolve();
    };

    service.enqueue('turn-2', frame(0, 'bad')); // blob:seg-0
    service.enqueue('turn-2', frame(1, 'good-1')); // blob:seg-1
    service.enqueue('turn-2', frame(2, 'good-2')); // blob:seg-2
    service.finishTurn('turn-2');

    // Both error event and rejected play() fire for segment 0.
    player.emit('error');
    await Promise.resolve();

    // Must land on segment 1 (blob:seg-1), NOT skip ahead to segment 2!
    expect(player.src).toBe('blob:seg-1');
    player.emit('ended');
    expect(player.src).toBe('blob:seg-2');
    player.emit('ended');
    expect(service.state()).toBe('idle');
  });

  it('transitions back to idle if finishTurn arrives when nothing is playing or queued', () => {
    service.primeAudio();
    const player = FakeAudio.instances[0];

    service.startTurn('turn-3');
    service.enqueue('turn-3', frame(0, 'filler', true));
    player.emit('ended');
    // Still waiting on content before finishTurn.
    expect(service.state()).toBe('speaking');

    service.finishTurn('turn-3');
    expect(service.state()).toBe('idle');
    expect(service.activeTurnId()).toBeNull();
  });
});
