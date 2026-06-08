import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Alert, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OrgConfigService } from '@/features/org/services/org-config.service';
import { Card } from '@/shared/components/card/card';
import { Spinner } from '@/shared/components/spinner/spinner';
import { Button } from '@/shared/components/button/button';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';

export default function OperatingScopeScreen() {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-operating-scope'],
    queryFn: () => OrgConfigService.getOperatingScope(),
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
          <Text style={styles.title}>Modo operativo</Text>
          <Text style={styles.description}>
            Define si la organización opera en modo TIENDA (cada tienda maneja su inventario) u ORGANIZACIÓN (inventario consolidado).
          </Text>

          <View style={styles.options}>
            <Pressable
              style={[styles.option, data?.current_scope === 'STORE' && styles.optionActive]}
              onPress={() => Alert.alert('Cambiar modo', 'Esta acción requiere confirmación.')}
            >
              <Icon name="store" size={20} color={data?.current_scope === 'STORE' ? colors.primary : colorScales.gray[500]} />
              <View style={styles.optionBody}>
                <Text style={styles.optionLabel}>Tienda</Text>
                <Text style={styles.optionDesc}>Cada tienda maneja su propio inventario</Text>
              </View>
              {data?.current_scope === 'STORE' ? <Icon name="check-circle" size={18} color={colors.primary} /> : null}
            </Pressable>

            <Pressable
              style={[styles.option, data?.current_scope === 'ORGANIZATION' && styles.optionActive]}
              onPress={() => Alert.alert('Cambiar modo', 'Esta acción requiere confirmación.')}
            >
              <Icon name="building" size={20} color={data?.current_scope === 'ORGANIZATION' ? colors.primary : colorScales.gray[500]} />
              <View style={styles.optionBody}>
                <Text style={styles.optionLabel}>Organización</Text>
                <Text style={styles.optionDesc}>Inventario consolidado entre tiendas</Text>
              </View>
              {data?.current_scope === 'ORGANIZATION' ? <Icon name="check-circle" size={18} color={colors.primary} /> : null}
            </Pressable>
          </View>

          {data?.is_locked ? (
            <View style={styles.warn}>
              <Icon name="alert-triangle" size={16} color={colorScales.amber[600]} />
              <Text style={styles.warnText}>
                {data.reason || 'El modo operativo está bloqueado en este momento.'}
              </Text>
            </View>
          ) : null}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colorScales.gray[50] },
  content: { padding: spacing[4] },
  title: { fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.bold, color: colorScales.gray[900] },
  description: { fontSize: typography.fontSize.sm, color: colorScales.gray[500], marginTop: spacing[2] },
  options: { marginTop: spacing[4], gap: spacing[2] },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[3],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    gap: spacing[3],
  },
  optionActive: { borderColor: colors.primary, backgroundColor: colorScales.green[50] },
  optionBody: { flex: 1 },
  optionLabel: { fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold, color: colorScales.gray[900] },
  optionDesc: { fontSize: typography.fontSize.xs, color: colorScales.gray[500], marginTop: 2 },
  warn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing[3],
    padding: spacing[2],
    backgroundColor: colorScales.amber[50],
    borderRadius: borderRadius.md,
    gap: spacing[2],
  },
  warnText: { flex: 1, fontSize: typography.fontSize.xs, color: colorScales.amber[700] },
});
