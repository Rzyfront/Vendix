import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class NotificationSoundPlayerService {
  private cache = new Map<string, HTMLAudioElement>();
  private lastPlayedAt = 0;
  private readonly THROTTLE_MS = 300;

  /**
   * Preload an audio element for a given sound, keyed by id.
   * Subsequent play() calls reuse the cached instance.
   */
  preload(soundId: string, url: string): HTMLAudioElement {
    let audio = this.cache.get(soundId);
    if (!audio) {
      audio = new Audio(url);
      audio.preload = 'auto';
      this.cache.set(soundId, audio);
    }
    return audio;
  }

  /**
   * Play a cached sound at the given volume (0-100). Silently swallows
   * autoplay errors (NotAllowedError) — first user interaction unlocks audio.
   */
  async play(soundId: string, url: string, volume: number): Promise<void> {
    // Throttle to prevent overlapping plays when many notifications arrive at once
    const now = Date.now();
    if (now - this.lastPlayedAt < this.THROTTLE_MS) return;
    this.lastPlayedAt = now;

    const audio = this.preload(soundId, url);
    audio.volume = Math.max(0, Math.min(1, volume / 100));

    try {
      audio.currentTime = 0;
      await audio.play();
    } catch {
      // Autoplay blocked or audio failed — ignore silently
    }
  }

  /** Clear all cached audio elements (e.g., on logout). */
  clearCache(): void {
    this.cache.forEach((audio) => {
      audio.pause();
      audio.src = '';
    });
    this.cache.clear();
  }
}
