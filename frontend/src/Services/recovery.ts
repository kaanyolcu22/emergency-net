// src/Services/recovery.ts - Unified recovery service
import { getApiURL } from "@/Library/getApiURL";
import axios, { AxiosError } from "axios";  
import { setCookie } from "typescript-cookie";
import { emergencySync } from "./sync";
import { 
  createClientSideRecoveryRequest,
  generateTempUserId,
  storeEphemeralKeys,
  retrieveEphemeralKeys,
  processRecoveryResponse,
  clearEphemeralKeys
} from "@/Library/recoveryUtil";

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
 * Unified recovery function - handles both local and cross-AP automatically
 */
export async function recoverIdentity(recoveryData: RecoveryData): Promise<RecoveryResponse> {
  try {
    console.log(`Starting unified recovery for: ${recoveryData.username}@${recoveryData.apIdentifier}`);
    
    // First attempt local recovery
    const localResult = await attemptLocalRecovery(recoveryData);
    if (localResult) {
      return {
        type: 'local_success',
        token: localResult.token
      };
    }
    
    // If local fails, initiate cross-AP recovery with temporary identity
    return await initiateCrossAPRecoveryWithTempIdentity(recoveryData);
    
  } catch (error: unknown) {
    console.error("Recovery error:", error);
    
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
 * Attempt local recovery at current AP
 */
async function attemptLocalRecovery(recoveryData: RecoveryData): Promise<{ token: string } | null> {
  try {
    const content = {
      username: recoveryData.username,
      apIdentifier: recoveryData.apIdentifier,
      recoveryWords: recoveryData.recoveryWords,
      tod: Date.now(),
      type: "MT_RECOVERY",
      priority: 1
    };
    
    const response = await axios.post(
      getApiURL() + "/recover-identity",
      content
    );
    
    console.log("Local recovery successful");
    
    const token = response.data.token || response.data.content?.token;
    
    if (token) {
      return { token };
    }
    
    return null;
    
  } catch (error) {
    console.log("Local recovery failed, initiating cross-AP recovery");
    return null;
  }
}

/**
 * Initiate cross-AP recovery and create temporary identity
 */
async function initiateCrossAPRecoveryWithTempIdentity(recoveryData: RecoveryData): Promise<RecoveryResponse> {
  try {
    // Generate temporary user ID and username
    const tempUserId = generateTempUserId(recoveryData.username, recoveryData.apIdentifier);
    const currentApId = await getCurrentApId();
    const tempUsername = `${recoveryData.username}@${recoveryData.apIdentifier}-temp@${currentApId}`;
    
    // Get current AP's certificate
    const apInfoResponse = await axios.get(getApiURL() + "/hello");
    let apCertificate = apInfoResponse.data.content?.cert || apInfoResponse.data.cert;
    
    if (!apCertificate) {
      throw new Error("Could not get AP certificate");
    }
    
    // Create encrypted recovery request
    const { encryptedData, ephemeralKeyPair } = await createClientSideRecoveryRequest(
      recoveryData.username,
      recoveryData.apIdentifier,
      recoveryData.recoveryWords,
      tempUserId,
      apCertificate
    );
    
    // Store ephemeral keys
    storeEphemeralKeys(tempUserId, ephemeralKeyPair);
    
    // Send cross-AP recovery request with temporary identity creation
    const requestContent = {
      tempUserId,
      tempUsername,
      originalUsername: `${recoveryData.username}@${recoveryData.apIdentifier}`,
      encryptedRecoveryData: encryptedData,
      destinationApId: recoveryData.apIdentifier,
      tod: Date.now(),
      type: "MT_CROSS_AP_RECOVERY_WITH_TEMP"
    };
    
    const response = await axios.post(
      getApiURL() + "/initiate-cross-ap-recovery-with-temp",
      requestContent
    );
    
    console.log("Cross-AP recovery with temp identity initiated");
    
    // Extract temporary token from response
    const tempToken = response.data.tempToken || response.data.content?.tempToken;
    
    return {
      type: 'cross_ap_initiated',
      tempToken,
      tempUserId,
      tempUsername,
      message: "Cross-AP recovery initiated with temporary identity"
    };
    
  } catch (error) {
    console.error("Cross-AP recovery initiation failed:", error);
    throw error;
  }
}

/**
 * Check recovery status
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
 * Complete cross-AP recovery
 */
export async function completeRecovery(tempUserId: string, recoveryWords: string) {
  try {
    // Get recovery response from server
    const response = await axios.post(
      getApiURL() + "/get-recovery-response",
      {
        tempUserId,
        tod: Date.now()
      }
    );
    
    if (!response.data.encryptedResponse) {
      throw new Error("No recovery response available");
    }
    
    // Retrieve stored ephemeral keys
    const ephemeralKeys = await retrieveEphemeralKeys(tempUserId);
    if (!ephemeralKeys) {
      throw new Error("Ephemeral keys not found. Recovery may have expired.");
    }
    
    // Decrypt the recovery response
    const decryptedResponse = await processRecoveryResponse(
      response.data.encryptedResponse,
      ephemeralKeys.privateKey
    );
    
    // Clean up
    clearEphemeralKeys(tempUserId);
    
    if (decryptedResponse.token) {
      return {
        token: decryptedResponse.token,
        timestamp: decryptedResponse.timestamp
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
 * Get current AP ID
 */
async function getCurrentApId(): Promise<string> {
  try {
    const response = await axios.get(getApiURL() + "/hello");
    return response.data.content?.id || response.data.id || "unknown";
  } catch (error) {
    console.error("Error getting current AP ID:", error);
    return "unknown";
  }
}

/**
 * Check if recovery data exists locally
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