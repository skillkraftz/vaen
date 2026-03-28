import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../../"),
  outputFileTracingExcludes: {
    "*": [
      "./node_modules/@swc/**",
      "./node_modules/@next/swc-linux-x64-gnu/**",
      "./node_modules/playwright-core/**",
      "./node_modules/@playwright/**",
      "./node_modules/@img/**",
      "./node_modules/sharp/**",
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
