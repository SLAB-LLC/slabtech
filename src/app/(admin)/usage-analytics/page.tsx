'use client';

import { UsageReport } from '@/components/usage/UsageReport';

export default function UsageAnalyticsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Usage</h1>
        <p className="mt-1 text-sm text-gray-500">How every company is using SLAB on the website and in the app.</p>
      </div>
      <UsageReport showCompanies userHref={id => `/users/${id}/usage`} exportName="slab" />
    </div>
  );
}
