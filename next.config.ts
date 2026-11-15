import type { NextConfig } from "next";
const config: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  serverExternalPackages: ["node:sqlite", "pdfkit"],
  outputFileTracingIncludes: { "/api/**/*": ["./assets/fonts/**/*", "./migrations/**/*.sql"] },
  async redirects() {
    return process.env.PRACTICE_ONLY === "true"
      ? [{ source: "/", destination: "/practice", permanent: false }]
      : [];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "microphone=(self), camera=()" },
        ],
      },
    ];
  },
};
export default config;
