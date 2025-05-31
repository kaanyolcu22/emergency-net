// Enhanced Recovery Service - Production Ready
import { getApiURL } from "@/Library/getApiURL";
import axios, { AxiosError } from "axios";
import { keyToJwk, generateKeys } from "@/Library/crypt";

interface RecoveryData {
  username: string;
  apIdentifier: string;
  recoveryWords: string;
}

interface RecoveryResponse {
  type: 'local_success' | 'cross_ap_initiated' | 'locked' | 'failed';
  token?: string;
  tempToken?: string;
  tempUserId?: string;
  tempUsername?: string;
  message?: string;
  attemptsRemaining?: number;
  lockedUntil?: string;
  error?: string;
}

interface AttemptTracker {
  count: number;
  lastAttempt: number;
  lockedUntil?: number;
  ipAddress?: string;
}

const RECOVERY_LIMITS = {
  MAX_ATTEMPTS: 5,
  LOCKOUT_DURATION: 24 * 60 * 60 * 1000,
  ATTEMPT_WINDOW: 60 * 60 * 1000,
  NETWORK_TIMEOUT: 15000
};

class RecoveryAttemptManager {
  private static instance: RecoveryAttemptManager;
  private attempts: Map<string, AttemptTracker> = new Map();

  static getInstance(): RecoveryAttemptManager {
    if (!RecoveryAttemptManager.instance) {
      RecoveryAttemptManager.instance = new RecoveryAttemptManager();
    }
    return RecoveryAttemptManager.instance;
  }

  private getAttemptKey(username: string, apIdentifier: string): string {
    return `${username}@${apIdentifier}`;
  }

  isLocked(username: string, apIdentifier: string): boolean {
    const key = this.getAttemptKey(username, apIdentifier);
    const tracker = this.attempts.get(key);
    
    if (!tracker) return false;
    
    if (tracker.lockedUntil && Date.now() < tracker.lockedUntil) {
      return true;
    }
    
    if (tracker.lockedUntil && Date.now() >= tracker.lockedUntil) {
      this.clearAttempts(username, apIdentifier);
      return false;
    }
    
    return tracker.count >= RECOVERY_LIMITS.MAX_ATTEMPTS;
  }

  recordAttempt(username: string, apIdentifier: string, success: boolean): AttemptTracker {
    const key = this.getAttemptKey(username, apIdentifier);
    const now = Date.now();
    let tracker = this.attempts.get(key) || { count: 0, lastAttempt: 0 };

    if (success) {
      this.attempts.delete(key);
      return { count: 0, lastAttempt: now };
    }

    if (now - tracker.lastAttempt > RECOVERY_LIMITS.ATTEMPT_WINDOW) {
      tracker.count = 0;
    }

    tracker.count++;
    tracker.lastAttempt = now;

    if (tracker.count >= RECOVERY_LIMITS.MAX_ATTEMPTS) {
      tracker.lockedUntil = now + RECOVERY_LIMITS.LOCKOUT_DURATION;
    }

    this.attempts.set(key, tracker);
    return tracker;
  }

  getAttemptsRemaining(username: string, apIdentifier: string): number {
    const key = this.getAttemptKey(username, apIdentifier);
    const tracker = this.attempts.get(key);
    return Math.max(0, RECOVERY_LIMITS.MAX_ATTEMPTS - (tracker?.count || 0));
  }

  getLockStatus(username: string, apIdentifier: string): { isLocked: boolean; lockedUntil?: Date } {
    const key = this.getAttemptKey(username, apIdentifier);
    const tracker = this.attempts.get(key);
    
    if (!tracker?.lockedUntil) return { isLocked: false };
    
    const lockedUntil = new Date(tracker.lockedUntil);
    return {
      isLocked: Date.now() < tracker.lockedUntil,
      lockedUntil
    };
  }

  clearAttempts(username: string, apIdentifier: string): void {
    const key = this.getAttemptKey(username, apIdentifier);
    this.attempts.delete(key);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, tracker] of this.attempts.entries()) {
      if (tracker.lockedUntil && now >= tracker.lockedUntil) {
        this.attempts.delete(key);
      } else if (now - tracker.lastAttempt > RECOVERY_LIMITS.ATTEMPT_WINDOW * 2) {
        this.attempts.delete(key);
      }
    }
  }
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

function generateRecoveryWordVariations(words: string): string[] {
  const baseWords = words.trim();
  const variations = [
    baseWords,
    baseWords.replace(/\s+/g, ' '),
    baseWords.toLowerCase(),
    baseWords.toLowerCase().replace(/\s+/g, ' ')
  ];
  
  return [...new Set(variations)];
}

async function getCurrentApCertificate(): Promise<string> {
  try {
    const helloResponse = localStorage.getItem('last_hello_response');
    if (helloResponse) {
      const parsed = JSON.parse(helloResponse);
      if (parsed.cert || parsed.content?.cert) {
        return parsed.cert || parsed.content.cert;
      }
    }
  } catch (e) {}
  
  try {
    const apDataString = localStorage.getItem('current_ap_data');
    if (apDataString) {
      const apData = JSON.parse(apDataString);
      if (apData.cert) return apData.cert;
    }
  } catch (e) {}
  
  try {
    const { hello } = await import("@/Services/hello");
    const response = await hello();
    
    if (response.data?.content?.cert) {
      localStorage.setItem('last_hello_response', JSON.stringify(response.data));
      return response.data.content.cert;
    }
    
    if (response.data?.cert) {
      localStorage.setItem('last_hello_response', JSON.stringify(response.data));
      return response.data.cert;
    }
  } catch (e) {}
  
  throw new Error("AP certificate unavailable");
}

async function submitCrossAPRequest(
  username: string,
  sourceApId: string,
  recoveryWords: string,
  tempUserId: string
): Promise<any> {
  const { createCrossAPRecoveryRequest, storeEphemeralKeys } = 
    await import("@/Library/recoveryUtil");
  
  const currentApCert = await getCurrentApCertificate();
  const { encryptedData, ephemeralKeyPair } = await createCrossAPRecoveryRequest(
    username, sourceApId, recoveryWords, tempUserId, currentApCert
  );
  
  storeEphemeralKeys(tempUserId, ephemeralKeyPair);
  
  return await axios.post(getApiURL() + "/submit-cross-ap-request", {
    encryptedData,
    tempUserId,
    tod: Date.now()
  });
}

export async function recoverIdentity(recoveryData: RecoveryData): Promise<RecoveryResponse> {
  const attemptManager = RecoveryAttemptManager.getInstance();
  
  if (attemptManager.isLocked(recoveryData.username, recoveryData.apIdentifier)) {
    const lockStatus = attemptManager.getLockStatus(recoveryData.username, recoveryData.apIdentifier);
    throw new Error(`Account locked until ${lockStatus.lockedUntil?.toLocaleString()}`);
  }

  try {
    const { sign } = await generateKeys();
    const privateKeyJwk = await keyToJwk(sign.privateKey);
    const publicKeyJwk = await keyToJwk(sign.publicKey);
    
    localStorage.setItem("privateKey", JSON.stringify(privateKeyJwk));
    localStorage.setItem("publicKey", JSON.stringify(publicKeyJwk));
    
    const wordVariations = generateRecoveryWordVariations(recoveryData.recoveryWords);
    
    for (const words of wordVariations) {
      const hash = await hashRecoveryWords(words);
      
      try {
        const recoveryRequest = {
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
          recoveryRequest,
          { timeout: RECOVERY_LIMITS.NETWORK_TIMEOUT }
        );
        
        const responseContent = response.data.content || response.data;
        
        if (responseContent.type === "MT_RECOVERY_ACK") {
          attemptManager.recordAttempt(recoveryData.username, recoveryData.apIdentifier, true);
          return {
            type: 'local_success',
            token: responseContent.token,
            message: "Identity recovered successfully"
          };
        } 
        
        if (responseContent.type === "MT_RECOVERY_CROSS_AP_INITIATED") {
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
          } catch (crossApError) {}
          
          return {
            type: 'cross_ap_initiated',
            tempToken: responseContent.tempToken,
            tempUserId: responseContent.tempUserId,
            tempUsername: responseContent.tempUsername,
            attemptsRemaining: attemptManager.getAttemptsRemaining(recoveryData.username, recoveryData.apIdentifier)
          };
        }
        
        if (responseContent.type === "MT_RECOVERY_LOCKED") {
          return {
            type: 'locked',
            error: responseContent.error,
            lockedUntil: responseContent.lockedUntil,
            attemptsRemaining: 0
          };
        }
        
      } catch (hashTestError) {
        continue;
      }
    }
    
    const tracker = attemptManager.recordAttempt(recoveryData.username, recoveryData.apIdentifier, false);
    
    if (tracker.lockedUntil) {
      return {
        type: 'locked',
        error: `Too many failed attempts. Account locked until ${new Date(tracker.lockedUntil).toLocaleString()}`,
        lockedUntil: new Date(tracker.lockedUntil).toISOString(),
        attemptsRemaining: 0
      };
    }
    
    return {
      type: 'failed',
      error: "Invalid recovery credentials",
      attemptsRemaining: attemptManager.getAttemptsRemaining(recoveryData.username, recoveryData.apIdentifier)
    };
    
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.data && typeof axiosError.response.data === 'object' && 'error' in axiosError.response.data) {
        const errorData = axiosError.response.data as { error: string };
        throw new Error(errorData.error);
      }
    }
    
    throw error instanceof Error ? error : new Error("Recovery failed");
  }
}

export async function checkRecoveryStatus(tempUserId: string) {
  const response = await axios.post(getApiURL() + "/check-cross-ap-recovery-status", {
    tempUserId,
    tod: Date.now()
  });
  
  return {
    status: response.data.status,
    message: response.data.message,
    hasResponse: response.data.hasResponse || false
  };
}

export async function completeRecovery(tempUserId: string) {
  const response = await axios.post(getApiURL() + "/get-cross-ap-recovery-response", {
    tempUserId,
    tod: Date.now()
  });
  
  if (!response.data.encryptedTokenData) {
    throw new Error("No recovery response available");
  }
  
  const { retrieveEphemeralKeys, decryptRecoveryResponse, clearEphemeralKeys } = 
    await import("@/Library/recoveryUtil");
  
  const ephemeralKeys = await retrieveEphemeralKeys(tempUserId);
  if (!ephemeralKeys) {
    throw new Error("Ephemeral keys not found");
  }
  
  const decryptedResponse = await decryptRecoveryResponse(
    response.data.encryptedTokenData,
    ephemeralKeys.privateKey
  );
  
  clearEphemeralKeys(tempUserId);
  
  if (decryptedResponse.token) {
    return { token: decryptedResponse.token, timestamp: Date.now() };
  } else {
    throw new Error("Invalid recovery response");
  }
}

export function getRecoveryAttemptInfo(username: string, apIdentifier: string): {
  attemptsRemaining: number;
  isLocked: boolean;
  lockedUntil?: Date;
} {
  const attemptManager = RecoveryAttemptManager.getInstance();
  const lockStatus = attemptManager.getLockStatus(username, apIdentifier);
  
  return {
    attemptsRemaining: attemptManager.getAttemptsRemaining(username, apIdentifier),
    isLocked: lockStatus.isLocked,
    lockedUntil: lockStatus.lockedUntil
  };
}

export function clearRecoveryAttempts(username: string, apIdentifier: string): void {
  const attemptManager = RecoveryAttemptManager.getInstance();
  attemptManager.clearAttempts(username, apIdentifier);
}

setInterval(() => {
  RecoveryAttemptManager.getInstance().cleanup();
}, 60000);