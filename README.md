# KaamConnect Production Backend

NestJS REST API with Firebase Admin authentication, PostgreSQL persistence, and an optional WhatsApp OTP channel backed by Baileys. Firebase SMS remains available when WhatsApp is not configured and connected.

## Architecture & Technology Stack

- **Framework**: NestJS (TypeScript)
- **Authentication**: Firebase Admin SDK (`verifyIdToken` with anti-revocation and Indian `+91` verification)
- **Database**: PostgreSQL 16 with raw pooling (`pg`) and auto-bootstrapping `schema.sql`
- **Security & Abuse**:
  - NestJS Throttler rate limiting (max 5 OTP login attempts / minute / IP)
  - Persistent `auth_audit_logs` tracking phone numbers, IPs, and lockouts (5 failed attempts locks phone for 15 mins)
  - WhatsApp OTP challenges are stored as keyed hashes, expire after five minutes, and are limited to five verification attempts
  - Firebase Phone Auth remains the fallback; plaintext OTPs are never written to the database or logs
- **Authorization**: Passport JWT strategy issuing application-level tokens with RBAC (Worker, Employer, Agent, Admin)

---

## Quick Start (Docker)

Copy `.env.example` to `.env` and set unique values for `DATABASE_PASSWORD`, `JWT_SECRET`, `ADMIN_SECRET_KEY`, and `WHATSAPP_OTP_HASH_SECRET` before starting. Generate secrets locally with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Keep `.env` out of source control.

Then launch PostgreSQL and the backend:

```bash
docker-compose up -d
```

---

## 🛠️ Local Development Setup (Node.js & npm)

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment (`.env`)
Copy `.env.example` to `.env` and set local database credentials plus unique random values for `JWT_SECRET`, `ADMIN_SECRET_KEY`, and `WHATSAPP_OTP_HASH_SECRET`. For the existing Firebase login path, also provide Firebase Admin credentials:
```env
PORT=3000
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=your_local_postgres_password
DATABASE_NAME=kaamconnect_db
JWT_SECRET=<unique-random-secret-at-least-32-characters>
ADMIN_SECRET_KEY=<separate-unique-random-secret-at-least-32-characters>
WHATSAPP_OTP_HASH_SECRET=<separate-unique-random-secret-at-least-32-characters>
WHATSAPP_OTP_ENABLED=false
WHATSAPP_OTP_PROVIDER=baileys
WHATSAPP_SESSION_PATH=./whatsapp_session

# Option A: Place your Firebase Admin Service Account JSON file in the backend root (never commit it)
FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json

# Option B: Use environment variables
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-firebase-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhki...\n-----END PRIVATE KEY-----\n"
```

### 3. Run the Backend
```bash
npm run start:dev
```

Server starts at `http://localhost:3000/api/v1`.

## WhatsApp OTP

To enable direct WhatsApp delivery, set `WHATSAPP_OTP_ENABLED=true`, keep `WHATSAPP_OTP_PROVIDER=baileys`, set a strong `WHATSAPP_OTP_HASH_SECRET`, and point `WHATSAPP_SESSION_PATH` at a private persistent directory. Link the sender on the host with `npm run whatsapp:pair`; do not upload the session folder to Git. The channel endpoint reports WhatsApp only when the sender and OTP database table are ready. Otherwise the Flutter client continues using Firebase SMS.

The Baileys session is an account credential and must be protected like a private key. A production deployment needs an always-on backend and persistent storage for that session; an ephemeral/free filesystem cannot retain it reliably.

OTP endpoints:

- `GET /api/v1/auth/otp-channel`
- `POST /api/v1/auth/whatsapp-otp/send` with `{ "phoneNumber": "+919876543210" }`
- `POST /api/v1/auth/whatsapp-otp/verify` with `{ "phoneNumber": "+919876543210", "challengeId": "<uuid>", "code": "123456", "role": "WORKER" }`

The OTP response is not proof of delivery by itself. The client must only proceed after a successful WhatsApp send response, and payment/session success must always be confirmed by the backend.

---

## 📡 API Endpoints

### 1. Mobile Phone Login / Registration
- **Endpoint**: `POST /api/v1/auth/phone-login`
- **Rate Limit**: 5 requests / min / IP
- **Headers**: `Content-Type: application/json`
- **Body**:
```json
{
  "idToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6...",
  "role": "EMPLOYER",
  "fullName": "Rohit Verma",
  "deviceInfo": "Android 14 (SM-S918B)"
}
```
- **Success Response (200 OK)**:
```json
{
  "success": true,
  "message": "Mobile number authenticated successfully with KaamConnect",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "7b0a5f8e-49b2-4d1a-96e0-25bc4d7f9911",
      "firebaseUid": "a8B9cD0e1Fg2Hi3Jk4Lm5",
      "phoneNumber": "+919876543210",
      "role": "EMPLOYER",
      "fullName": "Rohit Verma",
      "isVerified": true,
      "isActive": true,
      "lastLoginAt": "2026-10-31T18:30:00.000Z"
    }
  }
}
```

### 2. Get User Profile (Protected)
- **Endpoint**: `GET /api/v1/auth/me`
- **Headers**: `Authorization: Bearer <accessToken>`
- **Response**:
```json
{
  "success": true,
  "data": {
    "id": "7b0a5f8e-49b2-4d1a-96e0-25bc4d7f9911",
    "firebase_uid": "a8B9cD0e1Fg2Hi3Jk4Lm5",
    "phone_number": "+919876543210",
    "role": "EMPLOYER",
    "full_name": "Rohit Verma",
    "is_verified": true,
    "is_active": true
  }
}
```
