// src/Library/recoveryUtil.ts - Fixed client-side cross-AP recovery

import { arrayBufferToBase64, base64ToArrayBuffer } from "./util";

/**
 * Generate ephemeral key pair (non-deterministic, temporary)
 */
export async function generateEphemeralKeyPair() {
  console.log("🔑 Generating ephemeral key pair...");
  
  try {
    const keyPair = await window.crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
        hash: 'SHA-256'
      },
      true,
      ['encrypt', 'decrypt']
    );
    
    const publicKeyJwk = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const privateKeyJwk = await window.crypto.subtle.exportKey('jwk', keyPair.privateKey);
    
    // Convert public key to PEM format
    const publicKeySpki = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
    const publicKeyBase64 = arrayBufferToBase64(publicKeySpki);
    const publicKeyLines = publicKeyBase64.match(/.{1,64}/g);
    const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${publicKeyLines.join('\n')}\n-----END PUBLIC KEY-----`;

    console.log("✅ Ephemeral key pair generated");
    return {
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      publicKeyJwk,
      privateKeyJwk,
      publicKeyPem
    };
  } catch (error) {
    console.error("❌ Ephemeral key generation failed:", error);
    throw new Error(`Failed to generate ephemeral keys: ${error.message}`);
  }
}

/**
 * Hash recovery words client-side - simple hash without salt (same as local recovery)
 */
export async function hashRecoveryWords(recoveryWordsString) {
  console.log("🔐 Hashing recovery words...");
  
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(recoveryWordsString);
    
    // Simple SHA-256 hash without salt (same as local recovery)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    
    const hash = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    console.log("✅ Recovery words hashed successfully");
    return hash;
  } catch (error) {
    console.error("❌ Recovery word hashing failed:", error);
    throw new Error(`Failed to hash recovery words: ${error.message}`);
  }
}

/**
 * Extract public key from EmergencyNet certificate format
 */
function extractPublicKeyFromCert(cert) {
  try {
    console.log("🔍 Extracting public key from certificate...");
    
    const parts = cert.split('.');
    if (parts.length < 1) {
      throw new Error("Invalid certificate format");
    }
    
    const decoded = atob(parts[0]);
    const certData = JSON.parse(decoded);
    
    const publicKey = certData.apPub;
    if (!publicKey) {
      throw new Error("Public key not found in certificate");
    }
    
    if (!publicKey.includes('-----BEGIN PUBLIC KEY-----')) {
      throw new Error("Invalid PEM format in certificate");
    }
    
    console.log("✅ Public key extracted from certificate");
    return publicKey;
    
  } catch (error) {
    console.error("❌ Certificate parsing failed:", error);
    throw new Error(`Failed to extract public key: ${error.message}`);
  }
}

/**
 * Encrypt data with AP's public key
 */
async function encryptWithAPPublicKey(data, apPublicKeyPem) {
  try {
    console.log("🔐 Encrypting data with AP public key...");
    
    // Clean PEM string
    const pemHeader = "-----BEGIN PUBLIC KEY-----";
    const pemFooter = "-----END PUBLIC KEY-----";
    const pemContents = apPublicKeyPem.substring(
      pemHeader.length,
      apPublicKeyPem.length - pemFooter.length
    ).replace(/\s/g, '');
    
    // Convert to ArrayBuffer
    const binaryDer = base64ToArrayBuffer(pemContents);
    
    // Import public key
    const publicKey = await window.crypto.subtle.importKey(
      'spki',
      binaryDer,
      {
        name: 'RSA-OAEP',
        hash: 'SHA-256'
      },
      true,
      ['encrypt']
    );
    
    // Encrypt data
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    
    const encrypted = await window.crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      publicKey,
      dataBuffer
    );
    
    console.log("✅ Data encrypted with AP public key");
    return arrayBufferToBase64(encrypted);
    
  } catch (error) {
    console.error("❌ Encryption with AP public key failed:", error);
    throw new Error(`Encryption failed: ${error.message}`);
  }
}

/**
 * Create cross-AP recovery request (Client → AP2)
 */
export async function createCrossAPRecoveryRequest(
  username,
  sourceApId,
  recoveryWords,
  tempUserId,
  currentApCertificate
) {
  try {
    console.log("🚀 Creating cross-AP recovery request...");
    console.log("Username:", username);
    console.log("Source AP ID:", sourceApId);
    console.log("Temp User ID:", tempUserId);
    
    // Step 1: Generate ephemeral keys
    const ephemeralKeyPair = await generateEphemeralKeyPair();
    
    // Step 2: Hash recovery words (never send plaintext)
    const recoveryHash = await hashRecoveryWords(recoveryWords);
    
    // Step 3: Create request payload
    const requestPayload = {
      tempUserId,
      realUserId: username,
      sourceApId,
      recoveryHash,
      ephemeralPublicKey: ephemeralKeyPair.publicKeyPem,
      timestamp: Date.now(),
      type: "CROSS_AP_RECOVERY_REQUEST"
    };
    
    console.log("📋 Request payload created:", {
      tempUserId: requestPayload.tempUserId,
      realUserId: requestPayload.realUserId,
      sourceApId: requestPayload.sourceApId,
      hasHash: !!requestPayload.recoveryHash,
      hasEphemeralKey: !!requestPayload.ephemeralPublicKey
    });
    
    // Step 4: Extract AP2's public key and encrypt
    const ap2PublicKey = extractPublicKeyFromCert(currentApCertificate);
    const encryptedPayload = await encryptWithAPPublicKey(
      JSON.stringify(requestPayload), 
      ap2PublicKey
    );
    
    console.log("✅ Request encrypted with AP2's public key");
    
    return {
      encryptedData: encryptedPayload,
      ephemeralKeyPair
    };
    
  } catch (error) {
    console.error("❌ Error creating cross-AP recovery request:", error);
    throw error;
  }
}

/**
 * Decrypt recovery response with ephemeral private key
 */
export async function decryptRecoveryResponse(encryptedData, ephemeralPrivateKey) {
  try {
    console.log("🔓 Decrypting recovery response...");
    
    const encryptedBuffer = base64ToArrayBuffer(encryptedData);
    
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      ephemeralPrivateKey,
      encryptedBuffer
    );
    
    const decryptedText = new TextDecoder().decode(decrypted);
    console.log("✅ Recovery response decrypted successfully");
    
    return JSON.parse(decryptedText);
  } catch (error) {
    console.error("❌ Decryption error:", error);
    throw new Error(`Failed to decrypt recovery response: ${error.message}`);
  }
}

/**
 * Store ephemeral keys temporarily
 */
export function storeEphemeralKeys(tempUserId, keyPair) {
  const keyData = {
    publicKeyJwk: keyPair.publicKeyJwk,
    privateKeyJwk: keyPair.privateKeyJwk,
    publicKeyPem: keyPair.publicKeyPem,
    timestamp: Date.now()
  };
  
  localStorage.setItem(`ephemeral_keys_${tempUserId}`, JSON.stringify(keyData));
  console.log("💾 Ephemeral keys stored for:", tempUserId);
}

/**
 * Retrieve stored ephemeral keys
 */
export async function retrieveEphemeralKeys(tempUserId) {
  try {
    const keyDataString = localStorage.getItem(`ephemeral_keys_${tempUserId}`);
    if (!keyDataString) {
      console.log("❌ No ephemeral keys found for:", tempUserId);
      return null;
    }
    
    const keyData = JSON.parse(keyDataString);
    
    const publicKey = await window.crypto.subtle.importKey(
      'jwk',
      keyData.publicKeyJwk,
      {
        name: 'RSA-OAEP',
        hash: 'SHA-256'
      },
      true,
      ['encrypt']
    );
    
    const privateKey = await window.crypto.subtle.importKey(
      'jwk',
      keyData.privateKeyJwk,
      {
        name: 'RSA-OAEP',
        hash: 'SHA-256'
      },
      true,
      ['decrypt']
    );
    
    console.log("✅ Ephemeral keys retrieved for:", tempUserId);
    return {
      publicKey,
      privateKey,
      publicKeyJwk: keyData.publicKeyJwk,
      privateKeyJwk: keyData.privateKeyJwk,
      publicKeyPem: keyData.publicKeyPem
    };
  } catch (error) {
    console.error("❌ Error retrieving ephemeral keys:", error);
    return null;
  }
}

/**
 * Clear ephemeral keys after use
 */
export function clearEphemeralKeys(tempUserId) {
  localStorage.removeItem(`ephemeral_keys_${tempUserId}`);
  console.log("🗑️ Cleared ephemeral keys for:", tempUserId);
}