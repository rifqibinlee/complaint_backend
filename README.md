# Backend Setup Guide

## Prerequisites
- Node.js 18+
- PostgreSQL 14+ (install from https://www.postgresql.org/download/windows/)

---

## Step 1: Create the database

Open pgAdmin (installed with PostgreSQL) or the psql shell and run:

```sql
CREATE DATABASE complaint_db;
```

---

## Step 2: Set up your environment variables

In the `backend/` folder, copy the example file:

```powershell
copy .env.example .env
```

Open `.env` and fill in:

**DATABASE_URL** — use this format:
```
DATABASE_URL=postgresql://postgres:YOUR_POSTGRES_PASSWORD@localhost:5432/complaint_db
```
(Replace `YOUR_POSTGRES_PASSWORD` with the password you set when installing PostgreSQL)

**JWT secrets** — generate two different random secrets by running this in PowerShell:
```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Run it twice and paste the two outputs into `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`.

---

## Step 3: Install dependencies

```powershell
cd backend
npm install
```

---

## Step 4: Create the database tables

```powershell
npm run migrate
```

You should see:
```
✅  Database connected
✅  users table ready
✅  refresh_tokens table ready
✅  complaints table ready
✅  audit_logs table ready
✅  All migrations complete
```

---

## Step 5: Start the server

```powershell
npm run dev
```

You should see:
```
✅  Database connected
🚀  Server running on port 3000
```

Open http://localhost:3000/health in your browser — it should return `{"ok":true}`.

---

## File structure

```
backend/
├── server.js              ← entry point (security middleware lives here)
├── .env                   ← your secrets (never commit this)
├── .env.example           ← template (safe to commit)
├── db/
│   ├── index.js           ← database connection pool
│   └── migrate.js         ← creates all tables (run once)
├── middleware/
│   └── authenticate.js    ← JWT verification + role checking
├── routes/
│   ├── auth.js            ← register, login, refresh, logout
│   └── complaints.js      ← submit, list, update complaints
└── services/
    ├── tokenService.js    ← access + refresh token logic
    └── auditService.js    ← writes to audit_logs table
```

---

## API endpoints

| Method | Path                          | Auth       | Description                    |
|--------|-------------------------------|------------|--------------------------------|
| POST   | /api/auth/register            | None       | Create account                 |
| POST   | /api/auth/login               | None       | Login, returns token pair      |
| POST   | /api/auth/refresh             | None       | Exchange refresh for new pair  |
| POST   | /api/auth/logout              | Bearer     | Revoke refresh token           |
| GET    | /api/complaints               | Bearer     | List complaints (paginated)    |
| GET    | /api/complaints/:id           | Bearer     | Single complaint               |
| POST   | /api/complaints               | Bearer     | Submit new complaint           |
| PATCH  | /api/complaints/:id/status    | Admin/Officer | Update status               |
| GET    | /health                       | None       | Health check                   |
