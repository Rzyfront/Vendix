import {
  ChangeDetectionStrategy,
  Component,
  ComponentRef,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  OutputEmitterRef,
  untracked,
  ViewContainerRef,
} from '@angular/core';
import type { Type } from '@angular/core';
import { outputToObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { VexBlockInteraction, VexUiBlock } from '../../models/vex.models';
import { resolveVexBlockComponent } from './vex-block-registry';

/**
 * Renders a block through the registry and forwards the `interaction` output
 * of interactive blocks (table selection, chart click) unchanged.
 */
@Component({
  selector: 'vendix-vex-block-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The block is inserted as a sibling; hiding the (empty) host keeps flex gaps intact.
  host: { class: 'hidden' },
  template: ``,
})
export class VexBlockHostComponent {
  private readonly container = inject(ViewContainerRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly block = input.required<VexUiBlock>();
  readonly interaction = output<VexBlockInteraction>();

  private ref: ComponentRef<unknown> | null = null;
  private current: Type<unknown> | null = null;

  constructor() {
    effect(() => {
      const block = this.block();
      const type = resolveVexBlockComponent(block.kind);
      untracked(() => this.render(type, block));
    });
    this.destroyRef.onDestroy(() => this.dispose());
  }

  private render(type: Type<unknown>, block: VexUiBlock): void {
    if (!this.ref || this.current !== type) {
      this.dispose();
      this.ref = this.container.createComponent(type);
      this.current = type;
      const emitter = (this.ref.instance as { interaction?: unknown })
        .interaction;
      if (emitter instanceof OutputEmitterRef) {
        outputToObservable(emitter as OutputEmitterRef<VexBlockInteraction>)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((value) => this.interaction.emit(value));
      }
    }
    this.ref.setInput('block', block);
  }

  private dispose(): void {
    this.ref?.destroy();
    this.ref = null;
    this.current = null;
    this.container.clear();
  }
}
