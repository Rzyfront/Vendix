import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Circle, G, Text as SvgText } from 'react-native-svg';

import { OrgDashboardService } from '@/features/org/services/org-dashboard.service';
import { OrgStoreService } from '@/features/org/services/org-store.service';
import { useAuthStore } from '@/core/store/auth.store';
import { colors, colorScales, spacing, typography, borderRadius, interFonts } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { formatCurrency } from '@/shared/utils/currency';

// ─── Types ───────────────────────────────────────────────────────────────────
type DashboardPeriod = '6m' | '1y' | 'all';
type Tone = 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'accent';

const PERIOD_OPTIONS: { value: DashboardPeriod; label: string }[] = [
  { value: '6m', label: '6M' },
  { value: '1y', label: '1A' },
  { value: 'all', label: 'Todo' },
];

const DISTRIBUTION_COLORS = [
  colors.primary,
  '#3b82f6',
  '#8b5cf6',
  '#fb923c',
  '#06b6d4',
  '#ec4899',
];

const STORE_TYPE_LABELS: Record<string, string> = {
  online: 'En línea', ONLINE: 'En línea',
  offline: 'Física', physical: 'Física', PHYSICAL: 'Física',
  hybrid: 'Híbrida', HYBRID: 'Híbrida',
  popup: 'Pop-up', POPUP: 'Pop-up',
  kiosko: 'Kiosko', KIOSKO: 'Kiosko',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatCompact(value: number): string {
  if (!value) return '0';
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString('es-CO');
}

function formatCurrencyCompact(value: number): string {
  const num = Number(value) || 0;
  const symbol = '$';
  let formatted: string;
  if (Math.abs(num) >= 1_000_000_000) {
    const val = (num / 1_000_000_000).toFixed(1);
    formatted = val.endsWith('.0') ? `${val.slice(0, -2)}B` : `${val}B`;
  } else if (Math.abs(num) >= 1_000_000) {
    const val = (num / 1_000_000).toFixed(1);
    formatted = val.endsWith('.0') ? `${val.slice(0, -2)}M` : `${val}M`;
  } else if (Math.abs(num) >= 1_000) {
    const val = (num / 1_000).toFixed(1);
    formatted = val.endsWith('.0') ? `${val.slice(0, -2)}K` : `${val}K`;
  } else {
    formatted = Math.round(num).toLocaleString('es-CO');
  }
  return `${symbol}${formatted}`;
}

function formatSignedCurrency(value: number): string {
  if (value === 0) return formatCurrency(0);
  const sign = value > 0 ? '+' : '-';
  return `${sign}${formatCurrency(Math.abs(value))}`;
}

function formatTimestamp(isoDate: string | Date): string {
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) return 'reciente';
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days}d`;
  return date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}

function getActivityIcon(type: string): string {
  const t = (type || '').toLowerCase();
  if (t.includes('store') || t.includes('tienda')) return 'store';
  if (t.includes('user') || t.includes('usuario')) return 'user';
  if (t.includes('order') || t.includes('pedido')) return 'shopping-cart';
  if (t.includes('payment') || t.includes('revenue')) return 'receipt';
  if (t.includes('audit')) return 'shield';
  return 'activity';
}

function getActivityTone(type: string): Tone {
  const t = (type || '').toLowerCase();
  if (t.includes('store') || t.includes('tienda')) return 'primary';
  if (t.includes('user') || t.includes('usuario')) return 'secondary';
  if (t.includes('order') || t.includes('pedido')) return 'warning';
  if (t.includes('payment') || t.includes('revenue')) return 'success';
  if (t.includes('error') || t.includes('delete')) return 'error';
  return 'accent';
}

const TONE_COLORS: Record<Tone, { bg: string; icon: string }> = {
  primary:   { bg: 'rgba(22,163,74,0.10)',  icon: colors.primary },
  secondary: { bg: 'rgba(22,78,56,0.10)',   icon: '#162b21' },
  success:   { bg: 'rgba(34,197,94,0.10)',  icon: '#16a34a' },
  warning:   { bg: 'rgba(251,146,60,0.10)', icon: '#ea580c' },
  error:     { bg: 'rgba(239,68,68,0.10)',  icon: '#dc2626' },
  accent:    { bg: 'rgba(6,182,212,0.10)',  icon: '#0891b2' },
};

// ─── Mini Line Sparkline (pure SVG, no lib needed for simple trend) ──────────
function SparklineChart({
  data,
  width,
  height = 180,
  period,
  onPeriodChange,
}: {
  data: { month: string; year: number; amount: number; revenue: number; costs: number }[];
  width: number;
  height?: number;
  period: DashboardPeriod;
  onPeriodChange: (p: DashboardPeriod) => void;
}) {
  if (!data.length) {
    return (
      <View style={[chartStyles.emptyWrap, { height }]}>
        <Icon name="bar-chart-2" size={32} color={colorScales.gray[300]} />
        <Text style={chartStyles.emptyText}>No hay tendencia de ganancias</Text>
        <Text style={chartStyles.emptySubText}>
          Cuando existan ventas finalizadas se mostrará la evolución mensual.
        </Text>
      </View>
    );
  }

  const pad = { top: 12, right: 12, bottom: 40, left: 48 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const n = data.length;

  const revenues = data.map((d) => Number(d.revenue || 0));
  const costs    = data.map((d) => Number(d.costs || 0));
  const profits  = data.map((d) => Number(d.amount || 0));

  const allVals  = [...revenues, ...profits, 0];
  const maxVal   = Math.max(...allVals, 1);

  const xAt = (i: number) => pad.left + (i / Math.max(n - 1, 1)) * chartW;
  const yAt = (v: number) => pad.top + (1 - v / maxVal) * chartH;

  const toPath = (vals: number[]) =>
    vals
      .map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`)
      .join(' ');

  const toArea = (vals: number[]) =>
    toPath(vals) +
    ` L ${xAt(n - 1).toFixed(1)} ${(pad.top + chartH).toFixed(1)} L ${xAt(0).toFixed(1)} ${(pad.top + chartH).toFixed(1)} Z`;

  // Bar series for costs
  const barW = Math.max(2, chartW / n / 2 - 2);
  const labels = data.map((d, i) =>
    i === 0 || i === n - 1 || i === Math.floor(n / 2) ? `${d.month} ${String(d.year).slice(-2)}` : null,
  );

  return (
    <Svg width={width} height={height}>
      {/* Y-axis tick lines */}
      {[0, 0.5, 1].map((frac) => (
        <Path
          key={frac}
          d={`M ${pad.left} ${(pad.top + (1 - frac) * chartH).toFixed(1)} H ${(pad.left + chartW).toFixed(1)}`}
          stroke={colorScales.gray[100]}
          strokeWidth={1}
        />
      ))}
      {/* Y labels */}
      {[0, 0.5, 1].map((frac) => (
        <SvgText
          key={`yl-${frac}`}
          x={pad.left - 4}
          y={(pad.top + (1 - frac) * chartH + 4).toFixed(1)}
          fontSize={9}
          fill={colorScales.gray[400]}
          textAnchor="end"
          fontFamily="Inter_400Regular"
        >
          {formatCompact(maxVal * frac)}
        </SvgText>
      ))}

      {/* Cost bars */}
      {costs.map((c, i) => {
        const bh = (c / maxVal) * chartH;
        return (
          <Path
            key={`bar-${i}`}
            d={`M ${(xAt(i) - barW / 2).toFixed(1)} ${yAt(c).toFixed(1)} h ${barW} v ${bh.toFixed(1)} h -${barW} Z`}
            fill={`rgba(239,68,68,0.25)`}
          />
        );
      })}

      {/* Revenue area fill */}
      <Path d={toArea(revenues)} fill={`rgba(22,163,74,0.08)`} />
      {/* Revenue line */}
      <Path d={toPath(revenues)} stroke={colors.primary} strokeWidth={2} fill="none" strokeLinejoin="round" />
      {/* Profit line */}
      <Path d={toPath(profits)} stroke="#16a34a" strokeWidth={2} fill="none" strokeLinejoin="round" strokeDasharray="4 2" />

      {/* Dots on revenue */}
      {revenues.map((v, i) => (
        <Circle key={`dot-${i}`} cx={xAt(i)} cy={yAt(v)} r={3} fill={colors.primary} />
      ))}

      {/* X labels */}
      {labels.map((label, i) =>
        label ? (
          <SvgText
            key={`xl-${i}`}
            x={xAt(i)}
            y={pad.top + chartH + 16}
            fontSize={9}
            fill={colorScales.gray[400]}
            textAnchor="middle"
            fontFamily="Inter_400Regular"
          >
            {label}
          </SvgText>
        ) : null,
      )}

      {/* Legend */}
      <G>
        <Circle cx={pad.left + 0}  cy={pad.top + chartH + 32} r={4} fill={colors.primary} />
        <SvgText x={pad.left + 8}  y={pad.top + chartH + 36} fontSize={9} fill={colorScales.gray[500]} fontFamily="Inter_400Regular">Ingresos</SvgText>
        <Circle cx={pad.left + 66} cy={pad.top + chartH + 32} r={4} fill="rgba(239,68,68,0.6)" />
        <SvgText x={pad.left + 74} y={pad.top + chartH + 36} fontSize={9} fill={colorScales.gray[500]} fontFamily="Inter_400Regular">Costos</SvgText>
        <Circle cx={pad.left + 126} cy={pad.top + chartH + 32} r={4} fill="#16a34a" />
        <SvgText x={pad.left + 134} y={pad.top + chartH + 36} fontSize={9} fill={colorScales.gray[500]} fontFamily="Inter_400Regular">Ganancia neta</SvgText>
      </G>
    </Svg>
  );
}

// ─── Rose/Donut Pie Chart (pure SVG) ─────────────────────────────────────────
function RosePieChart({
  data,
  size = 180,
}: {
  data: { label: string; value: number; color: string }[];
  size?: number;
}) {
  if (!data.length) return null;

  const cx = size / 2, cy = size / 2;
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;

  // Rose: inner radius constant, outer varies by value
  const minR = size * 0.12;
  const maxR = size * 0.44;

  let angle = -Math.PI / 2; // start at top
  const slices = data.map((d) => {
    const sweep = (d.value / total) * 2 * Math.PI;
    const outerR = minR + (d.value / total) * (maxR - minR) * data.length * 0.6;
    const r = Math.min(outerR, maxR);
    const startAngle = angle;
    angle += sweep;
    return { ...d, startAngle, sweep, r };
  });

  const arcPath = (startA: number, sweep: number, r: number) => {
    const x1 = cx + minR * Math.cos(startA);
    const y1 = cy + minR * Math.sin(startA);
    const x2 = cx + r * Math.cos(startA);
    const y2 = cy + r * Math.sin(startA);
    const endA = startA + sweep;
    const x3 = cx + r * Math.cos(endA);
    const y3 = cy + r * Math.sin(endA);
    const x4 = cx + minR * Math.cos(endA);
    const y4 = cy + minR * Math.sin(endA);
    const large = sweep > Math.PI ? 1 : 0;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${large} 1 ${x3.toFixed(2)} ${y3.toFixed(2)} L ${x4.toFixed(2)} ${y4.toFixed(2)} A ${minR.toFixed(2)} ${minR.toFixed(2)} 0 ${large} 0 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
  };

  return (
    <Svg width={size} height={size}>
      {slices.map((s, i) => {
        if (s.sweep >= 2 * Math.PI - 0.01) {
          return (
            <Circle
              key={i}
              cx={cx}
              cy={cy}
              r={(s.r + minR) / 2}
              fill="none"
              stroke={s.color}
              strokeWidth={s.r - minR}
            />
          );
        }
        return (
          <Path
            key={i}
            d={arcPath(s.startAngle, s.sweep, s.r)}
            fill={s.color}
            stroke="#fff"
            strokeWidth={2}
          />
        );
      })}
    </Svg>
  );
}

// ─── Stat Card ───────────────────────────────────────────────────────────────
function StatCard({
  title,
  value,
  smallText,
  icon,
  iconBg,
  iconColor,
  loading,
}: {
  title: string;
  value: string | number;
  smallText: string;
  icon: string;
  iconBg: string;
  iconColor: string;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <View style={statStyles.card}>
        <View style={statStyles.content}>
          <View style={[statStyles.skeleton, { height: 10, width: '50%' }]} />
          <View style={[statStyles.skeleton, { height: 20, width: '75%', marginTop: 4 }]} />
          <View style={[statStyles.skeleton, { height: 10, width: '40%', marginTop: 4 }]} />
        </View>
      </View>
    );
  }

  const isNegative = smallText.startsWith('-');
  const smallTextColor = isNegative ? '#dc2626' : '#10b981';

  return (
    <View style={statStyles.card}>
      <View style={statStyles.iconWrap}>
        <Icon name={icon} size={15} color={iconColor} />
      </View>
      <View style={statStyles.content}>
        <Text style={statStyles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={statStyles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          {value}
        </Text>
        <Text style={[statStyles.subText, { color: smallTextColor }]} numberOfLines={1}>
          {smallText}
        </Text>
      </View>
    </View>
  );
}

const statStyles = StyleSheet.create({
  card: {
    width: 160,
    height: 90,
    backgroundColor: '#fff',
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    padding: 12,
    position: 'relative',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  iconWrap: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 1,
  },
  value: {
    fontSize: 20,
    fontFamily: interFonts.bold,
    color: colorScales.gray[900],
    lineHeight: 24,
    marginTop: 2,
  },
  title: {
    fontSize: 10,
    fontFamily: interFonts.bold,
    color: colorScales.gray[400],
    textTransform: 'uppercase',
  },
  subText: {
    fontSize: 10,
    fontFamily: interFonts.medium,
    marginTop: 2,
  },
  skeleton: {
    backgroundColor: colorScales.gray[100],
    borderRadius: 4,
  },
});

const chartStyles = StyleSheet.create({
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  emptyText: {
    fontSize: 13,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[500],
    textAlign: 'center',
  },
  emptySubText: {
    fontSize: 11,
    fontFamily: interFonts.regular,
    color: colorScales.gray[400],
    textAlign: 'center',
  },
});

// ─── Section card shell ───────────────────────────────────────────────────────
function SectionCard({
  title,
  subtitle,
  children,
  headerRight,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  headerRight?: React.ReactNode;
}) {
  return (
    <View style={sectionStyles.card}>
      <View style={sectionStyles.header}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={sectionStyles.title}>{title}</Text>
          {subtitle ? <Text style={sectionStyles.subtitle}>{subtitle}</Text> : null}
        </View>
        {headerRight}
      </View>
      <View style={sectionStyles.body}>{children}</View>
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  title: {
    fontSize: 13,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[900],
  },
  subtitle: {
    fontSize: 11,
    fontFamily: interFonts.regular,
    color: colorScales.gray[400],
    marginTop: 1,
  },
  body: {
    padding: 12,
  },
});

// ─── Activity item ────────────────────────────────────────────────────────────
function ActivityItem({
  icon,
  tone,
  title,
  description,
  timestamp,
  isLast,
}: {
  icon: string;
  tone: Tone;
  title: string;
  description: string;
  timestamp: string;
  isLast: boolean;
}) {
  const toneC = TONE_COLORS[tone];
  return (
    <View style={[actStyles.row, !isLast && actStyles.rowBorder]}>
      <View style={[actStyles.iconWrap, { backgroundColor: toneC.bg }]}>
        <Icon name={icon} size={14} color={toneC.icon} />
      </View>
      <View style={actStyles.textGroup}>
        <Text style={actStyles.title} numberOfLines={1}>{title}</Text>
        <Text style={actStyles.desc} numberOfLines={1}>{description}</Text>
      </View>
      <Text style={actStyles.time}>{timestamp}</Text>
    </View>
  );
}

const actStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textGroup: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 13,
    fontFamily: interFonts.medium,
    color: colorScales.gray[900],
  },
  desc: {
    fontSize: 11,
    fontFamily: interFonts.regular,
    color: colorScales.gray[500],
    marginTop: 1,
  },
  time: {
    fontSize: 11,
    fontFamily: interFonts.regular,
    color: colorScales.gray[400],
    flexShrink: 0,
  },
});

// ─── Distribution row (progress bar) ─────────────────────────────────────────
function DistributionRow({
  label,
  valueLabel,
  percentageLabel,
  percent,
  color,
}: {
  label: string;
  valueLabel: string;
  percentageLabel: string;
  percent: number;
  color: string;
}) {
  return (
    <View style={distStyles.row}>
      <View style={distStyles.topRow}>
        <View style={distStyles.left}>
          <View style={[distStyles.dot, { backgroundColor: color }]} />
          <View style={{ minWidth: 0 }}>
            <Text style={distStyles.label} numberOfLines={1}>{label}</Text>
            <Text style={distStyles.pct}>{percentageLabel} del total</Text>
          </View>
        </View>
        <Text style={distStyles.value}>{valueLabel}</Text>
      </View>
      <View style={distStyles.track}>
        <View style={[distStyles.fill, { width: `${Math.min(percent, 100)}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const distStyles = StyleSheet.create({
  row: {
    paddingVertical: 8,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 6,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  label: {
    fontSize: 13,
    fontFamily: interFonts.medium,
    color: colorScales.gray[900],
  },
  pct: {
    fontSize: 11,
    fontFamily: interFonts.regular,
    color: colorScales.gray[400],
  },
  value: {
    fontSize: 13,
    fontFamily: interFonts.bold,
    color: colorScales.gray[900],
    flexShrink: 0,
  },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colorScales.gray[100],
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
  },
});

// ─── Skeleton block ───────────────────────────────────────────────────────────
function SkeletonBlock({ h = 24, w = '100%' as any, mb = 0 }) {
  return (
    <View
      style={{
        height: h,
        width: w,
        backgroundColor: colorScales.gray[100],
        borderRadius: 6,
        marginBottom: mb,
      }}
    />
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function OrgDashboard() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { width } = useWindowDimensions();
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<DashboardPeriod>('6m');

  const orgId = user?.organizations?.id || user?.organization_id;

  const statsQuery = useQuery({
    queryKey: ['org-dashboard-stats', orgId],
    queryFn: () => OrgDashboardService.getStats(String(orgId)),
    enabled: !!orgId,
  });

  const storePerformanceQuery = useQuery({
    queryKey: ['org-store-performance'],
    queryFn: () => OrgDashboardService.getStorePerformance(),
  });

  // The web fetches full dashboard stats (profit_trend, store_distribution,
  // recent_audit, store_activity) from a single endpoint with period param.
  const dashboardFullQuery = useQuery({
    queryKey: ['org-dashboard-full', orgId, period],
    queryFn: () => OrgDashboardService.getStats(String(orgId), period),
    enabled: !!orgId,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      statsQuery.refetch(),
      dashboardFullQuery.refetch(),
      storePerformanceQuery.refetch(),
    ]);
    setRefreshing(false);
  }, [statsQuery, dashboardFullQuery, storePerformanceQuery]);

  const stats = statsQuery.data;
  const storePerf = (storePerformanceQuery.data as any[]) ?? [];
  const fullData: any = dashboardFullQuery.data || stats || null;

  // ── Profit trend (from full endpoint or fallback empty) ──────────────────
  const profitTrend: any[] = useMemo(() => fullData?.profit_trend ?? [], [fullData]);

  // ── Store distribution ────────────────────────────────────────────────────
  const distributionRows = useMemo(() => {
    const raw: any[] = fullData?.store_distribution ?? [];
    const usesRevenue = raw.some((d) => Number(d.revenue || 0) > 0);
    const mapped = raw
      .map((d, i) => ({
        label: STORE_TYPE_LABELS[d.type] || d.type || 'Sin tipo',
        value: usesRevenue ? Number(d.revenue || 0) : Number(d.count || 0),
        color: DISTRIBUTION_COLORS[i % DISTRIBUTION_COLORS.length],
      }))
      .filter((r) => r.value > 0);
    const total = mapped.reduce((s, r) => s + r.value, 0);
    return mapped.map((r) => ({
      ...r,
      percent: total > 0 ? (r.value / total) * 100 : 0,
      percentageLabel: total > 0 ? `${((r.value / total) * 100).toFixed(1)}%` : '0%',
      valueLabel: usesRevenue
        ? formatCurrencyCompact(r.value)
        : `${r.value} tiendas`,
    }));
  }, [fullData]);

  // ── Recent activity ───────────────────────────────────────────────────────
  const activityItems = useMemo(() => {
    const data = fullData;
    if (!data) return [];
    const audit: any[] = data.recent_audit ?? [];
    const storeAct: any[] = data.store_activity ?? [];

    const normalize = (rec: any, source: string, idx: number) => {
      const type = rec.type || rec.action || source;
      const rawTs = rec.timestamp || rec.created_at || rec.createdAt || rec.updated_at;
      const ts = rawTs ? new Date(rawTs) : null;
      return {
        id: String(rec.id || `${source}-${idx}`),
        title:
          rec.title || rec.action ||
          (type.includes('store') ? 'Actividad de tienda' : 'Actividad registrada'),
        description:
          rec.description || rec.entity_name || rec.store_name || rec.user_name ||
          'Actualización registrada en la organización',
        timestamp: ts ? formatTimestamp(ts) : 'reciente',
        icon: getActivityIcon(type),
        tone: getActivityTone(type) as Tone,
        sortTime: ts && !isNaN(ts.getTime()) ? ts.getTime() : 0,
      };
    };

    return [
      ...audit.map((r, i) => normalize(r, 'audit', i)),
      ...storeAct.map((r, i) => normalize(r, 'store', i)),
    ]
      .sort((a, b) => b.sortTime - a.sortTime)
      .slice(0, 6);
  }, [fullData]);

  // ── Store performance (distribution fallback from storePerf) ──────────────
  const perfRows = useMemo(() => {
    if (distributionRows.length > 0) return distributionRows; // prefer API dist
    if (!storePerf.length) return [];
    const total = storePerf.reduce((s: number, d: any) => s + Number(d.revenue || 0), 0);
    return storePerf
      .filter((d: any) => Number(d.revenue || 0) > 0)
      .map((d: any, i: number) => ({
        label: d.store_name || 'Tienda',
        value: Number(d.revenue || 0),
        percent: total > 0 ? (Number(d.revenue) / total) * 100 : 0,
        percentageLabel: total > 0 ? `${((Number(d.revenue) / total) * 100).toFixed(1)}%` : '0%',
        valueLabel: formatCurrencyCompact(Number(d.revenue || 0)),
        color: DISTRIBUTION_COLORS[i % DISTRIBUTION_COLORS.length],
      }));
  }, [distributionRows, storePerf]);

  const chartWidth = width - spacing[4] * 2 - 32; // full width minus padding and card padding

  const statsLoading = statsQuery.isLoading;
  const revenueDiff = Number(stats?.stats?.revenue?.sub_value ?? 0);

  const statCards = [
    {
      title: 'Total de Tiendas',
      value: stats?.stats?.total_stores?.value ?? 0,
      smallText: `${stats?.stats?.total_stores?.sub_value ?? 0} nuevas este mes`,
      icon: 'store',
      iconBg: 'rgba(22,163,74,0.10)',
      iconColor: colors.primary,
    },
    {
      title: 'Usuarios Activos',
      value: stats?.stats?.active_users?.value ?? 0,
      smallText: `${stats?.stats?.active_users?.sub_value ?? 0} en línea ahora`,
      icon: 'users',
      iconBg: 'rgba(59,130,246,0.10)',
      iconColor: '#3b82f6',
    },
    {
      title: 'Pedidos Mensuales',
      value: stats?.stats?.monthly_orders?.value ?? 0,
      smallText: `${stats?.stats?.monthly_orders?.sub_value ?? 0} pedidos hoy`,
      icon: 'shopping-cart',
      iconBg: 'rgba(251,146,60,0.10)',
      iconColor: '#fb923c',
    },
    {
      title: 'Ganancia',
      value: formatCurrency(stats?.stats?.revenue?.value ?? 0),
      smallText: `${formatSignedCurrency(revenueDiff)} vs mes anterior`,
      icon: 'dollar-sign',
      iconBg: revenueDiff >= 0 ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)',
      iconColor: revenueDiff >= 0 ? '#16a34a' : '#dc2626',
    },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        showsVerticalScrollIndicator={false}
      >


        {/* ── Stats row (horizontal scroll like web) ─────────────────────────── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.statsScroll}
          contentContainerStyle={styles.statsRow}
        >
          {statCards.map((s) => (
            <StatCard key={s.title} {...s} loading={statsLoading} />
          ))}
        </ScrollView>

        {/* ── Alert cards ───────────────────────────────────────────────────── */}
        {stats && (stats.low_stock_products > 0 || stats.expiring_batches > 0 || stats.pending_orders > 0) ? (
          <View style={styles.alertsRow}>
            {stats.pending_orders > 0 ? (
              <View style={[styles.alertCard, { backgroundColor: '#fef3c7' }]}>
                <Text style={[styles.alertValue, { color: '#b45309' }]}>{stats.pending_orders}</Text>
                <Text style={styles.alertLabel}>Órdenes{'\n'}pendientes</Text>
              </View>
            ) : null}
            {stats.low_stock_products > 0 ? (
              <View style={[styles.alertCard, { backgroundColor: '#fee2e2' }]}>
                <Text style={[styles.alertValue, { color: '#b91c1c' }]}>{stats.low_stock_products}</Text>
                <Text style={styles.alertLabel}>Stock{'\n'}bajo</Text>
              </View>
            ) : null}
            {stats.expiring_batches > 0 ? (
              <View style={[styles.alertCard, { backgroundColor: '#dbeafe' }]}>
                <Text style={[styles.alertValue, { color: '#1d4ed8' }]}>{stats.expiring_batches}</Text>
                <Text style={styles.alertLabel}>Lotes por{'\n'}vencer</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* ── Resumen de ganancias ──────────────────────────────────────────── */}
        <SectionCard
          title="Resumen de ganancias"
          subtitle="Ingresos, costos y ganancia neta por período"
          headerRight={
            <View style={styles.periodPicker}>
              {PERIOD_OPTIONS.map((p) => (
                <Pressable
                  key={p.value}
                  style={({ pressed }) => [
                    styles.periodBtn,
                    period === p.value && styles.periodBtnActive,
                    pressed && { opacity: 0.75 },
                  ]}
                  onPress={() => setPeriod(p.value)}
                >
                  <Text
                    style={[
                      styles.periodBtnText,
                      period === p.value && styles.periodBtnTextActive,
                    ]}
                  >
                    {p.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          }
        >
          {statsLoading ? (
            <View style={{ gap: 8 }}>
              <SkeletonBlock h={16} w="60%" mb={4} />
              <SkeletonBlock h={180} />
            </View>
          ) : (
            <SparklineChart
              data={profitTrend}
              width={chartWidth}
              height={200}
              period={period}
              onPeriodChange={setPeriod}
            />
          )}
        </SectionCard>

        {/* ── Distribución de ventas ────────────────────────────────────────── */}
        <SectionCard
          title="Distribución de ventas"
          subtitle={distributionRows.some((r) => r.valueLabel?.startsWith('$')) ? 'Ingresos por tipo de tienda' : 'Tiendas por tipo'}
        >
          {statsLoading ? (
            <View style={{ alignItems: 'center', paddingVertical: 24 }}>
              <SkeletonBlock h={160} w={160} mb={0} />
            </View>
          ) : distributionRows.length === 0 ? (
            <View style={chartStyles.emptyWrap}>
              <Icon name="pie-chart" size={32} color={colorScales.gray[300]} />
              <Text style={chartStyles.emptyText}>Sin distribución</Text>
              <Text style={chartStyles.emptySubText}>
                Aún no hay ventas suficientes para comparar tipos de tienda.
              </Text>
            </View>
          ) : (
            <View style={{ alignItems: 'center' }}>
              <RosePieChart
                data={distributionRows.map((r) => ({ label: r.label, value: r.value, color: r.color }))}
                size={Math.min(chartWidth, 200)}
              />
              {/* Legend */}
              <View style={styles.pieLegend}>
                {distributionRows.map((r) => (
                  <View key={r.label} style={styles.pieLegendItem}>
                    <View style={[styles.pieLegendDot, { backgroundColor: r.color }]} />
                    <Text style={styles.pieLegendLabel}>{r.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </SectionCard>

        {/* ── Actividad reciente ────────────────────────────────────────────── */}
        <SectionCard title="Actividad reciente">
          {statsLoading ? (
            <View style={{ gap: 12 }}>
              {[1, 2, 3].map((i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                  <SkeletonBlock h={28} w={28} />
                  <View style={{ flex: 1, gap: 6 }}>
                    <SkeletonBlock h={13} w="70%" />
                    <SkeletonBlock h={11} w="50%" />
                  </View>
                  <SkeletonBlock h={11} w={40} />
                </View>
              ))}
            </View>
          ) : activityItems.length === 0 ? (
            <View style={[chartStyles.emptyWrap, { paddingVertical: 20 }]}>
              <Icon name="activity" size={28} color={colorScales.gray[300]} />
              <Text style={chartStyles.emptyText}>Sin actividad reciente</Text>
              <Text style={chartStyles.emptySubText}>
                Las actualizaciones de tiendas y auditoría aparecerán aquí.
              </Text>
            </View>
          ) : (
            activityItems.map((a, i) => (
              <ActivityItem
                key={a.id}
                icon={a.icon}
                tone={a.tone}
                title={a.title}
                description={a.description}
                timestamp={a.timestamp}
                isLast={i === activityItems.length - 1}
              />
            ))
          )}
        </SectionCard>

        {/* ── Rendimiento por tipo de tienda ─────────────────────────────────── */}
        <SectionCard
          title="Rendimiento por tipo de tienda"
          subtitle={`Total: ${
            perfRows.length > 0
              ? perfRows[0]?.valueLabel?.startsWith('$')
                ? formatCurrencyCompact(perfRows.reduce((s, r) => s + r.value, 0))
                : `${perfRows.reduce((s, r) => s + r.value, 0)} tiendas`
              : '—'
          }`}
        >
          {statsLoading ? (
            <View style={{ gap: 12 }}>
              {[1, 2, 3].map((i) => <SkeletonBlock key={i} h={48} />)}
            </View>
          ) : perfRows.length === 0 ? (
            <View style={[chartStyles.emptyWrap, { paddingVertical: 20 }]}>
              <Icon name="store" size={28} color={colorScales.gray[300]} />
              <Text style={chartStyles.emptyText}>Sin rendimiento disponible</Text>
              <Text style={chartStyles.emptySubText}>
                Cuando haya ventas, se mostrará el peso de cada tipo de tienda.
              </Text>
            </View>
          ) : (
            perfRows.map((row) => (
              <DistributionRow
                key={row.label}
                label={row.label}
                valueLabel={row.valueLabel}
                percentageLabel={row.percentageLabel}
                percent={row.percent}
                color={row.color}
              />
            ))
          )}
        </SectionCard>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Global styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f4f4f4',
  },
  content: {
    padding: spacing[4],
    paddingBottom: spacing[10],
    gap: spacing[4],
  },

  // Stats
  statsScroll: { marginHorizontal: -spacing[4] },
  statsRow: {
    flexDirection: 'row',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[1],
  },
  // Alerts
  alertsRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  alertCard: {
    flex: 1,
    alignItems: 'center',
    borderRadius: borderRadius.lg,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  alertValue: {
    fontSize: 20,
    fontFamily: interFonts.bold,
  },
  alertLabel: {
    fontSize: 11,
    fontFamily: interFonts.regular,
    color: colorScales.gray[600],
    marginTop: 2,
    textAlign: 'center',
    lineHeight: 15,
  },
  // Period picker
  periodPicker: {
    flexDirection: 'row',
    backgroundColor: colorScales.gray[100],
    borderRadius: 8,
    padding: 3,
    gap: 2,
  },
  periodBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    minWidth: 36,
    alignItems: 'center',
  },
  periodBtnActive: {
    backgroundColor: colors.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  periodBtnText: {
    fontSize: 11,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[500],
  },
  periodBtnTextActive: {
    color: '#fff',
  },
  // Pie legend
  pieLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
  },
  pieLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pieLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pieLegendLabel: {
    fontSize: 10,
    fontFamily: interFonts.regular,
    color: colorScales.gray[500],
  },
  // Link action
  linkAction: {
    fontSize: 13,
    fontFamily: interFonts.semibold,
    color: colors.primary,
  },
});
