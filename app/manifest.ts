import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Sunoza – Multilingual Accessibility Assistant',
    short_name: 'Sunoza',
    description:
      'Technology that understands you. Multilingual voice assistant, visual understanding, and document explanation.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#F3EFE6',
    theme_color: '#33446A',
    categories: ['accessibility', 'utilities', 'productivity', 'education'],
    icons: [
      {
        src: '/icons/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-maskable-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
    shortcuts: [
      {
        name: 'Voice Assistant',
        short_name: 'Voice',
        description: 'Talk to Sunoza in your preferred language',
        url: '/?tab=voice',
        icons: [{ src: '/icons/icon-192x192.png', sizes: '192x192' }],
      },
      {
        name: 'Understand Image',
        short_name: 'Image AI',
        description: 'Analyze and explain photos and packaging',
        url: '/?tab=image',
        icons: [{ src: '/icons/icon-192x192.png', sizes: '192x192' }],
      },
      {
        name: 'Understand Document',
        short_name: 'Document AI',
        description: 'Explain invoices, letters, and forms',
        url: '/?tab=document',
        icons: [{ src: '/icons/icon-192x192.png', sizes: '192x192' }],
      },
    ],
  };
}

