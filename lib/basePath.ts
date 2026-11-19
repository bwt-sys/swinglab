/**
 * URL prefix the site is served under. Empty locally; "/swinglab" on GitHub Pages
 * (set by the deploy workflow via NEXT_PUBLIC_BASE_PATH, inlined at build time).
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Prefix a root-relative public asset path ("/sample-swing.mp4") with the base path. */
export function asset(path: string): string {
  return `${BASE_PATH}${path}`;
}
