import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { borderRadius, colorScales, colors, spacing } from '@/shared/theme';
import type { PopFiscalExplanation } from '../types';

interface FiscalExplanationPanelProps {
  /** El objeto tal como llega en `fiscal_explanation` de la vista previa. */
  explanation?: PopFiscalExplanation | null;
  /**
   * Recibe la ruta que el backend puso en `cta.route`. La pantalla NO inventa
   * el destino; sólo decide cómo llevar al operador hasta él.
   */
  onCtaPress?: (route: string) => void;
}

/**
 * CP-PURCHASE-TRANSPARENCY B.5 — el panel que explica QUÉ se hace con el IVA de
 * la compra, POR QUÉ, y CON QUÉ BASE LEGAL. Réplica del web
 * `app-fiscal-explanation-panel`.
 *
 * Reglas que lo gobiernan (idénticas a las de la web, porque el defecto que
 * cierran es el mismo):
 *
 *  1. **No deriva nada.** Pinta el `fiscal_explanation` que emite el backend.
 *     Si la pantalla dedujera el predicado por su cuenta, móvil y web podrían
 *     afirmar cosas opuestas sobre la misma compra.
 *  2. **Aparece también con IVA cero.** El tratamiento del impuesto es una
 *     decisión del sistema esté o no gravada la factura.
 *  3. **Degrada limpio.** Sin explicación (respuesta vieja, vista previa que
 *     falló, carrito sólo de productos nuevos) no pinta nada, en vez de
 *     inventar un texto.
 */
export default function FiscalExplanationPanel({
  explanation,
  onCtaPress,
}: FiscalExplanationPanelProps) {
  if (!explanation) return null;

  const indeterminate = explanation.indeterminate === true;
  const title = indeterminate
    ? 'No pudimos confirmar tu situación fiscal'
    : 'Tratamiento del IVA de esta compra';
  const treatmentLabel =
    explanation.treatment === 'deductible' ? 'IVA descontable' : 'IVA al costo';
  const legalBasis = explanation.legal_basis ?? [];
  const cta = explanation.cta;

  return (
    <View style={[styles.panel, indeterminate && styles.panelWarn]}>
      <View style={styles.head}>
        <Ionicons
          name={indeterminate ? 'shield-outline' : 'receipt-outline'}
          size={16}
          color={indeterminate ? colorScales.amber[600] : colorScales.gray[500]}
        />
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{treatmentLabel}</Text>
        </View>
      </View>

      {!!explanation.message && (
        <Text style={styles.message}>{explanation.message}</Text>
      )}

      {indeterminate && (
        <Text style={styles.recommendation}>
          Todavía no sabemos si tu negocio es responsable de IVA, así que el
          sistema aplica la regla más conservadora y suma el IVA al costo de tus
          productos. Te recomendamos configurar tu área fiscal para que el costo
          y el margen se calculen con tu situación real.
        </Text>
      )}

      {legalBasis.length > 0 && (
        <View style={styles.legal}>
          <Text style={styles.legalTitle}>Base legal</Text>
          {legalBasis.map((basis) => (
            <Text key={basis} style={styles.legalItem}>
              {'•  '}
              {basis}
            </Text>
          ))}
        </View>
      )}

      {!!cta && !!onCtaPress && (
        <Pressable
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          onPress={() => onCtaPress(cta.route)}
          accessibilityRole="button"
          accessibilityLabel={cta.label}
        >
          <Text style={styles.ctaText}>{cta.label}</Text>
          <Ionicons name="arrow-forward" size={14} color={colors.primary} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: 8,
    padding: 14,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.card,
  },
  panelWarn: {
    borderColor: colorScales.amber[500],
    backgroundColor: colorScales.amber[50],
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '700',
    color: colorScales.gray[900],
  },
  badge: {
    flexShrink: 0,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colorScales.gray[50],
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: colorScales.gray[600],
  },
  message: {
    fontSize: 12,
    lineHeight: 18,
    color: colorScales.gray[600],
  },
  recommendation: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    color: colorScales.amber[700],
  },
  legal: {
    gap: 2,
  },
  legalTitle: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: colorScales.gray[400],
    marginBottom: 2,
  },
  legalItem: {
    fontSize: 11,
    lineHeight: 16,
    color: colorScales.gray[500],
  },
  cta: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
    paddingHorizontal: spacing[3],
    paddingVertical: 7,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: 'transparent',
  },
  ctaPressed: {
    backgroundColor: colorScales.gray[50],
  },
  ctaText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
});
