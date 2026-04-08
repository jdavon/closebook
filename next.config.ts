import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Increase proxy/middleware body buffering limit for PDF uploads (default ~10MB)
    proxyClientMaxBodySize: "25mb",
  },
  async headers() {
    return [
      {
        source: "/embed/:path*",
        headers: [
          {
            key: "X-Frame-Options",
            value: "ALLOW-FROM https://rentalworks-dashboard.vercel.app",
          },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self' https://rentalworks-dashboard.vercel.app",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
