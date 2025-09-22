import { ApplicationRef, Injectable, Injector } from '@angular/core';
import { Overlay, OverlayConfig } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { DialogRef } from './dialog.ref';
import { DIALOG_CONFIG, DIALOG_DATA, DialogConfig } from './dialog.tokens';
import { ConfirmDialogComponent, ConfirmData } from './confirm-dialog.component';
import { PromptDialogComponent, PromptData } from './prompt-dialog.component';

@Injectable({ providedIn: 'root' })
export class DialogService {
  constructor(private overlay: Overlay, private injector: Injector, private appRef: ApplicationRef) {}

  open<T extends object>(component: any, config: DialogConfig = {}, data?: T): DialogRef<T> {
    const overlayRef = this.overlay.create(this.getOverlayConfig(config));

    const dialogRef = new DialogRef<T>(overlayRef, data);

    const portalInjector = Injector.create({
      providers: [
        { provide: DialogRef, useValue: dialogRef },
        { provide: DIALOG_CONFIG, useValue: config },
        { provide: DIALOG_DATA, useValue: data },
      ],
      parent: this.injector,
    });
    const portal = new ComponentPortal(component, null, portalInjector);
    overlayRef.attach(portal);

    if (config.closeOnBackdropClick !== false) {
      overlayRef.backdropClick().subscribe(() => dialogRef.close());
    }

    return dialogRef;
  }

  private getOverlayConfig(config: DialogConfig): OverlayConfig {
    return new OverlayConfig({
      hasBackdrop: config.hasBackdrop !== false,
      backdropClass: config.backdropClass || 'app-dialog-backdrop',
      panelClass: config.panelClass || 'app-dialog-panel',
      scrollStrategy: this.overlay.scrollStrategies.block(),
      positionStrategy: this.overlay.position().global().centerHorizontally().centerVertically(),
    });
  }

  confirm(data: ConfirmData, config: DialogConfig = {}): Promise<boolean> {
    const ref = this.open<ConfirmData>(ConfirmDialogComponent, { closeOnBackdropClick: true, ...config }, data);
    return new Promise<boolean>((resolve) => {
      ref.afterClosed$.subscribe((res) => resolve(!!res));
    });
  }

  prompt(data: PromptData, config: DialogConfig = {}): Promise<string | undefined> {
    const ref = this.open<PromptData>(PromptDialogComponent, { closeOnBackdropClick: true, ...config }, data) as DialogRef<PromptData, string | undefined>;
    return new Promise<string | undefined>((resolve) => {
      ref.afterClosed$.subscribe((res) => resolve(res as string | undefined));
    });
  }
}
