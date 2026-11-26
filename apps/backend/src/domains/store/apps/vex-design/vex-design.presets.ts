import type { AppPageTheme } from '../shared/app-page.contract';
import type { DesignChatAppKind } from './vex-design.types';

/**
 * Apps F4 — presets cerrados por industria para `apply_preset`.
 *
 * Cada preset define solo tokens cerrados de `page.theme` (y opcionalmente
 * ajustes de portada compatibles con el contrato), garantizando contraste
 * legible (≥ 4.5:1) y validación limpia contra `validateAppPage`.
 */
export interface VexDesignPreset {
  id: string;
  name: string;
  industry: string;
  description: string;
  applies_to: readonly DesignChatAppKind[];
  theme: AppPageTheme;
  hero_defaults?: {
    variant?: 'centered' | 'image_right' | 'background';
    overlay_opacity?: number;
    height?: 'auto' | 'compact' | 'full';
    align?: 'left' | 'center' | 'right';
  };
}

export const VEX_DESIGN_PRESETS: readonly VexDesignPreset[] = [
  {
    id: 'boutique',
    name: 'Boutique editorial',
    industry: 'moda y retail',
    description:
      'Tonos cálidos, títulos con serifa, bordes amplios y botones delineados.',
    applies_to: ['product_page', 'service_page', 'booking'],
    theme: {
      primary_color: '#7A3E2E',
      secondary_color: '#5C4033',
      surface_color: '#FBF7F2',
      text_color: '#2B211C',
      accent_color: '#8C5A2B',
      border_color: '#E7DCD1',
      heading_font: 'playfair',
      body_font: 'lora',
      radius: 'large',
      density: 'spacious',
      button_style: 'outline',
      image_style: 'rounded',
      content_width: 'narrow',
      card_style: 'soft',
      shadow: 'soft',
    },
  },
  {
    id: 'clinical',
    name: 'Clínico y preciso',
    industry: 'salud y tecnología',
    description:
      'Paleta azul fría y limpia, tipografía clara y bloques compactos.',
    applies_to: ['product_page', 'service_page', 'booking'],
    theme: {
      primary_color: '#0F4C81',
      secondary_color: '#1E3A5F',
      surface_color: '#F8FAFC',
      text_color: '#0F172A',
      accent_color: '#0369A1',
      border_color: '#CBD5E1',
      heading_font: 'inter',
      body_font: 'inter',
      radius: 'small',
      density: 'compact',
      button_style: 'solid',
      image_style: 'square',
      content_width: 'normal',
      card_style: 'outline',
      shadow: 'none',
    },
  },
  {
    id: 'beauty',
    name: 'Belleza y bienestar',
    industry: 'belleza, spa y estética',
    description:
      'Acentos vino y rosa suaves, serifa elegante y ritmo aireado.',
    applies_to: ['service_page', 'product_page', 'booking'],
    theme: {
      primary_color: '#831843',
      secondary_color: '#500724',
      surface_color: '#FFF9FB',
      text_color: '#2B1420',
      accent_color: '#9D174D',
      border_color: '#F3D5E2',
      heading_font: 'playfair',
      body_font: 'poppins',
      radius: 'large',
      density: 'spacious',
      button_style: 'solid',
      image_style: 'rounded',
      content_width: 'normal',
      section_gap: 'airy',
      card_style: 'soft',
      shadow: 'soft',
    },
  },
  {
    id: 'professional',
    name: 'Servicios profesionales',
    industry: 'consultoría, legal y educación',
    description:
      'Sobrio y confiable: azul marino profundo, tipografía geométrica y tarjetas con borde.',
    applies_to: ['service_page', 'product_page'],
    theme: {
      primary_color: '#1E3A8A',
      secondary_color: '#172554',
      surface_color: '#FFFFFF',
      text_color: '#111827',
      accent_color: '#1D4ED8',
      border_color: '#D1D5DB',
      heading_font: 'montserrat',
      body_font: 'inter',
      radius: 'medium',
      density: 'comfortable',
      button_style: 'solid',
      image_style: 'rounded',
      content_width: 'normal',
      card_style: 'outline',
      shadow: 'none',
    },
  },
  {
    id: 'cozy',
    name: 'Hospitalidad cálida',
    industry: 'hoteles, cabañas y turismo',
    description:
      'Verdes bosque y crema natural, perfecto para estadías acogedoras.',
    applies_to: ['booking', 'service_page', 'product_page'],
    theme: {
      primary_color: '#166534',
      secondary_color: '#14532D',
      surface_color: '#F7FAF5',
      text_color: '#1C2A1E',
      accent_color: '#3F6212',
      border_color: '#D4E2D0',
      heading_font: 'lora',
      body_font: 'inter',
      radius: 'large',
      density: 'spacious',
      button_style: 'solid',
      image_style: 'rounded',
      content_width: 'normal',
      card_style: 'soft',
      shadow: 'soft',
    },
  },
  {
    id: 'minimal',
    name: 'Minimalista urbano',
    industry: 'hoteles boutique, arquitectura y diseño',
    description:
      'Alto contraste en carbón y blanco puro, líneas rectas y enfoque en la fotografía.',
    applies_to: ['booking', 'product_page', 'service_page'],
    theme: {
      primary_color: '#18181B',
      secondary_color: '#27272A',
      surface_color: '#FFFFFF',
      text_color: '#18181B',
      accent_color: '#3F3F46',
      border_color: '#E4E4E7',
      heading_font: 'montserrat',
      body_font: 'inter',
      radius: 'none',
      density: 'comfortable',
      button_style: 'outline',
      image_style: 'square',
      content_width: 'wide',
      card_style: 'flat',
      shadow: 'none',
    },
  },
  {
    id: 'dark_editorial',
    name: 'Oscuro moderno',
    industry: 'gastronomía nocturna, tecnología y lujo',
    description:
      'Fondo oscuro profundo con acentos ámbar luminosos y portada con velo.',
    applies_to: ['product_page', 'service_page', 'booking'],
    theme: {
      primary_color: '#FBBF24',
      secondary_color: '#F59E0B',
      surface_color: '#0F172A',
      text_color: '#F1F5F9',
      accent_color: '#FCD34D',
      border_color: '#334155',
      heading_font: 'montserrat',
      body_font: 'inter',
      radius: 'medium',
      density: 'comfortable',
      button_style: 'solid',
      image_style: 'rounded',
      content_width: 'normal',
      card_style: 'soft',
      shadow: 'strong',
      image_overlay: 50,
    },
    hero_defaults: {
      variant: 'background',
      overlay_opacity: 55,
    },
  },
  {
    id: 'terracotta',
    name: 'Gastronomía y artesanía',
    industry: 'alimentos, café y productos artesanales',
    description:
      'Terracota cálido y fondo arena, cercano y apetitoso.',
    applies_to: ['product_page', 'service_page', 'booking'],
    theme: {
      primary_color: '#9A3412',
      secondary_color: '#7C2D12',
      surface_color: '#FFF8F1',
      text_color: '#2A1A12',
      accent_color: '#9A3412',
      border_color: '#FED7AA',
      heading_font: 'poppins',
      body_font: 'inter',
      radius: 'medium',
      density: 'comfortable',
      button_style: 'solid',
      image_style: 'rounded',
      content_width: 'normal',
      card_style: 'soft',
      shadow: 'soft',
    },
  },
];

export function listPresetsForApp(
  kind: DesignChatAppKind,
): readonly VexDesignPreset[] {
  return VEX_DESIGN_PRESETS.filter((preset) =>
    preset.applies_to.includes(kind),
  );
}

export function findPresetForApp(
  kind: DesignChatAppKind,
  presetId: string,
): VexDesignPreset | null {
  const normalized = presetId.trim().toLowerCase();
  return (
    VEX_DESIGN_PRESETS.find(
      (preset) =>
        preset.id === normalized && preset.applies_to.includes(kind),
    ) ?? null
  );
}
