import { Easing } from 'react-native';

/**
 * Motion tokens — duración, curvas y resortes compartidos por toda la app.
 *
 * Cualquier animación (drawer, toast, modal, etc.) debe consumir tokens de aquí,
 * nunca números mágicos inline. Si necesitas una nueva curva, añádela al catálogo
 * en lugar de inventar `Easing.bezier(...)` en el componente.
 *
 * Uso:
 *   withTiming(progress, { duration: motion.duration.base, easing: motion.easing.standard })
 *   withSpring(progress, motion.spring.gentle)
 */
export const motion = {
  duration: {
    /** 150ms — micro-interacciones (tap, dismiss, cambio de estado rápido). */
    fast: 150,
    /** 250ms — entrada/salida de toasts, drawers, modales. */
    base: 250,
    /** 350ms — transiciones de pantalla, handoffs entre vistas. */
    slow: 350,
  },
  easing: {
    /** Curva estándar (≈ Material standard easing). Default para entradas. */
    standard: Easing.bezier(0.2, 0.8, 0.2, 1),
    /** Deceleración — entradas que ya estaban en movimiento. */
    decelerate: Easing.bezier(0, 0, 0.2, 1),
    /** Aceleración — salidas rápidas. */
    accelerate: Easing.bezier(0.3, 0, 1, 1),
  },
  spring: {
    /** Resorte suave para toasts/sheets que entran desde fuera de pantalla. */
    gentle: { damping: 18, stiffness: 220, mass: 0.9 },
    /** Resorte firme para drawers/menus que deben sentirse anclados. */
    firm: { damping: 22, stiffness: 280, mass: 0.8 },
  },
} as const;

export type Motion = typeof motion;