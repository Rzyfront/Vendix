/**
 * Modal "Movimiento de Caja" — paridad con `pos-cash-movement-modal.component.ts` web.
 *
 * Permite al cashier registrar entradas (`cash_in`) o salidas (`cash_out`)
 * manuales de efectivo durante una sesión de caja abierta. Al confirmar:
 *   POST /store/cash-registers/sessions/:sessionId/movements
 * con `{ type, amount, reference?, notes? }`.
 *
 * Tras el éxito invalida las queries ['cash-session-active'] (para que el
 * `expected_closing_amount` del badge del header se recalcule) y
 * ['cash-registers', 'movements', sessionId] (para refrescar el resumen
 * histórico que consume PR #8 detail modal).
 *
 * NO usa `OrgCenteredModal` de parity — esa shared component no existe en
 * dev. En su lugar replica el chrome nativo RN Modal de
 * `pos-customer-modal.tsx` (transparent + fade + statusBarTranslucent +
 * Pressable backdrop + KeyboardAvoidingView).
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { Button } from '@/shared/components/button/button';
import { CashRegisterService, type CashRegisterSession } from '../services/cash-register.service';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { formatCurrency } from '@/shared/utils/currency';

export interface PosCashMovementModalProps {
  visible: boolean;
  onClose: () => void;
  session: CashRegisterSession | null;
}

type MovementType = 'cash_in' | 'cash_out';

/** Parsea el input libre del monto (acepta coma o punto como decimal). */
function parseAmount(text: string): number {
  if (!text) return 0;
  const normalized = text.replace(/\s/g, '').replace(',', '.');
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export const PosCashMovementModal: React.FC<PosCashMovementModalProps> = ({
  visible,
  onClose,
  session,
}) => {
  const queryClient = useQueryClient();

  const [type, setType] = useState<MovementType>('cash_in');
  const [amountText, setAmountText] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  const reset = () => {
    setType('cash_in');
    setAmountText('');
    setReference('');
    setNotes('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const amount = parseAmount(amountText);
  const isValid = session != null && amount > 0;

  const mutation = useMutation({
    mutationFn: () =>
      CashRegisterService.addMovement(session!.id, {
        type,
        amount,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cash-session-active'] });
      // Invalidate la query-key que usa PR #8 (Detail modal) en dev:
      //   ['cash-movements', sessionId]
      // Si en el futuro se canoniciza a ['cash-registers', 'movements', id],
      // este modal también debe actualizar su invalidación. Ver TODO al final.
      queryClient.invalidateQueries({
        queryKey: ['cash-movements', session!.id],
      });
      const label = type === 'cash_in' ? 'Entrada' : 'Salida';
      toastSuccess(`${label} registrada: ${formatCurrency(amount)}`);
      reset();
      onClose();
    },
    onError: (err: any) => {
      const message =
        err?.response?.data?.message ?? err?.message ?? 'Error al registrar el movimiento';
      toastError(message);
    },
  });

  const submitLabel =
    type === 'cash_in' ? 'Registrar Entrada' : 'Registrar Salida';
  const toggleColor = type === 'cash_in' ? '#10B981' : '#EF4444';
  const toggleBg = type === 'cash_in' ? '#ECFDF5' : '#FEF2F2';
  const toggleBorder = type === 'cash_in' ? '#10B981' : '#EF4444';
  const toggleTextStrong = type === 'cash_in' ? '#047857' : '#B91C1C';
  const toggleTextSoft = type === 'cash_in' ? '#065F46' : '#991B1B';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={handleClose}>
          <Pressable style={styles.container} onPress={(e) => e.stopPropagation()}>
            <View style={styles.surface}>
              {/* Header */}
              <View style={styles.header}>
                <View style={styles.headerLeft}>
                  <View style={styles.headerIcon}>
                    <Icon name="wallet" size={20} color={colors.primary} />
                  </View>
                  <View style={styles.headerTitles}>
                    <Text style={styles.headerTitle}>Movimiento de Caja</Text>
                    <Text style={styles.headerSubtitle}>
                      {session?.register?.name
                        ? `${session.register.name} · sesión #${session.id}`
                        : 'Registra entradas o salidas manuales de efectivo'}
                    </Text>
                  </View>
                </View>
                <Pressable onPress={handleClose} style={styles.closeBtn} hitSlop={8}>
                  <Icon name="x" size={20} color={colorScales.gray[400]} />
                </Pressable>
              </View>

              {/* Content */}
              <ScrollView
                style={styles.content}
                contentContainerStyle={styles.contentInner}
                keyboardShouldPersistTaps="handled"
              >
                {/* Info card — efectivo esperado actual */}
                {session && (
                  <View style={styles.infoCard}>
                    <View style={styles.infoCardHeader}>
                      <Icon name="activity" size={14} color={colorScales.gray[500]} />
                      <Text style={styles.infoCardLabel}>Efectivo esperado actual</Text>
                    </View>
                    <Text style={styles.infoCardValue}>
                      {formatCurrency(session.expected_closing_amount ?? session.opening_amount)}
                    </Text>
                    <Text style={styles.infoCardHint}>
                      Se recalcula tras registrar el movimiento.
                    </Text>
                  </View>
                )}

                {/* Toggle Entrada / Salida */}
                <Text style={styles.fieldLabel}>Tipo de movimiento</Text>
                <View style={styles.toggleRow}>
                  <Pressable
                    onPress={() => setType('cash_in')}
                    style={[
                      styles.toggleBtn,
                      type === 'cash_in' ? styles.toggleBtnActive : styles.toggleBtnInactive,
                      type === 'cash_in' && {
                        backgroundColor: toggleBg,
                        borderColor: toggleBorder,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.toggleIconWrap,
                        type === 'cash_in'
                          ? { backgroundColor: toggleColor }
                          : { backgroundColor: colorScales.gray[100] },
                      ]}
                    >
                      <Icon
                        name="plus"
                        size={16}
                        color={type === 'cash_in' ? '#FFFFFF' : colorScales.gray[400]}
                      />
                    </View>
                    <Text
                      style={[
                        styles.toggleTitle,
                        { color: type === 'cash_in' ? toggleTextStrong : colorScales.gray[700] },
                      ]}
                    >
                      Entrada
                    </Text>
                    <Text
                      style={[
                        styles.toggleSubtitle,
                        { color: type === 'cash_in' ? toggleTextSoft : colorScales.gray[400] },
                      ]}
                    >
                      Agregar efectivo
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setType('cash_out')}
                    style={[
                      styles.toggleBtn,
                      type === 'cash_out' ? styles.toggleBtnActive : styles.toggleBtnInactive,
                      type === 'cash_out' && {
                        backgroundColor: toggleBg,
                        borderColor: toggleBorder,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.toggleIconWrap,
                        type === 'cash_out'
                          ? { backgroundColor: toggleColor }
                          : { backgroundColor: colorScales.gray[100] },
                      ]}
                    >
                      <Icon
                        name="minus"
                        size={16}
                        color={type === 'cash_out' ? '#FFFFFF' : colorScales.gray[400]}
                      />
                    </View>
                    <Text
                      style={[
                        styles.toggleTitle,
                        { color: type === 'cash_out' ? toggleTextStrong : colorScales.gray[700] },
                      ]}
                    >
                      Salida
                    </Text>
                    <Text
                      style={[
                        styles.toggleSubtitle,
                        { color: type === 'cash_out' ? toggleTextSoft : colorScales.gray[400] },
                      ]}
                    >
                      Retirar efectivo
                    </Text>
                  </Pressable>
                </View>

                {/* Monto */}
                <Text style={styles.fieldLabel}>
                  MONTO <Text style={styles.required}>*</Text>
                </Text>
                <View style={styles.inputWrap}>
                  <Text style={styles.inputPrefix}>$</Text>
                  <TextInput
                    style={styles.input}
                    value={amountText}
                    onChangeText={setAmountText}
                    placeholder="0.00"
                    placeholderTextColor={colorScales.gray[400]}
                    keyboardType="decimal-pad"
                    returnKeyType="next"
                  />
                </View>

                {/* Referencia */}
                <Text style={styles.fieldLabel}>REFERENCIA</Text>
                <View style={styles.inputWrap}>
                  <TextInput
                    style={styles.input}
                    value={reference}
                    onChangeText={setReference}
                    placeholder="Ej: Cambio de monedas, pago proveedor…"
                    placeholderTextColor={colorScales.gray[400]}
                  />
                </View>
                <Text style={styles.fieldDesc}>
                  Describe brevemente la razón del movimiento.
                </Text>

                {/* Notas */}
                <Text style={styles.fieldLabel}>NOTAS</Text>
                <View style={[styles.inputWrap, styles.textareaWrap]}>
                  <TextInput
                    style={[styles.input, styles.textarea]}
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Notas adicionales (opcional)…"
                    placeholderTextColor={colorScales.gray[400]}
                    multiline
                  />
                </View>

                {!session && (
                  <Text style={styles.warning}>
                    No hay una sesión de caja activa. Abre una caja antes de
                    registrar movimientos.
                  </Text>
                )}
              </ScrollView>

              {/* Footer */}
              <View style={styles.footer}>
                <Button
                  title="Cancelar"
                  variant="secondary"
                  onPress={handleClose}
                  disabled={mutation.isPending}
                />
                <Button
                  title={submitLabel}
                  variant="primary"
                  onPress={() => mutation.mutate()}
                  disabled={!isValid}
                  loading={mutation.isPending}
                />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[4],
  },
  container: {
    width: '100%',
    maxWidth: 500,
    maxHeight: '85%',
  },
  surface: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    flex: 1,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    backgroundColor: colorScales.blue[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitles: {
    flex: 1,
  },
  headerTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  headerSubtitle: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    maxHeight: 520,
  },
  contentInner: {
    padding: spacing[4],
    gap: spacing[3],
  },
  infoCard: {
    backgroundColor: colorScales.blue[50],
    borderWidth: 1,
    borderColor: colorScales.blue[200],
    borderRadius: borderRadius.lg,
    padding: spacing[3],
    gap: spacing[1],
  },
  infoCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  infoCardLabel: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoCardValue: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.blue[800],
  },
  infoCardHint: {
    fontSize: 11,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing[2],
  },
  required: {
    color: colors.error,
  },
  fieldDesc: {
    fontSize: 11,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[400],
  },
  toggleRow: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
  },
  toggleBtnInactive: {
    backgroundColor: colors.background,
    borderColor: colorScales.gray[200],
  },
  toggleBtnActive: {
    // Background + border aplicados dinámicamente según tipo.
  },
  toggleIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
  },
  toggleSubtitle: {
    fontSize: 11,
    fontFamily: typography.fontFamily,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    backgroundColor: colorScales.gray[50],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    gap: spacing[2],
  },
  textareaWrap: {
    alignItems: 'flex-start',
    paddingVertical: spacing[3],
  },
  inputPrefix: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  input: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    padding: 0,
  },
  textarea: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  warning: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colors.error,
    backgroundColor: colorScales.red[50],
    borderRadius: borderRadius.md,
    padding: spacing[3],
    marginTop: spacing[2],
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
});