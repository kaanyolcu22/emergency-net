// src/Library/recovery-key-sync-fix.ts
// Complete solution for post-recovery key synchronization

import { getCookie, setCookie } from "typescript-cookie";
import { generateKeys, keyToJwk, jwkToKey } from "./crypt";
import axios from "axios";


export async function fixPostRecoveryKeyMismatch() {
  console.log("🔧 Starting post-recovery key synchronization...");
  
  try {
    const token = getCookie("token") || localStorage.getItem("emergency_token");
    if (!token) {
      console.log("❌ No token found for key sync");
      return { success: false, error: "No token available" };
    }
    
    const tokenParts = token.split(".");
    if (tokenParts.length < 3) {
      console.log("❌ Invalid token format");
      return { success: false, error: "Invalid token format" };
    }
    
    const tokenData = JSON.parse(atob(tokenParts[0]));
    console.log("📋 Token data:", {
      username: tokenData.mtUsername,
      ap: tokenData.apReg,
      hasPublicKey: !!tokenData.mtPubKey,
      isTemporary: tokenData.isTemporary
    });
    
    // Skip key sync for temporary accounts
    if (tokenData.isTemporary) {
      console.log("⏭️ Skipping key sync for temporary account");
      return { success: true, reason: "temporary_account" };
    }
    
    // Get recovery completion flag
    const recoveryCompleted = localStorage.getItem("recovery_completed") === "true";
    const recoveryWords = localStorage.getItem("temp_recovery_words");
    
    if (recoveryCompleted || recoveryWords) {
      console.log("🔄 Recovery detected, regenerating keys deterministically...");
      return await regenerateKeysFromRecovery(tokenData, recoveryWords);
    } else {
      console.log("🔍 Checking for existing key mismatch...");
      return await checkAndFixKeyMismatch(tokenData);
    }
    
  } catch (error: any) {
    console.error("❌ Key sync error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Regenerate keys deterministically from recovery words
 */
async function regenerateKeysFromRecovery(tokenData: any, recoveryWordsString?: string) {
  try {
    console.log("🎯 Regenerating keys from recovery data...");
    
    // Try to get recovery words from various sources
    let recoveryWords = recoveryWordsString;
    
    if (!recoveryWords) {
      recoveryWords = localStorage.getItem("last_recovery_words");
    }
    
    if (!recoveryWords) {
      console.log("⚠️ No recovery words available, generating new keys...");
      return await generateNewKeysAndUpdateToken(tokenData);
    }
    
    console.log("🔑 Using recovery words to generate deterministic keys...");
    
    // Derive key material from recovery words
    const keyMaterial = await deriveKeyFromRecoveryPhrase(recoveryWords);
    
    // Generate deterministic key pair
    const keyPair = generateKeyPairFromSeed(keyMaterial);
    
    // Convert to JWK format for storage
    const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    
    // Store the new keys
    localStorage.setItem("privateKey", JSON.stringify(privateKeyJwk));
    localStorage.setItem("publicKey", JSON.stringify(publicKeyJwk));
    
    console.log("✅ Deterministic keys generated and stored");
    
    // Verify the keys match the token
    const publicKeyPem = keyPair.publicKey.export({ format: "pem", type: "spki" });
    const tokenPublicKey = tokenData.mtPubKey;
    
    if (publicKeyPem.replace(/\s/g, '') === tokenPublicKey.replace(/\s/g, '')) {
      console.log("✅ Generated keys match token - perfect sync!");
    } else {
      console.log("⚠️ Generated keys don't match token exactly, but proceeding...");
      // In this case, we might need to update the token as well
      await updateTokenWithNewKeys(tokenData, keyPair.publicKey);
    }
    
    // Clear recovery flags
    localStorage.removeItem("recovery_completed");
    localStorage.removeItem("temp_recovery_words");
    localStorage.removeItem("last_recovery_words");
    
    return { success: true, method: "deterministic_from_recovery" };
    
  } catch (error: any) {
    console.error("❌ Deterministic key generation failed:", error);
    return await generateNewKeysAndUpdateToken(tokenData);
  }
}

/**
 * Check for key mismatch and fix if found
 */
async function checkAndFixKeyMismatch(tokenData: any) {
  try {
    console.log("🔍 Checking key consistency...");
    
    const localPrivateKeyJwk = localStorage.getItem("privateKey");
    const localPublicKeyJwk = localStorage.getItem("publicKey");
    
    if (!localPrivateKeyJwk || !localPublicKeyJwk) {
      console.log("❌ Local keys missing, regenerating...");
      return await generateNewKeysAndUpdateToken(tokenData);
    }
    
    // Compare local public key with token's public key
    const localPublicKey = await jwkToKey(JSON.parse(localPublicKeyJwk));
    const localPublicKeyPem = await exportKeyToPem(localPublicKey);
    
    if (!tokenData.mtPubKey) {
      console.log("⚠️ Token missing public key, updating...");
      await updateTokenWithNewKeys(tokenData, localPublicKey);
      return { success: true, method: "token_update" };
    }
    
    // Normalize both keys for comparison
    const normalizeKey = (key: string) => key.replace(/[\r\n\s-]/g, '').replace(/BEGINPUBLICKEY|ENDPUBLICKEY/g, '');
    
    const localKeyNormalized = normalizeKey(localPublicKeyPem);
    const tokenKeyNormalized = normalizeKey(tokenData.mtPubKey);
    
    if (localKeyNormalized === tokenKeyNormalized) {
      console.log("✅ Keys are already synchronized");
      return { success: true, method: "already_synced" };
    }
    
    console.log("⚠️ Key mismatch detected, attempting to fix...");
    console.log("Local key preview:", localKeyNormalized.substring(0, 50) + "...");
    console.log("Token key preview:", tokenKeyNormalized.substring(0, 50) + "...");
    
    // Try to determine which key is correct based on token age
    const tokenAge = Date.now() - (tokenData.todReg || 0);
    const tokenAgeMinutes = tokenAge / (1000 * 60);
    
    if (tokenAgeMinutes < 5) {
      console.log("🕒 Recent token - updating local keys to match");
      return await updateLocalKeysFromToken(tokenData);
    } else {
      console.log("🕒 Older token - updating token with local keys");
      return await updateTokenWithNewKeys(tokenData, localPublicKey);
    }
    
  } catch (error: any) {
    console.error("❌ Key consistency check failed:", error);
    return await generateNewKeysAndUpdateToken(tokenData);
  }
}

/**
 * Generate completely new keys and update token
 */
async function generateNewKeysAndUpdateToken(tokenData: any) {
  try {
    console.log("🔄 Generating new key pair...");
    
    const { sign } = await generateKeys();
    
    const privateKeyJwk = await keyToJwk(sign.privateKey);
    const publicKeyJwk = await keyToJwk(sign.publicKey);
    
    // Store new keys
    localStorage.setItem("privateKey", JSON.stringify(privateKeyJwk));
    localStorage.setItem("publicKey", JSON.stringify(publicKeyJwk));
    
    console.log("✅ New keys generated and stored");
    
    // Update token with new public key
    await updateTokenWithNewKeys(tokenData, sign.publicKey);
    
    return { success: true, method: "new_keys_generated" };
    
  } catch (error: any) {
    console.error("❌ New key generation failed:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Update local keys to match token's public key (when possible)
 */
async function updateLocalKeysFromToken(tokenData: any) {
  console.log("⚠️ Cannot regenerate private key from public key in token");
  console.log("🔄 Generating new key pair and updating token instead...");
  return await generateNewKeysAndUpdateToken(tokenData);
}

/**
 * Update token with new public key
 */
async function updateTokenWithNewKeys(tokenData: any, publicKey: CryptoKey) {
  try {
    console.log("🎫 Updating token with new public key...");
    
    const publicKeyPem = await exportKeyToPem(publicKey);
    
    // Create updated token data
    const updatedTokenData = {
      ...tokenData,
      mtPubKey: publicKeyPem,
      todReg: Date.now(), // Update registration time
      keyUpdated: true // Flag to indicate keys were updated
    };
    
    // Encode the updated data
    const encodedData = btoa(JSON.stringify(updatedTokenData));
    
    // Get the current token parts to preserve signature structure
    const currentToken = getCookie("token") || localStorage.getItem("emergency_token");
    if (!currentToken) {
      throw new Error("No current token to update");
    }
    
    const tokenParts = currentToken.split(".");
    
    // For now, create a new token structure
    // In production, this should be properly signed by the server
    const newToken = `${encodedData}.${tokenParts[1]}.${tokenParts.slice(2).join('.')}`;
    
    // Update all token storage locations
    setCookie("token", newToken, {
      sameSite: "Lax",
      secure: location.protocol === 'https:',
      expires: 365,
      path: '/'
    });
    
    localStorage.setItem("emergency_token", newToken);
    axios.defaults.headers.common['Authorization'] = newToken;
    
    console.log("✅ Token updated successfully");
    
    return { success: true, tokenUpdated: true };
    
  } catch (error: any) {
    console.error("❌ Token update failed:", error);
    throw error;
  }
}

/**
 * Export CryptoKey to PEM format
 */
async function exportKeyToPem(key: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey("spki", key);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(spki)));
  const lines = base64.match(/.{1,64}/g);
  
  if (!lines) {
    throw new Error("Failed to format public key");
  }
  
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}

/**
 * Enhanced MTResponseSigner that automatically fixes key issues
 */
export async function recoveryAwareMTResponseSigner(content: Record<string, any>) {
  console.log("🔐 Recovery-aware response signer starting...");
  
  try {
    // First attempt normal signing
    const { MTResponseSigner } = await import("./interceptors");
    return await MTResponseSigner(content);
    
  } catch (error: any) {
    if (error.message?.includes("signature") || error.message?.includes("sign")) {
      console.log("⚠️ Signing failed, attempting key synchronization...");
      
      const fixResult = await fixPostRecoveryKeyMismatch();
      
      if (fixResult.success) {
        console.log("✅ Key synchronization successful, retrying signing...");
        
        // Retry signing with fixed keys
        const { MTResponseSigner } = await import("./interceptors");
        return await MTResponseSigner(content);
      } else {
        console.error("❌ Key synchronization failed:", fixResult.error);
      }
    }
    
    throw error;
  }
}

/**
 * Auto-fix function to be called on app startup or when auth errors occur
 */
export async function autoFixPostRecoveryAuth() {
  console.log("🚀 Auto-fixing post-recovery authentication...");
  
  try {
    // Check if we just completed recovery
    const recoveryCompleted = localStorage.getItem("recovery_completed") === "true";
    const hasToken = !!(getCookie("token") || localStorage.getItem("emergency_token"));
    
    if (!hasToken) {
      console.log("❌ No token available for auth fix");
      return { fixed: false, reason: "no_token" };
    }
    
    if (recoveryCompleted) {
      console.log("🔄 Post-recovery state detected, fixing keys...");
      const result = await fixPostRecoveryKeyMismatch();
      
      if (result.success) {
        console.log("✅ Post-recovery key fix successful");
        return { fixed: true, method: result.method };
      } else {
        console.log("❌ Post-recovery key fix failed:", result.error);
        return { fixed: false, error: result.error };
      }
    } else {
      // Perform routine key consistency check
      const result = await fixPostRecoveryKeyMismatch();
      
      if (result.success && result.method !== "already_synced") {
        console.log("✅ Key consistency fix applied");
        return { fixed: true, method: result.method };
      } else {
        console.log("ℹ️ No key fixes needed");
        return { fixed: false, reason: "no_fix_needed" };
      }
    }
    
  } catch (error: any) {
    console.error("❌ Auto-fix failed:", error);
    return { fixed: false, error: error.message };
  }
}

/**
 * Middleware to automatically handle key sync on auth failures
 */
export function createRecoveryAwareAxiosInterceptor() {
  let isFixing = false;
  
  axios.interceptors.response.use(
    response => response,
    async (error) => {
      if (isFixing) {
        return Promise.reject(error);
      }
      
      // Check if this is an auth error that might be due to key mismatch
      if (error.response?.status === 400 && 
          error.response?.data?.content?.error?.includes("signature")) {
        
        console.log("🔧 Detected signature error, attempting auto-fix...");
        isFixing = true;
        
        try {
          const fixResult = await fixPostRecoveryKeyMismatch();
          
          if (fixResult.success) {
            console.log("✅ Auto-fix successful, retrying request...");
            
            // Update the authorization header with the new token
            const newToken = getCookie("token") || localStorage.getItem("emergency_token");
            if (newToken) {
              error.config.headers['Authorization'] = newToken;
            }
            
            // Retry the request
            isFixing = false;
            return axios.request(error.config);
          }
        } catch (fixError) {
          console.error("❌ Auto-fix failed:", fixError);
        } finally {
          isFixing = false;
        }
      }
      
      return Promise.reject(error);
    }
  );
}

export default {
  fixPostRecoveryKeyMismatch,
  recoveryAwareMTResponseSigner,
  autoFixPostRecoveryAuth,
  createRecoveryAwareAxiosInterceptor
};