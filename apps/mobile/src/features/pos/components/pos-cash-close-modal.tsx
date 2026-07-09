/**
 * Modal para cerrar la sesión de caja registradora activa.
 *
 * Modal centrado con resumen de la sesión (monto apertura, cajero, efectivo
 * esperado) + input de conteo real + notas opcionales. Al confirmar llama
 * `CashRegisterService.closeSession`, limpia `useCashRegisterStore` y refresca
 * la query `cash-session-active` para que el header badge vuelva a "Sin caja".
 */
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { Button } from '@/shared/components/button/button';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import {
  CashRegisterService,
  type CashRegisterSession,
} from '@/features/pos/services/cash-register.service';
import { useCashRegisterStore } from '@/features/pos/store/cash-register.store';

export interface PosCashCloseModalProps {
  visible: boolean;
  onClose: () => void;
  session: CashRegisterSession | null;
}

const parseAmount = (text: string): number => {
  const normalized = text.replace(',', '.').replace(/[^0-9.]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
};

const formatCurrency = (n: number | null | undefined): string => {
  if (n == null) return '—';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n);
};

export const PosCashCloseModal: React.FC<PosCashCloseModalProps> = ({
  visible,
  onClose,
  session,
}) => {
  const [actualText, setActualText] = useState('');
  const [notes, setNotes] = useState('');

  const queryClient = useQueryClient();
  const clearSession = useCashRegisterStore((s) => s.clearSession);

  const { data: movements = [], isLoading: movementsLoading } = useQuery({
    queryKey: ['cash-registers', 'movements', session?.id],
    queryFn: () => CashRegisterService.getMovements(session!.id),
    enabled: visible && session != null,
  });

  // Sales-by-method aggregation for the summary block.
  const salesByMethod = useMemo(() => {
    const grouped = new Map<string, { count: number; total: number }>();
    for (const m of movements) {
      if (m.type !== 'sale') continue;
      const method = m.payment_method ?? 'otro';
      const entry = grouped.get(method) ?? { count: 0, total: 0 };
      entry.count += 1;
      entry.total += m.amount;
      grouped.set(method, entry);
    }
    return Array.from(grouped.entries()).map(([method, v]) => ({ method, ...v }));
  }, [movements]);

  const actual = parseAmount(actualText);
  const expected = session?.expected_closing_amount ?? null;
  const difference = expected != null ? actual - expected : null;
  const isValid = session != null && actualText.trim().length > 0 && actual >= 0;

  const closeMutation = useMutation({
    mutationFn: () =>
      CashRegisterService.closeSession(
        session!.id,
        actual,
        notes.trim() || undefined,
      ),
    onSuccess: () => {
      clearSession();
      queryClient.invalidateQueries({ queryKey: ['cash-session-active'] });
      toastSuccess('Caja cerrada correctamente');
      handleClose();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? err?.message ?? 'Error al cerrar la caja';
      toastError(msg);
    },
  });

  const handleClose = useCallback(() => {
    setActualText('');
    setNotes('');
    onClose();
  }, [onClose]);

  // Reset state whenever the modal is closed (defensive).
  useEffect(() => {
    if (!visible) {
      setActualText('');
      setNotes('');
    }
  }, [visible]);

  if (!session) {
    return (
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={onClose}
        statusBarTranslucent
      >
        <View style={styles.backdrop}>
          <View style={styles.container}>
            <View style={styles.surface}>
              <View style={styles.emptyBody}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.emptyText}>Sin sesión activa</Text>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  const cashierName = session.opened_by_user
    ? `${session.opened_by_user.first_name} ${session.opened_by_user.last_name ?? ''}`.trim()
    : 'Cajero';

  const diffBadge = (() => {
    if (difference == null) return null;
    if (difference === 0) {
      return { label: 'Cuadre exacto', color: colorScales.green[600], bg: colorScales.green[50] };
    }
    if (difference > 0) {
      return {
        label: `Sobrante: +${formatCurrency(difference)}`,
        color: colorScales.amber[700],
        bg: colorScales.amber[50],
      };
    }
    return {
      label: `Faltante: ${formatCurrency(difference)}`,
      color: colorScales.red[700],
      bg: colorScales.red[50],
    };
  })();

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
              <View style={styles.header}>
                <View style={styles.headerLeft}>
                  <View style={styles.headerIcon}>
                    <Icon name="cash-register" size={20} color={colors.primary} />
                  </View>
                  <View>
                    <Text style={styles.headerTitle}>Cerrar Caja</Text>
                    <Text style={styles.headerSubtitle}>
                      {session.register?.name ?? `Sesión #${session.id}`}
                    </Text>
                  </View>
                </View>
                <Pressable onPress={handleClose} style={styles.closeBtn} hitSlop={8}>
                  <Icon name="x" size={20} color={colorScales.gray[400]} />
                </Pressable>
              </View>

              <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
                <View style={styles.infoRow}>
                  <View style={styles.infoCard}>
                    <Text style={styles.infoLabel}>MONTO APERTURA</Text>
                    <Text style={styles.infoValue}>{formatCurrency(session.opening_amount)}</Text>
                  </View>
                  <View style={styles.infoCard}>
                    <Text style={styles.infoLabel}>CAJERO</Text>
                    <Text style={styles.infoValueSmall}>{cashierName}</Text>
                  </View>
                </View>

                <View style={styles.summaryBlock}>
                  <Text style={styles.sectionLabel}>RESUMEN DE CAJA</Text>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Apertura</Text>
                    <Text style={styles.summaryValue}>{formatCurrency(session.opening_amount)}</Text>
                  </View>
                  {movementsLoading ? (
                    <View style={styles.summaryLoading}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={styles.summaryLoadingText}>Cargando movimientos…</Text>
                    </View>
                  ) : (
                    salesByMethod.map((row) => (
                      <View key={row.method} style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>
                          Ventas · {row.method} ({row.count})
                        </Text>
                        <Text style={styles.summaryValuePositive}>
                          +{formatCurrency(row.total)}
                        </Text>
                      </View>
                    ))
                  )}
                  <View style={[styles.summaryRow, styles.summaryRowTotal]}>
                    <Text style={styles.summaryLabelTotal}>Efectivo esperado en caja</Text>
                    <Text style={styles.summaryValueTotal}>{formatCurrency(expected)}</Text>
                  </View>
                </View>

                <View style={styles.field}>
                  <Text style={styles.sectionLabel}>
                    CONTEO REAL DE EFECTIVO <Text style={styles.required}>*</Text>
                  </Text>
                  <TextInput
                    style={styles.actualInput}
                    value={actualText}
                    onChangeText={setActualText}
                    placeholder="0"
                    placeholderTextColor={colorScales.gray[400]}
                    keyboardType="decimal-pad"
                  />
                  {diffBadge && (
                    <View style={[styles.diffBadge, { backgroundColor: diffBadge.bg }]}>
                      <Text style={[styles.diffBadgeText, { color: diffBadge.color }]}>
                        {diffBadge.label}
                      </Text>
                    </View>
                  )}
                </View>

                <View style={styles.field}>
                  <Text style={styles.sectionLabel}>NOTAS DE CIERRE</Text>
                  <TextInput
                    style={styles.notesInput}
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Opcional — comentarios sobre el cierre…"
                    placeholderTextColor={colorScales.gray[400]}
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                  />
                </View>
              </ScrollView>

              <View style={styles.footer}>
                <Pressable
                  style={styles.cancelBtn}
                  onPress={handleClose}
                  disabled={closeMutation.isPending}
                >
                  <Text style={styles.cancelBtnText}>Cancelar</Text>
                </Pressable>
                <View style={styles.submitBtn}>
                  <Button
                    title={closeMutation.isPending ? 'Cerrando…' : 'Cerrar Caja'}
                    onPress={() => closeMutation.mutate()}
                    disabled={!isValid || closeMutation.isPending}
                    loading={closeMutation.isPending}
                  />
                </View>
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
  emptyBody: {
    padding: spacing[8],
    gap: spacing[3],
    alignItems: 'center',
  },
  emptyText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
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
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.red[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  headerSubtitle: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    maxHeight: 480,
  },
  infoRow: {
    flexDirection: 'row',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
  },
  infoCard: {
    flex: 1,
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    backgroundColor: colorScales.gray[50],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  infoLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    marginBottom: spacing[1],
  },
  infoValue: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  infoValueSmall: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  summaryBlock: {
    marginHorizontal: spacing[4],
    marginTop: spacing[4],
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    backgroundColor: colorScales.gray[50],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    gap: spacing[2],
  },
  sectionLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[600],
  },
  summaryValue: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  summaryValuePositive: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.green[700],
  },
  summaryRowTotal: {
    marginTop: spacing[2],
    paddingTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  summaryLabelTotal: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  summaryValueTotal: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  summaryLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  summaryLoadingText: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  field: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[2],
    gap: spacing[2],
  },
  required: {
    color: colors.error,
  },
  actualInput: {
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    fontSize: typography.fontSize.xl,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    backgroundColor: colorScales.gray[50],
    textAlign: 'center',
    fontWeight: typography.fontWeight.semibold as any,
  },
  diffBadge: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    alignItems: 'center',
  },
  diffBadgeText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
  },
  notesInput: {
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    backgroundColor: colorScales.gray[50],
    minHeight: 80,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    backgroundColor: colors.background,
    gap: spacing[3],
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: colorScales.gray[800],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3],
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
  submitBtn: {
    flex: 1.4,
  },
});
