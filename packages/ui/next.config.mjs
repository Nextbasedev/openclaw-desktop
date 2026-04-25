/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "*.loca.lt",
    "fancy-baths-talk.loca.lt",
  ],

  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: "/api/stream/terminal/:path*",
        destination: "http://127.0.0.1:3001/api/stream/terminal/:path*",
      },
    ]
  },
}

export default nextConfig
