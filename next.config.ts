import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Increase proxy/middleware body buffering limit for PDF uploads (default ~10MB)
    proxyClientMaxBodySize: "25mb",
  },
};

export default nextConfig;
