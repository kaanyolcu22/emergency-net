import { apId } from "../../bin/www.js";
import { User } from "../database/entity/User.js";
import { AppDataSource } from "../database/newDbSetup.js";
import { 
  verifyRecoveryPhrase, 
  deriveKeyFromRecoveryPhrase, 
  generateKeyPairFromSeed ,
  hashRecoveryPhrase,
  generateRecoveryWords
} from "../util/RecoveryUtil.js";
import { createToken } from "../util/RegisterUtils.js";
import { checkTod } from "../util/Util.js";
import { getAdminPublicKey, getPublicKey } from "../scripts/readkeys.js";
import { 
  processIncomingCrossAPRequests,
  processIncomingCrossAPResponses,
  cleanupExpiredRequests,
  createCrossAPResponse
} from "../util/CrossApRecoveryUtil.js";
import { CrossAPRecoveryRequest } from "../database/entity/CrossApRecoveryRequest.js";
import { CrossAPRecoveryResponse } from "../database/entity/CrossApRecoveryResponse.js";
import { base64toJson, privateDecrypt } from "../util/CryptoUtil.js";

class RecoveryController {

  // Local recovery - same AP
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
      if (apIdentifier !== apId) {
        return res.status(400).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_RECOVERY_RJT",
          error: "User not registered at this AP. Use cross-AP recovery."
        });
      }

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
          error: "User not found."
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
        adminPubKey: getAdminPublicKey().toString(),
        token
      });
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

  // Initiate cross-AP recovery - client sends encrypted data
  async initiateCrossAPRecovery(req, res) {
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

    const { tempUserId, encryptedRecoveryData, destinationApId } = req.body;

    if (!tempUserId || !encryptedRecoveryData || !destinationApId) {
      return res.status(400).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_CROSS_AP_RECOVERY_RJT",
        error: "Missing required fields."
      });
    }

    try {
      // Decrypt the recovery data with AP's private key
      const decryptedData = privateDecrypt(getPrivateKey(), encryptedRecoveryData);
      const recoveryRequestData = JSON.parse(decryptedData);

      // Create cross-AP recovery request for propagation
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

      return res.status(200).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_CROSS_AP_RECOVERY_ACK",
        message: "Cross-AP recovery request initiated."
      });

    } catch (error) {
      console.error("Cross-AP recovery initiation error:", error);
      return res.status(500).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_CROSS_AP_RECOVERY_RJT",
        error: "Failed to process recovery request."
      });
    }
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

  // Get recovery response for completion
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

  // Process incoming cross-AP recovery requests and responses
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