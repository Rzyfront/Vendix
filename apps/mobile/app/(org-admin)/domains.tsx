import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgDomainsService } from '@/features/org/services/org-domains.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { colors, colorScales, spacing, typography } from '@/shared/theme';

export default function DomainsScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-domains-list'],
    queryFn: () => OrgDomainsService.list({ pageSize: 100 }),
  });

  const domains = data ?? [];

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <OrgPageContainer
      loading={isLoading}
      refreshing={refreshing}
      onRefresh={onRefresh}
      empty={
        domains.length === 0
          ? { icon: 'globe', title: 'Sin dominios', message: 'Agrega un dominio personalizado para tu organización.' }
          : undefined
      }
    >
      {domains.map((d) => (
        <OrgListItem
          key={d.id}
          title={d.hostname}
          subtitle={`Raíz: ${d.root_domain}${d.subdomain ? ` • Sub: ${d.subdomain}` : ''}`}
          description={`SSL: ${d.ssl_status ?? 'PENDING'} • CF: ${d.cloudfront_status ?? 'PENDING'}`}
          leftIcon="globe"
          leftIconColor={
            d.status === 'ACTIVE' ? colorScales.green[500] :
            d.status === 'FAILED' ? colorScales.red[500] :
            colorScales.amber[500]
          }
          rightBadge={
            d.is_primary
              ? { label: 'Principal', variant: 'primary' }
              : d.status === 'ACTIVE'
              ? { label: 'Activo', variant: 'success' }
              : { label: d.status, variant: 'warning' }
          }
          chevron
        />
      ))}
    </OrgPageContainer>
  );
}
