import type { Signal } from '@angular/core';

/**
 * Contract of an app's settings panel inside its view `/admin/apps/:kind`
 * (apps-vistas-f1 S3/S6). The panels are the former settings modals, now
 * rendered inline; the view header drives publishing through this contract,
 * so no app is managed from a modal.
 */
export interface AppSettingsPanel {
  readonly loading: Signal<boolean>;
  readonly busy: Signal<boolean>;
  /** The panel has what publishing needs (e.g. a featured product). */
  readonly canPublish: Signal<boolean>;
  /** There is a publication of this app to take down. */
  readonly canUnpublish: Signal<boolean>;
  /** Saves the panel and publishes it (or republishes it). */
  publish(): void;
  unpublish(): void;
  /** Reloads the panel (after the view header switched the app on or off). */
  load(): void;
}
