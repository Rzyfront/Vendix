import React, { useState, useMemo } from 'react';
import {
  View, Text, TextInput, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { OrgCenteredModal } from '@/shared/components/org-centered-modal';
import { Button } from '@/shared/components/button/button';
import { formatCurrency } from '@/shared/utils/currency';
import { CashRegisterService, type CashRegisterSession } from '../services/cash-register.service';
import { useCashRegisterStore } from '../store/cash-register.store';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';

interface PosCashCloseModalProps {
  visible: boolean;
  onClose: () => void;
  session: CashRegisterSession | null;
  onClosed?: () => void;
}

function parseAmount(text: string): number {
  if (!text) return 0;
  return parseFloat(text.replace(/\s/g, '').replace(',', '.')) || 0;
}

/**
 * Modal "Cerrar Caja" — paridad con `pos-session-close-modal.component.ts` web.
 *
 *  - Muestra monto de apertura + esperado (si el backend lo provee).
 *  - Input numérico para el monto real contado.
 *  - Resalta la diferencia (sobrante/faltante) en verde/rojo.
 *  - Al confirmar: `POST .../sessions/:id/close` → `clearSession()`.
 */
export function PosCashCloseModal({ visible, onClose, session, onClosed }: PosCashCloseModalProps) {
  const queryClient = useQueryClient();
  const clearSession = useCashRegisterStore((s) => s.clearSession);

  const [actualText, setActualText] = useState('');
  const [notes, setNotes] = useState('');

  const actual = parseAmount(actualText);
  const expected = session?.expected_closing_amount ?? null;
  const difference = expected != null ? actual - expected : null;

  const { data: movements = [] } = useQuery({
    queryKey: ['cash-movements', session?.id],
    queryFn: () => CashRegisterService.getMovements(session!.id),
    enabled: visible && session != null,
  });

  const closeMutation = useMutation({
    mutationFn: () =>
      CashRegisterService.closeSession(session!.id, actual, notes.trim() || undefined),
    onSuccess: () => {
      clearSession();
      queryClient.invalidateQueries({ queryKey: ['cash-session-active'] });
      toastSuccess('Caja cerrada correctamente');
      setActualText('');
      setNotes('');
      onClose();
      onClosed?.();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? err?.message ?? 'Error al cerrar la caja';
      toastError(msg);
    },
  });

  const salesByMethod = useMemo(() => {
    const sales = movements.filter((m) => m.type === 'sale');
    const groups: Record<string, { count: number; total: number }> = {};
    sales.forEach((s) => {
      const method = s.payment_method || 'Efectivo';
      if (!groups[method]) {
        groups[method] = { count: 0, total: 0 };
      }
      groups[method].count += 1;
      groups[method].total += Number(s.amount);
    });
    return Object.entries(groups).map(([method, data]) => ({
      method,
      count: data.count,
      total: data.total,
    }));
  }, [movements]);

  const differenceLabel = useMemo(() => {
    if (difference == null) return null;
    if (difference === 0) return { text: 'Cuadre exacto', tone: 'ok' as const };
    if (difference > 0) return { text: `Sobrante: +${formatCurrency(difference)}`, tone: 'ok' as const };
    return { text: `Faltante: ${formatCurrency(difference)}`, tone: 'bad' as const };
  }, [difference]);

  const isValid = actualText.trim().length > 0 && actual >= 0 && session != null;

  return (
    <OrgCenteredModal
      visible={visible}
      onClose={onClose}
      title="Cerrar Caja"
      subtitle={session ? `Sesión #${session.id}` : undefined}
      size="md"
      footer={
        <View style={styles.footerRow}>
          <Button
            title="Cancelar"
            variant="primary"
            style={{
              backgroundColor: '#0F2A1D', // Verde muy oscuro
              borderRadius: borderRadius.lg,
              paddingHorizontal: spacing[5],
              height: 40,
            }}
            onPress={onClose}
          />
          <Button
            title="Cerrar Caja"
            variant="primary"
            leftIcon={<Icon name="lock" size={16} color="#FFFFFF" />}
            style={{
              backgroundColor: '#00E676', // Verde brillante
              borderRadius: borderRadius.lg,
              paddingHorizontal: spacing[5],
              height: 40,
            }}
            onPress={() => closeMutation.mutate()}
            disabled={!isValid}
            loading={closeMutation.isPending}
          />
        </View>
      }
    >
      {!session ? (
        <View style={styles.emptyBox}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.formContainer}
        >
          {/* Info cards (Monto apertura + Cajero) */}
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Monto Apertura</Text>
              <Text style={styles.statValue}>{formatCurrency(session.opening_amount)}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Cajero</Text>
              <Text style={styles.statValue} numberOfLines={1}>
                {session.opened_by_user
                  ? `${session.opened_by_user.first_name} ${session.opened_by_user.last_name}`
                  : 'Vendix Demo'}
              </Text>
            </View>
          </View>

          {/* Resumen de Movimientos Card */}
          <View style={styles.summaryCard}>
            <Text style={styles.summaryCardSectionTitle}>Resumen de Movimientos</Text>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryRowLabel}>Apertura</Text>
              <Text style={styles.summaryRowValue}>{formatCurrency(session.opening_amount)}</Text>
            </View>

            {salesByMethod.length > 0 && (
              <>
                <Text style={[styles.summaryCardSectionTitle, { marginTop: spacing[3] }]}>
                  Ventas por Método
                </Text>
                {salesByMethod.map((s, idx) => (
                  <View key={idx} style={styles.summaryRow}>
                    <Text style={styles.summaryRowMethodText}>+ {s.method} ({s.count})</Text>
                    <Text style={styles.summaryRowMethodText}>{formatCurrency(s.total)}</Text>
                  </View>
                ))}
              </>
            )}

            <View style={[styles.summaryRow, styles.summaryRowTotal]}>
              <Text style={styles.summaryRowTotalLabel}>Efectivo Esperado en Caja</Text>
              <Text style={styles.summaryRowTotalValue}>
                {expected != null ? formatCurrency(expected) : '—'}
              </Text>
            </View>
          </View>

          {/* Conteo Real */}
          <Text style={[styles.fieldLabel, { marginTop: spacing[4] }]}>
            Conteo Real de Efectivo <Text style={{ color: colorScales.red[500] }}>*</Text>
          </Text>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              value={actualText}
              onChangeText={setActualText}
              placeholder="0"
              placeholderTextColor={colorScales.gray[400]}
              keyboardType="decimal-pad"
              returnKeyType="next"
            />
          </View>

          {/* Diferencia preview */}
          {differenceLabel && (
            <View
              style={[
                styles.diffBox,
                differenceLabel.tone === 'ok'
                  ? { backgroundColor: 'rgba(22, 163, 74, 0.10)', borderColor: 'rgba(22, 163, 74, 0.3)' }
                  : { backgroundColor: 'rgba(239, 68, 68, 0.10)', borderColor: 'rgba(239, 68, 68, 0.3)' },
              ]}
            >
              <Icon
                name={differenceLabel.tone === 'ok' ? 'check-circle' : 'alert-circle'}
                size={16}
                color={differenceLabel.tone === 'ok' ? colorScales.green[600] : colorScales.red[600]}
              />
              <Text
                style={[
                  styles.diffText,
                  { color: differenceLabel.tone === 'ok' ? colorScales.green[700] : colorScales.red[700] },
                ]}
              >
                {differenceLabel.text}
              </Text>
            </View>
          )}

          {/* Notas */}
          <Text style={[styles.fieldLabel, { marginTop: spacing[4] }]}>Notas de Cierre</Text>
          <View style={[styles.inputWrap, { alignItems: 'flex-start' }]}>
            <TextInput
              style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Observaciones del cierre..."
              placeholderTextColor={colorScales.gray[400]}
              multiline
            />
          </View>
          <Text style={styles.fieldDesc}>Opcional — novedades del turno, faltantes, etc.</Text>
        </KeyboardAvoidingView>
      )}
    </OrgCenteredModal>
  );
}

const styles = StyleSheet.create({
  formContainer: {
    paddingVertical: spacing[2],
  },
  emptyBox: { paddingVertical: spacing[10], alignItems: 'center' },
  statsRow: { flexDirection: 'row', gap: spacing[3] },
  statBox: {
    flex: 1,
    padding: spacing[3],
    borderRadius: borderRadius.xl,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  statLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: colorScales.gray[500],
    fontFamily: typography.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  statValue: {
    fontSize: typography.fontSize.lg,
    fontWeight: '700',
    color: colorScales.gray[900],
    fontFamily: typography.fontFamily,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    marginTop: spacing[4],
    padding: spacing[4],
  },
  summaryCardSectionTitle: {
    fontSize: 9,
    fontWeight: '600',
    color: colorScales.gray[400],
    fontFamily: typography.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing[2],
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing[1.5],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  summaryRowLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    fontFamily: typography.fontFamily,
  },
  summaryRowValue: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[800],
    fontFamily: typography.fontFamily,
    fontWeight: '500',
  },
  summaryRowMethodText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.green[600],
    fontFamily: typography.fontFamily,
    fontWeight: '500',
  },
  summaryRowTotal: {
    borderBottomWidth: 0,
    marginTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    paddingTop: spacing[3],
  },
  summaryRowTotalLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: '700',
    color: colorScales.gray[900],
    fontFamily: typography.fontFamily,
  },
  summaryRowTotalValue: {
    fontSize: typography.fontSize.base,
    fontWeight: '700',
    color: colorScales.gray[900],
    fontFamily: typography.fontFamily,
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
  diffBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    marginTop: spacing[3],
  },
  diffText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    fontFamily: typography.fontFamily,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[2],
    width: '100%',
  },
});
