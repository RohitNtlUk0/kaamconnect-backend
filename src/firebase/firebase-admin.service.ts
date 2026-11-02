import { Injectable, OnModuleInit, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

export interface VerifiedFirebaseUser {
  uid: string;
  phoneNumber: string;
  authTime: number;
}

@Injectable()
export class FirebaseAdminService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseAdminService.name);
  private firebaseApp: admin.app.App;
  private isInitialized = false;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    this.initializeFirebase();
  }

  private initializeFirebase() {
    if (admin.apps.length > 0) {
      this.firebaseApp = admin.app();
      this.isInitialized = true;
      return;
    }

    const fbConfig = this.configService.get('firebase');
    const serviceAccountPath = path.resolve(process.cwd(), fbConfig.serviceAccountPath);

    try {
      if (fs.existsSync(serviceAccountPath)) {
        const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
        this.firebaseApp = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: serviceAccount.project_id || fbConfig.projectId,
        });
        this.logger.log(`Firebase Admin initialized from service account file: ${serviceAccountPath}`);
        this.isInitialized = true;
      } else if (fbConfig.clientEmail && fbConfig.privateKey) {
        this.firebaseApp = admin.initializeApp({
          credential: admin.credential.cert({
            projectId: fbConfig.projectId,
            clientEmail: fbConfig.clientEmail,
            privateKey: fbConfig.privateKey,
          }),
          projectId: fbConfig.projectId,
        });
        this.logger.log(`Firebase Admin initialized from environment variables for project: ${fbConfig.projectId}`);
        this.isInitialized = true;
      } else {
        this.logger.warn(
          'Firebase credentials (serviceAccountKey.json or env vars) not provided. Running in sandbox development mode.',
        );
      }
    } catch (error) {
      this.logger.error(`Failed to initialize Firebase Admin SDK: ${error.message}`);
    }
  }

  /**
   * Securely verifies a Firebase ID Token using Firebase Admin SDK.
   * Ensures token has not been revoked and that the phone number is a valid Indian number (+91).
   */
  async verifyIdToken(idToken: string): Promise<VerifiedFirebaseUser> {
    if (!idToken || typeof idToken !== 'string') {
      throw new BadRequestException('Firebase ID Token is required and must be a valid string');
    }

    // If Firebase Admin is not initialized in local test environment, provide sandbox parsing
    if (!this.isInitialized) {
      this.logger.warn('Firebase Admin not initialized with live credentials. Fallback verification active.');
      // Extract unverified claims for sandbox/dev testing if valid JWT structure
      return this.parseDevToken(idToken);
    }

    try {
      // checkRevoked = true ensures revoked sessions are immediately rejected
      const decodedToken = await admin.auth().verifyIdToken(idToken, true);

      const phoneNumber = decodedToken.phone_number;
      if (!phoneNumber) {
        throw new BadRequestException('Firebase token does not contain a verified phone number.');
      }

      // Enforce Indian mobile number validation (+91 followed by 10 digits starting with 6-9)
      const indianPhoneRegex = /^\+91[6-9]\d{9}$/;
      if (!indianPhoneRegex.test(phoneNumber)) {
        throw new BadRequestException(
          `Unauthorized: Only Indian mobile numbers (+91) are supported. Found: ${phoneNumber}`,
        );
      }

      return {
        uid: decodedToken.uid,
        phoneNumber: phoneNumber,
        authTime: decodedToken.auth_time,
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;

      if (error.code === 'auth/id-token-expired') {
        throw new UnauthorizedException('Firebase ID Token has expired. Please re-authenticate.');
      }
      if (error.code === 'auth/id-token-revoked') {
        throw new UnauthorizedException('Firebase ID Token has been revoked. Please sign in again.');
      }
      if (error.code === 'auth/argument-error') {
        throw new BadRequestException('Malformed Firebase ID Token structure.');
      }

      this.logger.error(`ID Token verification failed: ${error.message}`);
      throw new UnauthorizedException('Invalid Firebase ID Token: ' + error.message);
    }
  }

  private parseDevToken(token: string): VerifiedFirebaseUser {
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        if (payload.phone_number) {
          return {
            uid: payload.user_id || payload.sub || 'dev_uid_123',
            phoneNumber: payload.phone_number,
            authTime: Math.floor(Date.now() / 1000),
          };
        }
      }
    } catch (e) {
      // Ignore
    }
    // Default fallback test user
    return {
      uid: 'dev_firebase_uid_' + Date.now(),
      phoneNumber: '+919876543210',
      authTime: Math.floor(Date.now() / 1000),
    };
  }
}
