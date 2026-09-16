export type ProviderName = 'groq' | 'openrouter' | 'openrouter_backup' | 'google' | 'opencode_zen';

export type ModelProvider = {
  name: ProviderName;
  baseUrl: string;
  apiKey?: string;
  model?: string;
  enabled: boolean;
  headers?: Record<string, string>;
};

const env = process.env;

export const llmProviders: ModelProvider[] = [
  {
    name: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: env.GROQ_API_KEY,
    model: env.GROQ_MODEL || 'llama-3.1-8b-instant',
    enabled: Boolean(env.GROQ_API_KEY),
  },
  {
    name: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: env.GOOGLE_API_KEY,
    model: env.GOOGLE_MODEL || 'gemini-3.8-flash',
    enabled: Boolean(env.GOOGLE_API_KEY),
  },
  {
    name: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: env.OPENROUTER_API_KEY,
    model: env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-8b-instruct:free',
    enabled: Boolean(env.OPENROUTER_API_KEY),
    headers: {
      'HTTP-Referer': env.TELEGRAM_WEBAPP_URL || 'http://localhost:5173',
      'X-Title': 'Talqyla',
    },
  },
  {
    name: 'openrouter_backup',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: env.OPENROUTER_BACKUP_API_KEY,
    model: env.OPENROUTER_BACKUP_MODEL || 'google/gemma-2-9b-it:free',
    enabled: Boolean(env.OPENROUTER_BACKUP_API_KEY),
    headers: {
      'HTTP-Referer': env.TELEGRAM_WEBAPP_URL || 'http://localhost:5173',
      'X-Title': 'Talqyla',
    },
  },
  {
    name: 'opencode_zen',
    baseUrl: env.OPENCODE_ZEN_BASE_URL || '',
    apiKey: env.OPENCODE_ZEN_API_KEY,
    model: env.OPENCODE_ZEN_MODEL,
    enabled: Boolean(env.OPENCODE_ZEN_API_KEY && env.OPENCODE_ZEN_BASE_URL && env.OPENCODE_ZEN_MODEL),
  },
];

export const sttConfig = {
  provider: env.STT_PROVIDER || 'deepgram',
  deepgramApiKey: env.DEEPGRAM_API_KEY,
  deepgramModel: env.DEEPGRAM_MODEL || 'nova-3',
  groqApiKey: env.GROQ_API_KEY,
  groqModel: env.GROQ_STT_MODEL || 'whisper-large-v3-turbo',
  googleApiKey: env.GOOGLE_API_KEY,
  googleSttModel: env.GOOGLE_STT_MODEL || 'gemini-3.5-transcribe',
  assemblyAiApiKey: env.ASSEMBLYAI_API_KEY,
};

export const telegramConfig = {
  botToken: env.TELEGRAM_BOT_TOKEN,
  webAppUrl: env.TELEGRAM_WEBAPP_URL || 'http://localhost:5173',
};
