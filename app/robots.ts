import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/studio", "/studio-bridge", "/settings"],
    },
    sitemap: "https://kitestudiopro.vercel.app/sitemap.xml",
  };
}
