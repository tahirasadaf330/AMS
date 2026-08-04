/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server (.next/standalone) for the Docker image. Harmless for the
  // classic `next start` / PM2 path, which continues to work unchanged.
  output: 'standalone',
};
module.exports = nextConfig;
