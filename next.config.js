/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static export for GitHub Pages - this is crucial
  // output: 'export',
  // Disable image optimization for static export
  images: {
    unoptimized: true,
    domains: ['cdn.serper.dev', 'images.serper.dev', 'wineenthusiast.b-cdn.net', 'public.blob.vercel-storage.com'],
  },
  // Use correct basePath for GitHub Pages
  // basePath: process.env.NODE_ENV === 'production' ? '/mywine' : '',
  // Use trailing slashes for better compatibility with static hosting
  // trailingSlash: true,
  // Any additional webpack configs
  webpack: (config) => {
    // You can add webpack customizations here if needed
    return config;
  },
  env: {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    KV_URL: process.env.KV_URL,
    KV_REST_API_URL: process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
    VERCEL_FUNCTION_TIMEOUT: process.env.VERCEL_FUNCTION_TIMEOUT || '60000',
  },
  // Increase serverless function timeout
  serverRuntimeConfig: {
    functionTimeout: 60, // Seconds
  },
}

module.exports = nextConfig 