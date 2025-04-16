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
      const { username, apIdentifier, recoveryWords } = req.body;
      const fullUsername = `${username}@${apIdentifier}`;
      
      console.log(`Looking up user: ${fullUsername}`);
      
      let user = await AppDataSource.manager.findOneBy(User, { 
        username: fullUsername 
      });
      
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
    
      const keyMaterial = await deriveKeyFromRecoveryPhrase(recoveryWords);
      const keyPair = generateKeyPairFromSeed(keyMaterial);
      const mtPubBuffer = Buffer.from(keyPair.publicKey);
      
      const token = createToken(user.username, mtPubBuffer, apIdentifier);
      
      console.log(`Token being sent: ${token.substring(0, 50)}...`);
      console.log(`Response structure:`, JSON.stringify({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_ACK",
        adminPubKey: "sample_key_string",
        token: "sample_token_string"
      }, null, 2));
      
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
  
  async checkPendingRecovery(req, res) {
    const { username, apIdentifier, recoveryRequestId } = req.body;
    
    try {
      return res.status(200).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_STATUS",
        status: "pending", 
        message: "Still waiting for synchronization data."
      });
    } catch (error) {
      console.error("Recovery check error:", error);
      return res.status(500).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_STATUS",
        error: "Error checking recovery status."
      });
    }
  }
}

export const recoveryController = new RecoveryController();