# NSW Data

### [Deployment](https://nsw.zrn.au)

Real-time NSW train tracker. Shows live train positions, trip timetables, and service alerts on an interactive map. Plan to expand to display fuel station prices and other various datasets available.

## Setup

### Backend

```bash
cd backend
cp .env.example .env   # then fill in OPEN_DATA_KEY
pnpm install
pnpm dev               # starts on http://localhost:3000
```

**Environment variables (`backend/.env`):**

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the API listens on |
| `OPEN_DATA_KEY` | - | NSW Open Data API key (required for live data) |
| `DEBUG` | `true` | Set to `true` for verbose console logging. This should be `false` in a deployed environment |

### Frontend

```bash
cd frontend
cp .env.example .env   # set VITE_API_URL if backend is not on localhost:3000
pnpm install
pnpm dev               # starts on http://localhost:5173
```

**Environment variables (`frontend/.env`):**

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3000/api` | Backend API base URL |

---
