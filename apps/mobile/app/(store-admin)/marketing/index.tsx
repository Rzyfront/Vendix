import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';

interface MarketingTile {
  key: string;
  title: string;
  description: string;
  icon: string;
  iconColor: string;
  iconBg: string;
  href: string;
}

const MARKETING_TILES: MarketingTile[] = [
  {
    key: 'promotions',
    title: 'Promociones',
    description: 'Crea y administra descuentos por producto, categoría o tienda.',
    icon: 'tag',
    iconColor: colors.primary,
    iconBg: colorScales.green[100],
    href: '/(store-admin)/marketing/promotions',
  },
  {
    key: 'coupons',
    title: 'Cupones',
    description: 'Códigos de descuento y campañas de cupones para clientes.',
    icon: 'ticket-percent',
    iconColor: colorScales.purple[600],
    iconBg: colorScales.purple[100],
    href: '/(store-admin)/marketing/coupons',
  },
  {
    key: 'social-sales',
    title: 'Social Sales',
    description: 'Venta por redes sociales y enlaces compartibles.',
    icon: 'share-2',
    iconColor: colorScales.blue[600],
    iconBg: colorScales.blue[100],
    href: '/(store-admin)/marketing/social-sales',
  },
  {
    key: 'anuncios',
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
 */
export default function MarketingHubScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.intro}>
          <Text style={styles.title}>Marketing</Text>
          <Text style={styles.subtitle}>
            Herramientas para atraer clientes y promover tus productos.
          </Text>
        </View>

        {MARKETING_TILES.map((tile) => (
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
});