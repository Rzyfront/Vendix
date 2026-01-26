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
}
