import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Production site: https://yuzucalc.com/ (GitHub Pages + custom domain)
export default defineConfig({
  site: 'https://yuzucalc.com',
  base: '/',
  trailingSlash: 'always',
  integrations: [sitemap()],
});
