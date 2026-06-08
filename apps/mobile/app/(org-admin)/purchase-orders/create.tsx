import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/shared/components/button/button';
import { Card } from '@/shared/components/card/card';
import { Input } from '@/shared/components/input/input';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { OrgPurchaseOrdersService } from '@/features/org/services/org-purchase-orders.service';
import { useQuery } from '@tanstack/react-query';
import { OrgInventoryService } from '@/features/org/services/org-inventory.service';

export default function CreatePurchaseOrderScreen() {
  const [supplierId, setSupplierId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');

  const suppliersQuery = useQuery({
    queryKey: ['org-suppliers-purchase-create'],
    queryFn: () => OrgInventoryService.listSuppliers({ pageSize: 50 }),
  });

  const storesQuery = useQuery({
    queryKey: ['org-stores-purchase-create'],
    queryFn: () => import('@/features/org/services/org-store.service').then(m => m.OrgStoreService.list({ pageSize: 50 })),
  });

  const stores = storesQuery.data?.data ?? [];
  const suppliers = suppliersQuery.data ?? [];

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => {}} />}
      >
        <Text style={styles.title}>Nueva orden de compra</Text>

        <View style={styles.section}>
          <Text style={styles.label}>Proveedor *</Text>
          <View style={styles.chipsRow}>
            {suppliers.map((s) => (
              <Pressable
                key={s.id}
                style={[styles.chip, supplierId === s.id && styles.chipActive]}
                onPress={() => setSupplierId(s.id)}
              >
                <Text style={[styles.chipText, supplierId === s.id && styles.chipTextActive]}>
                  {s.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Tienda destino *</Text>
          <View style={styles.chipsRow}>
            {stores.map((s) => (
              <Pressable
                key={s.id}
                style={[styles.chip, storeId === s.id && styles.chipActive]}
                onPress={() => setStoreId(s.id)}
              >
                <Text style={[styles.chipText, storeId === s.id && styles.chipTextActive]}>
                  {s.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Fecha esperada (YYYY-MM-DD)</Text>
          <Input value={expectedDate} onChangeText={setExpectedDate} placeholder="2026-06-15" />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Notas</Text>
          <Input value={notes} onChangeText={setNotes} multiline numberOfLines={3} />
        </View>

        <View style={styles.actions}>
          <Button
            title="Crear orden"
            onPress={async () => {
              try {
                await OrgPurchaseOrdersService.create({
                  supplier_id: supplierId,
                  store_id: storeId,
                  expected_date: expectedDate || undefined,
                  notes: notes || undefined,
                  items: [],
                });
              } catch {}
            }}
            disabled={!supplierId || !storeId}
            fullWidth
          />
        </View>

        <Card>
          <Text style={styles.note}>
            * Los items se agregan desde el detalle de la orden después de crearla.
          </Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing[4] },
  title: { fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.bold, color: colorScales.gray[900], marginBottom: spacing[4] },
  section: { marginBottom: spacing[3] },
  label: { fontSize: typography.fontSize.sm, color: colorScales.gray[700], marginBottom: spacing[2], fontWeight: typography.fontWeight.medium },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  chip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    backgroundColor: colorScales.gray[100],
    borderRadius: borderRadius.full,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: typography.fontSize.sm, color: colorScales.gray[700] },
  chipTextActive: { color: '#fff', fontWeight: typography.fontWeight.semibold },
  actions: { marginVertical: spacing[4] },
  note: { fontSize: typography.fontSize.xs, color: colorScales.gray[500] },
});
