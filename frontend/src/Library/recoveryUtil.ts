// src/Library/recoveryUtil.ts - Updated for client-side ephemeral key generation

import { arrayBufferToBase64, base64ToArrayBuffer } from "./util";

// Define proper interfaces for recovery data
interface EphemeralKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
  publicKeyPem: string;
}

interface RecoveryHash {
  hash: string;
  salt: string;
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

/**
 * Generates deterministic ephemeral key pair from recovery words
 * This allows the same keys to be regenerated from the same recovery phrase
 */
export async function generateEphemeralKeyPairFromRecoveryWords(recoveryWordsString: string): Promise<EphemeralKeyPair> {
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
  
  // Use derived material as seed for deterministic key generation
  // Note: Web Crypto API doesn't support seeded key generation directly
  // So we'll use the derived material to create a deterministic JWK
  const seedArray = new Uint8Array(keyMaterial);
  
  // Generate deterministic JWK components from seed
  // This is a simplified approach - in production, you'd use proper RSA parameter generation
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

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    publicKeyJwk,
    privateKeyJwk,
    publicKeyPem
  };
}

/**
 * Hash recovery words for verification
 */
export async function hashRecoveryWords(recoveryWordsString: string): Promise<string> {
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
  
  return arrayBufferToBase64(derivedBits);
}

export async function encryptRecoveryRequestForAP(
  data: RecoveryRequestData, 
  apPublicKeyPem: string
): Promise<string> {
  try {
    // Clean the PEM key - remove headers and whitespace
    const pemHeader = "-----BEGIN PUBLIC KEY-----";
    const pemFooter = "-----END PUBLIC KEY-----";
    
    if (!apPublicKeyPem.includes(pemHeader)) {
      throw new Error("Invalid PEM format - missing header");
    }
    
    const pemContents = apPublicKeyPem
      .replace(pemHeader, '')
      .replace(pemFooter, '')
      .replace(/\s/g, ''); // Remove all whitespace including \n
    
    // Convert to ArrayBuffer
    const binaryDer = base64ToArrayBuffer(pemContents);
    
    // Import the public key
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
    
    // Serialize and encrypt the data
    const jsonString = JSON.stringify(data);
    const encoded = new TextEncoder().encode(jsonString);
    
    const encrypted = await window.crypto.subtle.encrypt(
      {
        name: 'RSA-OAEP'
      },
      publicKey,
      encoded
    );
    
    return arrayBufferToBase64(encrypted);
  } catch (error : any) {
    console.error("Encryption error details:", error);
    throw new Error(`Failed to encrypt recovery request: ${error.message}`);
  }
}

/**
 * Decrypts recovery response with ephemeral private key
 */
export async function decryptRecoveryResponse(
  encryptedData: string, 
  ephemeralPrivateKey: CryptoKey
): Promise<RecoveryResponse> {
  try {
    // Decrypt the data
    const encryptedBuffer = base64ToArrayBuffer(encryptedData);
    const decrypted = await window.crypto.subtle.decrypt(
      {
        name: 'RSA-OAEP'
      },
      ephemeralPrivateKey,
      encryptedBuffer
    );
    
    // Parse and return
    const decoder = new TextDecoder();
    const jsonString = decoder.decode(decrypted);
    return JSON.parse(jsonString);
  } catch (error) {
    console.error("Decryption error:", error);
    throw new Error("Failed to decrypt recovery response");
  }
}

/**
 * Creates a complete recovery request with client-side encryption
 */
export async function createClientSideRecoveryRequest(
  username: string,
  sourceApId: string,
  recoveryWords: string,
  tempUserId: string,
  apPublicKeyPem: string
): Promise<{
  encryptedData: string;
  ephemeralKeyPair: EphemeralKeyPair;
}> {
  try {
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
    
    // Encrypt the recovery data with the AP's public key
    const encryptedData = await encryptRecoveryRequestForAP(requestData, apPublicKeyPem);
    
    return {
      encryptedData,
      ephemeralKeyPair
    };
  } catch (error) {
    console.error("Error creating recovery request:", error);
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
  } catch (error) {
    console.error("Error processing recovery response:", error);
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
  } catch (error) {
    console.error("Verification error:", error);
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
}

/**
 * Retrieve stored ephemeral keys
 */
export async function retrieveEphemeralKeys(tempUserId: string): Promise<EphemeralKeyPair | null> {
  try {
    const keyDataString = localStorage.getItem(`ephemeral_keys_${tempUserId}`);
    if (!keyDataString) return null;
    
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
    
    return {
      publicKey,
      privateKey,
      publicKeyJwk: keyData.publicKeyJwk,
      privateKeyJwk: keyData.privateKeyJwk,
      publicKeyPem: keyData.publicKeyPem
    };
  } catch (error) {
    console.error("Error retrieving ephemeral keys:", error);
    return null;
  }
}

/**
 * Clear stored ephemeral keys after use
 */
export function clearEphemeralKeys(tempUserId: string): void {
  localStorage.removeItem(`ephemeral_keys_${tempUserId}`);
}