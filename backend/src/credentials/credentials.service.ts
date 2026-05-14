import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

@Injectable()
export class CredentialsService {
  private readonly logger = new Logger(CredentialsService.name);
  private readonly key: Buffer;

  constructor(private configService: ConfigService) {
    const keyHex = this.configService.get<string>(
      'CREDENTIAL_ENCRYPTION_KEY',
      '0000000000000000000000000000000000000000000000000000000000000000',
    );
    this.key = Buffer.from(keyHex, 'hex');
    if (this.key.length !== 32) {
      this.logger.warn('CREDENTIAL_ENCRYPTION_KEY must be 64 hex chars (32 bytes). Using zeroed key.');
      this.key.fill(0);
    }
  }

  encrypt(plaintext: string): string {
    try {
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
      const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      // Format: iv(12) + tag(16) + ciphertext — all base64
      const combined = Buffer.concat([iv, tag, encrypted]);
      return combined.toString('base64');
    } catch (err) {
      this.logger.error('Encryption failed', err);
      throw err;
    }
  }

  decrypt(ciphertext: string): string {
    try {
      const combined = Buffer.from(ciphertext, 'base64');
      const iv = combined.subarray(0, IV_LENGTH);
      const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
      const encrypted = combined.subarray(IV_LENGTH + TAG_LENGTH);

      const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);
      return decrypted.toString('utf8');
    } catch (err) {
      this.logger.error('Decryption failed', err);
      throw err;
    }
  }
}
