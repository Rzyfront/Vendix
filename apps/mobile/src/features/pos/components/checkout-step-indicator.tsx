import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';

export type CheckoutStep = 'cart' | 'shipping' | 'payment' | 'confirmation';

const STEP_META: Record<CheckoutStep, { label: string; icon: string }> = {
  cart: { label: 'Carrito', icon: 'shopping-cart' },
  shipping: { label: 'Envío', icon: 'truck' },
  payment: { label: 'Pago', icon: 'credit-card' },
  confirmation: { label: 'Confirmación', icon: 'check-circle-2' },
};

const STEP_ORDER: CheckoutStep[] = ['cart', 'shipping', 'payment', 'confirmation'];

/**
 * Indicador de pasos del checkout flow.
 *
 * - Muestra 1..N pills horizontales con icono + label.
 * - El step activo y los completados se renderizan en color primary.
 * - Los steps futuros se renderizan en gris.
 * - Los conectores entre pills cambian de color según el step está completo.
 *
 * @example
 *   <CheckoutStepIndicator currentStep="shipping" />
 */
export function CheckoutStepIndicator({ currentStep }: { currentStep: CheckoutStep }) {
  const currentIndex = STEP_ORDER.indexOf(currentStep);

  return (
    <View style={styles.container}>
      {STEP_ORDER.filter((s) => s !== 'confirmation' || currentStep === 'confirmation').map((step, idx) => {
        const meta = STEP_META[step];
        const isActive = step === currentStep;
        const isCompleted = idx < currentIndex;
        const isFuture = idx > currentIndex;
        const showConnector = idx < STEP_ORDER.length - 1 && !(step === 'payment' && currentStep === 'confirmation');

        return (
          <React.Fragment key={step}>
            <View
              style={[
                styles.pill,
                isActive && styles.pillActive,
                isCompleted && styles.pillCompleted,
              ]}
            >
              <View
                style={[
                  styles.dot,
                  isActive && styles.dotActive,
                  isCompleted && styles.dotCompleted,
                  isFuture && styles.dotFuture,
                ]}
              >
                {isCompleted ? (
                  <Icon name="check" size={10} color="#FFFFFF" />
                ) : (
                  <Text
                    style={[
                      styles.dotNumber,
                      isActive && styles.dotNumberActive,
                    ]}
                  >
                    {idx + 1}
                  </Text>
                )}
              </View>
              <Text
                style={[
                  styles.pillLabel,
                  isActive && styles.pillLabelActive,
                  isCompleted && styles.pillLabelCompleted,
                ]}
                numberOfLines={1}
              >
                {meta.label}
              </Text>
            </View>
            {showConnector ? (
              <View style={[styles.connector, idx < currentIndex && styles.connectorCompleted]} />
            ) : null}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    gap: spacing[2],
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingVertical: 4,
    paddingHorizontal: spacing[2],
    borderRadius: 999,
    backgroundColor: 'transparent',
  },
  pillActive: {
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
  },
  pillCompleted: {
    backgroundColor: 'transparent',
  },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[200],
  },
  dotActive: {
    backgroundColor: colors.primary,
  },
  dotCompleted: {
    backgroundColor: colors.primary,
  },
  dotFuture: {
    backgroundColor: colorScales.gray[200],
  },
  dotNumber: {
    fontSize: 11,
    fontWeight: typography.fontWeight.bold as any,
    color: colorScales.gray[500],
  },
  dotNumberActive: {
    color: '#FFFFFF',
  },
  pillLabel: {
    fontSize: 12,
    fontWeight: typography.fontWeight.medium as any,
    color: colorScales.gray[500],
  },
  pillLabelActive: {
    color: colors.primary,
    fontWeight: typography.fontWeight.bold as any,
  },
  pillLabelCompleted: {
    color: colorScales.gray[700],
  },
  connector: {
    flex: 1,
    height: 1,
    backgroundColor: colorScales.gray[200],
    minWidth: 16,
    maxWidth: 32,
  },
  connectorCompleted: {
    backgroundColor: colors.primary,
  },
});