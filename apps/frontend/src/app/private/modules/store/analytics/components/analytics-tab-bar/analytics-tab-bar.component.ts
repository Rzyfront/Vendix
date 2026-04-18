import {
  Component,
  input,
  signal,
  ElementRef,
  inject,
  afterNextRender,
  effect,
} from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { AnalyticsView } from '../../config/analytics-registry';

@Component({
  selector: 'app-analytics-tab-bar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IconComponent],
  templateUrl: './analytics-tab-bar.component.html',
  styleUrls: ['./analytics-tab-bar.component.scss'],
})
export class AnalyticsTabBarComponent {
  private elementRef = inject(ElementRef);
  private router = inject(Router);

  readonly tabs = input.required<AnalyticsView[]>();
  readonly showFadeLeft = signal(false);
  readonly showFadeRight = signal(false);

  private hasInitialized = false;

  constructor() {
    afterNextRender(() => {
      this.checkScroll();
      this.hasInitialized = true;
      this.scrollToActive();
    });
  }

  onScroll(event: Event): void {
    if (!this.hasInitialized) return;
    this.checkScroll();
  }

  private checkScroll(): void {
    const el = this.elementRef.nativeElement.querySelector('.tabs-container');
    if (!el) return;

    const { scrollLeft, scrollWidth, clientWidth } = el;
    this.showFadeLeft.set(scrollLeft > 0);
    this.showFadeRight.set(scrollLeft < scrollWidth - clientWidth - 1);
  }

  scrollToActive(): void {
    const el = this.elementRef.nativeElement.querySelector('.tab-button.active');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }

  trackByViewKey(index: number, tab: AnalyticsView): string {
    return tab.key;
  }

  isActive(route: string): boolean {
    return this.router.url.includes(route);
  }
}
