import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { useAuthStore } from '@/core/store/auth.store';

interface MarketingTile {
  key: string;
  /** Key en `panel_ui.STORE_ADMIN` que controla la visibilidad del tile. */
  panelKey: string;
  title: string;
  description: string;
  icon: string;
  iconColor: string;
  iconBg: string;
  href: Href;
}

const MARKETING_TILES: MarketingTile[] = [
  {
    key: 'promotions',
    panelKey: 'marketing_promotions',
    title: 'Promociones',
    description: 'Crea y administra descuentos por producto, categoría o tienda.',
    icon: 'tag',
    iconColor: colors.primary,
    iconBg: colorScales.green[100],
    href: '/(store-admin)/marketing/promotions',
  },
  {
    key: 'coupons',
    panelKey: 'marketing_coupons',
    title: 'Cupones',
    description: 'Códigos de descuento y campañas de cupones para clientes.',
    icon: 'tag',
    iconColor: colorScales.purple[600],
    iconBg: colorScales.purple[100],
    href: '/(store-admin)/marketing/coupons',
  },
  {
    key: 'social-sales',
    panelKey: 'marketing_social_sales',
    title: 'Social Sales',
    description: 'Venta por redes sociales y enlaces compartibles.',
    icon: 'share-2',
    iconColor: colorScales.blue[600],
    iconBg: colorScales.blue[100],
    href: '/(store-admin)/marketing/social-sales',
  },
  {
    key: 'anuncios',
    panelKey: 'marketing_anuncios',
    title: 'Anuncios',
    description: 'Anuncios clasificados y vitrina pública de la tienda.',
    icon: 'megaphone',
    iconColor: colorScales.amber[600],
    iconBg: colorScales.amber[100],
    href: '/(store-admin)/marketing/anuncios',
  },
];

/**
 * Hub de Marketing (paridad con la sección Marketing del sidebar web).
 *
 * Lista las sub-secciones operativas disponibles a nivel de tienda:
 * promociones, cupones, social-sales y anuncios.
 * Las pantallas internas viven bajo app/(store-admin)/marketing/<sección>/.
 *
 * Filtra los tiles consultando `panel_ui.STORE_ADMIN[panelKey]` (mismo
 * gating que `MenuFilterService` web). Si el panel_ui no está cargado,
 * mostramos todos los tiles — el submenú quedó compactado en este hub
 * así que el gating debe aplicarse aquí, no antes.
 */
export default function MarketingHubScreen() {
  const router = useRouter();
  const defaultPanelUi = useAuthStore((s) => s.default_panel_ui);

  const visibleTiles = useMemo(() => {
    const storeAdminPanelUi =
      (defaultPanelUi?.STORE_ADMIN as Record<string, boolean> | undefined) ?? {};
    // Si no hay panel_ui cargado, mostrar todos (defensa en profundidad).
    if (!defaultPanelUi) return MARKETING_TILES;
    return MARKETING_TILES.filter((tile) => storeAdminPanelUi[tile.panelKey] !== false);
  }, [defaultPanelUi]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.intro}>
          <Text style={styles.title}>Marketing</Text>
          <Text style={styles.subtitle}>
            Herramientas para atraer clientes y promover tus productos.
          </Text>
        </View>

        {visibleTiles.map((tile) => (
          <Pressable
            key={tile.key}
            style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
            onPress={() => router.push(tile.href)}
          >
            <View style={[styles.tileIcon, { backgroundColor: tile.iconBg }]}>
              <Icon name={tile.icon} size={22} color={tile.iconColor} />
            </View>
            <View style={styles.tileBody}>
              <Text style={styles.tileTitle}>{tile.title}</Text>
              <Text style={styles.tileDescription} numberOfLines={2}>
                {tile.description}
              </Text>
            </View>
            <Icon name="chevron-right" size={20} color={colorScales.gray[400]} />
          </Pressable>
        ))}

        {visibleTiles.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>
              No hay módulos de marketing habilitados para tu tienda.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing[4], paddingBottom: spacing[12] },
  intro: { marginBottom: spacing[4] },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  subtitle: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginTop: spacing[1],
  },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    padding: spacing[3],
    marginBottom: spacing[2],
    gap: spacing[3],
  },
  tilePressed: { opacity: 0.85 },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileBody: { flex: 1, minWidth: 0 },
  tileTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  tileDescription: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  emptyState: {
    padding: spacing[6],
    alignItems: 'center',
  },
  emptyStateText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    textAlign: 'center',
  },
});