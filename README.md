# 1️⃣ Database First

From repo root:

```bash
docker compose -f infra/docker/docker-compose.yml up -d
```

Make sure Postgres is running.

Then inside `apps/api`:

```bash
pnpm prisma:migrate
pnpm prisma:seed
```

You should see seed output with users and documentId.

---

# 2️⃣ Start All Services

From repo root:

```bash
pnpm dev
```

This starts all services in parallel:
- **API**: http://localhost:4000/health
- **AI Service**: http://localhost:5000/health  
- **Realtime**: http://localhost:6000/health
- **Web**: http://localhost:5173

---

# 3️⃣ Start Individual Services (Optional)

If you need to run a single service:

```bash
pnpm --filter api dev
pnpm --filter ai-service dev
pnpm --filter realtime dev
pnpm --filter web dev
```

---

# 4️⃣ Login

Use seeded users from your seed file:

* [admin@example.com](mailto:admin@example.com)
* [owner@example.com](mailto:owner@example.com)
* [editor@example.com](mailto:editor@example.com)
* [commenter@example.com](mailto:commenter@example.com)
* [viewer@example.com](mailto:viewer@example.com)

Password (from seed):

```
password123
```

---

# 5️⃣ Test Flow

Minimum sanity test:

1. Login
2. Create document
3. Open document
4. Type
5. Open second browser window
6. Login same or different user
7. Open same document
8. Confirm realtime sync works
9. Try AI rewrite
10. Try comment + resolve
11. Try admin panel

---

# ⚠️ Common Problems You Might Hit

If something fails:

### ❌ 401 on realtime connection

Make sure:

* JWT_SECRET in API and Realtime are identical

### ❌ AI job fails

Make sure:

* LLM_PROVIDER=mock in ai-service .env

### ❌ CORS issues

Set:

```
WEB_ORIGIN=http://localhost:5173
```

in API and realtime .env

---

# Recommended Way To Run All

Already configured! Just run:

```bash
pnpm dev
```

All services will start in parallel automatically.
