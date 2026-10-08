import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // --host is what lets a phone on the same network open the QR target.
    // No internet is needed for that, only a shared network.
    host: true,
  },
});
