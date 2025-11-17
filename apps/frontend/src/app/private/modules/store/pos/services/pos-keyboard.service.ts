import { Injectable, ElementRef, NgZone, OnDestroy } from '@angular/core';
import { Subject, fromEvent } from 'rxjs';
import { filter, map, takeUntil, tap } from 'rxjs/operators';

export interface KeyboardShortcut {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  action: () => void;
  description: string;
  enabled?: boolean;
}

export interface ShortcutGroup {
  name: string;
  shortcuts: KeyboardShortcut[];
}

@Injectable({
  providedIn: 'root',
})
export class PosKeyboardService implements OnDestroy {
  private shortcuts: Map<string, KeyboardShortcut> = new Map();
  private shortcutGroups: ShortcutGroup[] = [];
  private destroy$ = new Subject<void>();
  private isEnabled: boolean = true;

  constructor(private ngZone: NgZone) {}

  registerShortcut(shortcut: KeyboardShortcut): void {
    const key = this.generateKey(shortcut);
    this.shortcuts.set(key, { ...shortcut, enabled: true });
  }

  registerShortcutGroup(group: ShortcutGroup): void {
    this.shortcutGroups.push(group);
    group.shortcuts.forEach((shortcut) => this.registerShortcut(shortcut));
  }

  unregisterShortcut(
    key: string,
    ctrlKey = false,
    altKey = false,
    shiftKey = false,
  ): void {
    const shortcutKey = this.generateKey({
      key: key,
      ctrlKey,
      altKey,
      shiftKey,
    } as KeyboardShortcut);
    this.shortcuts.delete(shortcutKey);
  }

  enableShortcuts(element?: ElementRef): void {
    this.isEnabled = true;

    this.ngZone.runOutsideAngular(() => {
      const target = element?.nativeElement || document;

      fromEvent<KeyboardEvent>(target, 'keydown')
        .pipe(
          filter(() => this.isEnabled),
          map((event: KeyboardEvent) => ({
            event,
            shortcut: this.findMatchingShortcut(event),
          })),
          filter(({ shortcut }) => !!shortcut && shortcut.enabled !== false),
          tap(({ event }) => {
            event.preventDefault();
            event.stopPropagation();
          }),
          takeUntil(this.destroy$),
        )
        .subscribe(({ shortcut }) => {
          if (shortcut) {
            this.ngZone.run(() => shortcut.action());
          }
        });
    });
  }

  disableShortcuts(): void {
    this.isEnabled = false;
  }

  enableShortcut(
    key: string,
    ctrlKey = false,
    altKey = false,
    shiftKey = false,
  ): void {
    const shortcutKey = this.generateKey({
      key: key,
      ctrlKey,
      altKey,
      shiftKey,
    } as KeyboardShortcut);
    const shortcut = this.shortcuts.get(shortcutKey);
    if (shortcut) {
      shortcut.enabled = true;
    }
  }

  disableShortcut(
    key: string,
    ctrlKey = false,
    altKey = false,
    shiftKey = false,
  ): void {
    const shortcutKey = this.generateKey({
      key: key,
      ctrlKey,
      altKey,
      shiftKey,
    } as KeyboardShortcut);
    const shortcut = this.shortcuts.get(shortcutKey);
    if (shortcut) {
      shortcut.enabled = false;
    }
  }

  getShortcutGroups(): ShortcutGroup[] {
    return this.shortcutGroups;
  }

  getAllShortcuts(): KeyboardShortcut[] {
    return Array.from(this.shortcuts.values());
  }

  getShortcutsHelp(): { key: string; description: string }[] {
    return this.getAllShortcuts()
      .filter((shortcut) => shortcut.enabled !== false)
      .map((shortcut) => ({
        key: this.formatShortcutKey(shortcut),
        description: shortcut.description,
      }));
  }

  private generateKey(shortcut: KeyboardShortcut): string {
    const parts: string[] = [];
    if (shortcut.ctrlKey) parts.push('ctrl');
    if (shortcut.altKey) parts.push('alt');
    if (shortcut.shiftKey) parts.push('shift');
    parts.push(shortcut.key.toLowerCase());
    return parts.join('+');
  }

  private findMatchingShortcut(
    event: KeyboardEvent,
  ): KeyboardShortcut | undefined {
    const matchingShortcuts = Array.from(this.shortcuts.values()).filter(
      (shortcut) => {
        if (shortcut.enabled === false) return false;

        return (
          shortcut.key.toLowerCase() === event.key.toLowerCase() &&
          !!shortcut.ctrlKey === event.ctrlKey &&
          !!shortcut.altKey === event.altKey &&
          !!shortcut.shiftKey === event.shiftKey
        );
      },
    );

    return matchingShortcuts[0];
  }

  private formatShortcutKey(shortcut: KeyboardShortcut): string {
    const parts: string[] = [];
    if (shortcut.ctrlKey) parts.push('Ctrl');
    if (shortcut.altKey) parts.push('Alt');
    if (shortcut.shiftKey) parts.push('Shift');
    parts.push(shortcut.key.toUpperCase());
    return parts.join(' + ');
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
