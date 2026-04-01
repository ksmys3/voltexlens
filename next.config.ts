import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@google-cloud/vision"],
  ...(process.env.NODE_ENV === "development" && {
    allowedDevOrigins: ["http://192.168.11.4:3000"],
  }),
};

export default nextConfig;
