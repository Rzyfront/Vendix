/**
 * AnuncioStepRibbon — Ribbon de 2 pasos para el wizard de creación.
 *
 * Replica el `app-steps-line` del web (`anuncio-create-wizard-page.component.ts:116-123`).
 *
 * En mobile usamos un ribbon horizontal simple con pills, no la
 * `steps-line` completa. El badge del sticky header (`1/2` / `2/2`) viene
 * desde el `create.tsx` directamente.
 */

import { View, Text, Pressable, StyleSheet } from 'react-native';

import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';

export interface AnuncioStep {
  label: string;
  icon: string;
}

export interface AnuncioStepRibbonProps {
  steps: AnuncioStep[];
  currentStep: number;
  onStepClick?: (index: number) => void;
}

export function AnuncioStepRibbon({
  steps,
  currentStep,
  onStepClick,
}: AnuncioStepRibbonProps) {
  return (
    <View style={styles.ribbon}>
      {steps.map((step, index) => {
        const isActive = index === currentStep;
        const isDone = index < currentStep;
        const canClick = isDone && Boolean(onStepClick);
        return (
          <Pressable
            key={step.label}
            style={[
              styles.pill,
              isActive && styles.pillActive,
              isDone && styles.pillDone,
            ]}
            onPress={canClick ? () => onStepClick?.(index) : undefined}
            disabled={!canClick}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive, disabled: !canClick }}
          >
            <Icon
              name={step.icon}
              size={14}
              color={isActive ? colors.primary : colorScales.gray[500]}
            />
            <Text
              style={[
                styles.label,
                isActive && styles.labelActive,
                isDone && styles.labelDone,
              ]}
            >
              {step.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  ribbon: {
    flexDirection: 'row',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.gray[100],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  pillActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  pillDone: {
    backgroundColor: colorScales.green[50] ?? '#F0FDF4',
    borderColor: colorScales.green[200] ?? '#BBF7D0',
  },
  label: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    fontWeight: typography.fontWeight.medium as any,
  },
  labelActive: {
    color: colors.primary,
    fontWeight: typography.fontWeight.semibold as any,
  },
  labelDone: {
    color: colorScales.green[700] ?? '#15803D',
  },
});
