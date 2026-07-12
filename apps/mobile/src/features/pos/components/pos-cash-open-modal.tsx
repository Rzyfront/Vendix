/**
 * Modal para abrir una sesión de caja registradora.
 *
 * BottomSheet con lista de cajas activas + input de monto de apertura.
 * Al confirmar, llama `CashRegisterService.openSession`, escribe la sesión
 * activa en `useCashRegisterStore` y refresca la query `cash-session-active`
 * para que el header de la pantalla POS refleje el nuevo estado sin flicker.
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { BottomSheet } from '@/shared/components/bottom-sheet/bottom-sheet';
import { Button } from '@/shared/components/button/button';
import { Icon } from '@/shared/components/icon/icon';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { CashRegisterService } from '@/features/pos/services/cash-register.service';
import { useCashRegisterStore } from '@/features/pos/store/cash-register.store';

export interface PosCashOpenModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Parsea texto de monto de forma estricta.
 *
 * Devuelve `null` si el texto no representa un número válido (vacío, contiene
 * caracteres no numéricos como letras o símbolos, etc.) — antes se coercía
 * silenciosamente a `0`, lo cual permitía enviar `opening_amount: 0` al backend
 * con el modal aún marcado como válido.
 *
 * Acepta separadores de miles `.` o `,` como punto decimal (es-CO).
 */
const parseAmount = (text: string): number | null => {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const normalized = trimmed.replace(',', '.');
  // Solo dígitos, un único punto decimal opcional y signo negativo opcional
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
};

export const PosCashOpenModal: React.FC<PosCashOpenModalProps> = ({ visible, onClose }) => {
  const [selectedRegisterId, setSelectedRegisterId] = useState<number | null>(null);
  const [amountText, setAmountText] = useState('');

  const queryClient = useQueryClient();
  const setActiveSession = useCashRegisterStore((s) => s.setActiveSession);

  const { data: registers = [], isLoading } = useQuery({
    queryKey: ['cash-registers', 'list'],
    queryFn: () => CashRegisterService.listRegisters(),
    enabled: visible,
  });

  // Auto-select the first active register and pre-fill its default opening amount
  // whenever the list loads or the modal re-opens.
  useEffect(() => {
    if (!visible) return;
    if (selectedRegisterId != null) return;
    const first = registers.find((r) => r.is_active);
    if (first) {
      setSelectedRegisterId(first.id);
      if (first.default_opening_amount != null) {
        setAmountText(String(first.default_opening_amount));
      }
    }
  }, [visible, registers, selectedRegisterId]);

  const selectedRegister = registers.find((r) => r.id === selectedRegisterId) ?? null;
  const amount = parseAmount(amountText);
  // `amount == null` ⇒ texto inválido o vacío; el botón se mantiene deshabilitado.
  // `amount >= 0` permite apertura con monto 0 (registros sin default_opening_amount).
  const isValid =
    selectedRegisterId != null && amount != null && amount >= 0;

  const openMutation = useMutation({
    // `amount!` es seguro — `isValid` arriba garantiza `amount != null` antes de habilitar el submit.
    mutationFn: () => CashRegisterService.openSession(selectedRegisterId!, amount!),
    onSuccess: (session) => {
      setActiveSession(session);
      queryClient.invalidateQueries({ queryKey: ['cash-session-active'] });
      queryClient.invalidateQueries({ queryKey: ['cash-registers', 'list'] });
      toastSuccess(`Caja abierta: ${session.register?.name ?? 'correctamente'}`);
      handleClose();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? err?.message ?? 'Error al abrir la caja';
      toastError(msg);
    },
  });

  const handleClose = useCallback(() => {
    setSelectedRegisterId(null);
    setAmountText('');
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(() => {
    if (!selectedRegisterId) {
      Alert.alert('Caja requerida', 'Selecciona una caja registradora');
      return;
    }
    if (amountText.trim().length === 0) {
      Alert.alert('Monto requerido', 'Ingresa el monto de apertura');
      return;
    }
    openMutation.mutate();
  }, [selectedRegisterId, amountText, openMutation]);

  return (
    <BottomSheet visible={visible} onClose={handleClose} snapPoint="partial">
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerIcon}>
            <Icon name="wallet" size={20} color={colors.primary} />
          </View>
          <View>
            <Text style={styles.headerTitle}>Abrir Caja</Text>
            <Text style={styles.headerSubtitle}>
              Selecciona la caja e ingresa el monto inicial
            </Text>
          </View>
        </View>
        <Pressable onPress={handleClose} style={styles.closeBtn} hitSlop={8}>
          <Icon name="x" size={20} color={colorScales.gray[400]} />
        </Pressable>
      </View>

      <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionLabel}>CAJA REGISTRADORA</Text>
        {isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Cargando cajas…</Text>
          </View>
        ) : registers.length === 0 ? (
          <Text style={styles.emptyText}>
            No hay cajas registradoras activas. Crea una en Configuración.
          </Text>
        ) : (
          <View style={styles.registerList}>
            {registers.map((reg) => {
              const selected = reg.id === selectedRegisterId;
              return (
                <Pressable
                  key={reg.id}
                  style={[styles.registerRow, selected && styles.registerRowActive]}
                  onPress={() => {
                    setSelectedRegisterId(reg.id);
                    if (reg.default_opening_amount != null) {
                      setAmountText(String(reg.default_opening_amount));
                    }
                  }}
                >
                  <View style={[styles.radio, selected && styles.radioActive]}>
                    {selected && <View style={styles.radioDot} />}
                  </View>
                  <View style={styles.registerInfo}>
                    <Text style={styles.registerName}>{reg.name}</Text>
                    <Text style={styles.registerCode}>Código: {reg.code}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={styles.amountField}>
          <Text style={styles.sectionLabel}>MONTO DE APERTURA</Text>
          <TextInput
            style={styles.amountInput}
            value={amountText}
            onChangeText={setAmountText}
            placeholder="0"
            placeholderTextColor={colorScales.gray[400]}
            keyboardType="decimal-pad"
          />
          {selectedRegister?.default_opening_amount != null && (
            <Text style={styles.hintText}>
              Sugerido por la caja: {selectedRegister.default_opening_amount}
            </Text>
          )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.cancelBtn} onPress={handleClose} disabled={openMutation.isPending}>
          <Text style={styles.cancelBtnText}>Cancelar</Text>
        </Pressable>
        <View style={styles.submitBtn}>
          <Button
            title={openMutation.isPending ? 'Abriendo…' : 'Abrir Caja'}
            onPress={handleSubmit}
            disabled={!isValid || openMutation.isPending}
            loading={openMutation.isPending}
          />
        </View>
      </View>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[4],
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
    backgroundColor: colorScales.green[50],
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
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
  },
  sectionLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
    marginBottom: spacing[2],
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[4],
  },
  loadingText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  emptyText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    textAlign: 'center',
    paddingVertical: spacing[6],
  },
  registerList: {
    gap: spacing[2],
    marginBottom: spacing[4],
  },
  registerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    backgroundColor: colorScales.gray[50],
  },
  registerRowActive: {
    borderColor: colors.primary,
    backgroundColor: colorScales.green[50],
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
  radioActive: {
    borderColor: colors.primary,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  registerInfo: {
    flex: 1,
  },
  registerName: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  registerCode: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  amountField: {
    paddingBottom: spacing[4],
  },
  amountInput: {
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
  hintText: {
    marginTop: spacing[2],
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    textAlign: 'center',
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
