# KaamConnect Backend Deployment

## WhatsApp OTP production requirements

The included `render.yaml` configures an always-on Render web service, a 1 GB persistent disk for the Baileys session, and PostgreSQL. The current Render workspace requires payment details before it can provision these paid resources.

Estimated Render baseline: **about $13.25/month** before usage charges: $7 web service, $0.25 for the 1 GB disk, and $6 PostgreSQL compute with 1 GB storage. Confirm the amount in Render before applying the Blueprint. Prices can change; see [Render pricing](https://render.com/pricing).

Render Free is suitable only for a temporary demo. Free web services lose local files on restarts and idle spin-down, and free PostgreSQL expires after 30 days. Baileys session files therefore need a paid persistent disk. See [Render Free limitations](https://render.com/docs/free) and [persistent disks](https://render.com/docs/disks).

## Deploy steps

1. Push the reviewed backend branch to `RohitNtlUk0/kaamconnect-backend`.
2. In Render, create a Blueprint from that repository and branch. Review the paid service, disk, and database resources before applying.
3. Add the existing Firebase Admin service-account email and private key through Render's secret fields if Firebase token login and SMS fallback must remain available. Never commit them to Git.
4. After the service and database are live, copy the private `whatsapp_session` files to `/opt/render/project/src/whatsapp_session` using a secure transfer. Do not upload them to GitHub or include them in build artifacts. Restart the service and check `GET /api/v1/auth/otp-channel`; it should report `whatsapp` when the sender and database migration are ready.
5. Build the Flutter app against the deployed URL:

   ```powershell
   flutter build apk --release --dart-define=KAAMCONNECT_API_BASE_URL=https://kaamconnect-otp-api-2026.onrender.com/api/v1
   flutter build appbundle --release --dart-define=KAAMCONNECT_API_BASE_URL=https://kaamconnect-otp-api-2026.onrender.com/api/v1
   ```

The Baileys session directory is a private account credential. Keep it out of Git and only transfer it to the linked production service over a secure channel.
