'use client';

import { useParams } from 'next/navigation';
import { UserUsageDetail } from '@/components/usage/UserUsageDetail';

export default function UserUsageDetailPage() {
  const params = useParams();
  return <UserUsageDetail userId={params.id as string} backHref="/usage-analytics" backLabel="Usage" />;
}
