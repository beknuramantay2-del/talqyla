// Test setup — sets all required env vars before app modules are loaded.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://debato:debato@localhost:5432/talqyla_test?connect_timeout=1';
process.env.REDIS_URL = 'redis://localhost:6379/1';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-min-16-chars';
process.env.API_BASE_URL = 'http://localhost:4000';
process.env.CORS_ORIGIN = 'http://localhost:3000';
process.env.API_PORT = '0';
process.env.STT_PROVIDER = 'stub';
process.env.TTS_PROVIDER = 'stub';
