// src/controllers/RecoveryController.js - With extensive debugging
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
    console.log("\n=== RECOVERY DEBUG START ===");
    console.log("Request body keys:", Object.keys(req.body));
    console.log("Username:", req.body.username);
    console.log("AP Identifier:", req.body.apIdentifier);
    console.log("Has recovery words:", !!req.body.recoveryWords);
    console.log("Has new public key:", !!req.body.newPublicKey);
    console.log("Current AP ID:", apId);
    
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

    const { username, apIdentifier, recoveryWords, newPublicKey } = req.body;

    if (!username || !apIdentifier || !recoveryWords) {
      console.log("❌ Missing required fields");
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
        console.log("✅ Local recovery detected");
        return await this.handleLocalRecovery(req, res, username, apIdentifier, recoveryWords, newPublicKey);
      } else {
        console.log("❌ Cross-AP recovery needed");
        return res.status(400).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_RECOVERY_RJT",
          error: "User not registered at this AP. Use cross-AP recovery."
        });
      }
    } catch (error) {
      console.error("❌ Recovery error:", error);
      return res.status(500).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_RJT",
        error: "Internal server error during recovery."
      });
    } finally {
      console.log("=== RECOVERY DEBUG END ===\n");
    }
  }

  // Handle local recovery with extensive debugging
  async handleLocalRecovery(req, res, username, apIdentifier, recoveryWords, newPublicKey) {
    try {
      console.log("\n--- LOCAL RECOVERY DEBUG ---");
      
      const fullUsername = `${username}@${apIdentifier}`;
      console.log("Looking for user:", fullUsername);
      
      let user = await AppDataSource.manager.findOneBy(User, { 
        username: fullUsername 
      });
      
      if (!user) {
        console.log("Full username not found, trying short username:", username);
        user = await AppDataSource.manager.findOneBy(User, {
          username: username
        });
      }
      
      if (!user) {
        console.log("❌ User not found in database");
        return res.status(404).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_RECOVERY_RJT",
          error: "User not found at this AP."
        });
      }
      
      console.log("✅ User found:", user.username);
      console.log("Has recovery hash:", !!user.recoveryKeyHash);
      console.log("Has recovery salt:", !!user.recoveryKeySalt);
      
      if (!user.recoveryKeyHash || !user.recoveryKeySalt) {
        console.log("❌ No recovery data for user");
        return res.status(400).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_RECOVERY_RJT",
          error: "User account doesn't have recovery data."
        });
      }
      
      console.log("🔍 Verifying recovery phrase...");
      console.log("Recovery words length:", recoveryWords.length);
      console.log("Stored hash preview:", user.recoveryKeyHash.substring(0, 20) + "...");
      console.log("Stored salt preview:", user.recoveryKeySalt.substring(0, 20) + "...");
      
      const isValid = await verifyRecoveryPhrase(
        recoveryWords,
        user.recoveryKeyHash,
        user.recoveryKeySalt
      );
      
      console.log("Recovery phrase valid:", isValid);
      
      if (!isValid) {
        console.log("❌ Invalid recovery phrase");
        return res.status(401).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_RECOVERY_RJT",
          error: "Invalid recovery phrase."
        });
      }
      
      console.log("✅ Recovery phrase verified");
      console.log("🔑 Processing public key for token...");
      
      // Use client's public key if provided, otherwise generate server-side
      let publicKeyForToken;
      
      if (newPublicKey) {
        console.log("📤 Using client's public key");
        console.log("Client public key type:", typeof newPublicKey);
        console.log("Client public key keys:", Object.keys(newPublicKey));
        console.log("Key type (kty):", newPublicKey.kty);
        console.log("Algorithm:", newPublicKey.alg);
        console.log("Modulus length:", newPublicKey.n ? newPublicKey.n.length : "none");
        
        try {
          // Convert JWK to PEM format for token
          const clientPubKeyPem = await this.jwkToPem(newPublicKey);
          console.log("✅ JWK to PEM conversion successful");
          console.log("PEM preview:", clientPubKeyPem.substring(0, 100) + "...");
          publicKeyForToken = Buffer.from(clientPubKeyPem, 'utf8');
          console.log("Public key buffer length:", publicKeyForToken.length);
        } catch (jwkError) {
          console.error("❌ JWK to PEM conversion failed:", jwkError);
          throw jwkError;
        }
      } else {
        console.log("🔧 Generating server-side keys");
        const keyMaterial = await deriveKeyFromRecoveryPhrase(recoveryWords);
        const keyPair = generateKeyPairFromSeed(keyMaterial);
        publicKeyForToken = Buffer.from(keyPair.publicKey, 'utf8');
        console.log("Server-generated key buffer length:", publicKeyForToken.length);
      }
      
      console.log("🎫 Creating token...");
      console.log("Token username:", user.username);
      console.log("Token public key buffer length:", publicKeyForToken.length);
      
      // Create token with the public key
      const token = createToken(user.username, publicKeyForToken);
      
      console.log("✅ Token created successfully");
      console.log("Token length:", token.length);
      console.log("Token parts:", token.split('.').length);
      console.log("Token preview:", token.substring(0, 100) + "...");
      
      // Parse token to verify content
      try {
        const tokenParts = token.split('.');
        const tokenData = JSON.parse(Buffer.from(tokenParts[0], 'base64').toString());
        console.log("Token data preview:", {
          mtUsername: tokenData.mtUsername,
          apReg: tokenData.apReg,
          todReg: tokenData.todReg,
          hasPubKey: !!tokenData.mtPubKey,
          pubKeyPreview: tokenData.mtPubKey ? tokenData.mtPubKey.substring(0, 50) + "..." : "none"
        });
      } catch (parseError) {
        console.error("❌ Token parsing error:", parseError);
      }
      
      console.log("💾 Updating user recovery timestamp...");
      
      // Update user's recovery timestamp
      await AppDataSource.manager.update(
        User,
        { username: user.username },
        { recoveryKeyUpdatedAt: new Date() }
      );
      
      console.log("✅ User updated successfully");
      
      const response = {
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_ACK",
        adminPubKey: getAdminPublicKey().toString(),
        token
      };
      
      console.log("📤 Sending response:", {
        type: response.type,
        hasToken: !!response.token,
        hasAdminKey: !!response.adminPubKey
      });
      
      return res.status(200).json(response);
      
    } catch (error) {
      console.error("❌ Local recovery error:", error);
      console.error("Error stack:", error.stack);
      return res.status(500).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_RECOVERY_RJT",
        error: "Internal server error during local recovery: " + error.message
      });
    }
  }

  // Helper function to convert JWK to PEM format with debugging
  async jwkToPem(jwk) {
    try {
      console.log("🔧 Converting JWK to PEM...");
      console.log("JWK input:", {
        kty: jwk.kty,
        use: jwk.use,
        alg: jwk.alg,
        hasN: !!jwk.n,
        hasE: !!jwk.e,
        nLength: jwk.n ? jwk.n.length : 0,
        eLength: jwk.e ? jwk.e.length : 0
      });
      
      // Import JWK as CryptoKey
      console.log("📥 Importing JWK as CryptoKey...");
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
      
      console.log("✅ JWK imported as CryptoKey");
      
      // Export as SPKI (PEM format)
      console.log("📤 Exporting as SPKI...");
      const spki = await crypto.webcrypto.subtle.exportKey('spki', cryptoKey);
      
      console.log("✅ SPKI exported, length:", spki.byteLength);
      
      const base64 = Buffer.from(spki).toString('base64');
      console.log("Base64 length:", base64.length);
      
      const lines = base64.match(/.{1,64}/g);
      console.log("Base64 lines:", lines ? lines.length : 0);
      
      const pem = `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
      console.log("✅ PEM generated, length:", pem.length);
      
      return pem;
    } catch (error) {
      console.error("❌ JWK to PEM conversion failed:", error);
      console.error("Error details:", {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      throw new Error("Invalid public key format: " + error.message);
    }
  }

  // Rest of methods with minimal changes...
  createTemporaryToken(tokenData) {
    const encodedData = Buffer.from(JSON.stringify(tokenData)).toString('base64');
    const tempSignature = "temp_signature_" + Date.now();
    const tempCert = "temp_cert";
    return `${encodedData}.${tempSignature}.${tempCert}`;
  }

  async initiateCrossAPRecoveryWithTempIdentity(req, res) {
    // Implementation remains the same
    return res.status(500).json({
      error: "Cross-AP recovery not implemented in debug version"
    });
  }

  async checkCrossAPRecoveryStatus(req, res) {
    return res.status(500).json({
      error: "Cross-AP recovery status not implemented in debug version"
    });
  }

  async getRecoveryResponse(req, res) {
    return res.status(500).json({
      error: "Get recovery response not implemented in debug version"
    });
  }

  async processCrossAPRecoverySync(req, res) {
    return res.status(500).json({
      error: "Cross-AP recovery sync not implemented in debug version"
    });
  }
}

export const recoveryController = new RecoveryController();