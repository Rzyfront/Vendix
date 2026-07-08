import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

import { IconComponent } from '../../../../../../shared/components/index';

interface BeTick {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface BeMajorTick {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lx: number;
  ly: number;
  label: string;
}

interface BeStatus {
  key: 'none' | 'ok' | 'warn' | 'crit';
  label: string;
  color: string;
  icon: string;
}

/**
 * Presentational HERO gauge for the break-even ratio (punto de equilibrio).
 *
 * Renders a 270° speedometer-style SVG gauge with three colored zones
 * (green / yellow / red), a fine needle, and a center hero overlay with the
 * ratio value and a status chip. Pure presentation: no services, no business
 * logic — all geometry is derived with `computed()` from a single signal input.
 *
 * Geometry contract (compass angles, 0° = up, clockwise):
 *   angle(v) = 225 + (clamp(v, 0, 150) / 150) * 270
 *   v=0   → 225° (bottom-left start)
 *   v=75  → 360°/0° (top center)
 *   v=150 → 135° (bottom-right end)
 * Zones: green 225°→351° (0-70%), yellow 351°→27° (70-90%), red 27°→135° (90-150%).
 *
 * Anti-CD-bug rule: transitions ONLY `transform` (needle) — never `transition: all`
 * (a known repo bug that restarts animations under continuous change detection).
 */
@Component({
  selector: 'app-break-even-gauge',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './break-even-gauge.component.css',
  template: `
    <div class="be-hero" [style.box-shadow]="heroShadow()">
      <div class="be-gauge">
        <svg
          class="be-gauge-svg"
          viewBox="0 0 200 200"
          role="img"
          [attr.aria-label]="ariaLabel()"
        >
          <defs>
            <linearGradient id="beGradientGreen" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color: var(--color-success); stop-opacity: 0.65" />
              <stop offset="100%" style="stop-color: var(--color-success); stop-opacity: 1" />
            </linearGradient>
            <linearGradient id="beGradientYellow" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color: #eab308; stop-opacity: 0.65" />
              <stop offset="100%" style="stop-color: #eab308; stop-opacity: 1" />
            </linearGradient>
            <linearGradient id="beGradientRed" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color: var(--color-error); stop-opacity: 0.65" />
              <stop offset="100%" style="stop-color: var(--color-error); stop-opacity: 1" />
            </linearGradient>
          </defs>

          <!-- Decorative bezel ticks (full ring, like aforo) -->
          <g class="be-ticks" aria-hidden="true">
            @for (t of ticks; track $index) {
              <line
                [attr.x1]="t.x1"
                [attr.y1]="t.y1"
                [attr.x2]="t.x2"
                [attr.y2]="t.y2"
              />
            }
          </g>

          <!-- Background track (270° arc, 225° → 135°) -->
          <path class="be-track" [attr.d]="trackPath" />

          <!-- Zone arcs -->
          <path
            class="be-zone"
            [attr.d]="greenPath"
            stroke="url(#beGradientGreen)"
          />
          <path
            class="be-zone"
            [attr.d]="yellowPath"
            stroke="url(#beGradientYellow)"
          />
          <path
            class="be-zone"
            [attr.d]="redPath"
            stroke="url(#beGradientRed)"
          />

          <!-- Major ticks + labels (0%, 70%, 90%, 150%) -->
          <g class="be-majors" aria-hidden="true">
            @for (m of majorTicks; track m.label) {
              <line
                [attr.x1]="m.x1"
                [attr.y1]="m.y1"
                [attr.x2]="m.x2"
                [attr.y2]="m.y2"
              />
              <text [attr.x]="m.lx" [attr.y]="m.ly">{{ m.label }}</text>
            }
          </g>

          <!-- Needle (hidden when no data) -->
          @if (hasData()) {
            <g
              class="be-needle"
              [style.transform]="'rotate(' + needleRotate() + 'deg)'"
            >
              <path d="M 100 100 L 103 97.5 L 170 100 L 103 102.5 Z" />
            </g>
          }

          <!-- Center pivot (rivet) -->
          <circle class="be-pivot" cx="100" cy="100" r="5" />
          <circle class="be-pivot-inner" cx="100" cy="100" r="2" />

          <!-- Hero value (rendered as SVG text inside the bottom gap) -->
          <text class="be-svg-value" x="100" y="178" text-anchor="middle" dominant-baseline="central">
            @if (hasData()) {
              {{ clamped().toFixed(1) }}<tspan class="be-svg-value-suffix">%</tspan>
            } @else {
              —
            }
          </text>
        </svg>
      </div>
      <span
        class="be-chip"
        [class.be-chip--ok]="status().key === 'ok'"
        [class.be-chip--warn]="status().key === 'warn'"
        [class.be-chip--crit]="status().key === 'crit'"
        [class.be-chip--none]="status().key === 'none'"
      >
        <app-icon [name]="status().icon" [size]="13" />
        {{ status().label }}
      </span>
    </div>
  `,
})
export class BreakEvenGaugeComponent {
  // --- Input (Angular 20 signal API) ---
  readonly ratio = input<number>(0);

  // --- Geometry constants ---
  readonly cx = 100;
  readonly cy = 100;
  readonly R = 82;

  // --- Static SVG paths (computed once at construction) ---
  readonly trackPath = this.arcPath(225, 135, this.R, 1);
  readonly greenPath = this.arcPath(225, 351, this.R, 0);
  readonly yellowPath = this.arcPath(351, 27, this.R, 0);
  readonly redPath = this.arcPath(27, 135, this.R, 0);

  readonly ticks = this.buildTicks();
  readonly majorTicks = this.buildMajorTicks();

  // --- Derived state (all signal-based, no mutations) ---
  readonly clamped = computed(() => Math.max(0, Math.min(150, this.ratio() ?? 0)));
  readonly hasData = computed(() => (this.ratio() ?? 0) > 0);

  readonly status = computed<BeStatus>(() => {
    const r = this.clamped();
    if (!this.ratio()) {
      return {
        key: 'none',
        label: 'Sin datos',
        color: 'var(--color-text-secondary)',
        icon: 'ban',
      };
    }
    if (r < 70) {
      return {
        key: 'ok',
        label: 'Saludable',
        color: 'var(--color-success)',
        icon: 'trending-up',
      };
    }
    if (r < 90) {
      return {
        key: 'warn',
        label: 'Ajustado',
        color: '#eab308',
        icon: 'alert-triangle',
      };
    }
    return {
      key: 'crit',
      label: 'Crítico',
      color: 'var(--color-error)',
      icon: 'alert-octagon',
    };
  });

  /** SVG/CSS rotation for the needle (compass → screen rotation). */
  readonly needleRotate = computed(() => this.angle(this.clamped()) - 90);

  /** Halo ring around the hero when status is critical. */
  readonly heroShadow = computed(() =>
    this.status().key === 'crit' ? '0 0 0 1.5px var(--color-error)' : null,
  );

  /** Accessible description for screen readers. */
  readonly ariaLabel = computed(() => {
    if (!this.hasData()) return `Punto de equilibrio: sin datos — ${this.status().label}`;
    return `Punto de equilibrio: ${this.clamped().toFixed(1)}% — ${this.status().label}`;
  });

  // --- Geometry helpers ---

  /** Maps a value 0..150 to a compass angle 225°..495° (i.e. 225°..135° wrapping). */
  private angle(v: number): number {
    return 225 + (Math.max(0, Math.min(150, v)) / 150) * 270;
  }

  /** Converts a compass angle + radius to an SVG point. */
  private polar(a: number, r: number): [number, number] {
    const rad = (a * Math.PI) / 180;
    return [this.cx + r * Math.sin(rad), this.cy - r * Math.cos(rad)];
  }

  /** Builds an SVG arc path (sweep-flag = 1, i.e. clockwise on screen). */
  private arcPath(start: number, end: number, r: number, largeArc: number): string {
    const [x1, y1] = this.polar(start, r);
    const [x2, y2] = this.polar(end, r);
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }

  /** 48 decorative bezel ticks forming a full ring (inner r=66, outer r=70). */
  private buildTicks(): BeTick[] {
    const count = 48;
    const inner = 66;
    const outer = 70;
    return Array.from({ length: count }, (_, i) => {
      const theta = (i / count) * 360;
      const [x1, y1] = this.polar(theta, inner);
      const [x2, y2] = this.polar(theta, outer);
      return {
        x1: +x1.toFixed(2),
        y1: +y1.toFixed(2),
        x2: +x2.toFixed(2),
        y2: +y2.toFixed(2),
      };
    });
  }

  /** 4 major ticks with labels at the zone boundaries (0%, 70%, 90%, 150%). */
  private buildMajorTicks(): BeMajorTick[] {
    const majors = [
      { angle: 225, label: '0%' },
      { angle: 351, label: '70%' },
      { angle: 27, label: '90%' },
      { angle: 135, label: '150%' },
    ];
    return majors.map(({ angle, label }) => {
      const [x1, y1] = this.polar(angle, 58);
      const [x2, y2] = this.polar(angle, 64);
      const [lx, ly] = this.polar(angle, 48);
      return {
        x1: +x1.toFixed(2),
        y1: +y1.toFixed(2),
        x2: +x2.toFixed(2),
        y2: +y2.toFixed(2),
        lx: +lx.toFixed(2),
        ly: +ly.toFixed(2),
        label,
      };
    });
  }
}