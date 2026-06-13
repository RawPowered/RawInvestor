import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
    // Electron loads `client/dist/index.html` via file:// — absolute `/assets/…` URLs
    // would resolve to the drive root and never load; relative paths work.
    base: './',
    build: {
        sourcemap: false,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('plugins/ebay-capture/orchestrators')) {
                        return 'ebay-capture-orchestrator';
                    }
                    if (id.includes('plugins/ebay-capture/components')) {
                        return 'ebay-capture-ui';
                    }
                    if (id.includes('plugins/ebay-capture/')) {
                        return 'ebay-capture-shared';
                    }
                },
            },
        },
    },
    plugins: [react(), tailwindcss()],
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://localhost:3001',
                changeOrigin: true,
            },
            '/images': {
                target: 'http://localhost:3001',
                changeOrigin: true,
            },
        },
    },
});
