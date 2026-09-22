import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/config";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = siteUrl();

  return [
    { url: `${baseUrl}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${baseUrl}/requests`, changeFrequency: "daily", priority: 0.9 },
    { url: `${baseUrl}/nearby`, changeFrequency: "daily", priority: 0.8 },
    { url: `${baseUrl}/volunteer`, changeFrequency: "monthly", priority: 0.6 },
  ];
}
