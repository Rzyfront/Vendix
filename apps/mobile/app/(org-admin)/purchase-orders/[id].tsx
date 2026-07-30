import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { OrgPurchaseOrdersService } from '@/features/org/services/org-purchase-orders.service';
import { Card } from '@/shared/components/card/card';
import { Spinner } from '@/shared/components/spinner/spinner';
import { Button } from '@/shared/components/button/button';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { OrgDetailRow } from '@/shared/components/org-detail-row';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, typography } from '@/shared/theme';
import { formatDate } from '@/shared/utils/date';
import { formatCurrency } from '@/shared/utils/currency';

/**
 * Pantalla de detalle de una orden de compra a nivel organización.
 *
 * El botón "Marcar como recibida" está intencionalmente AUSENTE: la recepción
 * detallada (`POST /:id/receive`) requiere `items: [{ id, quantity_received }]`
 * con los IDs de línea y cantidades elegidas por el operador, además de
 * opcionalmente serial numbers y overrides de precio por línea. La pantalla
 * móvil aún no captura esa información; el editor de recepción del backend
 * (web) es la fuente de verdad hasta que lo implementemos aquí.
 */
export default function PurchaseOrderDetail() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const [refreshing, setRefreshing] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['org-purchase-order', id],
    queryFn: () => OrgPurchaseOrdersService.get(id),
    enabled: !!id,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await detailQuery.refetch();
    setRefreshing(false);
  };

  if (!id) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <EmptyState
          icon="package-x"
          title="Orden no especificada"
          description="No se proporcionó un ID de orden. Vuelve a la lista e intenta de nuevo."
          actionLabel="Volver al listado"
          onAction={() => router.replace('/(org-admin)/purchase-orders')}
        />
      </SafeAreaView>
    );
  }

  if (detailQuery.isLoading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Spinner size="large" />
      </SafeAreaView>
    );
  }

  if (detailQuery.isError) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <EmptyState
          icon="alert-triangle"
          title="No se pudo cargar la orden"
          description="Hubo un problema al consultar el servidor. Intenta nuevamente."
          actionLabel="Reintentar"
          onAction={() => detailQuery.refetch()}
        />
      </SafeAreaView>
    );
  }

  const po = detailQuery.data;

  if (!po) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <EmptyState
          icon="package-x"
          title="Orden no encontrada"
          description={`No existe una orden con el ID "${id}". Es posible que haya sido eliminada.`}
          actionLabel="Volver al listado"
          onAction={() => router.replace('/(org-admin)/purchase-orders')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        <Card>
          <Text style={styles.title}>#{po.po_number}</Text>
          <OrgDetailRow label="Proveedor" value={po.supplier_name} icon="factory" />
          <OrgDetailRow
            label={po.location_name ? 'Ubicación destino' : 'Tienda'}
            value={po.location_name ?? po.store_name ?? '—'}
            icon={po.location_name ? 'warehouse' : 'store'}
          />
          <OrgDetailRow label="Estado" value={po.status} icon="info" />
          <OrgDetailRow
            label="Fecha"
            value={po.order_date ? formatDate(po.order_date) : '—'}
            icon="calendar"
          />
          {po.expected_date ? (
            <OrgDetailRow
              label="Esperada"
              value={formatDate(po.expected_date)}
              icon="calendar-clock"
            />
          ) : null}
          {po.received_date ? (
            <OrgDetailRow
              label="Recibida"
              value={formatDate(po.received_date)}
              icon="check-circle"
            />
          ) : null}
        </Card>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Totales</Text>
          <Card>
            <OrgDetailRow label="Items" value={po.total_items} icon="package" />
            <OrgDetailRow label="Cantidad" value={po.total_quantity} />
            <OrgDetailRow label="Subtotal" value={formatCurrency(po.subtotal.amount)} />
            <OrgDetailRow label="Impuestos" value={formatCurrency(po.tax_total.amount)} />
            <OrgDetailRow label="Total" value={formatCurrency(po.total.amount)} />
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

        {/* Aviso de recepción — copy honesto.
            El editor de recepción detallada (items + serial numbers) no está
            aún en mobile. Mantenemos la nota informativa en lugar de un
            botón roto. */}
        {po.status === 'APPROVED' || po.status === 'IN_TRANSIT' || po.status === 'PARTIAL' ? (
          <View style={styles.receptionNote}>
            <Icon name="info" size={14} color={colorScales.amber[700]} />
            <Text style={styles.receptionNoteText}>
              La recepción se realiza desde el editor de recepción del backend
              (web). Por cada línea confirmas la cantidad recibida y, si
              aplica, los serial numbers. Esta pantalla aún no captura esos
              datos{' '}
              <Text style={styles.receptionNoteHighlight}>
                — tocar el botón sólo abriría un modal en blanco.
              </Text>
            </Text>
          </View>
        ) : null}

        {po.status === 'RECEIVED' ? (
          <View style={styles.receivedNote}>
            <Icon name="check-circle" size={14} color={colors.success} />
            <Text style={styles.receivedNoteText}>
              Esta orden ya fue recibida el{' '}
              {po.received_date ? formatDate(po.received_date) : '—'}.
            </Text>
          </View>
        ) : null}

        <View style={styles.footer}>
          <Button title="Volver al listado" variant="secondary" onPress={() => router.back()} fullWidth />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colorScales.gray[50] },
  content: { padding: spacing[4], paddingBottom: spacing[12] },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
    marginBottom: spacing[2],
  },
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
  receptionNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    marginTop: spacing[4],
    padding: spacing[3],
    borderRadius: 8,
    backgroundColor: colorScales.amber[50],
    borderWidth: 1,
    borderColor: colorScales.amber[200],
  },
  receptionNoteText: { flex: 1, fontSize: typography.fontSize.xs, color: colorScales.amber[800] },
  receptionNoteHighlight: { fontWeight: typography.fontWeight.semibold },
  receivedNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[4],
    padding: spacing[3],
    borderRadius: 8,
    backgroundColor: colorScales.green[50],
    borderWidth: 1,
    borderColor: colorScales.green[200],
  },
  receivedNoteText: { flex: 1, fontSize: typography.fontSize.xs, color: colorScales.green[800] },
  footer: { marginTop: spacing[6] },
});
