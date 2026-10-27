import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { chatApi } from './server/chatApi.ts';
import { DEFAULT_MAX_TOKENS, DEFAULT_MODEL, DEFAULT_REASONING_EFFORT } from './server/openrouter.ts';
import { modulargridApi } from './server/modulargridApi.ts';

export default defineConfig(({ mode }) => {
  // Load all .env vars (not just VITE_*) for server-side use only; none reach the browser bundle.
  // loadEnv lets shell exports win, but this project's .env keys should take priority over any
  // OPENROUTER_API_KEY exported globally in the shell, so the file is layered on top.
  const fileEnv = existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {};
  const env: Record<string, string | undefined> = { ...loadEnv(mode, process.cwd(), ''), ...fileEnv };
  return {
    plugins: [
      react(),
      tailwindcss(),
      modulargridApi(),
      chatApi({
        apiKey: env.OPENROUTER_API_KEY,
        model: env.OPENROUTER_MODEL || DEFAULT_MODEL,
        maxTokens: Number(env.OPENROUTER_MAX_TOKENS) || DEFAULT_MAX_TOKENS,
        reasoningEffort: env.OPENROUTER_REASONING_EFFORT || DEFAULT_REASONING_EFFORT,
      }),
    ],
  };
});
