# Cluso Enterprise (New Isolated Starter)

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
MONGODB_DB=cluso

# Candidate portal link used in email template
CANDIDATE_PORTAL_URL=http://localhost:3012

# SMTP configuration used to send candidate verification emails
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_email_app_password

# Optional explicit from address
VERIFICATION_MAIL_FROM="Cluso Infolink Team <indiaops@cluso.in>"
```

## Run
```bash
npm install
npm run dev
```
Runs on `http://localhost:3011`.
