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
        // Attempt application default credentials (ADC)
        try {
          this.firebaseApp = admin.initializeApp({
            projectId: fbConfig.projectId,
          });
          this.isInitialized = true;
          this.logger.log(`Firebase Admin initialized with default credentials for project: ${fbConfig.projectId}`);
        } catch (e) {
          this.logger.error(
            'CRITICAL: Firebase service account credentials (serviceAccountKey.json or FIREBASE_PRIVATE_KEY) not found. Cryptographic token verification requires valid credentials.',
          );
        }
      }
    } catch (error) {
      this.logger.error(`Failed to initialize Firebase Admin SDK: ${error.message}`);
    }
  }

  /**
   * Cryptographically verifies a Firebase ID Token using Firebase Admin SDK.
   * Ensures token has not been revoked and that the phone number is a valid Indian number (+91).
   * Strict security: Zero unverified fallback.
   */
  async verifyIdToken(idToken: string): Promise<VerifiedFirebaseUser> {
    if (!idToken || typeof idToken !== 'string') {
      throw new BadRequestException('Firebase ID Token is required and must be a valid string');
    }

    if (!this.isInitialized) {
      this.logger.error('Token verification rejected: Firebase Admin SDK is not initialized with server credentials.');
      throw new UnauthorizedException(
        'Server configuration error: Firebase Admin credentials not loaded. Please contact platform administrator.',
      );
    }

    try {
      // checkRevoked = true cryptographically asserts the token is active and unrevoked
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
      if (error instanceof BadRequestException || error instanceof UnauthorizedException) {
        throw error;
      }

      if (error.code === 'auth/id-token-expired') {
        throw new UnauthorizedException('Firebase ID Token has expired. Please re-authenticate.');
      }
      if (error.code === 'auth/id-token-revoked') {
        throw new UnauthorizedException('Firebase ID Token has been revoked. Please sign in again.');
      }
      if (error.code === 'auth/argument-error') {
        throw new BadRequestException('Malformed Firebase ID Token structure.');
      }

      this.logger.error(`Cryptographic ID Token verification failed: ${error.message}`);
      throw new UnauthorizedException('Invalid Firebase ID Token: ' + error.message);
    }
  }

  /**
   * Sends an authentic FCM push notification to a device registration token
   */
  async sendPushNotification(
    token: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!token || !token.trim()) {
      return { success: false, error: 'Target device token is missing' };
    }

    if (!this.isInitialized) {
      this.logger.warn(`FCM send skipped (SDK uninitialized): "${title}" -> ${token.substring(0, 10)}...`);
      return { success: false, error: 'Firebase Admin SDK not initialized' };
    }

    try {
      const message: admin.messaging.Message = {
        token: token.trim(),
        notification: {
          title,
          body,
        },
        data: data || {},
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'kaamconnect_high_importance_channel',
          },
        },
      };

      const messageId = await admin.messaging().send(message);
      this.logger.log(`FCM push notification dispatched: ${messageId} ("${title}")`);
      return { success: true, messageId };
    } catch (error) {
      this.logger.error(`FCM dispatch error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Sends an authentic FCM push notification to a subscribed topic (e.g. 'all_workers_delhi', 'announcements')
   */
  async sendTopicNotification(
    topic: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.isInitialized) {
      return { success: false, error: 'Firebase Admin SDK not initialized' };
    }

    try {
      const message: admin.messaging.Message = {
        topic,
        notification: {
          title,
          body,
        },
        data: data || {},
      };

      const messageId = await admin.messaging().send(message);
      this.logger.log(`FCM topic message dispatched to ${topic}: ${messageId}`);
      return { success: true, messageId };
    } catch (error) {
      this.logger.error(`FCM topic error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}
