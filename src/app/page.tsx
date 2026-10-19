import type { Metadata } from 'next';
import HomeV2 from '@/components/home/HomeV2';

export const metadata: Metadata = {
  title: 'SLAB — Training D2D reps actually wanna use',
  description:
    'SLAB is a gamified sales training lab for door-to-door teams in pest, roofing, solar and fiber. Built in the field. Trained off the best of the best.',
  openGraph: {
    title: 'SLAB — Training D2D reps actually wanna use',
    description:
      'SLAB is a gamified sales training lab for door-to-door teams in pest, roofing, solar and fiber. Built in the field. Trained off the best of the best.',
    url: 'https://slabtraining.com',
    siteName: 'SLAB',
    images: [{ url: '/v2/banner-wide.jpg', width: 1200, height: 630 }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SLAB — Training D2D reps actually wanna use',
    description: 'A gamified sales training lab for door-to-door pest, roofing, solar and fiber teams.',
    images: ['/v2/banner-wide.jpg'],
  },
};

export default function HomePage() {
  return <HomeV2 />;
}
