// Fix for RecoveryController.js
import { apId } from "../../bin/www.js";
import { User } from "../database/entity/User.js";
import { AppDataSource } from "../database/newDbSetup.js";
import { 
  verifyRecoveryPhrase, 
  deriveKeyFromRecoveryPhrase, 
  generateKeyPairFromSeed 
} from "../util/RecoveryUtil.js";
import { createToken } from "../util/RegisterUtils.js";
import { checkTod } from "../util/Util.js";
import { getAdminPublicKey } from "../scripts/readkeys.js";
import { cleanupExpiredRequests, 
  createRecoveryRequest, 
  completeRecovery, 
  processIncomingRecoveryRequests,
  processIncomingRecoveryResponses
} from "../util/CrossApRecoveryUtil.js";
import { RecoveryRequest } from "../database/entity/RecoveryRequest.js";

class RecoveryController {

  async initialRecovery(req,res){
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

    try{
        if(apIdentifier == apId){
           return this.recoverIdentity(req,res);
        }
        console.log(`Initiating cross-AP recovery for user: ${username}@${apIdentifier}`);
        const { requestId } = await createRecoveryRequest(
          username,
          apIdentifier,
          recoveryWords
        );
        return res.status(202).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_RECOVERY_INITIATED",
          recoveryRequestId: requestId,
          message: "Recovery request initiated. Check status using /check-recovery-status."
        });
    }
    catch(error){
      console.error("Recovery initiation error:", error);
      return res.status(500).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_RJT",
        error: "Internal server error during recovery initiation."
      });
    }
  }

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
      const fullUsername = `${username}@${apIdentifier}`;
      
      console.log(`Looking up user: ${fullUsername}`);
      
      // Try to find user with combined username first
      let user = await AppDataSource.manager.findOneBy(User, { 
        username: fullUsername 
      });
      
      // If not found, try just the username (without AP)
      if (!user) {
        console.log(`User ${fullUsername} not found, trying just username: ${username}`);
        user = await AppDataSource.manager.findOneBy(User, {
          username: username
        });
      }
      
      if (!user) {
        console.log(`User not found with either format. Available users:`);
        const allUsers = await AppDataSource.manager.find(User, {});
        console.log(allUsers.map(u => u.username));
        
        return res.status(404).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_RECOVERY_RJT",
          error: "User not found. Recovery failed."
        });
      }
      
      console.log(`User found: ${user.username}, validating recovery phrase`);
      console.log(`User data: recoveryKeyHash exists: ${!!user.recoveryKeyHash}, recoveryKeySalt exists: ${!!user.recoveryKeySalt}`);
      
      // Check if recovery data exists
      if (!user.recoveryKeyHash || !user.recoveryKeySalt) {
        console.error("User doesn't have recovery data stored");
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
      
      // Generate token using the correct username format for your system
      const keyMaterial = await deriveKeyFromRecoveryPhrase(recoveryWords);
      const keyPair = generateKeyPairFromSeed(keyMaterial);
      const mtPubBuffer = Buffer.from(keyPair.publicKey);
      
      // Use the username from the found user record and only pass 2 parameters to createToken
      // Fix: Remove the third argument (apIdentifier)
      const token = createToken(user.username, mtPubBuffer);
      
      console.log(`Token being sent: ${token.substring(0, 50)}...`);
      
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


  async checkRecoveryStatus(req, res){
    
    const { recoveryRequestId } = req.body;

    if (!recoveryRequestId) {
      return res.status(400).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_STATUS",
        status: "error",
        error: "Missing recovery request ID."
      });
    }

    try{
      // Fix: Add await here to properly resolve the Promise
      const request = await AppDataSource.manager.findOneBy(RecoveryRequest, {
        id : recoveryRequestId
      });

      await cleanupExpiredRequests();
      
      if (!request) {
        return res.status(404).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_RECOVERY_STATUS",
          status: "not_found",
          error: "Recovery request not found."
        });
      }
      
      if (request.status === "EXPIRED"){
        return res.status(410).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_RECOVERY_STATUS",
          status: "expired",
          message: "Recovery request has expired. Please initiate a new recovery."
        });
      }

      if (request.status === "COMPLETED") {
        return res.status(200).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_RECOVERY_STATUS",
          status: "completed",
          message: "Recovery data is available. Complete recovery with your recovery words."
        });
      }
      
      return res.status(202).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_STATUS",
        status: "pending",
        message: "Recovery request is still pending. Please try again later."
      });
    }
    catch(error){
      console.error("Error checking recovery status:", error);
      return res.status(500).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_STATUS",
        status: "error",
        error: "Error checking recovery status."
      });
    }
  }
  
  async completeRecoveryProcess(req, res){
    const { recoveryRequestId, recoveryWords } = req.body;
    if (!recoveryRequestId || !recoveryWords) {
      return res.status(400).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_COMPLETE_RJT",
        error: "Missing required fields."
      });
    }

    try{
      const request = await AppDataSource.manager.findOneBy(RecoveryRequest, {
        id: recoveryRequestId
      });
      
      if (!request) {
        return res.status(404).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_RECOVERY_COMPLETE_RJT",
          error: "Recovery request not found."
        });
      }

      if (request.status !== "COMPLETED") {
        return res.status(400).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_RECOVERY_COMPLETE_RJT",
          error: `Recovery is not ready for completion. Current status: ${request.status}.`
        });
      }

      const { token, username } = await completeRecovery(recoveryRequestId, recoveryWords);

      return res.status(200).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_COMPLETE_ACK",
        token,
        username,
        adminPubKey: getAdminPublicKey().toString()
      });
    }

    catch(error){
      console.error("Error completing recovery:", error);
      return res.status(500).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_COMPLETE_RJT",
        error: error.message || "Error completing recovery."
      });
    }
  }

  async processRecoverySync(req, res){

    try{
      const { recoveryRequests, recoveryResponses } = req.body;
      if (recoveryRequests && Array.isArray(recoveryRequests) && recoveryRequests.length > 0) {
        await processIncomingRecoveryRequests(recoveryRequests);
      }

      if (recoveryResponses && Array.isArray(recoveryResponses) && recoveryResponses.length > 0) {
        await processIncomingRecoveryResponses(recoveryResponses);
      }
      return res.status(200).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_SYNC_ACK",
        message: "Recovery data processed successfully."
      });
    }
    catch(error){
      console.error("Error processing recovery sync:", error);
      return res.status(500).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_SYNC_RJT",
        error: "Error processing recovery sync data."
      });
    }
  }

}

export const recoveryController = new RecoveryController();