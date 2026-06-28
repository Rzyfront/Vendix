import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, Pressable, TextInput, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { BottomSheet } from '@/shared/components/bottom-sheet/bottom-sheet';
import { Button } from '@/shared/components/button/button';
import { CashRegisterService, type CashRegister } from '../services/cash-register.service';
import { useCashRegisterStore } from '../store/cash-register.store';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';

interface PosCashOpenModalProps {
  visible: boolean;
  onClose: () => void;
  /** Cuando se abre la sesión con éxito — el padre cierra el dropdown. */
  onOpened?: () => void;
}

function parseAmount(text: string): number {
  if (!text) return 0;
  const normalized = text.replace(/\s/g, '').replace(',', '.');
  return parseFloat(normalized) || 0;
}

/**
 * Modal "Abrir Caja" — paridad con `pos-session-open-modal.component.ts` web.
 *
 *  - Lista cajas registradoras activas (seleccionable).
 *  - Input numérico para monto de apertura (default: `default_opening_amount`).
 *  - Al confirmar: `POST /store/cash-registers/sessions/open` →
 *    `setActiveSession(session)` y se notifica al padre.
 */
export function PosCashOpenModal({ visible, onClose, onOpened }: PosCashOpenModalProps) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const setActiveSession = useCashRegisterStore((s) => s.setActiveSession);

  const [selectedRegister, setSelectedRegister] = useState<CashRegister | null>(null);
  const [openingAmountText, setOpeningAmountText] = useState('');

  const { data: registers = [], isLoading: loading } = useQuery({
    queryKey: ['cash-registers-list'],
    queryFn: () => CashRegisterService.listRegisters(),
    enabled: visible,
  });

  // Pre-seleccionar la primera caja disponible y aplicar su default_opening_amount.
  useEffect(() => {
    if (!visible) return;
    if (registers.length > 0 && !selectedRegister) {
      const first = registers.find((r) => r.is_active) ?? registers[0];
      setSelectedRegister(first);
      if (first.default_opening_amount != null) {
        setOpeningAmountText(String(first.default_opening_amount));
      }
    }
  }, [visible, registers, selectedRegister]);

  const reset = () => {
    setSelectedRegister(null);
    setOpeningAmountText('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const openingAmount = parseAmount(openingAmountText);
  const isValid = selectedRegister && openingAmount >= 0 && openingAmountText.trim().length > 0;

  const openMutation = useMutation({
    mutationFn: () =>
      CashRegisterService.openSession(selectedRegister!.id, openingAmount),
    onSuccess: (session) => {
      setActiveSession(session);
      queryClient.invalidateQueries({ queryKey: ['cash-session-active'] });
      queryClient.invalidateQueries({ queryKey: ['cash-registers-list'] });
      toastSuccess(`Caja abierta: ${session.register?.name ?? ''}`);
      reset();
      onClose();
      onOpened?.();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? err?.message ?? 'Error al abrir la caja';
      toastError(msg);
    },
  });

  return (
    <BottomSheet visible={visible} onClose={handleClose} snapPoint="partial">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.container, { paddingBottom: insets.bottom + 16 }]}
      >
        <View style={styles.headerRow}>
          <View style={styles.headerIcon}>
            <Icon name="unlock" size={20} color={colorScales.green[600]} />
          </View>
          <View style={styles.flex1}>
            <Text style={styles.title}>Abrir Caja</Text>
            <Text style={styles.subtitle}>Selecciona la caja y el monto inicial</Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : registers.length === 0 ? (
          <View style={styles.emptyBox}>
            <Icon name="info" size={20} color={colorScales.amber[600]} />
            <Text style={styles.emptyText}>
              No hay cajas registradoras configuradas. Crea una desde Configuración.
            </Text>
          </View>
        ) : (
          <ScrollView
            style={styles.form}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Selector de caja */}
            <Text style={styles.label}>Caja Registradora</Text>
            {registers.map((reg) => {
              const inUse = (reg.sessions?.length ?? 0) > 0;
              const active = selectedRegister?.id === reg.id;
              return (
                <Pressable
                  key={reg.id}
                  onPress={() => setSelectedRegister(reg)}
                  style={({ pressed }) => [
                    styles.regRow,
                    active && styles.regRowActive,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <View style={[styles.radio, active && styles.radioActive]}>
                    {active && <View style={styles.radioDot} />}
                  </View>
                  <View style={styles.flex1}>
                    <Text style={styles.regName}>{reg.name}</Text>
                    <Text style={styles.regCode}>{reg.code}{inUse ? ' · En uso' : ''}</Text>
                  </View>
                </Pressable>
              );
            })}

            {/* Monto de apertura */}
            <Text style={[styles.label, { marginTop: spacing[4] }]}>Monto de Apertura</Text>
            <View style={styles.inputWrap}>
              <Text style={styles.inputPrefix}>$</Text>
              <TextInput
                style={styles.input}
                value={openingAmountText}
                onChangeText={setOpeningAmountText}
                placeholder="0.00"
                placeholderTextColor={colorScales.gray[400]}
                keyboardType="decimal-pad"
                returnKeyType="done"
              />
            </View>
            <Text style={styles.helperText}>
              Efectivo inicial en la caja al comenzar la jornada.
            </Text>
          </ScrollView>
        )}

        <Button
          title="Abrir caja"
          onPress={() => openMutation.mutate()}
          disabled={!isValid}
          loading={openMutation.isPending}
          fullWidth
          size="lg"
          containerStyle={{ marginTop: spacing[4] }}
        />
      </KeyboardAvoidingView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingBottom: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
    marginBottom: spacing[4],
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    backgroundColor: 'rgba(22, 163, 74, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex1: { flex: 1 },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  subtitle: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  loadingWrap: { paddingVertical: spacing[10], alignItems: 'center' },
  emptyBox: {
    flexDirection: 'row',
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.amber[200],
    backgroundColor: colorScales.amber[50],
  },
  emptyText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colorScales.amber[900],
    fontFamily: typography.fontFamily,
    lineHeight: 18,
  },
  form: { maxHeight: 380 },
  label: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[700],
    fontFamily: typography.fontFamily,
    marginBottom: spacing[2],
  },
  regRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.background,
    marginBottom: spacing[2],
  },
  regRowActive: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(34, 197, 94, 0.05)',
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colorScales.gray[300],
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: colors.primary },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  regName: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
    fontFamily: typography.fontFamily,
  },
  regCode: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    fontFamily: typography.fontFamily,
    marginTop: 2,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    backgroundColor: colorScales.gray[50],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  inputPrefix: {
    fontSize: typography.fontSize.base,
    color: colorScales.gray[500],
    marginRight: spacing[2],
    fontFamily: typography.fontFamily,
  },
  input: {
    flex: 1,
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    padding: 0,
  },
  helperText: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    fontFamily: typography.fontFamily,
    marginTop: spacing[1.5],
  },
});
