import { DestroyRef, Injectable, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { VexiProposal } from '../store/vexi/vexi.actions';
import { VexiVoiceSafetyService } from './vexi-voice-safety.service';
import { VexiVoicePipelineService } from './vexi-voice-pipeline.service';
import { VexiRealtimeService } from './vexi-realtime.service';
import {
  VoiceConsentApplied,
  VoiceConsentChallenge,
  VoiceConsentContext,
  VoiceConsentReceipt,
  voiceCaptureAllowed,
  voiceChallengeExpiry,
  voiceProposalReadout,
  voiceReceiptWasApplied,
  voiceConsentSessionRequest,
  voiceChallengeRequest,
} from './vexi-voice-consent.model';

type ConsentState =
  | 'idle'
  | 'preparing'
  | 'reading'
  | 'ready'
  | 'recording'
  | 'submitting'
  | 'applied'
  | 'unavailable';

/** Local to a confirmation control. Dedicated audio never enters NgRx or a chat turn. */
@Injectable()
export class VexiVoiceConsentService {
  private readonly http = inject(HttpClient);
  private readonly safety = inject(VexiVoiceSafetyService);
  private readonly pipeline = inject(VexiVoicePipelineService);
  private readonly realtime = inject(VexiRealtimeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly base = `${environment.apiUrl}/store/vexi/voice/confirmations`;
  readonly enabled = signal(false);
  readonly state = signal<ConsentState>('idle');
  readonly challenge = signal<VoiceConsentChallenge | null>(null);
  readonly message = signal('');
  private generation = 0;
  private epoch = 0;
  private session: string | null = null;
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private timeout?: ReturnType<typeof setTimeout>;
  private held = false;
  private captureAttempt = 0;
  private started = 0;
  private onApplied?: (result: VoiceConsentApplied) => void;
  private binding?: { context: VoiceConsentContext; proposal: VexiProposal };

  constructor() {
    effect(() => {
      const epoch = this.safety.epoch();
      if (epoch !== this.epoch && this.session)
        this.cancel(
          'Se interrumpió la sesión. Solicita otro código o usa Aprobar.',
        );
    });
    if (typeof window !== 'undefined') {
      const blur = () =>
        this.cancel(
          'La confirmación perdió el foco. Usa un código nuevo o Aprobar.',
        );
      const hidden = () => {
        if (document.visibilityState !== 'visible') blur();
      };
      window.addEventListener('blur', blur);
      window.addEventListener('offline', blur);
      document.addEventListener('visibilitychange', hidden);
      this.destroyRef.onDestroy(() => {
        window.removeEventListener('blur', blur);
        window.removeEventListener('offline', blur);
        document.removeEventListener('visibilitychange', hidden);
      });
    }
    this.destroyRef.onDestroy(() => this.cancel());
  }

  async loadCapability(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<{ data: { enabled: boolean } }>(
          `${this.base}/capability`,
        ),
      );
      this.enabled.set(response.data?.enabled === true);
    } catch {
      this.enabled.set(false);
    }
  }

  async prepare(
    proposal: VexiProposal,
    context: VoiceConsentContext,
    onApplied: (result: VoiceConsentApplied) => void,
  ): Promise<void> {
    this.cancel();
    if (
      !this.enabled() ||
      !this.foreground() ||
      (!proposal.confirmationToken &&
        !context.proposal_id &&
        !context.plan_id) ||
      proposal.applying
    )
      return;
    this.pipeline.cancelRecording();
    this.pipeline.interrupt();
    this.realtime.suspendForConsent();
    const generation = this.generation;
    this.epoch = this.safety.epoch();
    this.binding = { proposal, context };
    this.onApplied = onApplied;
    this.state.set('preparing');
    this.message.set('Preparando un código exclusivo para esta acción.');
    try {
      // Rebind the opaque original proposal to a fresh authenticated capture session.
      // Its original <=60s record and token stay server-side, even after realtime closes.
      const session = await firstValueFrom(
        this.http.post<{ data: { session_id: string } }>(
          `${this.base}/session`,
          voiceConsentSessionRequest(context),
        ),
      );
      if (generation !== this.generation) {
        this.closeSession(session.data.session_id);
        return;
      }
      this.session = session.data.session_id;
      const response = await firstValueFrom(
        this.http.post<{ data: VoiceConsentChallenge }>(
          `${this.base}/challenge`,
          voiceChallengeRequest(this.session, context, proposal),
        ),
      );
      if (generation !== this.generation) return;
      const challenge = response.data;
      const expiry = voiceChallengeExpiry(challenge.expires_at);
      if (
        !challenge.expected_phrase ||
        !Number.isFinite(expiry) ||
        expiry <= Date.now() ||
        expiry - Date.now() > 60_000
      )
        throw new Error('El código no está vigente. Usa Aprobar.');
      this.challenge.set(challenge);
      this.timeout = setTimeout(
        () => this.cancel('El código venció. Solicita otro o usa Aprobar.'),
        expiry - Date.now(),
      );
      this.state.set('reading');
      // Speech synthesis failure is never permission to skip the audible nonce.
      await this.read(
        `${challenge.action_text || voiceProposalReadout(proposal)} Para autorizar, mantén el botón y di exactamente: ${challenge.expected_phrase}`,
        generation,
      );
      if (generation !== this.generation || !this.captureAllowed()) return;
      this.state.set('ready');
      this.message.set(
        'Mantén presionado el botón dedicado y repite la frase exacta. «Sí» no aprueba.',
      );
    } catch (error) {
      if (generation !== this.generation) return;
      this.cancel(this.errorMessage(error));
    }
  }

  async startCapture(): Promise<void> {
    if (
      this.held ||
      this.recorder ||
      this.state() !== 'ready' ||
      !this.captureAllowed()
    )
      return;
    this.held = true;
    const captureAttempt = ++this.captureAttempt;
    const generation = this.generation;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (
        !this.held ||
        generation !== this.generation ||
        captureAttempt !== this.captureAttempt ||
        !this.captureAllowed()
      ) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      if (
        stream
          .getAudioTracks()
          .some((track) => track.getSettings().echoCancellation !== true)
      )
        throw new Error(
          'Este navegador no garantiza captura con cancelación de eco. Usa Aprobar.',
        );
      const mime = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ].find((type) => MediaRecorder.isTypeSupported(type));
      this.chunks = [];
      const recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      recorder.ondataavailable = (event) => {
        if (generation === this.generation && event.data.size)
          this.chunks.push(event.data);
      };
      recorder.onerror = () => this.cancel('No se pudo grabar. Usa Aprobar.');
      this.recorder = recorder;
      this.started = Date.now();
      recorder.start();
      this.state.set('recording');
      this.message.set(
        'Grabando solo el consentimiento. Suelta para enviarlo.',
      );
    } catch (error) {
      if (generation === this.generation) this.cancel(this.errorMessage(error));
    }
  }

  async releaseCapture(): Promise<void> {
    this.held = false;
    const recorder = this.recorder;
    if (!recorder || this.state() !== 'recording') {
      this.captureAttempt++;
      return;
    }
    this.recorder = null; // A second keyup/pointerup cannot submit the same capture.
    const generation = this.generation;
    await new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
      recorder.stop();
    });
    this.releaseMic();
    this.recorder = null;
    if (generation !== this.generation || !this.captureAllowed()) return;
    const file = new Blob(this.chunks, { type: recorder.mimeType });
    this.chunks = [];
    if (Date.now() - this.started < 350 || file.size < 1500) {
      this.cancel(
        'No se capturó una frase completa. Usa otro código o Aprobar.',
      );
      return;
    }
    const challenge = this.challenge()!;
    const binding = this.binding!;
    const callback = this.onApplied;
    const form = new FormData();
    form.append(
      'file',
      file,
      recorder.mimeType.includes('mp4')
        ? 'consent.mp4'
        : recorder.mimeType.includes('ogg')
          ? 'consent.ogg'
          : 'consent.webm',
    );
    form.append('session_id', this.session!);
    form.append('proposal_id', challenge.proposal_id);
    form.append('challenge_id', challenge.challenge_id);
    form.append(
      'capture',
      JSON.stringify({
        dedicated: true,
        foreground: true,
        focused: true,
        assistantSilent: true,
        noBargeIn: true,
        notEcho: true,
        reconnected: false,
      }),
    );
    form.append('speak', 'true');
    this.state.set('submitting');
    this.message.set('Validando el consentimiento. No repitas la operación.');
    try {
      // NEVER retry. A lost response may conceal an already applied effect.
      const result = await firstValueFrom(
        this.http.post<{ data: VoiceConsentReceipt }>(
          `${this.base}/consent`,
          form,
        ),
      );
      callback?.({
        context: binding.context,
        confirmationToken: binding.proposal.confirmationToken,
        proposalArguments: binding.proposal.arguments,
        receipt: result.data,
      });
      if (generation === this.generation) {
        this.state.set(
          voiceReceiptWasApplied(result.data) ? 'applied' : 'unavailable',
        );
        this.message.set(
          result.data.summary ||
            'Se recibió el resultado. Consulta el estado de la acción.',
        );
        this.clearCapture();
      }
    } catch (error) {
      if (generation === this.generation) this.cancel(this.errorMessage(error));
    }
  }

  cancel(message = '', close = true): void {
    const submitting = this.state() === 'submitting';
    this.generation++;
    this.captureAttempt++;
    this.held = false;
    if (typeof speechSynthesis !== 'undefined' && this.state() === 'reading')
      speechSynthesis.cancel();
    const session = this.session;
    this.session = null;
    if (session && close) this.closeSession(session);
    this.clearCapture();
    this.challenge.set(null);
    this.state.set(message ? 'unavailable' : 'idle');
    this.message.set(
      submitting
        ? 'Se interrumpió la confirmación; el resultado puede estar pendiente. Consulta el estado antes de volver a proponer.'
        : message,
    );
  }

  private closeSession(session_id: string): void {
    void firstValueFrom(
      this.http.post(`${this.base}/cancel`, { session_id }),
    ).catch(() => undefined);
  }
  private foreground(): boolean {
    return (
      typeof document !== 'undefined' &&
      document.visibilityState === 'visible' &&
      document.hasFocus()
    );
  }
  private captureAllowed(): boolean {
    const challenge = this.challenge();
    return (
      !!challenge &&
      voiceCaptureAllowed({
        now: Date.now(),
        expiresAt: voiceChallengeExpiry(challenge.expires_at),
        visible: this.foreground(),
        focused: this.foreground(),
        assistantSilent:
          typeof speechSynthesis !== 'undefined' && !speechSynthesis.speaking,
        epoch: this.safety.epoch(),
        expectedEpoch: this.epoch,
      })
    );
  }
  private read(text: string, generation: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof speechSynthesis === 'undefined') {
        reject(new Error('No hay lectura audible disponible. Usa Aprobar.'));
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'es-CO';
      utterance.onend = () => {
        if (generation === this.generation) resolve();
        else reject(new Error('Lectura interrumpida.'));
      };
      utterance.onerror = () =>
        reject(
          new Error('No se pudo leer la acción y el código. Usa Aprobar.'),
        );
      speechSynthesis.cancel();
      speechSynthesis.speak(utterance);
    });
  }
  private clearCapture(): void {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = undefined;
    if (this.recorder?.state !== 'inactive') this.recorder?.stop();
    this.recorder = null;
    this.releaseMic();
    this.chunks = [];
  }
  private releaseMic(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
  private errorMessage(error: unknown): string {
    const message = (
      error as { error?: { message?: string }; message?: string }
    )?.error?.message;
    return (
      message ||
      (error instanceof Error ? error.message : '') ||
      'La transcripción no pudo demostrar una frase fiable. No se autoriza por voz; usa Aprobar. Si se perdió la respuesta, verifica el estado antes de reintentar.'
    );
  }
}
