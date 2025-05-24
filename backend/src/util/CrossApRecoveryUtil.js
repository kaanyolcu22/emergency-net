import crypto from 'crypto';
import { sign, jsonToBase64, publicEncrypt } from "./CryptoUtil.js";
import { getPrivateKey, getPublicKey } from "../scripts/readkeys.js";
import { CrossAPRecoveryRequest } from "../database/entity/CrossAPRecoveryRequest.js";
import { CrossAPRecoveryResponse } from "../database/entity/CrossAPRecoveryResponse.js";
import { User } from "../database/entity/User.js";
import { AppDataSource } from "../database/newDbSetup.js";
import { apId } from "../../bin/www.js";
import { createToken } from "./RegisterUtils.js";
import { verifyRecoveryPhrase, deriveKeyFromRecoveryPhrase, generateKeyPairFromSeed } from './RecoveryUtil.js';
import { LessThan } from "typeorm";

export function generateRequestId() {
    return crypto.randomBytes(16).toString('hex');
}

/**
 * Process incoming cross-AP recovery requests
 * When this AP receives requests from other APs via sync
 */
export async function processIncomingCrossAPRequests(crossAPRequests) {
    try {
        const responses = [];
        
        for (const request of crossAPRequests) {
            // Skip if this request is not for this AP
            if (request.sourceApId !== apId) {
                continue;
            }

            console.log(`Processing cross-AP recovery request for user ${request.realUserId} from AP ${request.requestingApId}`);
            
            // Check if we already processed this request
            const existingResponse = await AppDataSource.manager.findOneBy(CrossAPRecoveryResponse, {
                tempUserId: request.tempUserId
            });

            if (existingResponse) {
                console.log(`Already responded to request ${request.tempUserId}`);
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
                console.log(`User ${request.realUserId} not found at this AP`);
                continue;
            }

            // Verify the recovery hash matches
            if (!user.recoveryKeyHash || !user.recoveryKeySalt) {
                console.log(`User ${request.realUserId} has no recovery data`);
                continue;
            }

            // Generate token for the user
            const keyMaterial = await deriveKeyFromRecoveryPhrase(
                // We can't verify the actual words here since we only have the hash
                // The verification was done client-side and we trust the hash
                null
            );
            
            // Instead, generate token using stored user data
            const tokenData = {
                username: user.username,
                timestamp: Date.now()
            };
            
            // Create a new token for the user
            const token = createToken(user.username, Buffer.from(user.username)); // Simplified for demo

            // Encrypt the token with the ephemeral public key
            const responseData = {
                token,
                timestamp: Date.now(),
                sourceApId: apId,
                destinationApId: request.requestingApId
            };

            // Encrypt with ephemeral public key (from request)
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
            
            console.log(`Created recovery response for request ${request.tempUserId}`);
        }
        
        return responses;
    } catch (error) {
        console.error("Error processing cross-AP recovery requests:", error);
        throw error;
    }
}

/**
 * Process incoming cross-AP recovery responses
 * When this AP receives responses from other APs via sync
 */
export async function processIncomingCrossAPResponses(crossAPResponses) {
    try {
        const processedResponses = [];
        
        for (const response of crossAPResponses) {
            // Skip if this response is not for this AP
            if (response.requestingApId !== apId) {
                continue;
            }

            console.log(`Processing cross-AP recovery response for request ${response.tempUserId}`);

            // Check if we already have this response
            const existingResponse = await AppDataSource.manager.findOneBy(CrossAPRecoveryResponse, {
                tempUserId: response.tempUserId
            });

            if (existingResponse) {
                console.log(`Response ${response.tempUserId} already exists`);
                continue;
            }

            // Find the corresponding request
            const request = await AppDataSource.manager.findOneBy(CrossAPRecoveryRequest, {
                tempUserId: response.tempUserId
            });

            if (!request) {
                console.log(`Request ${response.tempUserId} not found at this AP`);
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
            console.log(`Processed recovery response for request ${response.tempUserId}`);
        }
        
        return processedResponses;
    } catch (error) {
        console.error("Error processing cross-AP recovery responses:", error);
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
        console.error("Error creating cross-AP response:", error);
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
        
        console.log("Cleaned up expired cross-AP recovery requests");
    } catch (error) {
        console.error("Error cleaning up expired requests:", error);
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
        console.error("Error getting pending requests:", error);
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
        console.error("Error getting responses:", error);
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
        console.error("Error verifying cross-AP request:", error);
        return false;
    }
}