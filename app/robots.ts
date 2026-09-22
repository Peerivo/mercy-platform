import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = siteUrl();

  return {
    rules: [{
      userAgent: "*",
      allow: "/",
    }],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
