import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
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

interface RealtimeSessionGrant {
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

  /**
   * Opens a voice turn. Resolves `false` when the attempt was consumed by the
   * permission prompt, so the caller can prompt for a second hold.
   */
  async start(): Promise<boolean> {
    if (this.pc) return true;

    this.errorMessage.set(null);

    try {
      const needsPrompt = !this.permissionResolved();
      if (needsPrompt) this.state.set('permission');

      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.permissionResolved.set(true);

      // The prompt tore the hold apart — the pointer is long gone. Release the
      // mic and let the user start a real turn.
      if (needsPrompt) {
        this.teardownMedia();
        this.state.set('idle');
        return false;
      }

      this.state.set('connecting');
      const grant = await this.requestGrant();
      await this.connect(grant);

      this.startedAt = Date.now();
      this.state.set('listening');
      return true;
    } catch (error) {
      this.handleFailure(error);
      await this.stop();
      return false;
    }
  }

  /** Ends the turn and reports the billable duration. */
  async stop(): Promise<void> {
    const seconds = this.startedAt
      ? Math.round((Date.now() - this.startedAt) / 1000)
      : 0;
    const tokens = this.totalTokens;

    this.startedAt = 0;
    this.totalTokens = 0;
    this.teardownConnection();
    this.teardownMedia();

    if (this.state() !== 'error') this.state.set('idle');

    if (seconds > 0) {
      // Fire-and-forget: the user already released the dock, and a failed
      // accounting call must not surface as a voice error.
      try {
        await firstValueFrom(
          this.http.post(`${this.baseUrl}/session/close`, {
            duration_seconds: seconds,
            total_tokens: tokens,
          }),
        );
      } catch {
        /* quota reconciliation is best-effort */
      }
    }
  }

  // ── Connection ──────────────────────────────────────────────────────────

  private async requestGrant(): Promise<RealtimeSessionGrant> {
    const res = await firstValueFrom(
      this.http.post<ApiEnvelope<RealtimeSessionGrant>>(
        `${this.baseUrl}/session`,
        {},
      ),
    );
    return res.data;
  }

  private async connect(grant: RealtimeSessionGrant): Promise<void> {
    const pc = new RTCPeerConnection();
    this.pc = pc;

    // Model audio arrives as a remote track; an <audio> element is the only
    // thing that actually plays it.
    this.remoteAudio = new Audio();
    this.remoteAudio.autoplay = true;
    pc.ontrack = (event) => {
      if (this.remoteAudio) this.remoteAudio.srcObject = event.streams[0];
    };

    for (const track of this.micStream?.getAudioTracks() ?? []) {
      pc.addTrack(track, this.micStream!);
    }

    const channel = pc.createDataChannel('oai-events');
    this.channel = channel;
    channel.onopen = () => this.configureSession(grant);
    channel.onmessage = (event) => void this.onServerEvent(event);

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

  private async onServerEvent(event: MessageEvent): Promise<void> {
    let payload: RealtimeServerEvent;
    try {
      payload = JSON.parse(event.data as string) as RealtimeServerEvent;
    } catch {
      return;
    }

    switch (payload.type) {
      case 'input_audio_buffer.speech_started':
        this.state.set('listening');
        return;
      case 'response.created':
        this.state.set('thinking');
        return;
      case 'response.output_audio.delta':
        this.state.set('speaking');
        return;
      case 'response.done':
        await this.onResponseDone(payload);
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
   * permissions and refuses anything that mutates data.
   */
  private async onResponseDone(payload: RealtimeServerEvent): Promise<void> {
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
      const output = await this.bridgeToolCall(
        call.name!,
        call.arguments,
        call.call_id!,
      );
      this.send({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call.call_id,
          output,
        },
      });
    }

    // Nothing is spoken until the model is told to continue.
    this.send({ type: 'response.create' });
  }

  private async bridgeToolCall(
    name: string,
    rawArgs: string | undefined,
    callId: string,
  ): Promise<string> {
    let args: Record<string, unknown> = {};
    try {
      args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
    } catch {
      return JSON.stringify({ error: 'Argumentos inválidos' });
    }

    // UI commands are intercepted before the network hop: they act on this
    // browser's router and cart, and the server has neither. Navigating by
    // voice is the natural case for these, so they are published to the voice
    // catalog too — they just never leave the tab.
    if (this.uiCommands.handles(name)) {
      return this.uiCommands.execute(name, args);
    }

    try {
      const res = await firstValueFrom(
        this.http.post<ApiEnvelope<{ call_id: string; output: string }>>(
          `${this.baseUrl}/tool-call`,
          { name, arguments: args, call_id: callId },
        ),
      );
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
