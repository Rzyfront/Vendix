/**
 * AnuncioStatsCards — 4 stats cards sticky-top para la lista de Anuncios.
 *
 * Replica el bloque stats del web `anuncios.component.ts:50-88`:
 * 1. Anuncios (total)
 * 2. Listos (completados)
 * 3. Procesando (en generación)
 * 4. Fallidos (requieren reintento)
 *
 * El endpoint `GET /store/marketing/ad-creatives/summary` retorna
 * `{total, completed, processing, failed}`. Si la query falla, retorna
 * ceros (NO rompe la lista — mismo comportamiento que el web).
 *
 * El colorMap (`#0284c7` / `#059669` / `#d97706` / `#dc2626`) está
 * alineado con las clases Tailwind del web
 * (`bg-sky-100/text-sky-600`, `bg-emerald-100/text-emerald-600`,
 * `bg-amber-100/text-amber-600`, `bg-red-100/text-red-600`).
 */

import { useQuery } from '@tanstack/react-query';
import { View, StyleSheet } from 'react-native';

import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { Spinner } from '@/shared/components/spinner/spinner';
import { spacing } from '@/shared/theme';

import { AnunciosService } from '@/features/store/services/anuncios.service';
import {
  ANUNCIO_LABELS,
  ANUNCIO_STATS_COLOR,
} from '@/features/store/constants/anuncio-labels';

export function AnuncioStatsCards() {
  const { data, isLoading } = useQuery({
    queryKey: ['anuncio-stats'],
    queryFn: () => AnunciosService.getSummary(),
  });

  if (isLoading) {
    return (
      <View style={styles.loadingWrap}>
        <Spinner size="sm" />
      </View>
    );
  }

  const total = data?.total ?? 0;
  const completed = data?.completed ?? 0;
  const processing = data?.processing ?? 0;
  const failed = data?.failed ?? 0;

  return (
    <StatsGrid
      items={[
        {
          label: ANUNCIO_LABELS.statsTotal,
          value: total,
          icon: 'image',
          iconBg: ANUNCIO_STATS_COLOR.total.bg,
          iconColor: ANUNCIO_STATS_COLOR.total.fg,
        },
        {
          label: ANUNCIO_LABELS.statsCompleted,
          value: completed,
          icon: 'check-circle',
          iconBg: ANUNCIO_STATS_COLOR.completed.bg,
          iconColor: ANUNCIO_STATS_COLOR.completed.fg,
        },
        {
          label: ANUNCIO_LABELS.statsProcessing,
          value: processing,
          icon: 'loader-2',
          iconBg: ANUNCIO_STATS_COLOR.processing.bg,
          iconColor: ANUNCIO_STATS_COLOR.processing.fg,
        },
        {
          label: ANUNCIO_LABELS.statsFailed,
          value: failed,
          icon: 'triangle-alert',
          iconBg: ANUNCIO_STATS_COLOR.failed.bg,
          iconColor: ANUNCIO_STATS_COLOR.failed.fg,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  loadingWrap: {
    paddingVertical: spacing[6],
    alignItems: 'center',
  },
});
