import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';

import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { LandingOfferComponent } from '../../../landing-page/landing-offer.component';
import type { LandingOffer } from '../../../landing-page/landing-page.service';
import { BlockRendererComponent } from '../../blocks/block-renderer/block-renderer.component';
import { ContactBlockComponent } from '../../blocks/contact-block.component';
import type { CrmLandingDocument } from '../../blocks/landing-blocks.types';
import type { CrmContactPayload } from '../../services/crm-landing.service';
import {
  IDLE_LEAD_STATE,
  LandingLeadFormComponent,
  LandingLeadState,
} from './landing-lead-form.component';
import { ensureLandingFonts, landingStyleVars, visibleBlocks, whatsappLink } from './landing-view.util';

/**
 * F6-A — the body of a published landing, from its block document. The SAME
 * component renders the public page (`StoreLandingComponent`) and the editor
 * preview (`LandingPreviewFrameComponent`), so what the owner sees is what
 * gets published.
 *
 * - Hidden sections are skipped.
 * - On the landing's own domain (`offer` set) the offer shows after the
 *   first section and the lead form is always there.
 * - `preview`: the lead form is inert, the floating WhatsApp button sticks to
 *   the frame instead of the window, and clicking a section selects it.
 */
@Component({
  selector: 'app-landing-document-view',
  standalone: true,
  imports: [
    BlockRendererComponent,
    ContactBlockComponent,
    IconComponent,
    LandingLeadFormComponent,
    LandingOfferComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="crm-landing" [style]="styleVars()"
         [class.crm-landing--font-heading]="hasHeadingFont()"
         [class.crm-landing--font-body]="hasBodyFont()">
      @for (block of blocks(); track block.id; let i = $index) {
        <div class="crm-landing-section" [attr.data-block-id]="block.id"
             [class.crm-landing-section--selectable]="preview()"
             [class.crm-landing-section--selected]="preview() && selectedBlockId() === block.id"
             (click)="preview() && blockSelect.emit(block.id)">
          @if (block.type === 'contact') {
            <app-contact-block [props]="block.props" (ctaClick)="scrollToForm()" />
            <app-landing-lead-form [state]="leadState()" [inert]="preview()" (send)="leadSubmit.emit($event)" />
          } @else {
            <app-block-renderer
              [block]="block"
              [baseUrl]="ecommerceBaseUrl()"
              (ctaClick)="ctaClick.emit()"
              (secondaryCtaClick)="scrollToForm()"
            />
          }
        </div>
        @if (i === 0 && offer(); as currentOffer) {
          <app-landing-offer [offer]="currentOffer" (interested)="scrollToForm()" />
        }
      }

      <!-- Landing on its own domain: the lead form is always there. -->
      @if (offer() && !hasContactBlock()) {
        <app-landing-lead-form [state]="leadState()" [inert]="preview()" (send)="leadSubmit.emit($event)" />
      }

      @if (whatsappFloat()) {
        <div [class.crm-floating-dock]="preview()">
          @if (whatsappUrl(); as waUrl) {
            <a [href]="waUrl" target="_blank" rel="noopener noreferrer"
               class="crm-floating-whatsapp z-50 inline-flex items-center gap-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-4 py-3 rounded-full shadow-2xl transition-all duration-300 hover:scale-105 cursor-pointer"
               [class.fixed]="!preview()" [class.bottom-6]="!preview()" [class.right-6]="!preview()">
              <app-icon name="headphones" [size]="18" color="white" />
              <span class="text-xs sm:text-sm font-bold">¿Dudas? Chatea en vivo</span>
            </a>
          } @else {
            <a (click)="scrollToForm()"
               class="crm-floating-whatsapp z-50 inline-flex items-center gap-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-4 py-3 rounded-full shadow-2xl transition-all duration-300 hover:scale-105 cursor-pointer"
               [class.fixed]="!preview()" [class.bottom-6]="!preview()" [class.right-6]="!preview()">
              <app-icon name="headphones" [size]="18" color="white" />
              <span class="text-xs sm:text-sm font-bold">¿Dudas? Chatea en vivo</span>
            </a>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      .crm-landing { min-height: 40vh; }
      .crm-landing--font-body { font-family: var(--crm-font-body); }
      .crm-landing--font-heading :is(h1, h2, h3, h4) { font-family: var(--crm-font-heading); }
      .crm-floating-whatsapp { box-shadow: 0 12px 24px -4px rgba(16, 185, 129, 0.45); }
      .crm-floating-dock {
        position: sticky;
        bottom: 1.5rem;
        display: flex;
        justify-content: flex-end;
        padding-right: 1.5rem;
        pointer-events: none;
      }
      .crm-floating-dock > a { pointer-events: auto; }
      .crm-landing-section--selectable { position: relative; cursor: pointer; }
      .crm-landing-section--selectable:hover { outline: 2px dashed rgba(37, 99, 235, 0.45); outline-offset: -2px; }
      .crm-landing-section--selected,
      .crm-landing-section--selected:hover { outline: 2px solid #2563eb; outline-offset: -2px; }
    `,
  ],
})
export class LandingDocumentViewComponent {
  private readonly doc = inject(DOCUMENT);

  readonly document = input.required<CrmLandingDocument>();
  /** Base of the store's online shop, for product deep links. */
  readonly ecommerceBaseUrl = input<string | null>(null);
  /** The offer, only on the landing's own domain; `null` on `{tienda}-store`. */
  readonly offer = input<LandingOffer | null>(null);
  readonly leadState = input<LandingLeadState>(IDLE_LEAD_STATE);
  /** Editor preview mode (see class doc). */
  readonly preview = input(false);
  readonly selectedBlockId = input<string | null>(null);

  readonly ctaClick = output<void>();
  readonly leadSubmit = output<CrmContactPayload>();
  readonly blockSelect = output<string>();

  readonly blocks = computed(() => visibleBlocks(this.document()));
  readonly hasContactBlock = computed(() => this.blocks().some((b) => b.type === 'contact'));
  readonly styleVars = computed(() => landingStyleVars(this.document()));
  readonly hasHeadingFont = computed(() => '--crm-font-heading' in this.styleVars());
  readonly hasBodyFont = computed(() => '--crm-font-body' in this.styleVars());
  readonly whatsappFloat = computed(() => this.document().theme?.enable_whatsapp_float ?? true);
  readonly whatsappUrl = computed(() => whatsappLink(this.document()));

  constructor() {
    effect(() => ensureLandingFonts(this.doc, this.document()));
  }

  scrollToForm(): void {
    this.doc.getElementById('contacto')?.scrollIntoView({ behavior: 'smooth' });
  }
}
