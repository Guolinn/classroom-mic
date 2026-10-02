import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], server: { hmr: { path: '/vite-hmr' } }, build: { sourcemap: false } });
