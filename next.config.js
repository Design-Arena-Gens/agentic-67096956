/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000", "agentic-67096956.vercel.app"],
    },
  },
};

module.exports = nextConfig;