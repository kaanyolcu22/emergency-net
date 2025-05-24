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

interface CrossAPRecoveryData extends RecoveryData {
  tempUserId?: string;
}

/**
 * Main recovery function - handles both local and cross-AP recovery
 */
export async function recoverIdentity(recoveryData: RecoveryData) {
  try {
    console.log(`Attempting recovery for user: ${recoveryData.username}@${recoveryData.apIdentifier}`);
    
    // First try local recovery
    const localResult = await attemptLocalRecovery(recoveryData);
    if (localResult) {
      return localResult;
    }
    
    // If local recovery fails, initiate cross-AP recovery
    return await initiateCrossAPRecovery(recoveryData);
    
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
 * Attempt local recovery first
 */
async function attemptLocalRecovery(recoveryData: RecoveryData) {
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
    
    // Extract token from response
    let token = response.data.token || response.data.content?.token;
    
    if (token) {
      await handleSuccessfulRecovery(token);
      return { token, local: true };
    }
    
    return null; // Local recovery failed, try cross-AP
    
  } catch (error) {
    console.log("Local recovery failed, trying cross-AP recovery");
    return null;
  }
}

/**
 * Initiate cross-AP recovery with client-side key generation
 */
async function initiateCrossAPRecovery(recoveryData: RecoveryData) {
  try {
    // Generate temporary user ID
    const tempUserId = generateTempUserId(recoveryData.username, recoveryData.apIdentifier);
    
    // Get current AP's public key (AP2)
    const apInfoResponse = await axios.get(getApiURL() + "/hello");
    const apPublicKey = apInfoResponse.data.content?.cert; // This needs to be extracted properly
    
    if (!apPublicKey) {
      throw new Error("Could not get AP public key");
    }
    
    // Create client-side recovery request with ephemeral keys
    const { encryptedData, ephemeralKeyPair } = await createClientSideRecoveryRequest(
      recoveryData.username,
      recoveryData.apIdentifier,
      recoveryData.recoveryWords,
      tempUserId,
      apPublicKey
    );
    
    // Store ephemeral keys for later decryption
    storeEphemeralKeys(tempUserId, ephemeralKeyPair);
    
    // Send encrypted recovery request to AP2
    const requestContent = {
      tempUserId,
      encryptedRecoveryData: encryptedData,
      destinationApId: recoveryData.apIdentifier,
      tod: Date.now(),
      type: "MT_CROSS_AP_RECOVERY_REQUEST"
    };
    
    const response = await axios.post(
      getApiURL() + "/initiate-cross-ap-recovery",
      requestContent
    );
    
    console.log("Cross-AP recovery initiated");
    
    // Store recovery request info for status checking
    localStorage.setItem("cross_ap_recovery_temp_user", tempUserId);
    localStorage.setItem("cross_ap_recovery_original_user", `${recoveryData.username}@${recoveryData.apIdentifier}`);
    
    return {
      status: "cross_ap_initiated",
      tempUserId,
      message: "Cross-AP recovery request sent. Please wait for response."
    };
    
  } catch (error) {
    console.error("Cross-AP recovery initiation failed:", error);
    throw error;
  }
}

/**
 * Check status of cross-AP recovery
 */
export async function checkCrossAPRecoveryStatus(tempUserId: string) {
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
 * Complete cross-AP recovery by decrypting response
 */
export async function completeCrossAPRecovery(tempUserId: string) {
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
    
    // Clean up ephemeral keys
    clearEphemeralKeys(tempUserId);
    localStorage.removeItem("cross_ap_recovery_temp_user");
    localStorage.removeItem("cross_ap_recovery_original_user");
    
    if (decryptedResponse.token) {
      await handleSuccessfulRecovery(decryptedResponse.token);
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
 * Handle successful recovery (common for both local and cross-AP)
 */
async function handleSuccessfulRecovery(token: string) {
  console.log("Setting up recovered identity");
  
  setCookie("token", token, {
    sameSite: "Lax",
    secure: location.protocol === 'https:',
    expires: 365,
    path: '/'
  });
  
  axios.defaults.headers.common['Authorization'] = token;
  localStorage.setItem("emergency_token", token);
  
  try {
    console.log("Performing emergency sync after recovery");
    await emergencySync();
    console.log("Emergency sync completed successfully");
  } catch (syncError) {
    console.error("Emergency sync failed:", syncError);
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

/**
 * Get pending cross-AP recovery info
 */
export function getPendingCrossAPRecovery(): {
  tempUserId: string;
  originalUser: string;
} | null {
  const tempUserId = localStorage.getItem("cross_ap_recovery_temp_user");
  const originalUser = localStorage.getItem("cross_ap_recovery_original_user");
  
  if (tempUserId && originalUser) {
    return { tempUserId, originalUser };
  }
  
  return null;
}

/**
 * Cancel pending cross-AP recovery
 */
export function cancelCrossAPRecovery(): void {
  const tempUserId = localStorage.getItem("cross_ap_recovery_temp_user");
  
  if (tempUserId) {
    clearEphemeralKeys(tempUserId);
    localStorage.removeItem("cross_ap_recovery_temp_user");
    localStorage.removeItem("cross_ap_recovery_original_user");
  }
}

// Legacy functions for backward compatibility
export async function checkRecoveryStatus(recoveryRequestId: string) {
  // Map to new cross-AP recovery status check
  return await checkCrossAPRecoveryStatus(recoveryRequestId);
}

export async function completeRecovery(recoveryRequestId: string, recoveryWords: string) {
  // For the new system, recovery words are not needed for completion
  // since they were used to generate the ephemeral keys initially
  return await completeCrossAPRecovery(recoveryRequestId);
}