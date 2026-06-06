import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OrgPurchaseOrdersService } from '@/features/org/services/org-purchase-orders.service';
import { OrgInventoryService } from '@/features/org/services/org-inventory.service';
import { Card } from '@/shared/components/card/card';
import { Spinner } from '@/shared/components/spinner/spinner';
import { Button } from '@/shared/components/button/button';
import { OrgDetailRow } from '@/shared/components/org-detail-row';
import { colors, colorScales, spacing, typography } from '@/shared/theme';

export default function PurchaseOrderDetail() {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  // We accept a route param `id` via expo-router
  // import { useLocalSearchParams } from 'expo-router';
  // const { id } = useLocalSearchParams<{ id: string }>();
  // For this static template we read it from query string / path
  const id = (global as any).__orgPoId ?? '';

  const detailQuery = useQuery({
    queryKey: ['org-purchase-order', id],
    queryFn: () => OrgPurchaseOrdersService.get(id),
    enabled: !!id,
  });

  const receiveMutation = useMutation({
    mutationFn: () => OrgPurchaseOrdersService.receive(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-purchase-order', id] });
      Alert.alert('Recibido', 'La orden fue marcada como recibida.');
    },
    onError: () => Alert.alert('Error', 'No se pudo recibir la orden.'),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await detailQuery.refetch();
    setRefreshing(false);
  };

  if (detailQuery.isLoading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Spinner size="large" />
      </SafeAreaView>
    );
  }

  const po = detailQuery.data;

  if (!po) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Text style={styles.muted}>Orden no encontrada</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Card>
          <Text style={styles.title}>#{po.po_number}</Text>
          <OrgDetailRow label="Proveedor" value={po.supplier_name} icon="factory" />
          <OrgDetailRow label="Tienda" value={po.store_name} icon="store" />
          <OrgDetailRow label="Estado" value={po.status} icon="info" />
          <OrgDetailRow label="Fecha" value={new Date(po.order_date).toLocaleDateString()} icon="calendar" />
          {po.expected_date ? <OrgDetailRow label="Esperada" value={new Date(po.expected_date).toLocaleDateString()} icon="calendar-clock" /> : null}
          {po.received_date ? <OrgDetailRow label="Recibida" value={new Date(po.received_date).toLocaleDateString()} icon="check-circle" /> : null}
        </Card>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Totales</Text>
          <Card>
            <OrgDetailRow label="Items" value={po.total_items} icon="package" />
            <OrgDetailRow label="Cantidad" value={po.total_quantity} />
            <OrgDetailRow label="Subtotal" value={po.subtotal.amount.toLocaleString('es-CO', { style: 'currency', currency: 'COP' })} />
            <OrgDetailRow label="Impuestos" value={po.tax_total.amount.toLocaleString('es-CO', { style: 'currency', currency: 'COP' })} />
            <OrgDetailRow label="Total" value={po.total.amount.toLocaleString('es-CO', { style: 'currency', currency: 'COP' })} />
          </Card>
        </View>

        {po.notes ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notas</Text>
            <Card>
              <Text style={styles.notes}>{po.notes}</Text>
            </Card>
          </View>
        ) : null}

        {(po.status === 'APPROVED' || po.status === 'IN_TRANSIT') ? (
          <View style={styles.actions}>
            <Button
              title="Marcar como recibida"
              onPress={() => receiveMutation.mutate()}
              loading={receiveMutation.isPending}
              fullWidth
            />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colorScales.gray[50] },
  content: { padding: spacing[4] },
  title: { fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.bold, color: colorScales.gray[900], marginBottom: spacing[2] },
  muted: { color: colorScales.gray[500] },
  section: { marginTop: spacing[4] },
  sectionTitle: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    marginBottom: spacing[2],
  },
  notes: { fontSize: typography.fontSize.sm, color: colorScales.gray[700] },
  actions: { marginTop: spacing[4] },
});
