import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OrgReportsService } from '@/features/org/services/org-reports.service';
import { Card } from '@/shared/components/card/card';
import { Spinner } from '@/shared/components/spinner/spinner';
import { OrgStatsGrid } from '@/shared/components/org-stats-grid';
import { OrgListItem } from '@/shared/components/org-list-item';
import { colors, colorScales, spacing, typography } from '@/shared/theme';
import { formatCurrency } from '@/shared/utils/currency';

function lastMonthRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return { start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10) };
}

export default function InventoryReportScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const filter = lastMonthRange();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-reports-inventory', filter],
    queryFn: () => OrgReportsService.getInventory(filter),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Spinner size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={styles.title}>Reporte de Inventario</Text>
        <Text style={styles.subtitle}>{filter.start_date} – {filter.end_date}</Text>

        {data ? (
          <>
            <View style={styles.section}>
              <OrgStatsGrid
                columns={2}
                stats={[
                  { label: 'Productos', value: data.total_products, icon: 'package' },
                  { label: 'Valor total', value: formatCurrency(data.total_value.amount), icon: 'dollar-sign', color: colors.success },
                  { label: 'Stock bajo', value: data.low_stock?.length ?? 0, icon: 'alert-triangle', color: colorScales.amber[500] },
                  { label: 'Por vencer', value: data.expiring_batches, icon: 'clock', color: colorScales.red[500] },
                ]}
              />
            </View>

            {data.by_location?.length ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Por ubicación</Text>
                {data.by_location.map((l, i) => (
                  <OrgListItem
                    key={i}
                    title={l.location_name}
                    subtitle={`${l.quantity} unidades`}
                    leftIcon="map"
                    rightValue={formatCurrency(l.value.amount)}
                    chevron={false}
                  />
                ))}
              </View>
            ) : null}

            {data.low_stock?.length ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Stock bajo</Text>
                {data.low_stock.map((p, i) => (
                  <OrgListItem
                    key={i}
                    title={p.product_name}
                    subtitle={`Actual: ${p.current} • Mínimo: ${p.min}`}
                    leftIcon="alert-triangle"
                    leftIconColor={colorScales.red[500]}
                    chevron={false}
                  />
                ))}
              </View>
            ) : null}
          </>
        ) : (
          <Card>
            <Text style={styles.muted}>No hay datos para el periodo.</Text>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colorScales.gray[50] },
  content: { padding: spacing[4] },
  title: { fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.bold, color: colorScales.gray[900] },
  subtitle: { fontSize: typography.fontSize.sm, color: colorScales.gray[500], marginTop: 2, marginBottom: spacing[4] },
  section: { marginBottom: spacing[4] },
  sectionTitle: { fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.semibold, color: colorScales.gray[500], textTransform: 'uppercase', marginBottom: spacing[2] },
  muted: { color: colorScales.gray[500], textAlign: 'center' },
});
