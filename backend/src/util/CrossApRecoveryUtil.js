import crypto from 'crypto';
import { sign, jsonToBase64 } from "./CryptoUtil.js";
import { getPrivateKey, getPublicKey } from "../scripts/readkeys.js";
import { CrossAPRecoveryRequest } from "../database/entity/CrossAPRecoveryRequest.js";
import { CrossAPRecoveryResponse } from "../database/entity/CrossAPRecoveryResponse.js";
import { User } from "../database/entity/User.js";
import { createToken } from "./RegisterUtils.js";
import { AppDataSource } from "../database/newDbSetup.js";
import { apId } from "../../bin/www.js";
import { LessThan } from "typeorm";

export function generateRequestId() {
    return crypto.randomBytes(16).toString('hex');
}

export async function processClientCrossAPRequest(encryptedRequest) {
    try {
        const decryptedData = decryptWithAPPrivateKey(encryptedRequest);
        const requestData = JSON.parse(decryptedData);
        
        if (!requestData.tempUserId || !requestData.realUserId || !requestData.sourceApId || 
            !requestData.recoveryHash || !requestData.ephemeralPublicKey) {
            throw new Error("Invalid request data - missing required fields");
        }
        
        const ap1RequestData = {
            tempUserId: requestData.tempUserId,
            realUserId: requestData.realUserId,
            sourceApId: requestData.sourceApId,
            recoveryHash: requestData.recoveryHash,
            ephemeralPublicKey: requestData.ephemeralPublicKey,
            requestingApId: apId,
            timestamp: Date.now(),
            type: "AP_TO_AP_RECOVERY_REQUEST"
        };
        
        const requestSignature = sign(JSON.stringify(ap1RequestData));
        const signedRequest = {
            ...ap1RequestData,
            ap2Signature: requestSignature
        };
        
        const ap1Certificate = await getAPCertificate(requestData.sourceApId);
        if (!ap1Certificate) {
            throw new Error(`Cannot find certificate for AP: ${requestData.sourceApId}`);
        }
        
        const ap1PublicKey = extractPublicKeyFromCert(ap1Certificate);
        const encryptedForAP1 = encryptWithAPPublicKey(
            JSON.stringify(signedRequest), 
            ap1PublicKey
        );
        
        const crossAPRequest = {
            tempUserId: requestData.tempUserId,
            requestingApId: apId,
            destinationApId: requestData.sourceApId,
            hash: requestData.recoveryHash,
            realUserId: requestData.realUserId,
            sourceApId: requestData.sourceApId,
            ephemeralPublicKey: requestData.ephemeralPublicKey,
            timestamp: Date.now(),
            status: "PENDING",
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            responseData: encryptedForAP1
        };
        
        await AppDataSource.manager.save(CrossAPRecoveryRequest, crossAPRequest);
        
        return {
            success: true,
            tempUserId: requestData.tempUserId,
            message: "Cross-AP recovery request created and will be forwarded to source AP"
        };
        
    } catch (error) {
        throw error;
    }
}

export async function getPendingCrossAPRequests() {
    try {
        const pendingRequests = await AppDataSource.manager.find(CrossAPRecoveryRequest, {
            where: { 
                requestingApId: apId,
                status: "PENDING" 
            }
        });
        
        return pendingRequests.map(request => ({
            tempUserId: request.tempUserId,
            destinationApId: request.sourceApId,
            encryptedData: request.responseData ? String(request.responseData) : "",
            timestamp: request.timestamp,
            type: "CROSS_AP_RECOVERY_REQUEST"
        }));
    } catch (error) {
        return [];
    }
}

export async function processIncomingCrossAPRequests(crossAPRequests) {
    try {
        const responses = [];
        
        for (const request of crossAPRequests) {
            if (request.destinationApId !== apId) {
                continue;
            }
            
            try {
                const decryptedData = decryptWithAPPrivateKey(String(request.encryptedData));
                const requestData = JSON.parse(decryptedData);
                
                const { ap2Signature, ...dataToVerify } = requestData;
                
                const fullUsername = `${requestData.realUserId}@${apId}`;
                
                let user = await AppDataSource.manager.findOneBy(User, { 
                    username: fullUsername 
                });
                
                if (!user) {
                    user = await AppDataSource.manager.findOneBy(User, {
                        username: requestData.realUserId
                    });
                }
                
                if (!user || !user.recoveryKeyHash) {
                    continue;
                }
                
                if (user.recoveryKeyHash !== requestData.recoveryHash) {
                    continue;
                }
                
                const token = createToken(user.username, Buffer.from(String(user.username)));
                
                const responseData = {
                    token,
                    username: user.username,
                    timestamp: Date.now(),
                    sourceApId: apId,
                    tempUserId: requestData.tempUserId,
                    type: "CROSS_AP_RECOVERY_RESPONSE"
                };
                
                const encryptedResponse = encryptWithEphemeralKey(
                    JSON.stringify(responseData),
                    requestData.ephemeralPublicKey
                );
                
                const crossAPResponse = {
                    tempUserId: requestData.tempUserId,
                    encryptedTokenData: encryptedResponse,
                    requestingApId: requestData.requestingApId,
                    sourceApId: apId,
                    signature: sign(JSON.stringify({
                        tempUserId: requestData.tempUserId,
                        timestamp: Date.now()
                    })),
                    createdAt: new Date()
                };
                
                await AppDataSource.manager.save(CrossAPRecoveryResponse, crossAPResponse);
                responses.push(crossAPResponse);
                
            } catch (requestError) {
                continue;
            }
        }
        
        return responses;
    } catch (error) {
        throw error;
    }
}

export async function processIncomingCrossAPResponses(crossAPResponses) {
    try {
        const processedResponses = [];
        
        for (const response of crossAPResponses) {
            if (response.requestingApId !== apId) {
                continue;
            }
            
            const existingResponse = await AppDataSource.manager.findOneBy(CrossAPRecoveryResponse, {
                tempUserId: response.tempUserId
            });
            
            if (existingResponse) {
                continue;
            }
            
            const request = await AppDataSource.manager.findOneBy(CrossAPRecoveryRequest, {
                tempUserId: response.tempUserId
            });
            
            if (!request) {
                continue;
            }
            
            await AppDataSource.manager.save(CrossAPRecoveryResponse, response);
            
            await AppDataSource.manager.update(
                CrossAPRecoveryRequest,
                { tempUserId: response.tempUserId },
                { status: "COMPLETED" }
            );
            
            processedResponses.push(response);
        }
        
        return processedResponses;
    } catch (error) {
        throw error;
    }
}

export async function getCrossAPResponses() {
    try {
        return await AppDataSource.manager.find(CrossAPRecoveryResponse, {
            where: { sourceApId: apId }
        });
    } catch (error) {
        return [];
    }
}

export async function cleanupExpiredRequests() {
    try {
        const now = new Date();
        
        await AppDataSource.manager.update(
            CrossAPRecoveryRequest,
            { 
                expiresAt: LessThan(now),
                status: "PENDING"
            },
            { status: "EXPIRED" }
        );
        
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        
        await AppDataSource.manager.delete(CrossAPRecoveryRequest, {
            status: "EXPIRED",
            expiresAt: LessThan(sevenDaysAgo)
        });
        
        await AppDataSource.manager.delete(CrossAPRecoveryResponse, {
            createdAt: LessThan(sevenDaysAgo)
        });
        
    } catch (error) {
    }
}

function decryptWithAPPrivateKey(encryptedData) {
    try {
        const privateKey = getPrivateKey();
        if (!privateKey) {
            throw new Error("Private key not available");
        }
        
        const decrypted = crypto.privateDecrypt(
            {
                key: privateKey,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: 'sha256'
            },
            Buffer.from(String(encryptedData), 'base64')
        );
        
        return decrypted.toString();
    } catch (error) {
        throw error;
    }
}

function encryptWithAPPublicKey(data, apPublicKeyPem) {
    try {
        const publicKey = crypto.createPublicKey({
            key: String(apPublicKeyPem),
            format: 'pem',
            type: 'spki'
        });
        
        const encrypted = crypto.publicEncrypt(
            {
                key: publicKey,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: 'sha256'
            },
            Buffer.from(String(data))
        );
        
        return encrypted.toString('base64');
    } catch (error) {
        throw error;
    }
}

function encryptWithEphemeralKey(data, ephemeralPublicKeyPem) {
    try {
        const publicKey = crypto.createPublicKey({
            key: String(ephemeralPublicKeyPem),
            format: 'pem',
            type: 'spki'
        });
        
        const encrypted = crypto.publicEncrypt(
            {
                key: publicKey,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: 'sha256'
            },
            Buffer.from(String(data))
        );
        
        return encrypted.toString('base64');
    } catch (error) {
        throw error;
    }
}

function extractPublicKeyFromCert(cert) {
    try {
        const parts = String(cert).split('.');
        const decoded = JSON.parse(Buffer.from(parts[0], 'base64').toString());
        return decoded.apPub;
    } catch (error) {
        throw error;
    }
}

async function getAPCertificate(apIdParam) {
    // Placeholder implementation - needs AP discovery mechanism
    // Return null for now, which will trigger error handling
    return null;
}

export default {
    processClientCrossAPRequest,
    getPendingCrossAPRequests,
    processIncomingCrossAPRequests,
    processIncomingCrossAPResponses,
    getCrossAPResponses,
    cleanupExpiredRequests
};