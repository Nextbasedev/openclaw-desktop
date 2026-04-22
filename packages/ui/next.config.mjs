/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.NEXT_OUTPUT === "export" ? "export" : undefined,
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "*.loca.lt",
    "fancy-baths-talk.loca.lt",
  ],
  turbopack: {
    root: new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    if (process.env.NEXT_OUTPUT === "export") return []
    return [
      {
        source: "/api/ipc/:path*",
        destination: "http://127.0.0.1:3001/api/ipc/:path*",
      },
      {
        source: "/api/stream/:path*",
        destination: "http://127.0.0.1:3001/api/stream/:path*",
      },
    ]
  },
}

export default nextConfig
