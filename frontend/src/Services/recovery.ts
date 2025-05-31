import { getApiURL } from "@/Library/getApiURL";
import axios, { AxiosError } from "axios";  
import { keyToJwk, generateKeys } from "@/Library/crypt";
import { hello } from "@/Services/hello";

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

async function hashRecoveryWords(recoveryWords: string): Promise<string> {
  const normalizedWords = Array.isArray(recoveryWords) 
    ? recoveryWords.join(" ").trim().replace(/\s+/g, ' ')
    : recoveryWords.trim().replace(/\s+/g, ' ');
  
  const encoder = new TextEncoder();
  const data = encoder.encode(normalizedWords);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function getCurrentApCertificate(): Promise<string> {
  // Try to get certificate from localStorage (hello response)
  try {
    const helloResponse = localStorage.getItem('last_hello_response');
    if (helloResponse) {
      const parsed = JSON.parse(helloResponse);
      if (parsed.cert) {
        return parsed.cert;
      }
      // Also check nested content structure
      if (parsed.content && parsed.content.cert) {
        return parsed.content.cert;
      }
    }
  } catch (e) {
    // Silent fail
  }
  
  // Try to get certificate from current AP data
  try {
    const apDataString = localStorage.getItem('current_ap_data');
    if (apDataString) {
      const apData = JSON.parse(apDataString);
      if (apData.cert) {
        return apData.cert;
      }
    }
  } catch (e) {
    // Silent fail
  }
  
  // Try to get fresh certificate from hello endpoint
  try {
    console.log("Fetching fresh AP certificate via hello endpoint");
    const response = await hello();
    
    if (response.data && response.data.content && response.data.content.cert) {
      // Store for future use
      localStorage.setItem('last_hello_response', JSON.stringify(response.data));
      return response.data.content.cert;
    }
    
    if (response.data && response.data.cert) {
      localStorage.setItem('last_hello_response', JSON.stringify(response.data));
      return response.data.cert;
    }
  } catch (e) {
    console.warn("Failed to fetch fresh certificate:", e);
  }

  // Try to get from session/temporary storage
  try {
    const tempCert = sessionStorage.getItem('current_ap_cert');
    if (tempCert) {
      return tempCert;
    }
  } catch (e) {
    // Silent fail
  }
  
  throw new Error("Current AP certificate not available - please ensure you're connected to a valid access point and try syncing");
}

async function submitCrossAPRequest(
  username: string,
  sourceApId: string, 
  recoveryWords: string,
  tempUserId: string
) {
  try {
    const { 
      createCrossAPRecoveryRequest, 
      storeEphemeralKeys 
    } = await import("@/Library/recoveryUtil");
    
    const currentApCert = await getCurrentApCertificate();
    
    const { encryptedData, ephemeralKeyPair } = await createCrossAPRecoveryRequest(
      username,
      sourceApId,
      recoveryWords,
      tempUserId,
      currentApCert
    );
    
    storeEphemeralKeys(tempUserId, ephemeralKeyPair);
    
    const response = await axios.post(
      getApiURL() + "/submit-cross-ap-request",
      {
        encryptedData,
        tempUserId,
        tod: Date.now()
      }
    );
    
    return response.data;
    
  } catch (error) {
    throw error;
  }
}

export async function recoverIdentity(recoveryData: RecoveryData): Promise<RecoveryResponse> {
  try {
    const { sign } = await generateKeys();
    const privateKeyJwk = await keyToJwk(sign.privateKey);
    const publicKeyJwk = await keyToJwk(sign.publicKey);
    
    localStorage.setItem("privateKey", JSON.stringify(privateKeyJwk));
    localStorage.setItem("publicKey", JSON.stringify(publicKeyJwk));
    
    const wordVariations = [
      recoveryData.recoveryWords.trim().replace(/\s+/g, ' '),
      recoveryData.recoveryWords,
    ];
    
    for (const words of wordVariations) {
      const hash = await hashRecoveryWords(words);
      
      try {
        const testContent = {
          username: recoveryData.username,
          apIdentifier: recoveryData.apIdentifier,
          recoveryHash: hash,
          newPublicKey: publicKeyJwk,
          tod: Date.now(),
          type: "MT_RECOVERY",
          priority: 1
        };
        
        const response = await axios.post(
          getApiURL() + "/recover-identity",
          testContent
        );
        
        const responseContent = response.data.content || response.data;
        
        if (responseContent.type === "MT_RECOVERY_ACK") {
          return {
            type: 'local_success',
            token: responseContent.token
          };
        } else if (responseContent.type === "MT_RECOVERY_CROSS_AP_INITIATED") {
          localStorage.setItem("pending_cross_ap_recovery", JSON.stringify({
            tempUserId: responseContent.tempUserId,
            tempUsername: responseContent.tempUsername,
            originalUsername: responseContent.originalUsername
          }));
          
          try {
            await submitCrossAPRequest(
              recoveryData.username,
              recoveryData.apIdentifier,
              words,
              responseContent.tempUserId
            );
          } catch (crossApError) {
            // Continue with temporary identity even if cross-AP fails
          }
          
          return {
            type: 'cross_ap_initiated',
            tempToken: responseContent.tempToken,
            tempUserId: responseContent.tempUserId,
            tempUsername: responseContent.tempUsername
          };
        }
        
      } catch (hashTestError) {
        continue;
      }
    }
    
    throw new Error("No valid recovery hash found. Please check your recovery words.");
    
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.data && typeof axiosError.response.data === 'object' && 'error' in axiosError.response.data) {
        const errorData = axiosError.response.data as { error: string };
        throw new Error(errorData.error);
      }
    }
    
    throw error instanceof Error ? error : new Error("Unknown recovery error occurred");
  }
}

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
    throw error;
  }
}

export async function completeRecovery(tempUserId: string) {
  try {
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
    
    const { retrieveEphemeralKeys, decryptRecoveryResponse, clearEphemeralKeys } = await import("@/Library/recoveryUtil");
    
    const ephemeralKeys = await retrieveEphemeralKeys(tempUserId);
    if (!ephemeralKeys) {
      throw new Error("Ephemeral keys not found - cannot decrypt response");
    }
    
    const decryptedResponse = await decryptRecoveryResponse(
      response.data.encryptedTokenData,
      ephemeralKeys.privateKey
    );
    
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
    throw error;
  }
}

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
    return false;
  }
}