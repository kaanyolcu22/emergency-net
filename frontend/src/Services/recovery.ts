// src/Services/recovery.ts - Fixed to handle local vs cross-AP recovery correctly

import { getApiURL } from "@/Library/getApiURL";
import axios, { AxiosError } from "axios";  
import { keyToJwk, generateKeys } from "@/Library/crypt";

interface RecoveryData {
  username: string;
  apIdentifier: string;
  recoveryWords: string;
}

interface RecoveryResponse {
  type: 'local_success' | 'cross_ap_initiated';
  token?: string;
  tempToken?: string;
  tempUserId?: string;
  tempUsername?: string;
  message?: string;
}

/**
 * Hash recovery words client-side - simple hash without salt
 */
async function hashRecoveryWords(recoveryWords: string): Promise<string> {
  const wordString = Array.isArray(recoveryWords) ? recoveryWords.join(" ") : recoveryWords;
  const encoder = new TextEncoder();
  const data = encoder.encode(wordString);
  
  // Simple SHA-256 hash without salt
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Unified recovery function - handles both local and cross-AP
 */
export async function recoverIdentity(recoveryData: RecoveryData): Promise<RecoveryResponse> {
  try {
    console.log(`🔄 Starting recovery for: ${recoveryData.username}@${recoveryData.apIdentifier}`);
    
    // Step 1: Generate fresh keys for the recovery
    const { sign } = await generateKeys();
    const privateKeyJwk = await keyToJwk(sign.privateKey);
    const publicKeyJwk = await keyToJwk(sign.publicKey);
    
    // Store keys immediately (for both local and cross-AP)
    localStorage.setItem("privateKey", JSON.stringify(privateKeyJwk));
    localStorage.setItem("publicKey", JSON.stringify(publicKeyJwk));
    
    // Step 2: Hash recovery words (NEVER send plaintext)
    const recoveryHash = await hashRecoveryWords(recoveryData.recoveryWords);
    
    // Step 3: Send recovery request with hash and public key
    const content = {
      username: recoveryData.username,
      apIdentifier: recoveryData.apIdentifier,
      recoveryHash: recoveryHash, // Only hash, never plaintext!
      newPublicKey: publicKeyJwk,
      tod: Date.now(),
      type: "MT_RECOVERY",
      priority: 1
    };
    
    console.log("📤 Sending recovery request...");
    
    const response = await axios.post(
      getApiURL() + "/recover-identity",
      content
    );
    
    console.log("✅ Recovery response received:", response.status);
    
    // Step 4: Handle response based on recovery type
    console.log("Server response data:", response.data);
    
    // Handle signed response format (content + signature)
    const responseContent = response.data.content || response.data;
    console.log("Response content:", responseContent);
    console.log("Response type:", responseContent.type);
    
    if (responseContent.type === "MT_RECOVERY_ACK") {
      // LOCAL RECOVERY SUCCESS - immediate access with original identity
      console.log("✅ Local recovery successful");
      return {
        type: 'local_success',
        token: responseContent.token
      };
    } else if (responseContent.type === "MT_RECOVERY_CROSS_AP_INITIATED") {
      // CROSS-AP RECOVERY - immediate access with temporary identity
      console.log("🔄 Cross-AP recovery initiated with temporary identity");
      
      // Store cross-AP recovery info for later completion
      localStorage.setItem("pending_cross_ap_recovery", JSON.stringify({
        tempUserId: responseContent.tempUserId,
        tempUsername: responseContent.tempUsername,
        originalUsername: responseContent.originalUsername
      }));
      
      // Now need to send the encrypted cross-AP request
      await submitCrossAPRequest(
        recoveryData.username,
        recoveryData.apIdentifier,
        recoveryData.recoveryWords,
        responseContent.tempUserId
      );
      
      return {
        type: 'cross_ap_initiated',
        tempToken: responseContent.tempToken,
        tempUserId: responseContent.tempUserId,
        tempUsername: responseContent.tempUsername
      };
    } else {
      console.log("❌ Unexpected response type:", responseContent.type);
      console.log("Full response content:", responseContent);
      throw new Error(responseContent.error || `Unexpected response type: ${responseContent.type}`);
    }
    
  } catch (error: unknown) {
    console.error("❌ Recovery error:", error);
    
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.data && typeof axiosError.response.data === 'object' && 'error' in axiosError.response.data) {
        const errorData = axiosError.response.data as { error: string };
        throw new Error(errorData.error);
      }
    }
    
    if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown recovery error occurred");
    }
  }
}

/**
 * Submit encrypted cross-AP recovery request
 */
async function submitCrossAPRequest(
  username: string,
  sourceApId: string, 
  recoveryWords: string,
  tempUserId: string
) {
  try {
    console.log("🔐 Submitting encrypted cross-AP recovery request...");
    
    // Import the recovery utility functions
    const { 
      createCrossAPRecoveryRequest, 
      storeEphemeralKeys 
    } = await import("@/Library/recoveryUtil");
    
    // Get current AP certificate (this might need to be obtained differently)
    const currentApCert = getCurrentApCertificate();
    
    // Create encrypted cross-AP request
    const { encryptedData, ephemeralKeyPair } = await createCrossAPRecoveryRequest(
      username,
      sourceApId,
      recoveryWords,
      tempUserId,
      currentApCert
    );
    
    // Store ephemeral keys for later decryption
    storeEphemeralKeys(tempUserId, ephemeralKeyPair);
    
    // Submit the encrypted request
    const response = await axios.post(
      getApiURL() + "/submit-cross-ap-request",
      {
        encryptedData,
        tempUserId,
        tod: Date.now()
      }
    );
    
    console.log("✅ Cross-AP request submitted successfully");
    return response.data;
    
  } catch (error) {
    console.error("❌ Error submitting cross-AP request:", error);
    throw error;
  }
}

/**
 * Get current AP certificate (placeholder - implement based on your AP discovery)
 */
function getCurrentApCertificate(): string {
  // TODO: Implement proper AP certificate retrieval
  // This could come from:
  // - HelloWrapper AP data
  // - Local storage
  // - Configuration
  
  // For now, try to get it from APDataReference
  try {
    const { APDataReference } = require("@/Library/APData");
    if (APDataReference.current && APDataReference.current.cert) {
      return APDataReference.current.cert;
    }
  } catch (e) {
    console.warn("Could not get AP certificate from APDataReference");
  }
  
  // Fallback - this needs to be implemented properly
  throw new Error("Current AP certificate not available - implement AP certificate discovery");
}

/**
 * Check cross-AP recovery status
 */
export async function checkRecoveryStatus(tempUserId: string) {
  try {
    const response = await axios.post(
      getApiURL() + "/check-cross-ap-recovery-status",
      {
        tempUserId,
        tod: Date.now()
      }
    );
    
    return {
      status: response.data.status,
      message: response.data.message,
      hasResponse: response.data.hasResponse || false
    };
  } catch (error: unknown) {
    console.error("Error checking cross-AP recovery status:", error);
    throw error;
  }
}

/**
 * Complete cross-AP recovery by getting the response
 */
export async function completeRecovery(tempUserId: string, recoveryWords: string) {
  try {
    // Get the encrypted response
    const response = await axios.post(
      getApiURL() + "/get-cross-ap-recovery-response",
      {
        tempUserId,
        tod: Date.now()
      }
    );
    
    if (!response.data.encryptedTokenData) {
      throw new Error("No recovery response available");
    }
    
    // Retrieve ephemeral keys for decryption
    const { retrieveEphemeralKeys, decryptRecoveryResponse, clearEphemeralKeys } = await import("@/Library/recoveryUtil");
    
    const ephemeralKeys = await retrieveEphemeralKeys(tempUserId);
    if (!ephemeralKeys) {
      throw new Error("Ephemeral keys not found - cannot decrypt response");
    }
    
    // Decrypt the response
    const decryptedResponse = await decryptRecoveryResponse(
      response.data.encryptedTokenData,
      ephemeralKeys.privateKey
    );
    
    // Clean up ephemeral keys
    clearEphemeralKeys(tempUserId);
    
    if (decryptedResponse.token) {
      return {
        token: decryptedResponse.token,
        timestamp: Date.now()
      };
    } else {
      throw new Error("Invalid recovery response - no token");
    }
    
  } catch (error: unknown) {
    console.error("Error completing cross-AP recovery:", error);
    throw error;
  }
}

/**
 * Check if user has local recovery data
 */
export function checkLocalRecoveryData(username: string, apIdentifier: string): boolean {
  try {
    const storeString = localStorage.getItem("store");
    if (!storeString) return false;
    
    const store = JSON.parse(storeString);
    if (!store.recoveryData || !Array.isArray(store.recoveryData)) return false;
    
    const fullUsername = `${username}@${apIdentifier}`;
    
    return store.recoveryData.some((data: any) => 
      data.username === fullUsername || 
      data.username === username
    );
  } catch (error: unknown) {
    console.error("Error checking local recovery data:", error);
    return false;
  }
}