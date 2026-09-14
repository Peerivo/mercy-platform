import type { NextConfig } from "next";
const config: NextConfig = { output: "standalone", poweredByHeader: false, async headers() { return [{ source: "/cabinet/:path*", headers: [{key:"Cache-Control",value:"private, no-store"},{key:"X-Robots-Tag",value:"noindex, nofollow"}] },{ source: "/staff/:path*", headers: [{key:"Cache-Control",value:"private, no-store"},{key:"X-Robots-Tag",value:"noindex, nofollow"}] }]; } };
export default config;
