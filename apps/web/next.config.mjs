/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The engines ship as workspace TypeScript packages.
  transpilePackages: ['@xau/core', '@xau/providers'],
  output: 'standalone',
  experimental: {
    // Uploaded screenshots can be a few megabytes.
    serverActions: { bodySizeLimit: '10mb' },
  },
  eslint: { ignoreDuringBuilds: false },
};

export default nextConfig;
