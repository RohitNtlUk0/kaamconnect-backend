# KaamConnect - 100% Free Live HTTPS Backend Deployment Guide

Yeh guide aapko KaamConnect ke NestJS Backend aur PostgreSQL Database ko **bina 1 rupaye kharch kiye (100% FREE)** internet par 24/7 live karne ke steps batati hai.

---

## Option 1: Render.com (Sabse Aasan aur Recommended - 3 Minutes Setup)

Render.com Node.js backend aur PostgreSQL database dono **FREE** provide karta hai aur automatic **HTTPS SSL Certificate** deta hai.

### Step 1: Render par Free Account Banayein
1. Browser me open karein: **[https://render.com](https://render.com)**
2. **"Get Started for Free"** par click karein aur apne Google account se sign in karein.

### Step 2: GitHub par Code Upload Karein (1-Click)
1. Browser me open karein: **[https://github.com/new](https://github.com/new)**
2. Repository Name daalein: `kaamconnect-backend`
3. **Private** ya **Public** select karein aur **"Create repository"** dabayein.
4. Terminal / PowerShell me yeh 3 commands chalayein:
   ```bash
   cd "C:\Users\jyoti\Desktop\KAAM CONNECT\backend"
   git remote add origin https://github.com/<AAPKA_GITHUB_USERNAME>/kaamconnect-backend.git
   git branch -M main
   git push -u origin main
   ```

### Step 3: Render par 1-Click Blueprint Deploy
1. Render Dashboard me **"New +"** button par click karein aur **"Blueprint"** chunein.
2. Apni `kaamconnect-backend` repository select karein.
3. Render automatic hamari banayi hui `render.yaml` file detect kar lega:
   - ✅ **Web Service:** `kaamconnect-api` (Free Node.js plan)
   - ✅ **Database:** `kaamconnect-db` (Free PostgreSQL plan)
4. **"Apply"** dabayein!
5. 2 minute me aapka live HTTPS URL ready ho jayega:
   👉 **`https://kaamconnect-api.onrender.com/api/v1`**

---

## Option 2: Supabase (Free Database) + Render (Free API)

Agar aap Supabase ka world-class free database use karna chahte hain:
1. **[https://supabase.com](https://supabase.com)** par free account banayein.
2. **"New Project"** -> Name: `kaamconnect-db`.
3. Project Settings -> Database -> **Connection String (URI)** copy karein.
4. Render Web Service me Environment Variable `DATABASE_URL` me wahi string paste kar dein.

---

## Step 4: Flutter App me Live URL Update Karna

Jaise hi aapko aapka live HTTPS URL mile (e.g. `https://kaamconnect-api.onrender.com/api/v1`):
1. `lib/core/config/app_config.dart` me line 13 update karein:
   ```dart
   static const String productionApiUrl = 'https://kaamconnect-api.onrender.com/api/v1';
   ```
2. Release APK build karein:
   ```bash
   python "C:\Users\jyoti\Desktop\KAAM CONNECT\build_apk.py"
   ```
3. Ab aapka APK kisi bhi real phone se poori duniya me 24/7 bina kisi local computer ke chalega!
