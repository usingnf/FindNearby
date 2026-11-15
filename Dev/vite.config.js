import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'FIND_NEARBY_');
  const url = env.FIND_NEARBY_SUPABASE_URL;
  const secret = env.FIND_NEARBY_ORIGIN_SECRET;
  if (command === 'serve' && url && !secret) {
    throw new Error('FIND_NEARBY_ORIGIN_SECRET is required for the Supabase proxy.');
  }
  return {
    server: {
      fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/ApiKey.txt', '**/*.sqlite3{,-*}'] },
      proxy: {
        '^/api/(status|addresses|recommend|route)(?:\\?|$)': url ? {
          target: url,
          changeOrigin: true,
          headers: { 'x-find-nearby-origin-secret': secret, 'x-forwarded-for': '127.0.0.1' },
          rewrite: path => path.replace(/^\/api\//, '/functions/v1/find-nearby/'),
        } : 'http://127.0.0.1:8000',
      },
    },
  };
});
