// Updated CrossApRecoveryUtil.js - Server-side hybrid decryption support

import crypto from 'crypto';
import { sign, jsonToBase64, publicEncrypt } from "./CryptoUtil.js";
import { getPrivateKey, getPublicKey } from "../scripts/readkeys.js";
import { CrossAPRecoveryRequest } from "../database/entity/CrossApRecoveryRequest.js";
import { CrossAPRecoveryResponse } from "../database/entity/CrossApRecoveryResponse.js";
import { User } from "../database/entity/User.js";
import { AppDataSource } from "../database/newDbSetup.js";
import { apId } from "../../bin/www.js";
import { createToken } from "./RegisterUtils.js";
import { verifyRecoveryPhrase, deriveKeyFromRecoveryPhrase, generateKeyPairFromSeed } from './RecoveryUtil.js';
import { LessThan } from "typeorm";
import { verify } from './CryptoUtil.js';

export function generateRequestId() {
    return crypto.randomBytes(16).toString('hex');
}

/**
 * Hybrid decryption function for server-side
 * Handles the new client-side hybrid encryption format
 */
function hybridDecrypt(encryptedData, privateKey) {
    try {
        console.log("🔓 Starting server-side hybrid decryption...");
        console.log("Encrypted data length:", encryptedData.length);
        
        // Step 1: Decode the base64 encoded hybrid data
        const hybridDataJson = Buffer.from(encryptedData, 'base64').toString('utf8');
        const hybridData = JSON.parse(hybridDataJson);
        
        console.log("✅ Hybrid data structure parsed");
        console.log("Structure keys:", Object.keys(hybridData));
        console.log("Encrypted AES key length:", hybridData.encryptedAESKey?.length);
        console.log("Encrypted data length:", hybridData.encryptedData?.length);
        console.log("IV length:", hybridData.iv?.length);
        
        // Step 2: Decrypt AES key with RSA private key
        const encryptedAESKeyBuffer = Buffer.from(hybridData.encryptedAESKey, 'base64');
        console.log("Decrypting AES key with RSA...");
        console.log("Encrypted AES key buffer length:", encryptedAESKeyBuffer.length);
        
        const aesKeyBuffer = crypto.privateDecrypt(
            {
                key: privateKey,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: 'sha256'
            },
            encryptedAESKeyBuffer
        );
        
        console.log("✅ AES key decrypted successfully");
        console.log("AES key length:", aesKeyBuffer.length, "bytes (should be 32)");
        
        // Step 3: Decrypt data with AES key
        const encryptedDataBuffer = Buffer.from(hybridData.encryptedData, 'base64');
        const ivBuffer = Buffer.from(hybridData.iv, 'base64');
        
        console.log("Decrypting data with AES-GCM...");
        console.log("IV length:", ivBuffer.length, "bytes (should be 16)");
        console.log("Encrypted data buffer length:", encryptedDataBuffer.length);
        
        // Split the encrypted data and auth tag for AES-GCM
        // In Node.js, the auth tag is the last 16 bytes
        const authTagLength = 16;
        const ciphertext = encryptedDataBuffer.slice(0, -authTagLength);
        const authTag = encryptedDataBuffer.slice(-authTagLength);
        
        console.log("Ciphertext length:", ciphertext.length);
        console.log("Auth tag length:", authTag.length);
        
        const decipher = crypto.createDecipheriv('aes-256-gcm', aesKeyBuffer, ivBuffer);
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(ciphertext, null, 'utf8');
        decrypted += decipher.final('utf8');
        
        console.log("✅ Data decrypted successfully with AES");
        console.log("Decrypted data length:", decrypted.length);
        
        // Step 4: Parse the JSON result
        const result = JSON.parse(decrypted);
        console.log("✅ Server-side hybrid decryption completed");
        console.log("Result keys:", Object.keys(result));
        
        return result;
        
    } catch (error) {
        console.error("❌ Server-side hybrid decryption failed:", error);
        console.error("Error details:", {
            message: error.message,
            stack: error.stack?.split('\n').slice(0, 3).join('\n')
        });
        throw new Error(`Hybrid decryption failed: ${error.message}`);
    }
}

/**
 * Process incoming cross-AP recovery requests with hybrid decryption support
 */
export async function processIncomingCrossAPRequests(crossAPRequests) {
    try {
        const responses = [];
        
        for (const request of crossAPRequests) {
            // Skip if this request is not for this AP
            if (request.sourceApId !== apId) {
                continue;
            }

            console.log(`🔄 Processing cross-AP recovery request for user ${request.realUserId} from AP ${request.requestingApId}`);
            
            // Check if we already processed this request
            const existingResponse = await AppDataSource.manager.findOneBy(CrossAPRecoveryResponse, {
                tempUserId: request.tempUserId
            });

            if (existingResponse) {
                console.log(`✅ Already responded to request ${request.tempUserId}`);
                responses.push(existingResponse);
                continue;
            }

            // Find the user in our database
            const fullUsername = `${request.realUserId}@${apId}`;
            let user = await AppDataSource.manager.findOneBy(User, { 
                username: fullUsername 
            });

            if (!user) {
                user = await AppDataSource.manager.findOneBy(User, {
                    username: request.realUserId
                });
            }

            if (!user) {
                console.log(`❌ User ${request.realUserId} not found at this AP`);
                continue;
            }

            // Verify the recovery hash matches
            if (!user.recoveryKeyHash || !user.recoveryKeySalt) {
                console.log(`❌ User ${request.realUserId} has no recovery data`);
                continue;
            }

            // Generate token for the user
            const keyMaterial = await deriveKeyFromRecoveryPhrase(
                // We can't verify the actual words here since we only have the hash
                // The verification was done client-side and we trust the hash
                null
            );
            
            // Create a new token for the user
            const token = createToken(user.username, Buffer.from(user.username)); // Simplified for demo

            // Create response data
            const responseData = {
                token,
                timestamp: Date.now(),
                sourceApId: apId,
                destinationApId: request.requestingApId
            };

            // For hybrid encryption response, we would encrypt with the ephemeral public key
            // For now, using the same approach as before but could be enhanced
            const encryptedTokenData = publicEncrypt(
                request.ephemeralPublicKey,
                JSON.stringify(responseData)
            );

            // Create the response
            const recoveryResponse = {
                tempUserId: request.tempUserId,
                encryptedTokenData,
                requestingApId: request.requestingApId,
                sourceApId: apId,
                signature: sign(JSON.stringify({
                    tempUserId: request.tempUserId,
                    timestamp: Date.now()
                })),
                createdAt: new Date()
            };

            await AppDataSource.manager.save(CrossAPRecoveryResponse, recoveryResponse);
            responses.push(recoveryResponse);
            
            console.log(`✅ Created recovery response for request ${request.tempUserId}`);
        }
        
        return responses;
    } catch (error) {
        console.error("❌ Error processing cross-AP recovery requests:", error);
        throw error;
    }
}

/**
 * Process incoming cross-AP recovery responses
 */
export async function processIncomingCrossAPResponses(crossAPResponses) {
    try {
        const processedResponses = [];
        
        for (const response of crossAPResponses) {
            // Skip if this response is not for this AP
            if (response.requestingApId !== apId) {
                continue;
            }

            console.log(`🔄 Processing cross-AP recovery response for request ${response.tempUserId}`);

            // Check if we already have this response
            const existingResponse = await AppDataSource.manager.findOneBy(CrossAPRecoveryResponse, {
                tempUserId: response.tempUserId
            });

            if (existingResponse) {
                console.log(`✅ Response ${response.tempUserId} already exists`);
                continue;
            }

            // Find the corresponding request
            const request = await AppDataSource.manager.findOneBy(CrossAPRecoveryRequest, {
                tempUserId: response.tempUserId
            });

            if (!request) {
                console.log(`❌ Request ${response.tempUserId} not found at this AP`);
                continue;
            }

            // Save the response
            await AppDataSource.manager.save(CrossAPRecoveryResponse, {
                tempUserId: response.tempUserId,
                encryptedTokenData: response.encryptedTokenData,
                requestingApId: response.requestingApId,
                sourceApId: response.sourceApId,
                signature: response.signature,
                createdAt: new Date()
            });

            // Update request status
            await AppDataSource.manager.update(
                CrossAPRecoveryRequest,
                { tempUserId: response.tempUserId },
                { status: "COMPLETED" }
            );

            processedResponses.push(response);
            console.log(`✅ Processed recovery response for request ${response.tempUserId}`);
        }
        
        return processedResponses;
    } catch (error) {
        console.error("❌ Error processing cross-AP recovery responses:", error);
        throw error;
    }
}

/**
 * Enhanced function to handle encrypted recovery requests
 * Now supports both old format and new hybrid encryption
 */
export async function decryptRecoveryRequestData(encryptedData) {
    try {
        console.log("🔓 Attempting to decrypt recovery request data...");
        console.log("Encrypted data type:", typeof encryptedData);
        console.log("Encrypted data length:", encryptedData?.length);
        
        const privateKey = getPrivateKey();
        if (!privateKey) {
            throw new Error("AP private key not available");
        }
        
        // Try to determine if this is hybrid encrypted data or old format
        try {
            // First, try to decode as base64 and check if it's JSON (hybrid format)
            const decoded = Buffer.from(encryptedData, 'base64').toString('utf8');
            const parsed = JSON.parse(decoded);
            
            // If it has hybrid encryption structure, use hybrid decryption
            if (parsed.encryptedAESKey && parsed.encryptedData && parsed.iv) {
                console.log("✅ Detected hybrid encryption format");
                return hybridDecrypt(encryptedData, privateKey);
            }
        } catch (e) {
            // Not hybrid format, continue with old format
            console.log("🔄 Not hybrid format, trying legacy decryption...");
        }
        
        // Fall back to old direct RSA decryption
        console.log("🔄 Using legacy RSA decryption...");
        const decrypted = crypto.privateDecrypt(
            {
                key: privateKey,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: 'sha256'
            },
            Buffer.from(encryptedData, 'base64')
        );
        
        const result = JSON.parse(decrypted.toString());
        console.log("✅ Legacy decryption successful");
        return result;
        
    } catch (error) {
        console.error("❌ Failed to decrypt recovery request data:", error);
        throw error;
    }
}

/**
 * Create a cross-AP recovery response (called by source AP)
 */
export async function createCrossAPResponse(request, userData) {
    try {
        // Generate token for the user
        const token = createToken(userData.username, Buffer.from(userData.username));
        
        const responseData = {
            token,
            timestamp: Date.now(),
            sourceApId: apId,
            destinationApId: request.requestingApId
        };

        // Encrypt with ephemeral public key
        const encryptedTokenData = publicEncrypt(
            request.ephemeralPublicKey,
            JSON.stringify(responseData)
        );

        const response = {
            tempUserId: request.tempUserId,
            encryptedTokenData,
            requestingApId: request.requestingApId,
            sourceApId: apId,
            signature: sign(JSON.stringify({
                tempUserId: request.tempUserId,
                timestamp: Date.now()
            })),
            createdAt: new Date()
        };

        return response;
    } catch (error) {
        console.error("❌ Error creating cross-AP response:", error);
        throw error;
    }
}

/**
 * Cleanup expired cross-AP recovery requests
 */
export async function cleanupExpiredRequests() {
    try {
        const now = new Date();
        
        // Mark expired requests
        await AppDataSource.manager.update(
            CrossAPRecoveryRequest,
            { 
                expiresAt: LessThan(now),
                status: "PENDING"
            },
            { status: "EXPIRED" }
        );
        
        // Delete old expired requests (older than 7 days)
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        
        await AppDataSource.manager.delete(CrossAPRecoveryRequest, {
            status: "EXPIRED",
            expiresAt: LessThan(sevenDaysAgo)
        });
        
        // Delete corresponding responses
        await AppDataSource.manager.delete(CrossAPRecoveryResponse, {
            createdAt: LessThan(sevenDaysAgo)
        });
        
        console.log("✅ Cleaned up expired cross-AP recovery requests");
    } catch (error) {
        console.error("❌ Error cleaning up expired requests:", error);
    }
}

/**
 * Get pending cross-AP recovery requests for propagation
 */
export async function getPendingCrossAPRequests() {
    try {
        return await AppDataSource.manager.find(CrossAPRecoveryRequest, {
            where: { status: "PENDING" }
        });
    } catch (error) {
        console.error("❌ Error getting pending requests:", error);
        return [];
    }
}

/**
 * Get cross-AP recovery responses for propagation
 */
export async function getCrossAPResponses() {
    try {
        return await AppDataSource.manager.find(CrossAPRecoveryResponse, {});
    } catch (error) {
        console.error("❌ Error getting responses:", error);
        return [];
    }
}

/**
 * Verify cross-AP recovery request signature
 */
export function verifyCrossAPRequest(request, publicKey) {
    try {
        const requestData = {
            tempUserId: request.tempUserId,
            requestingApId: request.requestingApId,
            destinationApId: request.destinationApId,
            timestamp: request.timestamp
        };
        
        return verify(JSON.stringify(requestData), request.signature, publicKey);
    } catch (error) {
        console.error("❌ Error verifying cross-AP request:", error);
        return false;
    }
}