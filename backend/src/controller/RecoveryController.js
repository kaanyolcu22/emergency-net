// src/controllers/RecoveryController.js - Unified recovery controller
import { apId } from "../../bin/www.js";
import { User } from "../database/entity/User.js";
import { AppDataSource } from "../database/newDbSetup.js";
import { 
  verifyRecoveryPhrase, 
  deriveKeyFromRecoveryPhrase, 
  generateKeyPairFromSeed,
  hashRecoveryPhrase,
  generateRecoveryWords
} from "../util/RecoveryUtil.js";
import { createToken } from "../util/RegisterUtils.js";
import { checkTod } from "../util/Util.js";
import { getAdminPublicKey, getPublicKey, getPrivateKey } from "../scripts/readkeys.js";
import { 
  processIncomingCrossAPRequests,
  processIncomingCrossAPResponses,
  cleanupExpiredRequests,
  createCrossAPResponse,
  decryptRecoveryRequestData
} from "../util/CrossApRecoveryUtil.js";
import { CrossAPRecoveryRequest } from "../database/entity/CrossApRecoveryRequest.js";
import { CrossAPRecoveryResponse } from "../database/entity/CrossApRecoveryResponse.js";
import crypto from 'crypto';

class RecoveryController {

  // Unified recovery - handles local and cross-AP automatically
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

    const { username, apIdentifier, recoveryWords } = req.body;

    if (!username || !apIdentifier || !recoveryWords) {
      return res.status(400).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_RJT",
        error: "Missing required fields."
      });
    }

    try {
      // Check if this is local recovery (same AP)
      if (apIdentifier === apId) {
        console.log("Attempting local recovery for:", username);
        return await this.handleLocalRecovery(req, res, username, apIdentifier, recoveryWords);
      } else {
        console.log("User registered at different AP, rejecting for cross-AP handling");
        return res.status(400).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_RECOVERY_RJT",
          error: "User not registered at this AP. Use cross-AP recovery."
        });
      }
    } catch (error) {
      console.error("Recovery error:", error);
      return res.status(500).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_RJT",
        error: "Internal server error during recovery."
      });
    }
  }

  // Handle local recovery
  async handleLocalRecovery(req, res, username, apIdentifier, recoveryWords) {
    try {
      const fullUsername = `${username}@${apIdentifier}`;
      
      let user = await AppDataSource.manager.findOneBy(User, { 
        username: fullUsername 
      });
      
      if (!user) {
        user = await AppDataSource.manager.findOneBy(User, {
          username: username
        });
      }
      
      if (!user) {
        return res.status(404).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_RECOVERY_RJT",
          error: "User not found at this AP."
        });
      }
      
      if (!user.recoveryKeyHash || !user.recoveryKeySalt) {
        return res.status(400).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_RECOVERY_RJT",
          error: "User account doesn't have recovery data."
        });
      }
      
      const isValid = await verifyRecoveryPhrase(
        recoveryWords,
        user.recoveryKeyHash,
        user.recoveryKeySalt
      );
      
      if (!isValid) {
        return res.status(401).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_RECOVERY_RJT",
          error: "Invalid recovery phrase."
        });
      }
      
      const keyMaterial = await deriveKeyFromRecoveryPhrase(recoveryWords);
      const keyPair = generateKeyPairFromSeed(keyMaterial);
      const mtPubBuffer = Buffer.from(keyPair.publicKey);
      
      const token = createToken(user.username, mtPubBuffer);
      
      await AppDataSource.manager.update(
        User,
        { username: user.username },
        { recoveryKeyUpdatedAt: new Date() }
      );
      
      return res.status(200).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_ACK",
        token
      });
    } catch (error) {
      console.error("Local recovery error:", error);
      return res.status(500).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_RJT",
        error: "Internal server error during local recovery."
      });
    }
  }

  // Initiate cross-AP recovery with temporary identity
  async initiateCrossAPRecoveryWithTempIdentity(req, res) {
    const tod_received = req.body.tod;
    if (!checkTod(tod_received)) {
      return res.status(408).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_CROSS_AP_RECOVERY_RJT",
        error: "Timeout error."
      });
    }

    const { tempUserId, tempUsername, originalUsername, encryptedRecoveryData, destinationApId } = req.body;

    if (!tempUserId || !tempUsername || !originalUsername || !encryptedRecoveryData || !destinationApId) {
      return res.status(400).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_CROSS_AP_RECOVERY_RJT",
        error: "Missing required fields."
      });
    }

    try {
      console.log("🔄 Processing cross-AP recovery with temp identity...");
      console.log("Temp Username:", tempUsername);
      console.log("Original Username:", originalUsername);
      console.log("Destination AP:", destinationApId);

      // Decrypt the recovery data
      const recoveryRequestData = await decryptRecoveryRequestData(encryptedRecoveryData);
      
      // Create cross-AP recovery request
      const crossAPRequest = {
        tempUserId,
        requestingApId: apId,
        destinationApId,
        hash: recoveryRequestData.hash,
        realUserId: recoveryRequestData.realUserId,
        sourceApId: recoveryRequestData.sourceApId,
        ephemeralPublicKey: recoveryRequestData.ephemeralPublicKey,
        timestamp: recoveryRequestData.timestamp,
        status: "PENDING",
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) // 48 hours
      };

      // Save to database for propagation
      await AppDataSource.manager.save(CrossAPRecoveryRequest, crossAPRequest);
      
      // Create temporary token for immediate use
      const tempTokenData = {
        apReg: apId,
        todReg: Date.now(),
        mtUsername: tempUsername,
        mtPubKey: "temp_key_placeholder",
        isTemporary: true,
        originalUsername: originalUsername,
        tempUserId: tempUserId
      };
      
      // Generate a temporary token (simplified for demo)
      const tempToken = this.createTemporaryToken(tempTokenData);

      return res.status(200).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_CROSS_AP_RECOVERY_ACK",
        tempToken: tempToken,
        tempUserId: tempUserId,
        tempUsername: tempUsername,
        message: "Cross-AP recovery initiated with temporary identity."
      });

    } catch (error) {
      console.error("❌ Cross-AP recovery initiation error:", error);
      
      let errorMessage = "Failed to process recovery request.";
      if (error.message.includes("Hybrid decryption failed")) {
        errorMessage = "Failed to decrypt recovery data. Please check your recovery words.";
      } else if (error.message.includes("JSON")) {
        errorMessage = "Invalid recovery data format.";
      } else if (error.message.includes("private key")) {
        errorMessage = "Server configuration error - private key not available.";
      }
      
      return res.status(500).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_CROSS_AP_RECOVERY_RJT",
        error: errorMessage
      });
    }
  }

  // Create temporary token (simplified)
  createTemporaryToken(tokenData) {
    const encodedData = Buffer.from(JSON.stringify(tokenData)).toString('base64');
    const tempSignature = "temp_signature_" + Date.now();
    const tempCert = "temp_cert";
    return `${encodedData}.${tempSignature}.${tempCert}`;
  }

  // Check cross-AP recovery status
  async checkCrossAPRecoveryStatus(req, res) {
    const { tempUserId } = req.body;

    if (!tempUserId) {
      return res.status(400).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_STATUS_RJT",
        error: "Missing temp user ID."
      });
    }

    try {
      await cleanupExpiredRequests();
      
      const request = await AppDataSource.manager.findOneBy(CrossAPRecoveryRequest, {
        tempUserId: tempUserId
      });

      if (!request) {
        return res.status(404).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_RECOVERY_STATUS",
          status: "not_found",
          hasResponse: false
        });
      }

      // Check if response is available
      const response = await AppDataSource.manager.findOneBy(CrossAPRecoveryResponse, {
        tempUserId: tempUserId
      });

      if (response) {
        return res.status(200).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_RECOVERY_STATUS",
          status: "completed",
          hasResponse: true
        });
      }

      if (request.status === "EXPIRED") {
        return res.status(410).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_RECOVERY_STATUS",
          status: "expired",
          hasResponse: false
        });
      }

      return res.status(202).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_STATUS",
        status: "pending",
        hasResponse: false
      });

    } catch (error) {
      console.error("Error checking recovery status:", error);
      return res.status(500).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_STATUS_RJT",
        error: "Error checking recovery status."
      });
    }
  }

  // Get recovery response
  async getRecoveryResponse(req, res) {
    const { tempUserId } = req.body;

    if (!tempUserId) {
      return res.status(400).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_GET_RECOVERY_RESPONSE_RJT",
        error: "Missing temp user ID."
      });
    }

    try {
      const response = await AppDataSource.manager.findOneBy(CrossAPRecoveryResponse, {
        tempUserId: tempUserId
      });

      if (!response) {
        return res.status(404).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_GET_RECOVERY_RESPONSE_RJT",
          error: "Recovery response not found."
        });
      }

      return res.status(200).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_GET_RECOVERY_RESPONSE_ACK",
        encryptedResponse: response.encryptedTokenData
      });

    } catch (error) {
      console.error("Error getting recovery response:", error);
      return res.status(500).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_GET_RECOVERY_RESPONSE_RJT",
        error: "Error retrieving recovery response."
      });
    }
  }

  // Process cross-AP recovery sync
  async processCrossAPRecoverySync(req, res) {
    try {
      const { crossAPRequests, crossAPResponses } = req.body;

      if (crossAPRequests && Array.isArray(crossAPRequests) && crossAPRequests.length > 0) {
        await processIncomingCrossAPRequests(crossAPRequests);
      }

      if (crossAPResponses && Array.isArray(crossAPResponses) && crossAPResponses.length > 0) {
        await processIncomingCrossAPResponses(crossAPResponses);
      }

      return res.status(200).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_CROSS_AP_RECOVERY_SYNC_ACK",
        message: "Cross-AP recovery data processed successfully."
      });
    } catch (error) {
      console.error("Error processing cross-AP recovery sync:", error);
      return res.status(500).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_CROSS_AP_RECOVERY_SYNC_RJT",
        error: "Error processing cross-AP recovery sync data."
      });
    }
  }
}

export const recoveryController = new RecoveryController();