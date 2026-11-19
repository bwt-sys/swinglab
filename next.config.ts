import type { NextConfig } from "next";

/** "/swinglab" when building for GitHub Pages (set by .github/workflows/pages.yml); empty locally. */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Fully static site: `next build` writes plain HTML/JS/CSS to out/, which GitHub Pages serves as-is.
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
