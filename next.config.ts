import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Aholo SDKs read files from disk and must stay server-side.
  serverExternalPackages: ["@manycore/aholo-sdk-lux3d", "@manycore/aholo-sdk-asset"],
};

export default nextConfig;
