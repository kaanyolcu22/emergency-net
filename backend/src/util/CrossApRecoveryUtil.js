import crypto from 'crypto';
import { sign, jsonToBase64 } from "./CryptoUtil.js";
import { getPrivateKey, getPublicKey } from "../scripts/readkeys.js";
import { RecoveryRequest } from "../database/entity/RecoveryRequest.js";
import { RecoveryResponse } from "../database/entity/RecoveryResponse.js";
import { User } from "../database/entity/User.js";
import { AppDataSource } from "../database/newDbSetup.js";
import { apId } from "../../bin/www.js";
import { createToken } from "./RegisterUtils.js";
import { deriveKeyFromRecoveryPhrase , hashRecoveryPhrase} from "./RecoveryUtil.js";
import { verifyRecoveryPhrase, generateKeyPairFromSeed } from './RecoveryUtil.js';
import { LessThan } from "typeorm";




export function generateRequestId() {
    return crypto.randomBytes(16).toString('hex');
}

export async function generateEphemeralKeyPair() {
    return crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    });
}
  

export async function createRecoveryRequest(username, sourceApId, recoveryWords) {

  try{
    const requestId = generateRequestId();
    const keyPair = await generateEphemeralKeyPair();

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 48);

    const { hash: recoveryKeyHash, salt: recoveryKeySalt } = await hashRecoveryPhrase(recoveryWords);

    const requestContent = {
      id: requestId,
      username,
      sourceApId,
      requestingApId: apId,
      ephemeralPublicKey: keyPair.publicKey,
      recoveryKeyHash,
      createdAt: new Date(),
      expiresAt
    };

    const signature = sign(JSON.stringify(requestContent));

    const recoveryRequest = {
      ...requestContent,
      signature,
      status: "PENDING"
    };

    await AppDataSource.manager.save(RecoveryRequest, recoveryRequest);

    // Store the ephemeral private key in localStorage keyed by request ID
    // This is a simplified approach - in production, use a more secure storage method
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`recovery_private_key_${requestId}`, keyPair.privateKey);
    } else {
      // For server-side, store in a map or other temporary storage
      global.recoveryPrivateKeys = global.recoveryPrivateKeys || new Map();
      global.recoveryPrivateKeys.set(requestId, keyPair.privateKey);
    }

    return {
      requestId,
      publicKey: keyPair.publicKey
    };
  }

  catch(error){
    console.error("Error creating recovery request:", error);
    throw error;
  }

}

export async function processIncomingRecoveryRequests(recoveryRequests) {

    try{
        const responses = [];
        for (const request of recoveryRequests) {
          if (request.sourceApId !== apId) {
            continue;
          }

          console.log(`Processing recovery request for user ${request.username}`);
          const user = await AppDataSource.manager.findOneBy(User, { 
            username: request.username 
          });

          if (!user) {
            console.log(`User ${request.username} not found at this AP`);
            continue;
          }

          const existingResponse = await AppDataSource.manager.findOneBy(RecoveryResponse, {
            requestId: request.id
          });

          if (existingResponse) {
            console.log(`Already responded to request ${request.id}`);
            responses.push(existingResponse);
            continue;
          }

          const userData = {
            username: user.username,
            recoveryKeyHash: user.recoveryKeyHash,
            recoveryKeySalt: user.recoveryKeySalt
          }

          const encryptedUserData = crypto.publicEncrypt(
            request.ephemeralPublicKey,
            Buffer.from(JSON.stringify(userData))
          ).toString('base64');

          const responseContent = {
            requestId: request.id,
            encryptedUserData,
            sourceApId: apId,
            targetApId: request.requestingApId,
            createdAt: new Date()
          };

          const signature = sign(JSON.stringify(responseContent));

          const recoveryResponse = {
            ...responseContent,
            signature
          };

          await AppDataSource.manager.save(RecoveryResponse, recoveryResponse);

          responses.push(recoveryResponse);
          console.log(`Created recovery response for request ${request.id}`);
        }
        return responses;
      }
    catch(error){
      console.error("Error processing recovery requests:", error);
      throw error;
    }
}

export async function processIncomingRecoveryResponses(recoveryResponses) {

    
    try{
      const completedRequests = [];
      for (const response of recoveryResponses) {
        if (response.targetApId !== apId) {
          continue;
        }
        console.log(`Processing recovery response for request ${response.requestId}`);

        const request = await AppDataSource.manager.findOneBy(RecoveryRequest, {
          id: response.requestId
        });

        if (!request) {
          console.log(`Request ${response.requestId} not found at this AP`);
          continue;
        }

        if (request.status !== "PENDING") {
          console.log(`Request ${response.requestId} is already ${request.status}`);
          continue;
        }

        let privateKey;
        if (typeof localStorage !== 'undefined') {
          privateKey = localStorage.getItem(`recovery_private_key_${response.requestId}`);
        } else {
          privateKey = global.recoveryPrivateKeys?.get(response.requestId);
        }

        if (!privateKey) {
          console.error(`Private key for request ${response.requestId} not found`);
          continue;
        }

        try{
          const decryptedData = crypto.privateDecrypt(
            privateKey,
            Buffer.from(response.encryptedUserData, 'base64')
          ).toString();

          const userData = JSON.parse(decryptedData);
          await AppDataSource.manager.update(
            RecoveryRequest,
            { id: response.requestId },
            { status: "COMPLETED" }
          );
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(`recovery_data_${response.requestId}`, JSON.stringify(userData));
          } else {
            global.recoveryData = global.recoveryData || new Map();
            global.recoveryData.set(response.requestId, userData);
          }

          completedRequests.push({
            requestId: response.requestId,
            userData
          });

          console.log(`Recovery completed for request ${response.requestId}`);

        }
        catch(error){
          console.error(`Error decrypting recovery data for request ${response.requestId}:`, error);
        }


        return completedRequests;
      }


    }

    catch(error){
      console.error("Error processing recovery responses:", error);
      throw error;
    }
  
}

export async function completeRecovery(requestId, recoveryWords) {
  try {
    let userData;
    if (typeof localStorage !== 'undefined') {
      userData = JSON.parse(localStorage.getItem(`recovery_data_${requestId}`));
    } else {
      userData = global.recoveryData?.get(requestId);
    }
    
    if (!userData) {
      throw new Error("Recovery data not found");
    }
  
    const isValid = await verifyRecoveryPhrase(
      recoveryWords,
      userData.recoveryKeyHash,
      userData.recoveryKeySalt
    );
    
    if (!isValid) {
      throw new Error("Invalid recovery words");
    }
    
    const keyMaterial = await deriveKeyFromRecoveryPhrase(recoveryWords);
    const keyPair = generateKeyPairFromSeed(keyMaterial);
    
    const token = createToken(userData.username, Buffer.from(keyPair.publicKey));
    
    return {
      token,
      username: userData.username
    };
  } catch (error) {
    console.error("Error completing recovery:", error);
    throw error;
  }
}

export async function cleanupExpiredRequests() {
  try {
    const now = new Date();
  
    await AppDataSource.manager.update(
      RecoveryRequest,
      { 
        expiresAt: LessThan(now),
        status: "PENDING"
      },
      { status: "EXPIRED" }
    );
    
    const expiredRequests = await AppDataSource.manager.find(RecoveryRequest, {
      where: { status: "EXPIRED" },
      select: ["id"]
    });
  
    for (const request of expiredRequests) {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(`recovery_private_key_${request.id}`);
        localStorage.removeItem(`recovery_data_${request.id}`);
      } else {
        global.recoveryPrivateKeys?.delete(request.id);
        global.recoveryData?.delete(request.id);
      }
    }
    
    console.log(`Cleaned up ${expiredRequests.length} expired recovery requests`);
  } catch (error) {
    console.error("Error cleaning up expired requests:", error);
  }
}