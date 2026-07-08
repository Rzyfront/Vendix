import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Button,
  Card,
  Badge,
  Spinner,
  EmptyState,
} from '@/shared/components';
import { Icon } from '@/shared/components/icon/icon';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';
import { SerialNumbersService } from '@/features/store/services/serial-numbers.service';
import {
  colors,
  colorScales,
  spacing,
  borderRadius,
  typography,
} from '@/shared/theme';

interface SerialNumbersManagerModalProps {
  visible: boolean;
  onClose: () => void;
  productId: number;
  productName?: string;
}

const STATUS_LABELS: Record<string, string> = {
  in_stock: 'En stock',
  reserved: 'Reservado',
  sold: 'Vendido',
  damaged: 'Dañado',
  returned: 'Devuelto',
  in_repair: 'En reparación',
  written_off: 'Dado de baja',
};

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'info' | 'error' | 'neutral'> = {
  in_stock: 'success',
  reserved: 'warning',
  sold: 'info',
  damaged: 'error',
  returned: 'warning',
  in_repair: 'warning',
  written_off: 'neutral',
};

export function SerialNumbersManagerModal({
  visible,
  onClose,
  productId,
  productName,
}: SerialNumbersManagerModalProps) {
  const queryClient = useQueryClient();
  const [bulkInput, setBulkInput] = useState('');
  const [showBulkForm, setShowBulkForm] = useState(false);

  const summaryQuery = useQuery({
    queryKey: ['serial-numbers-summary', productId],
    queryFn: () => SerialNumbersService.summary(productId),
    enabled: visible && !!productId,
  });

  const listQuery = useQuery({
    queryKey: ['serial-numbers-list', productId],
    queryFn: () => SerialNumbersService.list({ product_id: productId, limit: 50 }),
    enabled: visible && !!productId,
  });

  const bulkMutation = useMutation({
    mutationFn: async (serials: string[]) =>
      SerialNumbersService.bulkCreate({ product_id: productId, serials }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['serial-numbers-summary', productId] });
      queryClient.invalidateQueries({ queryKey: ['serial-numbers-list', productId] });
      toastSuccess(
        `${result.created} serial(es) registrado(s)${result.skipped > 0 ? ` · ${result.skipped} omitido(s)` : ''}`,
      );
      setBulkInput('');
      setShowBulkForm(false);
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        'No se pudieron registrar los seriales';
      toastError(typeof msg === 'string' ? msg : 'Error al registrar seriales');
    },
  });

  function handleBulkSubmit() {
    const serials = bulkInput
      .split(/[\n,;]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (serials.length === 0) {
      toastError('Ingresa al menos un serial');
      return;
    }
    // Deduplicar conservando orden
    const unique = Array.from(new Set(serials));
    bulkMutation.mutate(unique);
  }

  const summary = summaryQuery.data;
  const serials = listQuery.data?.data ?? [];

  return (
    <Modal visible={visible} onClose={onClose} title="Gestionar seriales" showCloseButton>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        {productName ? (
          <Text style={styles.subtitle}>{productName}</Text>
        ) : null}

        {/* Stats resumen */}
        {summaryQuery.isLoading ? (
          <View style={styles.centered}>
            <Spinner size="md" />
          </View>
        ) : summary ? (
          <View style={styles.statsRow}>
            <View style={[styles.statCard, { backgroundColor: colorScales.blue[50], borderColor: colorScales.blue[100] }]}>
              <Text style={[styles.statLabel, { color: colorScales.blue[700] }]}>Total</Text>
              <Text style={[styles.statValue, { color: colorScales.blue[700] }]}>
                {summary.total}
              </Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: colorScales.green[50], borderColor: colorScales.green[100] }]}>
              <Text style={[styles.statLabel, { color: colorScales.green[700] }]}>En stock</Text>
              <Text style={[styles.statValue, { color: colorScales.green[700] }]}>
                {summary.in_stock}
              </Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: colorScales.amber[50], borderColor: colorScales.amber[100] }]}>
              <Text style={[styles.statLabel, { color: colorScales.amber[700] }]}>Reservados</Text>
              <Text style={[styles.statValue, { color: colorScales.amber[700] }]}>
                {summary.reserved}
              </Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: colorScales.purple[50], borderColor: colorScales.purple[100] }]}>
              <Text style={[styles.statLabel, { color: colorScales.purple[700] }]}>Vendidos</Text>
              <Text style={[styles.statValue, { color: colorScales.purple[700] }]}>
                {summary.sold}
              </Text>
            </View>
          </View>
        ) : null}

        {summary ? (
          (summary.warranty_expiring_soon > 0 || summary.warranty_expired > 0) ? (
            <View style={styles.warrantyBanner}>
              <Icon name="alert-triangle" size={14} color={colorScales.amber[700]} />
              <Text style={styles.warrantyText}>
                {summary.warranty_expiring_soon > 0
                  ? `${summary.warranty_expiring_soon} serial(es) con garantía por vencer`
                  : null}
                {summary.warranty_expiring_soon > 0 && summary.warranty_expired > 0 ? ' · ' : null}
                {summary.warranty_expired > 0
                  ? `${summary.warranty_expired} con garantía vencida`
                  : null}
              </Text>
            </View>
          ) : null
        ) : null}

        {/* Botón carga masiva */}
        <Card>
          <View style={styles.cardBody}>
            <View style={styles.bulkHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.bulkTitle}>Carga masiva</Text>
                <Text style={styles.bulkSubtitle}>
                  Pegá o escribí múltiples seriales (uno por línea, separados por coma o ;).
                </Text>
              </View>
              <Pressable
                onPress={() => setShowBulkForm((v) => !v)}
                hitSlop={6}
                style={styles.bulkToggle}
              >
                <Icon
                  name={showBulkForm ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.primary}
                />
                <Text style={styles.bulkToggleText}>
                  {showBulkForm ? 'Ocultar' : 'Expandir'}
                </Text>
              </Pressable>
            </View>
            {showBulkForm ? (
              <View style={{ marginTop: spacing[2] }}>
                <TextInput
                  value={bulkInput}
                  onChangeText={setBulkInput}
                  placeholder={'SN-001\nSN-002\nSN-003'}
                  placeholderTextColor={colorScales.gray[400]}
                  multiline
                  numberOfLines={5}
                  style={styles.bulkInput}
                />
                <View style={styles.bulkActions}>
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Cancelar"
                      variant="outline"
                      onPress={() => {
                        setBulkInput('');
                        setShowBulkForm(false);
                      }}
                      fullWidth
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Registrar seriales"
                      variant="primary"
                      onPress={handleBulkSubmit}
                      loading={bulkMutation.isPending}
                      fullWidth
                    />
                  </View>
                </View>
              </View>
            ) : null}
          </View>
        </Card>

        {/* Lista de seriales */}
        <Text style={styles.sectionLabel}>Últimos seriales registrados</Text>
        {listQuery.isLoading ? (
          <View style={styles.centered}>
            <Spinner size="md" />
          </View>
        ) : serials.length === 0 ? (
          <EmptyState
            title="Sin seriales"
            description="Aún no registrás seriales para este producto."
          />
        ) : (
          <View style={{ gap: spacing[2] }}>
            {serials.map((s) => (
              <Card key={s.id}>
                <View style={styles.serialRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.serialNumber} numberOfLines={1}>
                      {s.serial}
                    </Text>
                    {s.notes ? (
                      <Text style={styles.serialNotes} numberOfLines={1}>
                        {s.notes}
                      </Text>
                    ) : null}
                  </View>
                  <Badge
                    label={STATUS_LABELS[s.status] ?? s.status}
                    variant={STATUS_VARIANT[s.status] ?? 'neutral'}
                    size="xs"
                  />
                </View>
              </Card>
            ))}
          </View>
        )}

        {listQuery.isFetching ? (
          <View style={styles.refetchIndicator}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : null}
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: spacing[4],
    gap: spacing[3],
  },
  subtitle: {
    fontSize: typography.fontSize.sm,
    color: colors.text.secondary,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[4],
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  statCard: {
    flex: 1,
    minWidth: 80,
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: typography.fontSize.xl,
    fontWeight: '700',
    marginTop: spacing[1],
  },
  warrantyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.amber[200],
    backgroundColor: colorScales.amber[50],
  },
  warrantyText: {
    flex: 1,
    fontSize: typography.fontSize.xs,
    color: colorScales.amber[800],
  },
  cardBody: {
    padding: spacing[3],
    gap: spacing[2],
  },
  bulkHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
  },
  bulkTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: '700',
    color: colors.text.primary,
  },
  bulkSubtitle: {
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
    marginTop: 2,
  },
  bulkToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  bulkToggleText: {
    fontSize: typography.fontSize.xs,
    fontWeight: '700',
    color: colors.primary,
  },
  bulkInput: {
    minHeight: 100,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    backgroundColor: colorScales.gray[50],
    padding: spacing[2],
    fontSize: typography.fontSize.sm,
    color: colors.text.primary,
    textAlignVertical: 'top',
    fontFamily: typography.fontFamily,
  },
  bulkActions: {
    flexDirection: 'row',
    gap: spacing[2],
    marginTop: spacing[2],
  },
  sectionLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: colors.text.secondary,
    marginTop: spacing[2],
  },
  serialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
  },
  serialNumber: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600',
    color: colors.text.primary,
    fontFamily: typography.fontFamily,
  },
  serialNotes: {
    fontSize: 11,
    color: colors.text.secondary,
    marginTop: 2,
  },
  refetchIndicator: {
    alignItems: 'center',
    paddingVertical: spacing[2],
  },
});
