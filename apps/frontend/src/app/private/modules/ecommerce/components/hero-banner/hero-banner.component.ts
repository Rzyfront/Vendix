import { Component, ChangeDetectionStrategy, inject, input, DestroyRef } from '@angular/core';

import { RouterModule, Router } from '@angular/router';
import { TenantFacade } from '../../../../../../app/core/store';

export interface HeroBannerConfig {
  title: string;
  subtitle: string;
  image_url?: string;
  background_color?: string;
  text_color?: string;
  cta_text: string;
  cta_link: string;
  show_overlay?: boolean;
}

export interface SliderPhoto {
  url: string | null;
  title: string;
  caption: string;
}

@Component({
  selector: 'app-hero-banner',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './hero-banner.component.html',
  styleUrls: ['./hero-banner.component.scss'],
})
export class HeroBannerComponent {
  readonly banner = input<Partial<HeroBannerConfig>>({});
  readonly slides = input<SliderPhoto[]>([]);
  readonly class = input<string>('');

  current_slide_index = 0;
  private auto_play_interval: any;

  private domain_service = inject(TenantFacade);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  constructor() {
    if (this.slides().length > 1) {
      this.startAutoPlay();
    }
    this.destroyRef.onDestroy(() => this.stopAutoPlay());
  }

  private startAutoPlay(): void {
    this.auto_play_interval = setInterval(() => {
      this.nextSlide();
    }, 5000);
  }

  private stopAutoPlay(): void {
    if (this.auto_play_interval) {
      clearInterval(this.auto_play_interval);
    }
  }

  nextSlide(): void {
    this.current_slide_index =
      (this.current_slide_index + 1) % this.slides.length;
  }

  setSlide(index: number): void {
    this.current_slide_index = index;
    this.stopAutoPlay();
    this.startAutoPlay();
  }

  get banner_config(): HeroBannerConfig {
    const tenantConfig = this.domain_service.getCurrentTenantConfig();
    const current_slide = this.slides()[this.current_slide_index];
    const bannerVal = this.banner();

    return {
      title:
        current_slide?.title ||
        bannerVal.title ||
        'Bienvenido a nuestra tienda',
      subtitle:
        current_slide?.caption ||
        bannerVal.subtitle ||
        'Encuentra los mejores productos al mejor precio',
      image_url: current_slide?.url || bannerVal.image_url || undefined,
      background_color:
        bannerVal.background_color ||
        tenantConfig?.branding?.colors?.primary ||
        'var(--color-primary)',
      text_color: bannerVal.text_color || '#ffffff',
      cta_text: bannerVal.cta_text || 'Ver productos',
      cta_link: bannerVal.cta_link || '/catalog',
      show_overlay: bannerVal.show_overlay ?? true,
    };
  }

  onCtaClick(): void {
    this.router.navigate([this.banner_config.cta_link]);
  }
}
