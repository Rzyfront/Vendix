import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  SPEECH_CACHE_MAX_BYTES,
  SPEECH_CACHE_MAX_ENTRIES,
} from './vexi-speech.constants';

export interface CachedAudio {
  audioBase64: string;
  contentType: string;
}

/**
 * Everything that changes the audio for a given text.
 *
 * "Everything" is load-bearing, and `vol` is why. It was missing here while the
 * provider already honoured it, so raising the volume left the filler bank —
 * which lives in the never-evicted `pinned` tier and is skipped by
 * `warmFillers` once present — synthesized at the old gain forever. Every turn
 * would have opened quiet and continued loud, which is more audible than the
 * quiet volume that prompted the change. Any future parameter that reaches the
 * synthesizer has to be added here in the same commit.
 */
export interface SpeechCacheParams {
  model: string;
  voice: string;
  format: string;
  speed: number;
  vol: number;
  /**
   * F8 T49 — provider config of the catalog voice that reads this turn. Absent
   * on the fallback path (the TTS app's own config), and then it adds nothing
   * to the key, so entries created before the catalog existed stay valid.
   */
  configId?: number;
  /**
   * Provider name of the config that synthesizes (`ai_engine_configs.provider`).
   * Diagnostics only — never part of the cache key: `configId` already
   * identifies the provider, and the key must not move when a name is edited.
   */
  provider?: string;
}

interface CacheEntry {
  audio: CachedAudio;
  bytes: number;
}

/**
 * Synthesis cache for the fixed vocabulary — not for the answers.
 *
 * A cache keyed on arbitrary assistant prose has a hit rate of approximately
 * zero: no two answers about a business are the same sentence. What *does*
 * repeat is the small closed set — the fillers, "Listo", "¿Confirmás?" — and
 * for those the hit rate is near total. Sizing and eviction are tuned for that
 * shape rather than for a general-purpose LRU.
 *
 * Two tiers, because they have opposite lifetimes:
 *
 * - **pinned** holds the filler bank. Its entire value is being instant, so it
 *   must never be evictable: a filler that lost a race against LRU pressure
 *   would pay a full synthesis round-trip at exactly the moment the design
 *   promised zero.
 * - **entries** is a real LRU for incidental repeats, bounded by entry count
 *   *and* total bytes. Bytes matter on their own: 200 long answers at ~200 KB
 *   of mp3 each is 40 MB of resident audio, so an entry-only cap would let the
 *   cache grow by two orders of magnitude depending on segment length.
 */
@Injectable()
export class VexiSpeechCache {
  /** Insertion order IS the LRU order; a `get` re-inserts to refresh. */
  private readonly entries = new Map<string, CacheEntry>();
  private readonly pinned = new Map<string, CachedAudio>();
  private totalBytes = 0;

  /**
   * El separador es NUL porque no puede aparecer en el texto a hashear, así que
   * ningún par (texto, parámetro) puede fabricar la clave de otro.
   *
   * Se escribe con el escape `\0` y no con el byte crudo, que es lo que había
   * antes: un NUL literal vuelve el archivo binario para `grep` —deja de
   * encontrar cualquier línea de este archivo— y cualquier editor que limpie
   * NULs al guardar cambiaría TODAS las claves de caché sin que nadie lo note.
   * El carácter resultante es idéntico.
   */
  key(text: string, params: SpeechCacheParams): string {
    return createHash('sha1')
      .update(
        [
          text,
          params.model,
          params.voice,
          params.format,
          String(params.speed),
          String(params.vol),
          ...(params.configId ? [`config:${params.configId}`] : []),
        ].join('\0'),
      )
      .digest('hex');
  }

  get(key: string): CachedAudio | null {
    const fixed = this.pinned.get(key);
    if (fixed) return fixed;

    const entry = this.entries.get(key);
    if (!entry) return null;

    // Re-insert to move to the most-recent end of the iteration order.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.audio;
  }

  set(key: string, audio: CachedAudio): void {
    if (this.pinned.has(key)) return;

    const bytes = this.byteLength(audio);

    // A single entry larger than the whole budget would evict everything else
    // and still not fit; skip caching it rather than emptying the cache.
    if (bytes > SPEECH_CACHE_MAX_BYTES) return;

    const existing = this.entries.get(key);
    if (existing) {
      this.totalBytes -= existing.bytes;
      this.entries.delete(key);
    }

    this.entries.set(key, { audio, bytes });
    this.totalBytes += bytes;
    this.evictWhileOverBudget();
  }

  /** Adds an entry the LRU can never reclaim. Used only by the filler bank. */
  pin(key: string, audio: CachedAudio): void {
    const evicted = this.entries.get(key);
    if (evicted) {
      this.totalBytes -= evicted.bytes;
      this.entries.delete(key);
    }
    this.pinned.set(key, audio);
  }

  hasPinned(key: string): boolean {
    return this.pinned.has(key);
  }

  stats(): { entries: number; pinned: number; bytes: number } {
    return {
      entries: this.entries.size,
      pinned: this.pinned.size,
      bytes: this.totalBytes,
    };
  }

  private evictWhileOverBudget(): void {
    while (
      this.entries.size > SPEECH_CACHE_MAX_ENTRIES ||
      this.totalBytes > SPEECH_CACHE_MAX_BYTES
    ) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;

      const entry = this.entries.get(oldest.value);
      this.entries.delete(oldest.value);
      if (entry) this.totalBytes -= entry.bytes;
    }
  }

  private byteLength(audio: CachedAudio): number {
    // The base64 string is what is actually held in memory, so that is what is
    // measured — not the decoded audio it represents.
    return Buffer.byteLength(audio.audioBase64, 'utf8');
  }
}
