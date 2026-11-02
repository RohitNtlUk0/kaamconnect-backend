# KaamConnect Production Backend

Production-grade NestJS REST API with Firebase Admin SDK authentication and PostgreSQL database persistence.

## Architecture & Technology Stack

- **Framework**: NestJS (TypeScript)
- **Authentication**: Firebase Admin SDK (`verifyIdToken` with anti-revocation and Indian `+91` verification)
- **Database**: PostgreSQL 16 with raw pooling (`pg`) and auto-bootstrapping `schema.sql`
- **Security & Abuse**:
  - NestJS Throttler rate limiting (max 5 OTP login attempts / minute / IP)
  - Persistent `auth_audit_logs` tracking phone numbers, IPs, and lockouts (5 failed attempts locks phone for 15 mins)
  - Never stores passwords or OTPs (Firebase Phone Auth manages delivery & verification)
- **Authorization**: Passport JWT strategy issuing application-level tokens with RBAC (Worker, Employer, Agent, Admin)

---

## 🚀 Quick Start (Docker - 1 Command)

If you have Docker Desktop installed, you can launch PostgreSQL and the backend with:

```bash
cd backend
docker-compose up -d
```

---

## 🛠️ Local Development Setup (Node.js & npm)

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Configure Environment (`.env`)
Create or edit `.env`:
```env
PORT=3000
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=your_postgres_password
DATABASE_NAME=kaamconnect_db
JWT_SECRET=kaamconnect_secure_jwt_secret_key_prod_2026

# Option A: Place your Firebase Admin Service Account JSON file in the backend root
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
