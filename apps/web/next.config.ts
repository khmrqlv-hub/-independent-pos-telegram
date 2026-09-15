import type {NextConfig} from "next";

const apiUrl = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async rewrites() {
    return [{source: "/api/:path*", destination: `${apiUrl}/api/:path*`}, {source: "/health", destination: `${apiUrl}/health`}];
  },
};

export default config;

