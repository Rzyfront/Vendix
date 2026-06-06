import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OrgConfigService } from '@/features/org/services/org-config.service';
import { Card } from '@/shared/components/card/card';
import { Spinner } from '@/shared/components/spinner/spinner';
import { OrgDetailRow } from '@/shared/components/org-detail-row';
import { OrgBadge } from '@/shared/components/org-badge';
import { colors, colorScales, spacing, typography } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';

export default function FiscalScopeScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const scopeQuery = useQuery({
    queryKey: ['org-fiscal-scope'],
    queryFn: () => OrgConfigService.getFiscalScope(),
  });
  const fiscalDataQuery = useQuery({
    queryKey: ['org-fiscal-data'],
    queryFn: () => OrgConfigService.getFiscalData(),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([scopeQuery.refetch(), fiscalDataQuery.refetch()]);
    setRefreshing(false);
  };

  if (scopeQuery.isLoading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Spinner size="large" />
      </SafeAreaView>
    );
  }

  const scope = scopeQuery.data;
  const fd: any = fiscalDataQuery.data ?? {};

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Card>
          <View style={styles.headRow}>
            <View>
              <Text style={styles.title}>Modo fiscal</Text>
              <Text style={styles.subtitle}>
                Define la entidad fiscal responsable de la facturación.
              </Text>
            </View>
            <OrgBadge
              label={scope?.current_scope === 'ORGANIZATION' ? 'Organización' : 'Tienda'}
              variant={scope?.current_scope === 'ORGANIZATION' ? 'primary' : 'muted'}
            />
          </View>
        </Card>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Datos fiscales</Text>
          <Card>
            <OrgDetailRow label="NIT" value={fd.nit} icon="hash" monospace />
            <OrgDetailRow label="Dígito verificación" value={fd.dv} monospace />
            <OrgDetailRow label="Razón social" value={fd.name} icon="building" />
            <OrgDetailRow label="Régimen" value={fd.regime} />
            <OrgDetailRow label="Email facturación" value={fd.email} icon="mail" />
            <OrgDetailRow label="Teléfono" value={fd.phone} icon="phone" />
            <OrgDetailRow label="Dirección" value={fd.address} icon="map" />
            <OrgDetailRow label="Ciudad" value={fd.city} />
          </Card>
        </View>

        {scope?.is_locked ? (
          <View style={styles.warn}>
            <Icon name="alert-triangle" size={16} color={colorScales.amber[600]} />
            <Text style={styles.warnText}>{scope.reason || 'Modo fiscal bloqueado.'}</Text>
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
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
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
  warn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing[3],
    padding: spacing[2],
    backgroundColor: colorScales.amber[50],
    borderRadius: 8,
    gap: spacing[2],
  },
  warnText: { flex: 1, fontSize: typography.fontSize.xs, color: colorScales.amber[700] },
});
