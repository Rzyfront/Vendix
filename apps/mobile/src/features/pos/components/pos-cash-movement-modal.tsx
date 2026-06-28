import React, { useState } from 'react';
import {
  View, Text, Pressable, TextInput, StyleSheet,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { OrgCenteredModal } from '@/shared/components/org-centered-modal';
import { Button } from '@/shared/components/button/button';
import { CashRegisterService, type CashRegisterSession } from '../services/cash-register.service';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';

interface PosCashMovementModalProps {
  visible: boolean;
  onClose: () => void;
  session: CashRegisterSession | null;
  onCreated?: () => void;
}

type MovementType = 'cash_in' | 'cash_out';

function parseAmount(text: string): number {
  if (!text) return 0;
  return parseFloat(text.replace(/\s/g, '').replace(',', '.')) || 0;
}

/**
 * Modal "Movimiento de Caja" — paridad con `pos-cash-movement-modal.component.ts` web.
 *
 * Toggle entre `cash_in` (entrada) y `cash_out` (salida). Inputs: monto,
 * referencia opcional, notas opcionales. Al confirmar:
 * `POST .../sessions/:id/movements` → toast éxito.
 */
export function PosCashMovementModal({ visible, onClose, session, onCreated }: PosCashMovementModalProps) {
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

  const createMutation = useMutation({
    mutationFn: () =>
      CashRegisterService.addMovement(session!.id, {
        type,
        amount,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
      }),
    onSuccess: (movement) => {
      queryClient.invalidateQueries({ queryKey: ['cash-session-active'] });
      queryClient.invalidateQueries({ queryKey: ['cash-movements', session?.id] });
      const label = type === 'cash_in' ? 'Entrada' : 'Salida';
      toastSuccess(`${label} registrada: $${amount.toLocaleString('es-CO')}`);
      reset();
      onClose();
      onCreated?.();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? err?.message ?? 'Error al registrar el movimiento';
      toastError(msg);
    },
  });

  return (
    <OrgCenteredModal
      visible={visible}
      onClose={handleClose}
      title="Movimiento de Caja"
      subtitle="Registra entradas o salidas manuales de efectivo"
      size="md"
      footer={
        <View style={styles.footerRow}>
          <Button
            title="Cancelar"
            variant="primary"
            style={{
              backgroundColor: '#0F2A1D', // Verde muy oscuro como la web
              borderRadius: borderRadius.lg,
              paddingHorizontal: spacing[5],
              height: 40,
            }}
            onPress={handleClose}
          />
          <Button
            title={type === 'cash_in' ? 'Registrar Entrada' : 'Registrar Salida'}
            variant="primary"
            leftIcon={
              <Icon
                name={type === 'cash_in' ? 'trending-up' : 'trending-down'}
                size={16}
                color="#FFFFFF"
              />
            }
            style={{
              backgroundColor: type === 'cash_in' ? '#10B981' : '#EF4444',
              borderRadius: borderRadius.lg,
              paddingHorizontal: spacing[5],
              height: 40,
            }}
            onPress={() => createMutation.mutate()}
            disabled={!isValid}
            loading={createMutation.isPending}
          />
        </View>
      }
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.formContainer}
      >
        {/* Toggle Entrada / Salida */}
        <View style={styles.toggleRow}>
          <Pressable
            onPress={() => setType('cash_in')}
            style={[
              styles.toggleBtn,
              type === 'cash_in' ? styles.toggleBtnInActive : styles.toggleBtnInactive,
            ]}
          >
            <Icon
              name="trending-up"
              size={20}
              color={type === 'cash_in' ? '#10B981' : colorScales.gray[400]}
              style={{ marginBottom: 6 }}
            />
            <Text style={[styles.toggleTitle, { color: type === 'cash_in' ? '#047857' : colorScales.gray[700] }]}>
              Entrada
            </Text>
            <Text style={[styles.toggleSubtitle, { color: type === 'cash_in' ? '#065F46' : colorScales.gray[400] }]}>
              Agregar efectivo
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setType('cash_out')}
            style={[
              styles.toggleBtn,
              type === 'cash_out' ? styles.toggleBtnOutActive : styles.toggleBtnInactive,
            ]}
          >
            <Icon
              name="trending-down"
              size={20}
              color={type === 'cash_out' ? '#EF4444' : colorScales.gray[400]}
              style={{ marginBottom: 6 }}
            />
            <Text style={[styles.toggleTitle, { color: type === 'cash_out' ? '#B91C1C' : colorScales.gray[700] }]}>
              Salida
            </Text>
            <Text style={[styles.toggleSubtitle, { color: type === 'cash_out' ? '#991B1B' : colorScales.gray[400] }]}>
              Retirar efectivo
            </Text>
          </Pressable>
        </View>

        {/* Monto */}
        <Text style={[styles.fieldLabel, { marginTop: spacing[4] }]}>
          Monto <Text style={{ color: colorScales.red[500] }}>*</Text>
        </Text>
        <View style={styles.inputWrap}>
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
        <Text style={[styles.fieldLabel, { marginTop: spacing[4] }]}>Referencia</Text>
        <View style={styles.inputWrap}>
          <TextInput
            style={styles.input}
            value={reference}
            onChangeText={setReference}
            placeholder="Ej: Cambio de monedas, pago proveedor..."
            placeholderTextColor={colorScales.gray[400]}
          />
        </View>
        <Text style={styles.fieldDesc}>Describe brevemente la razón del movimiento</Text>

        {/* Notas */}
        <Text style={[styles.fieldLabel, { marginTop: spacing[4] }]}>Notas</Text>
        <View style={[styles.inputWrap, { alignItems: 'flex-start' }]}>
          <TextInput
            style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Notas adicionales..."
            placeholderTextColor={colorScales.gray[400]}
            multiline
          />
        </View>
      </KeyboardAvoidingView>
    </OrgCenteredModal>
  );
}

const styles = StyleSheet.create({
  formContainer: {
    paddingVertical: spacing[2],
  },
  toggleRow: {
    flexDirection: 'row',
    gap: spacing[3],
    marginBottom: spacing[4],
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleBtnInactive: {
    backgroundColor: '#FFFFFF',
    borderColor: colorScales.gray[200],
  },
  toggleBtnInActive: {
    backgroundColor: '#ECFDF5',
    borderColor: '#10B981',
  },
  toggleBtnOutActive: {
    backgroundColor: '#FEF2F2',
    borderColor: '#EF4444',
  },
  toggleTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600',
    fontFamily: typography.fontFamily,
  },
  toggleSubtitle: {
    fontSize: 9,
    fontFamily: typography.fontFamily,
    marginTop: 2,
    textTransform: 'none',
  },
  fieldLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: colorScales.gray[500],
    fontFamily: typography.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing[1.5],
  },
  fieldDesc: {
    fontSize: 11,
    color: colorScales.gray[400],
    fontFamily: typography.fontFamily,
    marginTop: spacing[1],
    marginBottom: spacing[2],
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
  },
  input: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    padding: 0,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[2],
    width: '100%',
  },
});
