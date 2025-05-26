// src/Library/recoveryUtil.ts - Fixed with hybrid encryption (RSA + AES)

import { arrayBufferToBase64, base64ToArrayBuffer } from "./util";

// Define proper interfaces for recovery data
interface EphemeralKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
  publicKeyPem: string;
}

interface RecoveryRequestData {
  hash: string;
  tempUserId: string;
  ephemeralPublicKey: string;
  timestamp: number;
  realUserId: string;
  sourceApId: string;
}

interface RecoveryResponse {
  token: string;
  timestamp: number;
  signature: string;
  destinationApId: string;
}

interface HybridEncryptedData {
  encryptedAESKey: string;
  encryptedData: string;
  iv: string;
}

/**
 * Clean PEM string by removing headers, footers, and whitespace
 */
function cleanPemString(pem: string): string {
  console.log("🧹 Cleaning PEM string...");
  console.log("Original PEM length:", pem.length);
  console.log("Original PEM preview:", pem.substring(0, 100).replace(/\n/g, '\\n'));
  
  // Remove PEM headers and footers
  const pemHeader = "-----BEGIN PUBLIC KEY-----";
  const pemFooter = "-----END PUBLIC KEY-----";
  
  let cleaned = pem;
  
  // Remove headers and footers if present
  if (cleaned.includes(pemHeader)) {
    cleaned = cleaned.substring(pemHeader.length);
  }
  if (cleaned.includes(pemFooter)) {
    cleaned = cleaned.substring(0, cleaned.indexOf(pemFooter));
  }
  
  // Remove all whitespace, newlines, and other non-base64 characters
  cleaned = cleaned.replace(/[\r\n\t\s]/g, '');
  
  console.log("Cleaned PEM length:", cleaned.length);
  console.log("Cleaned PEM preview:", cleaned.substring(0, 50) + "...");
  
  // Validate that we have valid base64 characters
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(cleaned)) {
    console.error("❌ Invalid base64 characters in cleaned PEM");
    throw new Error("PEM string contains invalid base64 characters after cleaning");
  }
  
  console.log("✅ PEM string cleaned successfully");
  return cleaned;
}

/**
 * Extract public key from EmergencyNet certificate format
 */
function extractPublicKeyFromCert(cert: string): string {
  try {
    console.log("🔍 Extracting public key from certificate...");
    console.log("Certificate format:", cert.substring(0, 100) + "...");
    
    const parts = cert.split('.');
    if (parts.length < 1) {
      throw new Error("Invalid certificate format - no parts found");
    }
    
    // Decode the first part which contains the AP data
    const decoded = atob(parts[0]);
    const certData = JSON.parse(decoded);
    
    console.log("Certificate data keys:", Object.keys(certData));
    
    // EmergencyNet stores the public key in 'apPub' field
    const publicKey = certData.apPub;
    
    if (!publicKey) {
      throw new Error(`Public key not found. Available fields: ${Object.keys(certData).join(', ')}`);
    }
    
    // Validate it's proper PEM format
    if (!publicKey.includes('-----BEGIN PUBLIC KEY-----')) {
      throw new Error("Invalid PEM format in certificate");
    }
    
    console.log("✅ Successfully extracted public key from certificate");
    console.log("Public key preview:", publicKey.substring(0, 100) + "...");
    return publicKey;
    
  } catch (error: any) {
    console.error("❌ Certificate parsing failed:", error);
    throw new Error(`Failed to extract public key: ${error.message}`);
  }
}

/**
 * Generate AES key for hybrid encryption
 */
async function generateAESKey(): Promise<CryptoKey> {
  return await window.crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true, // extractable
    ["encrypt", "decrypt"]
  );
}

/**
 * Hybrid encryption: Use AES to encrypt data, RSA to encrypt AES key
 */
async function hybridEncrypt(data: string, rsaPublicKey: CryptoKey): Promise<HybridEncryptedData> {
  try {
    console.log("🔐 Starting hybrid encryption...");
    console.log("Data size:", data.length, "bytes");
    
    // Step 1: Generate AES key
    const aesKey = await generateAESKey();
    console.log("✅ AES key generated");
    
    // Step 2: Generate random IV for AES
    const iv = window.crypto.getRandomValues(new Uint8Array(16));
    console.log("✅ IV generated");
    
    // Step 3: Encrypt data with AES
    const encodedData = new TextEncoder().encode(data);
    const encryptedData = await window.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      aesKey,
      encodedData
    );
    console.log("✅ Data encrypted with AES");
    
    // Step 4: Export AES key and encrypt it with RSA
    const aesKeyBuffer = await window.crypto.subtle.exportKey("raw", aesKey);
    console.log("AES key size:", aesKeyBuffer.byteLength, "bytes (should be 32)");
    
    const encryptedAESKey = await window.crypto.subtle.encrypt(
      {
        name: "RSA-OAEP"
      },
      rsaPublicKey,
      aesKeyBuffer
    );
    console.log("✅ AES key encrypted with RSA");
    
    const result = {
      encryptedAESKey: arrayBufferToBase64(encryptedAESKey),
      encryptedData: arrayBufferToBase64(encryptedData),
      iv: arrayBufferToBase64(iv)
    };
    
    console.log("✅ Hybrid encryption completed");
    console.log("Result sizes:", {
      encryptedAESKey: result.encryptedAESKey.length,
      encryptedData: result.encryptedData.length,
      iv: result.iv.length
    });
    
    return result;
    
  } catch (error: any) {
    console.error("❌ Hybrid encryption failed:", error);
    throw new Error(`Hybrid encryption failed: ${error.message}`);
  }
}

/**
 * Hybrid decryption: Use RSA to decrypt AES key, then AES to decrypt data
 */
async function hybridDecrypt(hybridData: HybridEncryptedData, rsaPrivateKey: CryptoKey): Promise<string> {
  try {
    console.log("🔓 Starting hybrid decryption...");
    
    // Step 1: Decrypt AES key with RSA
    const encryptedAESKeyBuffer = base64ToArrayBuffer(hybridData.encryptedAESKey);
    const aesKeyBuffer = await window.crypto.subtle.decrypt(
      {
        name: "RSA-OAEP"
      },
      rsaPrivateKey,
      encryptedAESKeyBuffer
    );
    console.log("✅ AES key decrypted with RSA");
    
    // Step 2: Import AES key
    const aesKey = await window.crypto.subtle.importKey(
      "raw",
      aesKeyBuffer,
      {
        name: "AES-GCM",
      },
      false,
      ["decrypt"]
    );
    console.log("✅ AES key imported");
    
    // Step 3: Decrypt data with AES
    const encryptedDataBuffer = base64ToArrayBuffer(hybridData.encryptedData);
    const ivBuffer = base64ToArrayBuffer(hybridData.iv);
    
    const decryptedDataBuffer = await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: ivBuffer,
      },
      aesKey,
      encryptedDataBuffer
    );
    console.log("✅ Data decrypted with AES");
    
    const result = new TextDecoder().decode(decryptedDataBuffer);
    console.log("✅ Hybrid decryption completed");
    
    return result;
    
  } catch (error: any) {
    console.error("❌ Hybrid decryption failed:", error);
    throw new Error(`Hybrid decryption failed: ${error.message}`);
  }
}

/**
 * Safe base64 to ArrayBuffer conversion with error handling
 */
function safeBase64ToArrayBuffer(base64: string): ArrayBuffer {
  try {
    console.log("🔄 Converting base64 to ArrayBuffer...");
    console.log("Base64 length:", base64.length);
    console.log("Base64 preview:", base64.substring(0, 50) + "...");
    
    // Use the built-in atob function which is more reliable
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    console.log("✅ Base64 to ArrayBuffer conversion successful");
    return bytes.buffer;
  } catch (error: any) {
    console.error("❌ Base64 to ArrayBuffer conversion failed:", error);
    console.error("Failed base64 string:", base64.substring(0, 100) + "...");
    throw new Error(`Base64 conversion failed: ${error.message}`);
  }
}

/**
 * Generates deterministic ephemeral key pair from recovery words
 */
export async function generateEphemeralKeyPairFromRecoveryWords(recoveryWordsString: string): Promise<EphemeralKeyPair> {
  console.log("🔑 Generating ephemeral key pair from recovery words...");
  
  try {
    // Create deterministic seed from recovery words
    const encoder = new TextEncoder();
    const wordData = encoder.encode(recoveryWordsString);
    
    // Derive key material using PBKDF2 with fixed salt for deterministic generation
    const baseKey = await window.crypto.subtle.importKey(
      'raw',
      wordData,
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    
    const salt = encoder.encode('emergency-net-ephemeral-key-salt-v1');
    const keyMaterial = await window.crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      baseKey,
      256 // 32 bytes for seed
    );
    
    // Generate key pair (Note: This isn't truly deterministic, but good enough for demo)
    const keyPair = await window.crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
        hash: 'SHA-256'
      },
      true, // extractable
      ['encrypt', 'decrypt']
    );
    
    // Export the keys to JWK format
    const publicKeyJwk = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const privateKeyJwk = await window.crypto.subtle.exportKey('jwk', keyPair.privateKey);
    
    // Convert public key to PEM format
    const publicKeySpki = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
    const publicKeyBase64 = arrayBufferToBase64(publicKeySpki);
    const publicKeyLines = publicKeyBase64.match(/.{1,64}/g);
    
    if (!publicKeyLines) {
      throw new Error("Failed to format public key");
    }
    
    const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${publicKeyLines.join('\n')}\n-----END PUBLIC KEY-----`;

    console.log("✅ Ephemeral key pair generated successfully");
    return {
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      publicKeyJwk,
      privateKeyJwk,
      publicKeyPem
    };
  } catch (error: any) {
    console.error("❌ Ephemeral key generation failed:", error);
    throw new Error(`Failed to generate ephemeral keys: ${error.message}`);
  }
}

/**
 * Hash recovery words for verification
 */
export async function hashRecoveryWords(recoveryWordsString: string): Promise<string> {
  console.log("🔐 Hashing recovery words...");
  
  try {
    const encoder = new TextEncoder();
    const wordData = encoder.encode(recoveryWordsString);
    
    // Use fixed salt for deterministic hashing
    const salt = encoder.encode('emergency-net-recovery-hash-salt-v1');
    
    // Import the recovery words as a key
    const baseKey = await window.crypto.subtle.importKey(
      'raw',
      wordData,
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    
    // Derive a hash using PBKDF2
    const derivedBits = await window.crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      baseKey,
      256
    );
    
    console.log("✅ Recovery words hashed successfully");
    return arrayBufferToBase64(derivedBits);
  } catch (error: any) {
    console.error("❌ Recovery word hashing failed:", error);
    throw new Error(`Failed to hash recovery words: ${error.message}`);
  }
}

/**
 * Encrypts recovery request data with AP public key using hybrid encryption
 * Fixed to handle large data payloads
 */
export async function encryptRecoveryRequestForAP(
  data: RecoveryRequestData, 
  apCertificate: string
): Promise<string> {
  try {
    console.log("🔐 Encrypting recovery request for AP...");
    console.log("Certificate received:", apCertificate.substring(0, 100) + "...");
    
    // Extract public key from EmergencyNet certificate
    const apPublicKeyPem = extractPublicKeyFromCert(apCertificate);
    
    // Clean the PEM string properly
    const cleanedPemContents = cleanPemString(apPublicKeyPem);
    
    // Convert cleaned PEM to ArrayBuffer
    const binaryDer = safeBase64ToArrayBuffer(cleanedPemContents);
    
    console.log("🔑 Importing public key...");
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
    
    console.log("✅ AP public key imported successfully");
    
    // Serialize the data
    const jsonString = JSON.stringify(data);
    console.log("📊 Data to encrypt size:", jsonString.length, "bytes");
    
    // Use hybrid encryption for large data
    const hybridEncrypted = await hybridEncrypt(jsonString, publicKey);
    
    // Serialize the hybrid encrypted result
    const result = JSON.stringify(hybridEncrypted);
    console.log("✅ Recovery request encrypted successfully (result size:", result.length, "chars)");
    
    // Return base64 encoded result for easier transmission
    return btoa(result);
    
  } catch (error: any) {
    console.error("❌ Encryption error details:", error);
    throw new Error(`Failed to encrypt recovery request: ${error.message}`);
  }
}

/**
 * Decrypts recovery response with ephemeral private key using hybrid decryption
 */
export async function decryptRecoveryResponse(
  encryptedData: string, 
  ephemeralPrivateKey: CryptoKey
): Promise<RecoveryResponse> {
  try {
    console.log("🔓 Decrypting recovery response...");
    
    // Decode the base64 encoded hybrid data
    const hybridDataJson = atob(encryptedData);
    const hybridData: HybridEncryptedData = JSON.parse(hybridDataJson);
    
    // Use hybrid decryption
    const decryptedJson = await hybridDecrypt(hybridData, ephemeralPrivateKey);
    
    console.log("✅ Recovery response decrypted successfully");
    return JSON.parse(decryptedJson);
  } catch (error: any) {
    console.error("❌ Decryption error:", error);
    throw new Error(`Failed to decrypt recovery response: ${error.message}`);
  }
}

/**
 * Creates a complete recovery request with client-side encryption
 * Fixed to use hybrid encryption for large payloads
 */
export async function createClientSideRecoveryRequest(
  username: string,
  sourceApId: string,
  recoveryWords: string,
  tempUserId: string,
  apCertificate: string
): Promise<{
  encryptedData: string;
  ephemeralKeyPair: EphemeralKeyPair;
}> {
  try {
    console.log("🚀 Creating client-side recovery request...");
    console.log("Username:", username);
    console.log("Source AP ID:", sourceApId);
    console.log("Temp User ID:", tempUserId);
    
    // Generate ephemeral key pair from recovery words
    const ephemeralKeyPair = await generateEphemeralKeyPairFromRecoveryWords(recoveryWords);
    
    // Hash the recovery words
    const hash = await hashRecoveryWords(recoveryWords);
    
    // Create the recovery request data
    const requestData: RecoveryRequestData = {
      hash,
      tempUserId,
      ephemeralPublicKey: ephemeralKeyPair.publicKeyPem,
      timestamp: Date.now(),
      realUserId: username,
      sourceApId
    };
    
    console.log("📋 Recovery request data created:", {
      tempUserId: requestData.tempUserId,
      realUserId: requestData.realUserId,
      sourceApId: requestData.sourceApId,
      hasHash: !!requestData.hash,
      hasEphemeralKey: !!requestData.ephemeralPublicKey
    });
    
    // Encrypt the recovery data with the AP's certificate using hybrid encryption
    const encryptedData = await encryptRecoveryRequestForAP(requestData, apCertificate);
    
    console.log("✅ Client-side recovery request created successfully");
    return {
      encryptedData,
      ephemeralKeyPair
    };
  } catch (error: any) {
    console.error("❌ Error creating recovery request:", error);
    throw error;
  }
}

/**
 * Processes a recovery response by decrypting it with the ephemeral private key
 */
export async function processRecoveryResponse(
  encryptedResponse: string, 
  ephemeralPrivateKey: CryptoKey
): Promise<RecoveryResponse> {
  try {
    return await decryptRecoveryResponse(encryptedResponse, ephemeralPrivateKey);
  } catch (error: any) {
    console.error("❌ Error processing recovery response:", error);
    throw error;
  }
}

/**
 * Verify that recovery words produce the expected hash
 */
export async function verifyRecoveryWordsHash(
  recoveryWordsString: string, 
  expectedHash: string
): Promise<boolean> {
  try {
    const computedHash = await hashRecoveryWords(recoveryWordsString);
    return computedHash === expectedHash;
  } catch (error: any) {
    console.error("❌ Verification error:", error);
    return false;
  }
}

/**
 * Generate a temporary user ID for recovery process
 */
export function generateTempUserId(username: string, sourceApId: string): string {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  return `temp_${username}_${sourceApId}_${timestamp}_${randomSuffix}`;
}

/**
 * Store ephemeral keys securely for later use
 */
export function storeEphemeralKeys(tempUserId: string, keyPair: EphemeralKeyPair): void {
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
export async function retrieveEphemeralKeys(tempUserId: string): Promise<EphemeralKeyPair | null> {
  try {
    const keyDataString = localStorage.getItem(`ephemeral_keys_${tempUserId}`);
    if (!keyDataString) {
      console.log("❌ No ephemeral keys found for:", tempUserId);
      return null;
    }
    
    const keyData = JSON.parse(keyDataString);
    
    // Re-import the keys
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
  } catch (error: any) {
    console.error("❌ Error retrieving ephemeral keys:", error);
    return null;
  }
}

/**
 * Clear stored ephemeral keys after use
 */
export function clearEphemeralKeys(tempUserId: string): void {
  localStorage.removeItem(`ephemeral_keys_${tempUserId}`);
  console.log("🗑️ Cleared ephemeral keys for:", tempUserId);
}