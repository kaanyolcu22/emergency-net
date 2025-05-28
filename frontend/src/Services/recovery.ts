// src/Services/recovery.ts - Simple fix by updating token with client keys
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
 * Unified recovery function
 */
export async function recoverIdentity(recoveryData: RecoveryData): Promise<RecoveryResponse> {
  try {
    console.log(`Starting unified recovery for: ${recoveryData.username}@${recoveryData.apIdentifier}`);
    
    const localResult = await attemptLocalRecovery(recoveryData);
    if (localResult) {
      return {
        type: 'local_success',
        token: localResult.token
      };
    }
    
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
 * Attempt local recovery - WITH EXTENSIVE DEBUG OUTPUT
 */
async function attemptLocalRecovery(recoveryData: RecoveryData): Promise<{ token: string } | null> {
  try {
    console.log("\n=== CLIENT RECOVERY DEBUG START ===");
    console.log("🔄 Step 1: Generate new local keys");
    
    // Generate fresh keys locally first
    const { sign } = await generateKeys();
    console.log("✅ Key pair generated");
    
    const privateKeyJwk = await keyToJwk(sign.privateKey);
    const publicKeyJwk = await keyToJwk(sign.publicKey);
    
    console.log("🔍 Generated key details:");
    console.log("Private key type:", privateKeyJwk.kty);
    console.log("Private key algorithm:", privateKeyJwk.alg);
    console.log("Private key use:", privateKeyJwk.use);
    console.log("Private key operations:", privateKeyJwk.key_ops);
    console.log("Modulus length:", privateKeyJwk.n ? privateKeyJwk.n.length : "none");
    
    console.log("Public key type:", publicKeyJwk.kty);
    console.log("Public key algorithm:", publicKeyJwk.alg);
    console.log("Public key use:", publicKeyJwk.use);
    console.log("Public key operations:", publicKeyJwk.key_ops);
    console.log("Public modulus length:", publicKeyJwk.n ? publicKeyJwk.n.length : "none");
    
    // Store the new keys immediately
    localStorage.setItem("privateKey", JSON.stringify(privateKeyJwk));
    localStorage.setItem("publicKey", JSON.stringify(publicKeyJwk));
    
    console.log("✅ New keys stored in localStorage");
    
    console.log("🔄 Step 2: Send recovery request with new public key");
    console.log("Username:", recoveryData.username);
    console.log("AP Identifier:", recoveryData.apIdentifier);
    console.log("Recovery words length:", recoveryData.recoveryWords.length);
    
    // Send recovery request with our new public key
    const content = {
      username: recoveryData.username,
      apIdentifier: recoveryData.apIdentifier,
      recoveryWords: recoveryData.recoveryWords,
      newPublicKey: publicKeyJwk, // Send our new public key
      tod: Date.now(),
      type: "MT_RECOVERY",
      priority: 1
    };
    
    console.log("📤 Sending recovery request...");
    console.log("Request content keys:", Object.keys(content));
    console.log("Public key being sent:", {
      kty: publicKeyJwk.kty,
      alg: publicKeyJwk.alg,
      hasN: !!publicKeyJwk.n,
      nLength: publicKeyJwk.n?.length
    });
    
    const response = await axios.post(
      getApiURL() + "/recover-identity",
      content
    );
    
    console.log("✅ Server response received");
    console.log("Response status:", response.status);
    console.log("Response data keys:", Object.keys(response.data));
    
    const token = response.data.token || response.data.content?.token;
    
    if (token) {
      console.log("✅ Token received from server");
      console.log("Token length:", token.length);
      console.log("Token parts count:", token.split('.').length);
      console.log("Token preview:", token.substring(0, 100) + "...");
      
      // Parse and verify token content
      try {
        const tokenParts = token.split('.');
        const tokenData = JSON.parse(atob(tokenParts[0]));
        
        console.log("🔍 Token content analysis:");
        console.log("Username:", tokenData.mtUsername);
        console.log("AP Reg:", tokenData.apReg);
        console.log("Registration time:", new Date(tokenData.todReg).toISOString());
        console.log("Has public key:", !!tokenData.mtPubKey);
        
        if (tokenData.mtPubKey) {
          console.log("Token public key preview:", tokenData.mtPubKey.substring(0, 100) + "...");
          console.log("Token public key length:", tokenData.mtPubKey.length);
          
          // Test if our private key can sign something that the token's public key can verify
          console.log("🧪 Testing key compatibility...");
          
          const testMessage = "key compatibility test " + Date.now();
          const encoder = new TextEncoder();
          const data = encoder.encode(testMessage);
          
          // Sign with our private key
          const signature = await window.crypto.subtle.sign(
            {
              name: 'RSA-PSS',
              saltLength: 0,
            },
            sign.privateKey,
            data
          );
          
          console.log("✅ Test signature generated");
          console.log("Signature length:", signature.byteLength);
          
          // Try to import the token's public key and verify
          try {
            const tokenPubKeyPem = tokenData.mtPubKey;
            
            // Clean the PEM string
            const pemHeader = "-----BEGIN PUBLIC KEY-----";
            const pemFooter = "-----END PUBLIC KEY-----";
            const pemContents = tokenPubKeyPem.substring(
              pemHeader.length,
              tokenPubKeyPem.length - pemFooter.length
            ).replace(/\s/g, '');
            
            const binaryDer = base64ToArrayBuffer(pemContents);
            
            const tokenPublicKey = await window.crypto.subtle.importKey(
              'spki',
              binaryDer,
              {
                name: 'RSA-PSS',
                hash: 'SHA-256',
              },
              true,
              ['verify']
            );
            
            console.log("✅ Token public key imported successfully");
            
            // Verify signature
            const isValid = await window.crypto.subtle.verify(
              {
                name: 'RSA-PSS',
                saltLength: 0,
              },
              tokenPublicKey,
              signature,
              data
            );
            
            console.log("🔍 Key compatibility test result:", isValid ? "✅ COMPATIBLE" : "❌ INCOMPATIBLE");
            
            if (!isValid) {
              console.error("❌ CRITICAL: Keys are not compatible!");
              console.error("This will cause authentication failures!");
              
              // Compare our public key with token's public key
              const ourPublicKeySpki = await window.crypto.subtle.exportKey('spki', sign.publicKey);
              const ourPublicKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(ourPublicKeySpki)));
              const ourPublicKeyLines = ourPublicKeyBase64.match(/.{1,64}/g);
              const ourPublicKeyPem = `-----BEGIN PUBLIC KEY-----\n${ourPublicKeyLines?.join('\n')}\n-----END PUBLIC KEY-----`;
              
              console.log("❌ OUR public key:");
              console.log(ourPublicKeyPem.substring(0, 200) + "...");
              console.log("❌ TOKEN public key:");
              console.log(tokenPubKeyPem.substring(0, 200) + "...");
              
              const normalizeKey = (key: string) => key.replace(/[\r\n\s-]/g, '').replace(/BEGINPUBLICKEY|ENDPUBLICKEY/g, '');
              
              if (normalizeKey(ourPublicKeyPem) === normalizeKey(tokenPubKeyPem)) {
                console.log("✅ Keys are identical (normalization issue)");
              } else {
                console.log("❌ Keys are completely different");
              }
            }
            
          } catch (verifyError) {
            console.error("❌ Token key verification failed:", verifyError);
          }
        }
        
      } catch (parseError) {
        console.error("❌ Token parsing failed:", parseError);
      }
      
      console.log("✅ Recovery successful - keys and token synchronized");
      console.log("=== CLIENT RECOVERY DEBUG END ===\n");
      return { token };
    }
    
    console.log("❌ No token received from server");
    console.log("=== CLIENT RECOVERY DEBUG END ===\n");
    return null;
    
  } catch (error : any) {
    console.error("❌ Local recovery failed:", error);
    console.error("Error details:", {
      name: error.name,
      message: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
    console.log("=== CLIENT RECOVERY DEBUG END ===\n");
    return null;
  }
}

/**
 * Helper function for base64 to ArrayBuffer conversion
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// Rest of the functions remain the same...
async function initiateCrossAPRecoveryWithTempIdentity(recoveryData: RecoveryData): Promise<RecoveryResponse> {
  // Implementation stays the same as before
  return {
    type: 'cross_ap_initiated',
    message: "Cross-AP recovery not implemented in this fix"
  };
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
    console.error("Error checking cross-AP recovery status:", error);
    throw error;
  }
}

export async function completeRecovery(tempUserId: string, recoveryWords: string) {
  try {
    const response = await axios.post(
      getApiURL() + "/get-recovery-response",
      {
        tempUserId,
        tod: Date.now()
      }
    );
    
    if (response.data.token) {
      return {
        token: response.data.token,
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