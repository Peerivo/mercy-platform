import type { NextConfig } from "next";

const russianHosts = [
  "xn----htbcggcjkhwxk7j6bn.xn--p1ai",
  "www.xn----htbcggcjkhwxk7j6bn.xn--p1ai",
];

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async redirects() {
    return russianHosts.map((host) => ({
      source: "/:path*",
      has: [{ type: "host" as const, value: host }],
      destination: "https://mercy.peerivo.net/:path*",
      permanent: true,
    }));
  },
  async headers() {
    return [
      {
        source: "/cabinet/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/staff/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default config;
