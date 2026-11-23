import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { readMonitorConfig } from './platform-alert-policy';

const TELEGRAM_API = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 5_000;
const RATE_KEY_PREFIX = 'monitor:telegram:minute:';
const SUPPRESSED_KEY = 'monitor:telegram:suppressed';
/** Telegram corta los mensajes a 4096 caracteres. */
const TELEGRAM_MAX_TEXT = 4_000;

export interface TelegramSendOptions {
  /** Responde al mensaje original del episodio (aviso de resolución). */
  replyToMessageId?: string | null;
}

/**
 * Envía los avisos del bot de monitoreo al chat del equipo (QUI-1010).
 *
 * Credenciales SOLO por entorno: `MONITOR_TELEGRAM_BOT_TOKEN` y
 * `MONITOR_TELEGRAM_CHAT_ID`. Sin ellas el canal queda apagado y el bot sigue
 * registrando alertas y abriendo tickets. El token viaja en la URL de la API de
 * Telegram, por eso ningún log imprime la URL ni el error crudo de `fetch`.
 *
 * Nunca lanza: un aviso que no sale no puede tumbar la petición o el job que
 * falló. Tope de `MONITOR_TELEGRAM_MAX_PER_MINUTE` mensajes por minuto (Redis,
 * compartido entre procesos); los que se pasan se cuentan y el siguiente
 * mensaje lo informa.
 */
@Injectable()
export class TelegramNotifierService {
  private readonly logger = new Logger(TelegramNotifierService.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  isEnabled(): boolean {
    return this.token() !== null && this.chatId() !== null;
  }

  /** `message_id` del mensaje enviado, o `null` si no salió. */
  async send(html: string, options: TelegramSendOptions = {}): Promise<string | null> {
    if (!this.isEnabled()) return null;
    if (!(await this.takeRateSlot())) return null;
    const suppressed = await this.takeSuppressedCount();
    const prefix =
      suppressed > 0
        ? `<i>(+${suppressed} avisos omitidos por límite de envío; ver Superadmin → Monitoreo → Alertas)</i>\n\n`
        : '';
    const result = await this.call('sendMessage', {
      chat_id: this.chatId(),
      text: truncate(prefix + html),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(options.replyToMessageId
        ? {
            reply_to_message_id: Number(options.replyToMessageId),
            allow_sending_without_reply: true,
          }
        : {}),
    });
    const id = (result as { message_id?: unknown } | null)?.message_id;
    return typeof id === 'number' || typeof id === 'string' ? String(id) : null;
  }

  /** Reescribe un mensaje ya enviado (conteo de repeticiones). */
  async edit(messageId: string, html: string): Promise<boolean> {
    if (!this.isEnabled()) return false;
    const result = await this.call(
      'editMessageText',
      {
        chat_id: this.chatId(),
        message_id: Number(messageId),
        text: truncate(html),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      },
      // Sin cambios de texto Telegram responde 400 «message is not modified».
      /message is not modified/i,
    );
    return result !== null;
  }

  private token(): string | null {
    const value = (this.config.get<string>('MONITOR_TELEGRAM_BOT_TOKEN') ?? '').trim();
    return value || null;
  }

  private chatId(): string | null {
    const value = (this.config.get<string>('MONITOR_TELEGRAM_CHAT_ID') ?? '').trim();
    return value || null;
  }

  private async call(
    method: string,
    body: Record<string, unknown>,
    tolerated?: RegExp,
  ): Promise<Record<string, unknown> | true | null> {
    try {
      const response = await fetch(`${TELEGRAM_API}/bot${this.token()}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        result?: unknown;
        description?: string;
      } | null;
      if (response.ok && payload?.ok) {
        return payload.result && typeof payload.result === 'object'
          ? (payload.result as Record<string, unknown>)
          : true;
      }
      const description = String(payload?.description ?? '').slice(0, 200);
      if (tolerated?.test(description)) return true;
      this.logger.warn(
        `Telegram ${method} rechazado (HTTP ${response.status}): ${description}`,
      );
      return null;
    } catch (error) {
      // Sin el mensaje crudo: `fetch` puede citar la URL, que lleva el token.
      this.logger.warn(
        `Telegram ${method} no respondió (${(error as Error)?.name ?? 'Error'})`,
      );
      return null;
    }
  }

  /** `true` si queda cupo este minuto. Si Redis falla, envía igual. */
  private async takeRateSlot(): Promise<boolean> {
    const max = readMonitorConfig(this.config).telegramMaxPerMinute;
    const key = `${RATE_KEY_PREFIX}${Math.floor(Date.now() / 60_000)}`;
    try {
      const used = await this.redis.incr(key);
      if (used === 1) await this.redis.expire(key, 120);
      if (used <= max) return true;
      await this.redis.incr(SUPPRESSED_KEY);
      await this.redis.expire(SUPPRESSED_KEY, 24 * 60 * 60);
      return false;
    } catch {
      return true;
    }
  }

  private async takeSuppressedCount(): Promise<number> {
    try {
      const value = await this.redis.getdel(SUPPRESSED_KEY);
      const count = Number(value ?? 0);
      return Number.isFinite(count) ? count : 0;
    } catch {
      return 0;
    }
  }
}

function truncate(text: string): string {
  return text.length > TELEGRAM_MAX_TEXT
    ? `${text.slice(0, TELEGRAM_MAX_TEXT - 1)}…`
    : text;
}
