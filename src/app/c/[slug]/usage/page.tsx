'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { Container } from '@/components';
import { UsageReport } from '@/components/usage/UsageReport';

export default function CompanyUsagePage() {
  const params = useParams();
  const slug = params.slug as string;
  const [company, setCompany] = useState<{ id: string; name: string } | null | undefined>(undefined);

  useEffect(() => {
    createClient()
      .from('companies')
      .select('id, name')
      .eq('slug', slug)
      .single()
      .then(({ data }) => setCompany(data ?? null));
  }, [slug]);

  return (
    <Container maxWidth="xl" padding="lg">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Usage</h1>
          <p className="mt-1 text-sm text-gray-500">
            How {company?.name || 'your team'} is using SLAB on the website and in the app.
          </p>
        </div>
        {company === null ? (
          <p className="text-sm text-gray-600">Company not found.</p>
        ) : company ? (
          <UsageReport companyId={company.id} userHref={id => `/c/${slug}/usage/${id}`} exportName={slug} />
        ) : null}
      </div>
    </Container>
  );
}
