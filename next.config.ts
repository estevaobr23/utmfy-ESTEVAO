import type { NextConfig } from "next";

const security = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // O servidor MCP lê o código-fonte em runtime (src/lib/mcp/files.ts).
  // Nunca incluir .env*, *.local.txt ou supabase/.temp (tem segredos locais).
  outputFileTracingIncludes: {
    "/api/mcp/\\[\\[\\.\\.\\.key\\]\\]": [
      "src/**/*",
      "supabase/migrations/**/*",
      "supabase/sql/**/*",
      "supabase/config.toml",
      "scripts/**/*",
      "tests/**/*",
      "public/**/*",
      "*.md",
      "package.json",
      "next.config.ts",
      "vercel.json",
      "tsconfig.json",
    ],
  },
  async headers() {
    return [
      { source: "/:path*", headers: security },
      {
        // tracker público: carregável de qualquer site, cache curto
        source: "/t.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=300, s-maxage=3600" },
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
