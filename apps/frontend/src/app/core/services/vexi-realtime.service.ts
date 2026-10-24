import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { VexiVoiceSafetyService } from './vexi-voice-safety.service';
import type { VexiProposal } from '../store/vexi/vexi.actions';
import type { VoiceConsentContext } from './vexi-voice-consent.model';
import { VexiUiCommandService } from './vexi-ui-command.service';

/**
 * What the dock is doing right now. Drives the avatar expression, so the
 * names track user-visible states rather than transport internals.
 */
export type VexiVoiceState =
  | 'idle'
  | 'permission'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error';

export interface RealtimeToolDefinition {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Session config the backend already shaped for the provider. Forwarded
 * verbatim: the nesting (`audio.input.turn_detection`, `audio.output.voice`) is
 * the backend's business, and a misplaced key here would be ignored silently
 * rather than reported.
 */
interface RealtimeSessionPatch {
  tool_choice: 'auto';
  audio?: { input: Record<string, unknown> };
}

export interface RealtimeSessionGrant {
  session_id?: string;
  session_expires_at?: string;
  objective_id?: string;
  agent_key?: 'vex' | 'vexi';
  client_secret: string;
  expires_at: number;
  model: string;
  voice: string;
  base_url: string;
  tools: RealtimeToolDefinition[];
  instructions: string | null;
  session_patch: RealtimeSessionPatch;
}

/**
 * Fallback persona, used only when no `vexi_realtime_voice` application governs
 * the session — an install where the migration never ran. Keeping it means a
 * missing row degrades to the previous behaviour instead of handing the model an
 * unguided session.
 */
const DEFAULT_VOICE_INSTRUCTIONS =
  'Eres Vexi, el asistente de Vendix. Ayudas al propietario y al ' +
  'administrador a consultar su negocio. Responde en español, breve y ' +
  'concreto. Usa las herramientas disponibles para responder con datos ' +
  'reales; nunca inventes cifras.';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

/** Provider event shapes we actually branch on. */
interface RealtimeServerEvent {
  type: string;
  response?: {
    output?: Array<{
      type?: string;
      name?: string;
      arguments?: string;
      call_id?: string;
    }>;
    usage?: { total_tokens?: number };
  };
}

@Injectable({ providedIn: 'root' })
export class VexiRealtimeService {
  private readonly http = inject(HttpClient);
  private readonly safety = inject(VexiVoiceSafetyService);
  private readonly destroyRef = inject(DestroyRef);
  readonly pendingProposal = signal<{
    proposal: VexiProposal;
    context: VoiceConsentContext;
  } | null>(null);
  private grant: RealtimeSessionGrant | null = null;
  private context: { conversation_id?: number; agent_key: 'vex' | 'vexi' } = {
    agent_key: 'vexi',
  };
  private generation = 0;
  private suspended = false;
  private sessionExpiresAt = 0;
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private readonly uiCommands = inject(VexiUiCommandService);
  private readonly baseUrl = `${environment.apiUrl}/store/vexi/realtime`;

  readonly state = signal<VexiVoiceState>('idle');
  readonly errorMessage = signal<string | null>(null);
  /**
   * True once the mic permission prompt has been resolved. The first
   * long-press has to spend itself on the prompt — the browser dialog steals
   * the gesture — so the UI tells the user to hold again instead of silently
   * doing nothing.
   */
  readonly permissionResolved = signal(false);

  private pc: RTCPeerConnection | null = null;
  private micStream: MediaStream | null = null;
  private channel: RTCDataChannel | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private startedAt = 0;
  private totalTokens = 0;

  constructor() {
    if (typeof window !== 'undefined') {
      const invalidate = () => {
        if (this.grant?.session_id) {
          this.pendingProposal.set(null);
          void this.stop();
        }
      };
      window.addEventListener('blur', invalidate);
      window.addEventListener('offline', invalidate);
      const hidden = () => {
        if (document.visibilityState !== 'visible') invalidate();
      };
      document.addEventListener('visibilitychange', hidden);
      this.destroyRef.onDestroy(() => {
        window.removeEventListener('blur', invalidate);
        window.removeEventListener('offline', invalidate);
        document.removeEventListener('visibilitychange', hidden);
        void this.stop();
      });
    }
  }

  /**
   * Opens a voice turn. Resolves `false` when the attempt was consumed by the
   * permission prompt, so the caller can prompt for a second hold.
   */
  async start(context?: {
    conversation_id?: number;
    agent_key: 'vex' | 'vexi';
  }): Promise<boolean> {
    if (this.pc || this.grant) await this.stop();
    this.safety.invalidate();
    this.pendingProposal.set(null);
    this.context = context ?? { agent_key: 'vexi' };
    const generation = ++this.generation;
    this.suspended = false;

    this.errorMessage.set(null);

    try {
      const needsPrompt = !this.permissionResolved();
      if (needsPrompt) this.state.set('permission');

      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.permissionResolved.set(true);
      if (generation !== this.generation) {
        micStream.getTracks().forEach((track) => track.stop());
        return false;
      }
      this.micStream = micStream;

      // The prompt tore the hold apart — the pointer is long gone. Release the
      // mic and let the user start a real turn.
      if (needsPrompt) {
        this.teardownMedia();
        this.state.set('idle');
        return false;
      }

      this.state.set('connecting');
      const grant = await this.requestGrant();
      if (generation !== this.generation) {
        if (grant.session_id)
          void firstValueFrom(
            this.http.post(`${this.baseUrl}/session/close`, {
              session_id: grant.session_id,
              duration_seconds: 0,
              total_tokens: 0,
            }),
          ).catch(() => undefined);
        return false;
      }
      this.grant = grant;
      if (grant.session_id) {
        const expiresAt = Date.parse(grant.session_expires_at || '');
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now())
          throw new Error('La sesión de voz venció.');
        this.sessionExpiresAt = Math.min(expiresAt, Date.now() + 300_000);
        this.expiryTimer = setTimeout(
          () => {
            this.pendingProposal.set(null);
            void this.stop();
          },
          Math.max(1, this.sessionExpiresAt - Date.now() - 100),
        );
      }
      await this.connect(grant, generation);
      if (generation !== this.generation) return false;

      this.startedAt = Date.now();
      this.state.set('listening');
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.handleFailure(error);
      await this.stop();
      return false;
    }
  }

  /** Ends the turn and reports the billable duration. */
  async stop(): Promise<void> {
    this.safety.invalidate();
    this.generation++;
    const session_id = this.grant?.session_id;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    this.sessionExpiresAt = 0;
    this.grant = null;
    const seconds = this.startedAt
      ? Math.round((Date.now() - this.startedAt) / 1000)
      : 0;
    const tokens = this.totalTokens;

    this.startedAt = 0;
    this.totalTokens = 0;
    this.teardownConnection();
    this.teardownMedia();

    if (this.state() !== 'error') this.state.set('idle');

    if (seconds > 0 || session_id) {
      // Fire-and-forget: the user already released the dock, and a failed
      // accounting call must not surface as a voice error.
      try {
        await firstValueFrom(
          this.http.post(`${this.baseUrl}/session/close`, {
            ...(session_id ? { session_id } : {}),
            duration_seconds: seconds,
            total_tokens: tokens,
          }),
        );
      } catch {
        /* quota reconciliation is best-effort */
      }
    }
  }

  /** Mute both directions before challenge narration/capture. Never resume this mic implicitly. */
  suspendForConsent(): void {
    this.suspended = true;
    this.send({ type: 'response.cancel' });
    this.micStream?.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
    if (this.remoteAudio) {
      this.remoteAudio.muted = true;
      this.remoteAudio.pause();
    }
  }

  clearProposal(): void {
    this.pendingProposal.set(null);
  }

  // ── Connection ──────────────────────────────────────────────────────────

  async voiceConsentEnabled(): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.http.get<ApiEnvelope<{ enabled: boolean }>>(
          `${environment.apiUrl}/store/vexi/voice/confirmations/capability`,
        ),
      );
      return response.data?.enabled === true;
    } catch {
      return false;
    }
  }

  private async requestGrant(): Promise<RealtimeSessionGrant> {
    const res = await firstValueFrom(
      this.http.post<ApiEnvelope<RealtimeSessionGrant>>(
        `${this.baseUrl}/session`,
        this.context.conversation_id ? this.context : {},
      ),
    );
    return res.data;
  }

  private async connect(
    grant: RealtimeSessionGrant,
    generation: number,
  ): Promise<void> {
    const pc = new RTCPeerConnection();
    this.pc = pc;

    // Model audio arrives as a remote track; an <audio> element is the only
    // thing that actually plays it.
    this.remoteAudio = new Audio();
    this.remoteAudio.autoplay = true;
    pc.ontrack = (event) => {
      if (generation === this.generation && this.remoteAudio)
        this.remoteAudio.srcObject = event.streams[0];
    };

    for (const track of this.micStream?.getAudioTracks() ?? []) {
      pc.addTrack(track, this.micStream!);
    }

    const channel = pc.createDataChannel('oai-events');
    this.channel = channel;
    channel.onopen = () => {
      if (generation === this.generation) this.configureSession(grant);
    };
    channel.onmessage = (event) => {
      if (generation === this.generation && !this.suspended)
        void this.onServerEvent(event, generation);
    };
    pc.onconnectionstatechange = () => {
      if (
        generation === this.generation &&
        ['disconnected', 'failed', 'closed'].includes(pc.connectionState)
      ) {
        this.safety.invalidate();
        this.suspendForConsent();
        this.state.set('error');
        this.errorMessage.set(
          'La conexión cambió. Abre una sesión y una propuesta nuevas.',
        );
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const answerSdp = await firstValueFrom(
      this.http.post(`${grant.base_url}/realtime/calls`, offer.sdp ?? '', {
        headers: new HttpHeaders({
          Authorization: `Bearer ${grant.client_secret}`,
          'Content-Type': 'application/sdp',
        }),
        responseType: 'text',
      }),
    );

    if (generation !== this.generation) {
      pc.close();
      return;
    }
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  }

  /**
   * Applies the server-authored session config and hands the model its tool
   * catalog. The catalog is whatever the backend authorized for this user — the
   * client never widens it — and the rest of the config is forwarded as-is.
   */
  private configureSession(grant: RealtimeSessionGrant): void {
    this.send({
      type: 'session.update',
      session: {
        ...grant.session_patch,
        tools: grant.tools,
        instructions: grant.instructions ?? DEFAULT_VOICE_INSTRUCTIONS,
      },
    });
  }

  private async onServerEvent(
    event: MessageEvent,
    generation: number,
  ): Promise<void> {
    let payload: RealtimeServerEvent;
    try {
      payload = JSON.parse(event.data as string) as RealtimeServerEvent;
    } catch {
      return;
    }

    switch (payload.type) {
      case 'input_audio_buffer.speech_started':
        this.safety.invalidate();
        this.state.set('listening');
        return;
      case 'response.created':
        this.state.set('thinking');
        return;
      case 'response.output_audio.delta':
        this.state.set('speaking');
        return;
      case 'response.done':
        await this.onResponseDone(payload, generation);
        return;
      case 'error':
        this.state.set('error');
        this.errorMessage.set('La sesión de voz falló.');
        return;
    }
  }

  /**
   * `response.done` carries either a finished spoken answer or a request to
   * run a tool. Tool calls are bridged to the backend, which re-checks
   * permissions and can only propose a write, never apply it.
   */
  private async onResponseDone(
    payload: RealtimeServerEvent,
    generation: number,
  ): Promise<void> {
    this.totalTokens += payload.response?.usage?.total_tokens ?? 0;

    const calls = (payload.response?.output ?? []).filter(
      (item) => item.type === 'function_call' && item.name && item.call_id,
    );

    if (!calls.length) {
      if (this.state() !== 'error') this.state.set('listening');
      return;
    }

    this.state.set('thinking');

    for (const call of calls) {
      if (generation !== this.generation || this.suspended) return;
      const output = await this.bridgeToolCall(
        call.name!,
        call.arguments,
        call.call_id!,
      );
      if (generation !== this.generation || this.suspended) return;
      this.send({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call.call_id,
          output,
        },
      });
      // One proposal ends this voice turn; defer siblings instead of replacing
      // the exact diff the human is about to review.
      if (
        this.grant?.session_id &&
        this.pendingProposal()?.context.session_id === this.grant.session_id
      )
        break;
    }

    // A pending write is browser-only, not a license for the model to narrate an applied effect.
    // Read the exact action/nonce through the dedicated control instead of continuing model audio.
    if (
      this.pendingProposal()?.context.session_id === this.grant?.session_id &&
      this.grant?.session_id
    ) {
      this.suspendForConsent();
      this.state.set('idle');
      return;
    }
    this.send({ type: 'response.create' });
  }

  private async bridgeToolCall(
    name: string,
    rawArgs: string | undefined,
    callId: string,
  ): Promise<string> {
    if (this.grant?.session_id && Date.now() >= this.sessionExpiresAt) {
      this.pendingProposal.set(null);
      void this.stop();
      return JSON.stringify({ error: 'La sesión de voz venció.' });
    }
    let args: Record<string, unknown> = {};
    try {
      args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
    } catch {
      return JSON.stringify({ error: 'Argumentos inválidos' });
    }

    // OFF preserves the legacy local path. G must receive explicit server
    // authorization before any browser UI dispatch; Vex remains denied.
    if (this.uiCommands.handles(name) && !this.grant?.session_id) {
      if (this.context.agent_key === 'vex')
        return JSON.stringify({
          error: 'Vex no puede ejecutar herramientas de interfaz.',
        });
      return this.uiCommands.execute(name, args);
    }

    const generation = this.generation;
    const sessionId = this.grant?.session_id;
    try {
      const res = await firstValueFrom(
        this.http.post<
          ApiEnvelope<{
            call_id: string;
            output: string;
            ui_authorized?: boolean;
            tools?: RealtimeToolDefinition[];
            proposal?: {
              proposal_id: string;
              plan_id?: string;
              step_id?: string;
              tool: string;
              arguments?: Record<string, unknown>;
              preview?: VexiProposal['preview'];
              preview_hash?: string;
              expires_at?: string;
            };
          }>
        >(`${this.baseUrl}/tool-call`, {
          name,
          arguments: args,
          call_id: callId,
          ...(this.grant?.session_id
            ? { session_id: this.grant.session_id }
            : {}),
        }),
      );
      if (
        generation !== this.generation ||
        sessionId !== this.grant?.session_id ||
        this.suspended
      )
        return JSON.stringify({ error: 'Sesión interrumpida.' });
      if (res.data.tools && this.grant) {
        this.grant = { ...this.grant, tools: res.data.tools };
        this.configureSession(this.grant);
      }
      if (
        res.data.proposal &&
        this.grant?.session_id &&
        this.context.conversation_id
      ) {
        const proposal = res.data.proposal;
        this.pendingProposal.set({
          proposal: {
            tool: proposal.tool,
            arguments: proposal.arguments ?? args,
            preview: proposal.preview,
            confirmationToken: '',
            applying: false,
          },
          context: {
            conversation_id: this.context.conversation_id,
            agent_key: this.context.agent_key,
            channel: 'realtime',
            session_id: this.grant.session_id,
            proposal_id: proposal.proposal_id,
            objective_id: this.grant.objective_id,
            ...(proposal.plan_id
              ? { plan_id: proposal.plan_id, step_id: proposal.step_id }
              : {}),
          },
        });
      }
      if (this.uiCommands.handles(name) && this.grant?.session_id) {
        if (this.context.agent_key === 'vex' || res.data.ui_authorized !== true)
          return JSON.stringify({
            error: 'Herramienta de interfaz no autorizada.',
          });
        return this.uiCommands.execute(name, args);
      }
      // Only the safe server output goes back to the provider. Never the proposal/token/nonce.
      return res.data.output;
    } catch (error: unknown) {
      // Surfaced to the model as data, not thrown: it should say "no puedo
      // consultar eso" out loud rather than the turn dying silently.
      const message =
        (error as { error?: { message?: string } })?.error?.message ??
        'La herramienta no está disponible';
      return JSON.stringify({ error: message });
    }
  }

  // ── Teardown ────────────────────────────────────────────────────────────

  private send(event: Record<string, unknown>): void {
    if (this.channel?.readyState !== 'open') return;
    this.channel.send(JSON.stringify(event));
  }

  private teardownConnection(): void {
    this.channel?.close();
    this.channel = null;

    this.pc?.getSenders().forEach((sender) => sender.track?.stop());
    this.pc?.close();
    this.pc = null;

    if (this.remoteAudio) {
      this.remoteAudio.srcObject = null;
      this.remoteAudio = null;
    }
  }

  /** Releases the mic so the browser's recording indicator goes away. */
  private teardownMedia(): void {
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.micStream = null;
  }

  private handleFailure(error: unknown): void {
    const name = (error as { name?: string })?.name;

    if (name === 'NotAllowedError' || name === 'SecurityError') {
      this.permissionResolved.set(false);
      this.errorMessage.set(
        'Vexi necesita permiso del micrófono para escucharte.',
      );
    } else if (name === 'NotFoundError') {
      this.errorMessage.set('No se encontró un micrófono disponible.');
    } else {
      const code = (error as { error?: { error_code?: string } })?.error
        ?.error_code;
      this.errorMessage.set(
        code === 'SUBSCRIPTION_005'
          ? 'Tu plan no incluye voz en tiempo real.'
          : 'No se pudo iniciar la sesión de voz.',
      );
    }

    this.state.set('error');
  }
}
