import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'turso',
  schema: './src/main/db/schema.ts',
  out: './drizzle/migrations',
  casing: 'snake_case',
  dbCredentials: {
    url: 'file:./dev.db',
  },
});
