import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OrgInvoicingService } from '@/features/org/services/org-invoicing.service';
import { Card } from '@/shared/components/card/card';
import { Spinner } from '@/shared/components/spinner/spinner';
import { OrgBadge } from '@/shared/components/org-badge';
import { OrgDetailRow } from '@/shared/components/org-detail-row';
import { colors, colorScales, spacing, typography } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';

export default function DianConfigScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-invoicing-dian-config'],
    queryFn: () => OrgInvoicingService.getDianConfig(),
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
        <Card>
          <View style={styles.headRow}>
            <View>
              <Text style={styles.title}>Configuración DIAN</Text>
              <Text style={styles.subtitle}>Datos de facturación electrónica</Text>
            </View>
            <OrgBadge
              label={data?.environment ?? 'TEST'}
              variant={data?.environment === 'PRODUCTION' ? 'success' : 'warning'}
            />
          </View>

          <View style={styles.section}>
            <OrgDetailRow label="NIT" value={data?.nit} icon="hash" monospace />
            <OrgDetailRow label="Dígito verificación" value={data?.dv} monospace />
            <OrgDetailRow label="Razón social" value={data?.name} icon="building" />
            <OrgDetailRow label="Régimen" value={data?.regime} />
            <OrgDetailRow label="Software ID" value={data?.software_id} monospace />
            <OrgDetailRow label="Software PIN" value={data?.software_pin ? '••••••••' : undefined} monospace />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Certificado digital</Text>
            <View style={styles.certBox}>
              <Icon
                name={data?.certificate_status === 'ACTIVE' ? 'shield-check' : 'shield-alert'}
                size={20}
                color={
                  data?.certificate_status === 'ACTIVE'
                    ? colorScales.green[500]
                    : colorScales.amber[500]
                }
              />
              <View style={styles.certText}>
                <Text style={styles.certStatus}>{data?.certificate_status ?? 'PENDING'}</Text>
                {data?.certificate_expires_at ? (
                  <Text style={styles.certExpires}>
                    Vence: {new Date(data.certificate_expires_at).toLocaleDateString()}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colorScales.gray[50] },
  content: { padding: spacing[4] },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.bold, color: colorScales.gray[900] },
  subtitle: { fontSize: typography.fontSize.sm, color: colorScales.gray[500], marginTop: 2 },
  section: { marginTop: spacing[4] },
  sectionTitle: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    marginBottom: spacing[2],
  },
  certBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[3],
    backgroundColor: colorScales.gray[50],
    borderRadius: 12,
    gap: spacing[3],
  },
  certText: { flex: 1 },
  certStatus: { fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold, color: colorScales.gray[900] },
  certExpires: { fontSize: typography.fontSize.xs, color: colorScales.gray[500], marginTop: 2 },
});
