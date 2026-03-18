import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
        pathname: '/**',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
      },
    ],
  },
  async redirects() {
    return [
      {
        source: '/getstarted',
        destination: '/get-started',
        permanent: false,
      },
      {
        source: '/getstarted/',
        destination: '/get-started',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
