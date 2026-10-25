'use client';

import { useParams } from 'next/navigation';
import { Container } from '@/components';
import { UserUsageDetail } from '@/components/usage/UserUsageDetail';

export default function CompanyUserUsagePage() {
  const params = useParams();
  const slug = params.slug as string;
  return (
    <Container maxWidth="xl" padding="lg">
      <UserUsageDetail userId={params.userId as string} backHref={`/c/${slug}/usage`} backLabel="Usage" />
    </Container>
  );
}
