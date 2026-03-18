# Cluso Customer (New Isolated Starter)

This app is intentionally isolated under `cluso-new-suite` so it does not clash with your current portals.

## Scope implemented
- No public registration
- Company login (created by admin)
- Delegate login (created by company)
- Candidate verification request form
- Requests list for the logged-in company context

## Environment variables
Create `.env.local`:

```env
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_strong_secret
```

## Run
```bash
npm install
npm run dev
```
Runs on `http://localhost:3011`.
