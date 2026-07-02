import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  ScrollView,
} from 'react-native';
import { Icon } from '@/shared/components/icon/icon';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';

export interface StockLocationOption {
  id: number;
  name: string;
}

interface StockAdjustmentLocationModalProps {
  visible: boolean;
  locations: StockLocationOption[];
  onClose: () => void;
  onConfirm: (locationId: number) => void;
}

type Step = 1 | 2;

/**
 * StockAdjustmentLocationModal — modal de 2 pasos para seleccionar
 * la ubicación donde se creará el ajuste de stock.
 *
 * Paso 1: UBICACIÓN — selector dropdown de ubicaciones
 * Paso 2: CONFIRMAR — confirmación de la selección
 *
 * Espejo del web app-adjustment-create-modal con stepper.
 */
export default function StockAdjustmentLocationModal({
  visible,
  locations,
  onClose,
  onConfirm,
}: StockAdjustmentLocationModalProps) {
  const [step, setStep] = useState<Step>(1);
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);

  const selectedLocation = locations.find((l) => l.id === selectedLocationId);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>Seleccionar Ubicación</Text>
              <Text style={styles.subtitle}>Registrar ajustes de inventario</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
              <Icon name="x" size={20} color={colorScales.gray[500]} />
            </Pressable>
          </View>

          {/* Body */}
          <View style={styles.body}>
            {/* Stepper */}
            <View style={styles.stepper}>
              <View style={styles.stepItem}>
                <View
                  style={[
                    styles.stepCircle,
                    (step === 1 || step === 2) && styles.stepCircleActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.stepNum,
                      (step === 1 || step === 2) && styles.stepNumActive,
                    ]}
                  >
                    1
                  </Text>
                </View>
                <Text
                  style={[
                    styles.stepLabel,
                    (step === 1 || step === 2) && styles.stepLabelActive,
                  ]}
                >
                  UBICACIÓN
                </Text>
              </View>
              <View
                style={[
                  styles.stepLine,
                  step === 2 && styles.stepLineActive,
                ]}
              />
              <View style={styles.stepItem}>
                <View
                  style={[
                    styles.stepCircle,
                    step === 2 && styles.stepCircleActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.stepNum,
                      step === 2 && styles.stepNumActive,
                    ]}
                  >
                    2
                  </Text>
                </View>
                <Text
                  style={[
                    styles.stepLabel,
                    step === 2 && styles.stepLabelActive,
                  ]}
                >
                  CONFIRMAR
                </Text>
              </View>
            </View>

            {/* Step content */}
            {step === 1 && (
              <View>
                <Text style={styles.fieldLabel}>Ubicación *</Text>
                <Pressable
                  onPress={() => setShowDropdown(!showDropdown)}
                  style={({ pressed }) => [
                    styles.selectTrigger,
                    showDropdown && styles.selectTriggerActive,
                    pressed && { backgroundColor: colorScales.gray[50] },
                  ]}
                >
                  <Text
                    style={[
                      styles.selectValue,
                      !selectedLocation && styles.selectPlaceholder,
                    ]}
                  >
                    {selectedLocation
                      ? selectedLocation.name
                      : 'Seleccionar ubicación'}
                  </Text>
                  <Icon
                    name={showDropdown ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colorScales.gray[500]}
                  />
                </Pressable>
                {showDropdown && (
                  <ScrollView style={styles.dropdownList} nestedScrollEnabled>
                    {locations.length === 0 ? (
                      <Text style={styles.emptyText}>
                        No hay ubicaciones disponibles
                      </Text>
                    ) : (
                      locations.map((loc) => (
                        <Pressable
                          key={loc.id}
                          onPress={() => {
                            setSelectedLocationId(loc.id);
                            setShowDropdown(false);
                          }}
                          style={[
                            styles.dropdownOption,
                            selectedLocationId === loc.id &&
                              styles.dropdownOptionActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.dropdownOptionText,
                              selectedLocationId === loc.id &&
                                styles.dropdownOptionTextActive,
                            ]}
                          >
                            {loc.name}
                          </Text>
                          {selectedLocationId === loc.id && (
                            <Icon
                              name="check"
                              size={14}
                              color={colors.primary}
                            />
                          )}
                        </Pressable>
                      ))
                    )}
                  </ScrollView>
                )}
              </View>
            )}

            {step === 2 && (
              <View style={styles.confirmBox}>
                <Text style={styles.confirmLabel}>Ubicación seleccionada</Text>
                <Text style={styles.confirmValue}>
                  {selectedLocation?.name ?? '—'}
                </Text>
              </View>
            )}
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            {step === 1 ? (
              <Pressable
                style={[
                  styles.primaryBtn,
                  !selectedLocationId && styles.primaryBtnDisabled,
                ]}
                onPress={() => {
                  if (selectedLocationId) setStep(2);
                }}
                disabled={!selectedLocationId}
              >
                <Text style={styles.primaryBtnText}>Continuar</Text>
                <Icon name="arrow-right" size={16} color={colors.background} />
              </Pressable>
            ) : (
              <View style={styles.confirmActions}>
                <Pressable
                  onPress={() => {
                    if (selectedLocationId) onConfirm(selectedLocationId);
                  }}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    { flex: 1 },
                    pressed && { backgroundColor: colorScales.green[700] },
                  ]}
                >
                  <Text style={styles.primaryBtnText}>Confirmar</Text>
                </Pressable>
                <Pressable
                  onPress={() => setStep(1)}
                  style={({ pressed }) => [
                    styles.outlineBtn,
                    pressed && { backgroundColor: colorScales.gray[100] },
                  ]}
                >
                  <Text style={styles.outlineBtnText}>Atrás</Text>
                </Pressable>
              </View>
            )}
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeFooterBtn,
                pressed && { backgroundColor: 'rgba(220, 38, 38, 0.1)' },
              ]}
            >
              <Icon name="x" size={22} color={colorScales.red[500]} />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[4],
  },
  modal: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    width: '100%',
    maxWidth: 480,
    maxHeight: '90%',
    ...shadows.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  headerText: { flex: 1 },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.primary,
  },
  subtitle: {
    fontSize: typography.fontSize.sm,
    color: colors.text.secondary,
    marginTop: 2,
  },
  closeBtn: {
    padding: spacing[1],
  },
  body: {
    padding: spacing[4],
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[6],
  },
  stepItem: {
    alignItems: 'center',
    flex: 0,
  },
  stepCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.card,
  },
  stepCircleActive: {
    borderColor: colors.primary,
    backgroundColor: colors.card,
  },
  stepLine: {
    flex: 1,
    height: 2,
    backgroundColor: colorScales.gray[200],
    marginHorizontal: spacing[2],
    marginTop: 1,
  },
  stepLineActive: {
    backgroundColor: colors.primary,
  },
  stepNum: {
    fontSize: 12,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.secondary,
  },
  stepNumActive: {
    color: colors.primary,
  },
  stepLabel: {
    fontSize: 9,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.secondary,
    textTransform: 'uppercase' as any,
    letterSpacing: 1,
    marginTop: 4,
  },
  stepLabelActive: {
    color: colors.primary,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.primary,
    marginBottom: spacing[2],
  },
  selectTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing[3],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.card,
  },
  selectTriggerActive: {
    backgroundColor: colorScales.green[50],
  },
  selectValue: {
    fontSize: 14,
    color: colors.text.primary,
    flex: 1,
  },
  selectPlaceholder: {
    color: colorScales.gray[400],
  },
  dropdownList: {
    maxHeight: 240,
    marginTop: spacing[2],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.card,
  },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  dropdownOptionActive: {
    backgroundColor: colorScales.green[50],
  },
  dropdownOptionText: {
    fontSize: 14,
    color: colorScales.gray[700],
  },
  dropdownOptionTextActive: {
    color: colors.primary,
    fontWeight: typography.fontWeight.semibold as any,
  },
  emptyText: {
    textAlign: 'center' as any,
    fontSize: 12,
    color: colorScales.gray[500],
    padding: spacing[3],
  },
  confirmBox: {
    padding: spacing[4],
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
  },
  confirmLabel: {
    fontSize: 11,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[500],
    textTransform: 'uppercase' as any,
    marginBottom: 4,
  },
  confirmValue: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.primary,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: 12,
    paddingHorizontal: spacing[4],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary,
  },
  primaryBtnDisabled: {
    backgroundColor: colorScales.gray[200],
    opacity: 0.6,
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.background,
  },
  outlineBtn: {
    paddingVertical: 12,
    paddingHorizontal: spacing[4],
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    borderColor: colorScales.gray[300],
    backgroundColor: colors.card,
  },
  outlineBtnText: {
    fontSize: 14,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[700],
  },
  confirmActions: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing[2],
  },
  closeFooterBtn: {
    padding: spacing[1],
  },
});
