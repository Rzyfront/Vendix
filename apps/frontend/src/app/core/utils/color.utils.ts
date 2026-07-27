export class ColorUtils {
    /**
     * Convierte un color HEX a RGB
     * @param hex Color en formato HEX (ej: #FFFFFF o #FFF)
     * @returns Objeto con valores r, g, b o null si es inválido
     */
    static hexToRgb(hex: string): { r: number; g: number; b: number } | null {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (result) {
            return {
                r: parseInt(result[1], 16),
                g: parseInt(result[2], 16),
                b: parseInt(result[3], 16),
            };
        }

        // Soporte para short hex (#FFF)
        const shortResult = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(hex);
        if (shortResult) {
            return {
                r: parseInt(shortResult[1] + shortResult[1], 16),
                g: parseInt(shortResult[2] + shortResult[2], 16),
                b: parseInt(shortResult[3] + shortResult[3], 16),
            };
        }

        return null;
    }

    /**
     * Convierte un color HEX a RGBA string
     * @param hex Color en formato HEX
     * @param alpha Opacidad (0-1)
     */
    static hexToRgba(hex: string, alpha: number): string {
        const rgb = this.hexToRgb(hex);
        if (!rgb) return hex;
        return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
    }

    /**
     * Mezcla dos colores HEX dado un porcentaje
     * @param color1 Color base
     * @param color2 Color a mezclar
     * @param weight Peso del color2 (0-1). 1 es 100% color2.
     */
    static mixColors(color1: string, color2: string, weight: number): string {
        const rgb1 = this.hexToRgb(color1);
        const rgb2 = this.hexToRgb(color2);

        if (!rgb1 || !rgb2) return color1;

        const w = Math.min(Math.max(weight, 0), 1);
        const w1 = 1 - w;

        const r = Math.round(rgb1.r * w1 + rgb2.r * w);
        const g = Math.round(rgb1.g * w1 + rgb2.g * w);
        const b = Math.round(rgb1.b * w1 + rgb2.b * w);

        return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()}`;
    }

    /**
     * Convierte HEX a HSL.
     * @returns { h: 0-360, s: 0-100, l: 0-100 } o null si el hex es inválido.
     */
    static hexToHsl(hex: string): { h: number; s: number; l: number } | null {
        const rgb = this.hexToRgb(hex);
        if (!rgb) return null;

        const r = rgb.r / 255;
        const g = rgb.g / 255;
        const b = rgb.b / 255;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const l = (max + min) / 2;
        let h = 0;
        let s = 0;

        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r:
                    h = (g - b) / d + (g < b ? 6 : 0);
                    break;
                case g:
                    h = (b - r) / d + 2;
                    break;
                default:
                    h = (r - g) / d + 4;
                    break;
            }
            h /= 6;
        }

        return {
            h: Math.round(h * 360),
            s: Math.round(s * 100),
            l: Math.round(l * 100),
        };
    }

    /**
     * Convierte HSL a HEX.
     * @param h 0-360, s 0-100, l 0-100
     */
    static hslToHex(h: number, s: number, l: number): string {
        const hue = ((h % 360) + 360) % 360;
        const sat = Math.min(Math.max(s, 0), 100) / 100;
        const light = Math.min(Math.max(l, 0), 100) / 100;

        const c = (1 - Math.abs(2 * light - 1)) * sat;
        const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
        const m = light - c / 2;
        let r = 0;
        let g = 0;
        let b = 0;

        if (hue < 60) { r = c; g = x; b = 0; }
        else if (hue < 120) { r = x; g = c; b = 0; }
        else if (hue < 180) { r = 0; g = c; b = x; }
        else if (hue < 240) { r = 0; g = x; b = c; }
        else if (hue < 300) { r = x; g = 0; b = c; }
        else { r = c; g = 0; b = x; }

        const toHex = (v: number) =>
            Math.round((v + m) * 255)
                .toString(16)
                .padStart(2, '0');

        return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
    }

    /**
     * Genera una escala 50-900 teñida del color base (tinte del hue del primario).
     * Usada por el preset monocromo para reemplazar la escala neutral por una
     * propia del comercio: cada shade comparte el hue del primario y varía la
     * luminosidad. La saturación se reduce en los extremos para un ramp natural.
     * @param dark si true, invierte la luminosidad (50 oscuro → 900 claro) para
     *             que la escala monocromo funcione en modo dark (bg-gray-100 →
     *             superficie oscura teñida, text-gray-900 → texto claro teñido).
     * @returns Record<'50'|'100'|...|'900', hex>
     */
    static generateScale(baseHex: string, dark = false): Record<string, string> {
        const hsl = this.hexToHsl(baseHex);
        // Light: 50 claro → 900 oscuro. Dark: 50 oscuro → 900 claro (inversión).
        const steps: Record<string, number> = dark
            ? { '50': 10, '100': 17, '200': 26, '300': 36, '400': 45, '500': 55, '600': 70, '700': 80, '800': 90, '900': 96 }
            : { '50': 96, '100': 90, '200': 80, '300': 70, '400': 55, '500': 45, '600': 36, '700': 26, '800': 17, '900': 10 };

        if (!hsl) {
            // Fallback: escala neutral slate (invertida en dark) si el hex es inválido
            const fbLight: Record<string, string> = {
                '50': '#f8fafc', '100': '#f1f5f9', '200': '#e2e8f0',
                '300': '#cbd5e1', '400': '#94a3b8', '500': '#64748b',
                '600': '#475569', '700': '#334155', '800': '#1e293b',
                '900': '#0f172a',
            };
            const fbDark: Record<string, string> = {
                '50': '#0b1220', '100': '#0f1724', '200': '#1a2332',
                '300': '#334155', '400': '#64748b', '500': '#94a3b8',
                '600': '#cbd5e1', '700': '#e2e8f0', '800': '#f1f5f9',
                '900': '#f8fafc',
            };
            return dark ? fbDark : fbLight;
        }

        const scale: Record<string, string> = {};
        for (const key of Object.keys(steps)) {
            const l = steps[key];
            const satFactor = l > 85 ? 0.55 : l < 20 ? 0.7 : 1;
            const s = Math.round(hsl.s * satFactor);
            scale[key] = this.hslToHex(hsl.h, s, l);
        }
        return scale;
    }

    /**
     * Luminancia relativa WCAG 2.x de un color HEX (0-1).
     * Usada para calcular contraste y elegir foregrounds legibles.
     */
    static relativeLuminance(hex: string): number {
        const rgb = this.hexToRgb(hex);
        if (!rgb) return 0;

        const channel = (v: number) => {
            const c = v / 255;
            return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        };

        return (
            0.2126 * channel(rgb.r) +
            0.7152 * channel(rgb.g) +
            0.0722 * channel(rgb.b)
        );
    }

    /**
     * Ratio de contraste WCAG entre dos HEX (1-21). 1 = sin contraste, 21 = máx.
     */
    static contrastRatio(hex1: string, hex2: string): number {
        const l1 = this.relativeLuminance(hex1);
        const l2 = this.relativeLuminance(hex2);
        const lighter = Math.max(l1, l2);
        const darker = Math.min(l1, l2);
        return (lighter + 0.05) / (darker + 0.05);
    }

    /**
     * Elige un foreground legible (blanco o casi-negro) para un fondo dado,
     * maximizando el contraste. Umbral 4.5 (WCAG AA texto normal).
     */
    static pickForeground(bgHex: string): string {
        const white = '#FFFFFF';
        const dark = '#0F172A';
        const whiteRatio = this.contrastRatio(bgHex, white);
        const darkRatio = this.contrastRatio(bgHex, dark);
        return whiteRatio >= darkRatio ? white : dark;
    }
}