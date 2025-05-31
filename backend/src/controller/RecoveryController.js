import { apId } from "../../bin/www.js";
import { User } from "../database/entity/User.js";
import { AppDataSource } from "../database/newDbSetup.js";
import { createToken } from "../util/RegisterUtils.js";
import { checkTod } from "../util/Util.js";
import { getAdminPublicKey } from "../scripts/readkeys.js";
import { 
  processClientCrossAPRequest,
  processIncomingCrossAPRequests,
  processIncomingCrossAPResponses,
  cleanupExpiredRequests,
  getPendingCrossAPRequests,
  getCrossAPResponses
} from "../util/CrossApRecoveryUtil.js";
import { CrossAPRecoveryRequest } from "../database/entity/CrossApRecoveryRequest.js";
import { CrossAPRecoveryResponse } from "../database/entity/CrossApRecoveryResponse.js";
import crypto from "crypto";

const MAX_RECOVERY_ATTEMPTS = 5;
const LOCKOUT_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

class RecoveryController {

  async recoverIdentity(req, res) {
    const tod_received = req.body.tod;
    if (!checkTod(tod_received)) {
      return res.status(408).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_RJT",
        error: "Timeout error."
      });
    }

    const { username, apIdentifier, recoveryHash, newPublicKey } = req.body;

    if (!username || !apIdentifier || !recoveryHash) {
      return res.status(400).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_RJT",
        error: "Missing required fields."
      });
    }

    try {
      if (apIdentifier === apId) {
        return await this.handleLocalRecovery(req, res, username, apIdentifier, recoveryHash, newPublicKey);
      } else {
        return await this.initiateCrossAPRecovery(req, res, username, apIdentifier, recoveryHash);
      }
    } catch (error) {
      return res.status(500).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_RJT",
        error: "Internal server error during recovery."
      });
    }
  }

  async handleLocalRecovery(req, res, username, apIdentifier, recoveryHash, newPublicKey) {
    // Start a database transaction to ensure data consistency
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const fullUsername = `${username}@${apIdentifier}`;
      
      let user = await queryRunner.manager.findOneBy(User, { 
        username: fullUsername 
      });
      
      if (!user) {
        user = await queryRunner.manager.findOneBy(User, {
          username: username
        });
      }
      
      if (!user) {
        await queryRunner.commitTransaction();
        return res.status(404).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_RECOVERY_RJT",
          error: "User not found at this AP."
        });
      }
      
      if (!user.recoveryKeyHash) {
        await queryRunner.commitTransaction();
        return res.status(400).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_RECOVERY_RJT",
          error: "User account doesn't have recovery data."
        });
      }

      // Check if the user is currently locked out
      const lockStatus = await this.checkLockStatus(user);
      if (lockStatus.isLocked) {
        await queryRunner.commitTransaction();
        return res.status(423).json({ // 423 = Locked status code
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_RECOVERY_LOCKED",
          error: `Account locked until ${lockStatus.unlockTime}`,
          lockedUntil: lockStatus.unlockTime,
          attemptsRemaining: 0
        });
      }
      
      // Test the recovery hash against stored hash with variations
      const hashVariations = [recoveryHash];
      
      const possibleWords = [
        "normalized single space version",
        "double  space version", 
        "triple   space version"
      ];

      for (const words of possibleWords) {
        try {
          const testHash = crypto.createHash('sha256').update(words).digest('hex');
          hashVariations.push(testHash);
        } catch (e) {
          // Silent fail for hash generation errors
        }
      }
      
      const isValid = hashVariations.includes(user.recoveryKeyHash);
      
      if (isValid) {
        // SUCCESS: Reset attempts and proceed with recovery
        await this.resetAttempts(queryRunner, user);
        
        let publicKeyForToken;
        
        if (newPublicKey) {
          try {
            const clientPubKeyPem = await this.jwkToPem(newPublicKey);
            publicKeyForToken = Buffer.from(clientPubKeyPem, 'utf8');
          } catch (jwkError) {
            throw jwkError;
          }
        }
        
        const token = createToken(user.username, publicKeyForToken);
        
        await queryRunner.manager.update(
          User,
          { username: user.username },
          { recoveryKeyUpdatedAt: new Date() }
        );
        
        await queryRunner.commitTransaction();
        
        const response = {
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_RECOVERY_ACK",
          adminPubKey: getAdminPublicKey().toString(),
          token
        };
        
        return res.status(200).json(response);
        
      } else {
        // FAILURE: Record the failed attempt
        const attemptResult = await this.recordFailedAttempt(queryRunner, user);
        await queryRunner.commitTransaction();
        
        if (attemptResult.isLocked) {
          return res.status(423).json({
            id: apId,
            tod: Date.now(),
            priority: -1,
            type: "MT_RECOVERY_LOCKED",
            error: "Too many failed attempts. Account locked for 24 hours.",
            lockedUntil: attemptResult.lockUntil,
            attemptsRemaining: 0
          });
        } else {
          return res.status(401).json({
            id: apId,
            tod: Date.now(),
            priority: -1,
            type: "MT_RECOVERY_RJT",
            error: "Invalid recovery credentials.",
            attemptsRemaining: attemptResult.attemptsRemaining
          });
        }
      }
      
    } catch (error) {
      await queryRunner.rollbackTransaction();
      return res.status(500).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_RJT",
        error: "Internal server error during local recovery."
      });
    } finally {
      await queryRunner.release();
    }
  }

  // Check if a user account is currently locked
  async checkLockStatus(user) {
    if (!user.recoveryLockedAt) {
      return { isLocked: false };
    }

    const lockTime = new Date(user.recoveryLockedAt);
    const unlockTime = new Date(lockTime.getTime() + LOCKOUT_DURATION);
    const now = new Date();

    if (now < unlockTime) {
      // Still locked
      return {
        isLocked: true,
        unlockTime: unlockTime.toISOString()
      };
    } else {
      // Lock has expired, clean it up
      await AppDataSource.manager.update(
        User,
        { username: user.username },
        {
          recoveryLockedAt: null,
          recoveryAttempts: 0
        }
      );
      
      return { isLocked: false };
    }
  }

  // Record a failed recovery attempt and check if we should lock
  async recordFailedAttempt(queryRunner, user) {
    const currentAttempts = user.recoveryAttempts || 0;
    const newAttemptCount = currentAttempts + 1;
    const now = new Date();
    
    // Check if this attempt should trigger a lock
    if (newAttemptCount >= MAX_RECOVERY_ATTEMPTS) {
      // LOCK the account
      await queryRunner.manager.update(
        User,
        { username: user.username },
        {
          recoveryAttempts: newAttemptCount,
          recoveryLockedAt: now,
          lastRecoveryAttempt: now
        }
      );
      
      const lockUntil = new Date(now.getTime() + LOCKOUT_DURATION);
      
      return {
        isLocked: true,
        lockUntil: lockUntil.toISOString(),
        attemptsRemaining: 0
      };
    } else {
      // Just increment the attempt counter
      await queryRunner.manager.update(
        User,
        { username: user.username },
        {
          recoveryAttempts: newAttemptCount,
          lastRecoveryAttempt: now
        }
      );
      
      return {
        isLocked: false,
        attemptsRemaining: MAX_RECOVERY_ATTEMPTS - newAttemptCount
      };
    }
  }

  // Reset attempt counter after successful recovery
  async resetAttempts(queryRunner, user) {
    await queryRunner.manager.update(
      User,
      { username: user.username },
      {
        recoveryAttempts: 0,
        recoveryLockedAt: null,
        lastRecoveryAttempt: new Date()
      }
    );
  }

  async initiateCrossAPRecovery(req, res, username, sourceApId, recoveryHash) {
    try {
      const tempUserId = `temp_${username}_${sourceApId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const tempUsername = `temp_${username}_${Date.now().toString().slice(-6)}`;
      
      const { privateKey: tempPrivKey, publicKey: tempPubKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
      });
      
      const publicKeyBuffer = Buffer.from(tempPubKey.export({ format: "pem", type: "spki" }));
      const tempToken = createToken(tempUsername, publicKeyBuffer);
      
      const crossAPRequestInfo = {
        tempUserId,
        requestingApId: apId,
        destinationApId: sourceApId,
        hash: recoveryHash,
        realUserId: username,
        sourceApId: sourceApId,
        ephemeralPublicKey: "",
        timestamp: Date.now(),
        status: "INITIATED",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      };
      
      return res.status(200).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_CROSS_AP_INITIATED",
        tempUserId,
        tempUsername,
        tempToken,
        originalUsername: `${username}@${sourceApId}`,
        message: "Cross-AP recovery initiated. You can use the system with temporary identity while recovery is processed."
      });
      
    } catch (error) {
      return res.status(500).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_RJT",
        error: "Failed to initiate cross-AP recovery."
      });
    }
  }

  async submitCrossAPRequest(req, res) {
    const tod_received = req.body.tod;
    if (!checkTod(tod_received)) {
      return res.status(408).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_CROSS_AP_RJT",
        error: "Timeout error."
      });
    }

    const { encryptedData, tempUserId } = req.body;

    if (!encryptedData || !tempUserId) {
      return res.status(400).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_CROSS_AP_RJT",
        error: "Missing encrypted data or temp user ID."
      });
    }

    try {
      const result = await processClientCrossAPRequest(encryptedData);
      
      if (result.success) {
        return res.status(200).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_CROSS_AP_ACK",
          tempUserId: result.tempUserId,
          message: result.message
        });
      } else {
        return res.status(400).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_CROSS_AP_RJT",
          error: "Failed to process cross-AP request."
        });
      }
      
    } catch (error) {
      return res.status(500).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_CROSS_AP_RJT",
        error: "Internal server error processing cross-AP request."
      });
    }
  }

  async checkCrossAPRecoveryStatus(req, res) {
    const { tempUserId } = req.body;

    if (!tempUserId) {
      return res.status(400).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_CROSS_AP_STATUS_RJT",
        error: "Missing temp user ID."
      });
    }

    try {
      const response = await AppDataSource.manager.findOneBy(CrossAPRecoveryResponse, {
        tempUserId
      });

      const request = await AppDataSource.manager.findOneBy(CrossAPRecoveryRequest, {
        tempUserId
      });

      if (response) {
        return res.status(200).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_CROSS_AP_STATUS_ACK",
          status: "completed",
          hasResponse: true,
          message: "Recovery response is ready."
        });
      } else if (request) {
        const now = new Date();
        let expiresAt;
        
        try {
          const expiresAtValue = request.expiresAt;
          //@ts-ignore
          expiresAt = new Date(request.expiresAt);
          if (isNaN(expiresAt.getTime())) {
            expiresAt = new Date(0);
          }
        } catch (e) {
          expiresAt = new Date(0);
        }
        
        if (expiresAt < now) {
          return res.status(200).json({
            id: apId,
            tod: Date.now(),
            priority: -1,
            type: "MT_CROSS_AP_STATUS_ACK",
            status: "expired",
            hasResponse: false,
            message: "Recovery request has expired."
          });
        } else {
          return res.status(200).json({
            id: apId,
            tod: Date.now(),
            priority: -1,
            type: "MT_CROSS_AP_STATUS_ACK",
            status: "pending",
            hasResponse: false,
            message: "Recovery request is still being processed."
          });
        }
      } else {
        return res.status(404).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_CROSS_AP_STATUS_RJT",
          error: "Recovery request not found."
        });
      }

    } catch (error) {
      return res.status(500).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_CROSS_AP_STATUS_RJT",
        error: "Internal server error."
      });
    }
  }

  async getCrossAPRecoveryResponse(req, res) {
    const { tempUserId } = req.body;

    if (!tempUserId) {
      return res.status(400).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_CROSS_AP_RESPONSE_RJT",
        error: "Missing temp user ID."
      });
    }

    try {
      const response = await AppDataSource.manager.findOneBy(CrossAPRecoveryResponse, {
        tempUserId
      });

      if (!response) {
        return res.status(404).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_CROSS_AP_RESPONSE_RJT",
          error: "Recovery response not found."
        });
      }

      return res.status(200).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_CROSS_AP_RESPONSE_ACK",
        encryptedTokenData: response.encryptedTokenData,
        sourceApId: response.sourceApId,
        signature: response.signature
      });

    } catch (error) {
      return res.status(500).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_CROSS_AP_RESPONSE_RJT",
        error: "Internal server error."
      });
    }
  }

  async processCrossAPRecoverySync(req, res) {
    try {
      const { crossAPRequests = [], crossAPResponses = [] } = req.body;

      await cleanupExpiredRequests();

      if (crossAPRequests.length > 0) {
        await processIncomingCrossAPRequests(crossAPRequests);
      }

      if (crossAPResponses.length > 0) {
        await processIncomingCrossAPResponses(crossAPResponses);
      }

      const pendingRequests = await getPendingCrossAPRequests();
      const pendingResponses = await getCrossAPResponses();

      return res.status(200).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_CROSS_AP_SYNC_ACK",
        pendingRequests,
        pendingResponses
      });

    } catch (error) {
      return res.status(500).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_CROSS_AP_SYNC_RJT",
        error: "Internal server error during cross-AP sync."
      });
    }
  }

  async jwkToPem(jwk) {
    try {
      const cryptoKey = await crypto.webcrypto.subtle.importKey(
        'jwk',
        jwk,
        {
          name: 'RSA-PSS',
          hash: 'SHA-256'
        },
        true,
        ['verify']
      );
      
      const spki = await crypto.webcrypto.subtle.exportKey('spki', cryptoKey);
      const base64 = Buffer.from(spki).toString('base64');
      const lines = base64.match(/.{1,64}/g);
      
      if (!lines) {
        throw new Error("Failed to format public key");
      }
      
      const pem = `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
      
      return pem;
    } catch (error) {
      throw new Error("Invalid public key format: " + error.message);
    }
  }
}

export const recoveryController = new RecoveryController();