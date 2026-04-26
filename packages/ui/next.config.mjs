const isProd = process.env.NODE_ENV === "production"

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(isProd ? { output: "export" } : {}),
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "100.79.189.15",
    "ubuntu-8gb-hel1-4.tail094d3a.ts.net",
    "*.tail094d3a.ts.net",
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
