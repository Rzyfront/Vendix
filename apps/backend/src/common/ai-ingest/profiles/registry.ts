import { Injectable } from '@nestjs/common';
import type { IngestProfile, IngestProfileKey } from './ingest-profile.interface';

/**
 * Profiles by entity. Domains register theirs in `onModuleInit` (same as the
 * ai-scan handlers); registering a key twice is a wiring bug and throws.
 */
@Injectable()
export class IngestProfileRegistry {
  private readonly profiles = new Map<IngestProfileKey, IngestProfile<unknown>>();

  register<T>(profile: IngestProfile<T>): void {
    if (this.profiles.has(profile.key)) {
      throw new Error(`ai-ingest profile "${profile.key}" already registered`);
    }
    this.profiles.set(profile.key, profile as IngestProfile<unknown>);
  }

  get<T>(key: IngestProfileKey): IngestProfile<T> | undefined {
    return this.profiles.get(key) as IngestProfile<T> | undefined;
  }

  has(key: IngestProfileKey): boolean {
    return this.profiles.has(key);
  }
}
