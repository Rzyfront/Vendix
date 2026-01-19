import { Component, Input, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
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
  imports: [CommonModule, RouterModule],
  templateUrl: './hero-banner.component.html',
  styleUrls: ['./hero-banner.component.scss'],
})
export class HeroBannerComponent implements OnInit, OnDestroy {
  @Input() banner: Partial<HeroBannerConfig> = {};
  @Input() slides: SliderPhoto[] = [];
  @Input() class = '';

  current_slide_index = 0;
  private auto_play_interval: any;

  private domain_service = inject(TenantFacade);
  private router = inject(Router);

  ngOnInit(): void {
    if (this.slides.length > 1) {
      this.startAutoPlay();
    }
  }

  ngOnDestroy(): void {
    this.stopAutoPlay();
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

  prevSlide(): void {
    this.current_slide_index =
      (this.current_slide_index - 1 + this.slides.length) % this.slides.length;
  }

  setSlide(index: number): void {
    this.current_slide_index = index;
    this.stopAutoPlay();
    this.startAutoPlay();
  }

  get banner_config(): HeroBannerConfig {
    const tenantConfig = this.domain_service.getCurrentTenantConfig();
    const current_slide = this.slides[this.current_slide_index];

    return {
      title:
        current_slide?.title ||
        this.banner.title ||
        'Bienvenido a nuestra tienda',
      subtitle:
        current_slide?.caption ||
        this.banner.subtitle ||
        'Encuentra los mejores productos al mejor precio',
      image_url: current_slide?.url || this.banner.image_url || undefined,
      background_color:
        this.banner.background_color ||
        tenantConfig?.branding?.colors?.primary ||
        'var(--color-primary)',
      text_color: this.banner.text_color || '#ffffff',
      cta_text: this.banner.cta_text || 'Ver productos',
      cta_link: this.banner.cta_link || '/catalog',
      show_overlay: this.banner.show_overlay ?? true,
    };
  }

  onCtaClick(): void {
    this.router.navigate([this.banner_config.cta_link]);
  }
}
