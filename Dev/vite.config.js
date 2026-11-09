import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/ApiKey.txt', '**/*.sqlite3{,-*}'] },
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
});
