import { Injectable, signal } from '@angular/core';

/** Cross-channel interruption only; holds no approval, audio, token or transcript. */
@Injectable({ providedIn: 'root' })
export class VexiVoiceSafetyService {
  readonly epoch = signal(0);
  invalidate(): void {
    this.epoch.update((value) => value + 1);
  }
}
