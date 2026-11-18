/** @type {import('next').NextConfig} */
const securityHeaders = [
  // Other sites can't put SLAB pages in a frame (stops click-jacking a signed-in rep)
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self), payment=(self)' },
];

const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  // Explicitly use webpack to avoid Turbopack issues
  turbopack: {},
  experimental: {
    serverActions: {
      bodySizeLimit: '400mb',
    },
  },
  // Optimize for Vercel Hobby plan memory limits
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Reduce memory usage
      config.optimization = {
        ...config.optimization,
        moduleIds: 'deterministic',
        minimize: true,
      }
    }
    return config
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },
};

export default nextConfig;
