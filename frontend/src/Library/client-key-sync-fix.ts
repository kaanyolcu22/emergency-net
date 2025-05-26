// Client-side key synchronization fix for EmergencyNet
// Add this to your interceptors.ts or create a new utility file

import { getCookie, setCookie } from "typescript-cookie";
import { generateKeys, keyToJwk, jwkToKey } from "./crypt";
import { base64ToJson } from "./util";

/**
 * Diagnoses and fixes key mismatch issues between client keys and token
 */
export async function diagnoseAndFixKeyMismatch() {
  console.log("🔍 Starting key mismatch diagnosis...");
  
  try {
    // Step 1: Check if token exists
    const token = getCookie("token");
    if (!token) {
      console.log("❌ No token found - user needs to register");
      return { status: "no_token", action: "register" };
    }
    
    // Step 2: Parse token data
    const tokenParts = token.split(".");
    if (tokenParts.length < 3) {
      console.log("❌ Invalid token format");
      return { status: "invalid_token", action: "register" };
    }
    
    let tokenData;
    try {
      tokenData = JSON.parse(atob(tokenParts[0]));
    } catch (error) {
      console.log("❌ Cannot decode token data");
      return { status: "corrupted_token", action: "register" };
    }
    
    console.log("📋 Token data:", {
      username: tokenData.mtUsername,
      ap: tokenData.apReg,
      hasPublicKey: !!tokenData.mtPubKey
    });
    
    // Step 3: Check local keys
    const localPrivateKeyJwk = localStorage.getItem("privateKey");
    const localPublicKeyJwk = localStorage.getItem("publicKey");
    
    if (!localPrivateKeyJwk || !localPublicKeyJwk) {
      console.log("❌ Local keys missing - attempting to restore or regenerate");
      return await handleMissingLocalKeys(tokenData);
    }
    
    // Step 4: Compare keys
    try {
      const localPublicKey = await jwkToKey(JSON.parse(localPublicKeyJwk));
      const localPublicKeyJwk_parsed = JSON.parse(localPublicKeyJwk);
      
      // Import token's public key for comparison
      const tokenPublicKey = await importPublicKeyPem(tokenData.mtPubKey);
      const tokenPublicKeyJwk = await keyToJwk(tokenPublicKey);
      
      // Compare the keys
      const keysMatch = JSON.stringify(localPublicKeyJwk_parsed) === JSON.stringify(tokenPublicKeyJwk);
      
      console.log("🔑 Key comparison result:", keysMatch);
      
      if (!keysMatch) {
        console.log("❌ Key mismatch detected - attempting fix");
        return await handleKeyMismatch(tokenData, localPublicKeyJwk_parsed, tokenPublicKeyJwk);
      } else {
        console.log("✅ Keys match - no issues detected");
        return { status: "keys_match", action: "none" };
      }
      
    } catch (error) {
      console.error("❌ Key comparison failed:", error);
      return { status: "comparison_failed", action: "register", error: error.message };
    }
    
  } catch (error) {
    console.error("❌ Diagnosis failed:", error);
    return { status: "diagnosis_failed", action: "register", error: error.message };
  }
}

/**
 * Handles the case where local keys are missing
 */
async function handleMissingLocalKeys(tokenData) {
  console.log("🔧 Handling missing local keys...");
  
  try {
    // Option 1: Try to derive keys from token if possible
    if (tokenData.mtPubKey) {
      console.log("⚠️ Cannot recreate private key from public key in token");
      console.log("💡 Recommendation: Use identity recovery or re-register");
      
      return {
        status: "private_key_lost",
        action: "recovery_or_register",
        message: "Private key lost. Use identity recovery with your recovery words, or re-register."
      };
    }
    
    // Option 2: Generate new keys (will require re-registration)
    console.log("🔄 Generating new key pair...");
    const { sign } = await generateKeys();
    
    const privateKeyJwk = await keyToJwk(sign.privateKey);
    const publicKeyJwk = await keyToJwk(sign.publicKey);
    
    localStorage.setItem("privateKey", JSON.stringify(privateKeyJwk));
    localStorage.setItem("publicKey", JSON.stringify(publicKeyJwk));
    
    console.log("✅ New keys generated and stored");
    
    return {
      status: "new_keys_generated",
      action: "register",
      message: "New keys generated. You need to re-register with these keys."
    };
    
  } catch (error) {
    console.error("❌ Failed to handle missing keys:", error);
    return { status: "key_generation_failed", action: "manual_fix", error: error.message };
  }
}

/**
 * Handles key mismatch between local keys and token
 */
async function handleKeyMismatch(tokenData, localKeyJwk, tokenKeyJwk) {
  console.log("🔧 Handling key mismatch...");
  
  console.log("🔍 Key mismatch analysis:");
  console.log("Local key 'n' (modulus):", localKeyJwk.n?.substring(0, 50) + "...");
  console.log("Token key 'n' (modulus):", tokenKeyJwk.n?.substring(0, 50) + "...");
  console.log("Local key 'e' (exponent):", localKeyJwk.e);
  console.log("Token key 'e' (exponent):", tokenKeyJwk.e);
  
  // Check if we can determine which key is "correct"
  const tokenAge = Date.now() - (tokenData.todReg || 0);
  const tokenAgeHours = tokenAge / (1000 * 60 * 60);
  
  console.log("🕒 Token age:", tokenAgeHours.toFixed(2), "hours");
  
  if (tokenAgeHours < 1) {
    // Recent token - probably the local keys are wrong
    console.log("💡 Recent token detected - local keys might be stale");
    
    return {
      status: "recent_token_key_mismatch",
      action: "recovery_or_register",
      message: "Recent token with different key. Try identity recovery or re-register."
    };
  } else {
    // Older token - could be either way
    console.log("💡 Older token - unclear which key is correct");
    
    // Try to fix by clearing everything and forcing re-auth
    return await attemptKeyResynchronization(tokenData);
  }
}

/**
 * Attempts to resynchronize keys by clearing inconsistent state
 */
async function attemptKeyResynchronization(tokenData) {
  console.log("🔄 Attempting key resynchronization...");
  
  try {
    // Clear all local crypto state
    const keysToRemove = [
      "privateKey",
      "publicKey", 
      "adminKey",
      "pu_cert"
    ];
    
    keysToRemove.forEach(key => {
      if (localStorage.getItem(key)) {
        console.log(`🗑️ Removing ${key}`);
        localStorage.removeItem(key);
      }
    });
    
    // Clear cookies
    setCookie("token", "", { expires: -1, path: "/" });
    
    console.log("✅ Cleared inconsistent state");
    
    return {
      status: "state_cleared",
      action: "register",
      message: "Cleared inconsistent authentication state. Please re-register."
    };
    
  } catch (error) {
    console.error("❌ Resynchronization failed:", error);
    return { status: "resync_failed", action: "manual_fix", error: error.message };
  }
}

/**
 * Helper function to import PEM-formatted public key
 */
async function importPublicKeyPem(pem) {
  const pemHeader = "-----BEGIN PUBLIC KEY-----";
  const pemFooter = "-----END PUBLIC KEY-----";
  const pemContents = pem.substring(
    pemHeader.length,
    pem.length - pemFooter.length
  ).replace(/\n/g, '');
  
  const binaryDer = base64ToArrayBuffer(pemContents);
  
  return await window.crypto.subtle.importKey(
    'spki',
    binaryDer,
    {
      name: 'RSA-PSS',
      hash: 'SHA-256',
    },
    true,
    ['verify']
  );
}

/**
 * Helper function to convert base64 to ArrayBuffer
 */
function base64ToArrayBuffer(base64) {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Enhanced MTResponseSigner with key validation
 */
export async function enhancedMTResponseSigner(content) {
  console.log("🔐 Enhanced MTResponseSigner starting...");
  
  // First, check for key issues
  const diagnosis = await diagnoseAndFixKeyMismatch();
  
  if (diagnosis.status !== "keys_match") {
    console.warn("⚠️ Key issues detected:", diagnosis);
    
    if (diagnosis.action === "register") {
      throw new Error(`Authentication keys are inconsistent: ${diagnosis.message}. Please re-register.`);
    } else if (diagnosis.action === "recovery_or_register") {
      throw new Error(`Authentication keys are lost: ${diagnosis.message}`);
    }
  }
  
  // Proceed with normal signing
  content.tod = Date.now();
  
  try {
    const privateKeyJwk = JSON.parse(localStorage.getItem("privateKey"));
    const privateKey = await jwkToKey(privateKeyJwk);
    
    const contentString = JSON.stringify(content);
    console.log("📝 Signing content:", contentString.substring(0, 200) + "...");
    
    const signature = await sign(privateKey, contentString);
    console.log("✅ Content signed successfully");
    
    const result = { content, signature };
    
    // Add PU cert if available
    const puCert = localStorage.getItem("pu_cert");
    if (puCert) {
      result.pu_cert = puCert;
      console.log("📜 Added PU certificate to request");
    }
    
    return result;
    
  } catch (error) {
    console.error("❌ Enhanced signing failed:", error);
    throw error;
  }
}

/**
 * Sign function (import from your crypto utilities)
 */
async function sign(key, message) {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(message);

  const signature = await window.crypto.subtle.sign(
    {
      name: "RSA-PSS",
      saltLength: 0,
    },
    key,
    encoded
  );

  return arrayBufferToBase64(signature);
}

/**
 * Helper to convert ArrayBuffer to Base64
 */
function arrayBufferToBase64(buffer) {
  var binary = '';
  var bytes = new Uint8Array(buffer);
  var len = bytes.byteLength;
  for (var i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

/**
 * Auto-fix function that can be called on app startup
 */
export async function autoFixAuthenticationIssues() {
  console.log("🚀 Auto-fixing authentication issues on startup...");
  
  try {
    const diagnosis = await diagnoseAndFixKeyMismatch();
    
    switch (diagnosis.status) {
      case "keys_match":
        console.log("✅ No authentication issues detected");
        return { fixed: false, message: "No issues" };
        
      case "state_cleared":
        console.log("🔧 Cleared inconsistent state - redirect to registration");
        return { fixed: true, action: "redirect_register", message: diagnosis.message };
        
      case "new_keys_generated":
        console.log("🔑 Generated new keys - redirect to registration");
        return { fixed: true, action: "redirect_register", message: diagnosis.message };
        
      case "private_key_lost":
        console.log("🆘 Private key lost - offer recovery");
        return { fixed: false, action: "offer_recovery", message: diagnosis.message };
        
      default:
        console.log("⚠️ Could not auto-fix:", diagnosis.status);
        return { fixed: false, action: "manual_intervention", message: diagnosis.message || "Manual intervention required" };
    }
    
  } catch (error: any) {
    console.error("❌ Auto-fix failed:", error);
    return { fixed: false, error: error.message };
  }
}