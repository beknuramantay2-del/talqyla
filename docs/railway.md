# Railway deploy

Do not put API keys in GitHub. Railway does not read `.env.example`.

## One-time setup

1. Create a Railway project from this repo.
2. Add plugins: **PostgreSQL** and **Redis**. Railway will inject `DATABASE_URL` and `REDIS_URL`.
3. In the API service **Variables**, paste only keys:

```text
GROQ_API_KEY=
OPENROUTER_API_KEY=
OPENROUTER_BACKUP_API_KEY=
GOOGLE_API_KEY=
DEEPGRAM_API_KEY=
TELEGRAM_BOT_TOKEN=
OPENCODE_ZEN_API_KEY=
```

Everything else is filled automatically:

- `NODE_ENV=production` when running on Railway
- `PORT` / `API_PORT` from Railway
- `API_BASE_URL` from `RAILWAY_PUBLIC_DOMAIN`
- `CORS_ORIGIN` from the public HTTPS URL
- `JWT_ACCESS_SECRET` from the Railway project/service id if you do not set one
- `STT_PROVIDER=groq` if `GROQ_API_KEY` is present

4. Deploy. The API start command is `node apps/api/dist/server.js`.
5. After deploy, copy the public HTTPS URL if you want to override `API_BASE_URL` yourself.

Optional but better: set your own `JWT_ACCESS_SECRET` with `openssl rand -hex 32`.
