import { arrayBufferToBase64, base64ToArrayBuffer } from "./util";

interface EphemeralKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
  publicKeyPem: string;
}

interface CrossAPRequest {
  encryptedData: string;
  ephemeralKeyPair: EphemeralKeyPair;
}

interface StoredKeyData {
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
  publicKeyPem: string;
  timestamp: number;
}

interface CertificateData {
  apPub: string;
  apId: string;
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

export async function generateEphemeralKeyPair(): Promise<EphemeralKeyPair> {
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
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to generate ephemeral keys: ${errorMessage}`);
  }
}

function extractPublicKeyFromCert(cert: string): string {
  try {
    const parts = cert.split('.');
    if (parts.length < 1) {
      throw new Error("Invalid certificate format");
    }
    
    const decoded = atob(parts[0]);
    const certData: CertificateData = JSON.parse(decoded);
    
    const publicKey = certData.apPub;
    if (!publicKey) {
      throw new Error("Public key not found in certificate");
    }
    
    if (!publicKey.includes('-----BEGIN PUBLIC KEY-----')) {
      throw new Error("Invalid PEM format in certificate");
    }
    
    return publicKey;
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to extract public key: ${errorMessage}`);
  }
}

async function encryptWithAPPublicKey(data: string, apPublicKeyPem: string): Promise<string> {
  try {
    const pemHeader = "-----BEGIN PUBLIC KEY-----";
    const pemFooter = "-----END PUBLIC KEY-----";
    const pemContents = apPublicKeyPem.substring(
      pemHeader.length,
      apPublicKeyPem.length - pemFooter.length
    ).replace(/\s/g, '');
    
    const binaryDer = base64ToArrayBuffer(pemContents);
    
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
    
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    
    const encrypted = await window.crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      publicKey,
      dataBuffer
    );
    
    return arrayBufferToBase64(encrypted);
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Encryption failed: ${errorMessage}`);
  }
}

export async function createCrossAPRecoveryRequest(
  username: string,
  sourceApId: string,
  recoveryWords: string,
  tempUserId: string,
  currentApCertificate: string
): Promise<CrossAPRequest> {
  try {
    const ephemeralKeyPair = await generateEphemeralKeyPair();
    const recoveryHash = await hashRecoveryWords(recoveryWords);
    
    const requestPayload = {
      tempUserId,
      realUserId: username,
      sourceApId,
      recoveryHash,
      ephemeralPublicKey: ephemeralKeyPair.publicKeyPem,
      timestamp: Date.now(),
      type: "CROSS_AP_RECOVERY_REQUEST"
    };
    
    const ap2PublicKey = extractPublicKeyFromCert(currentApCertificate);
    const encryptedPayload = await encryptWithAPPublicKey(
      JSON.stringify(requestPayload), 
      ap2PublicKey
    );
    
    return {
      encryptedData: encryptedPayload,
      ephemeralKeyPair
    };
    
  } catch (error: unknown) {
    throw error instanceof Error ? error : new Error('Unknown error in createCrossAPRecoveryRequest');
  }
}

export async function decryptRecoveryResponse(encryptedData: string, ephemeralPrivateKey: CryptoKey): Promise<any> {
  try {
    const encryptedBuffer = base64ToArrayBuffer(encryptedData);
    
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      ephemeralPrivateKey,
      encryptedBuffer
    );
    
    const decryptedText = new TextDecoder().decode(decrypted);
    return JSON.parse(decryptedText);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to decrypt recovery response: ${errorMessage}`);
  }
}

export function storeEphemeralKeys(tempUserId: string, keyPair: EphemeralKeyPair): void {
  const keyData: StoredKeyData = {
    publicKeyJwk: keyPair.publicKeyJwk,
    privateKeyJwk: keyPair.privateKeyJwk,
    publicKeyPem: keyPair.publicKeyPem,
    timestamp: Date.now()
  };
  
  localStorage.setItem(`ephemeral_keys_${tempUserId}`, JSON.stringify(keyData));
}

export async function retrieveEphemeralKeys(tempUserId: string): Promise<EphemeralKeyPair | null> {
  try {
    const keyDataString = localStorage.getItem(`ephemeral_keys_${tempUserId}`);
    if (!keyDataString) {
      return null;
    }
    
    const keyData: StoredKeyData = JSON.parse(keyDataString);
    
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
  } catch (error: unknown) {
    return null;
  }
}

export function clearEphemeralKeys(tempUserId: string): void {
  localStorage.removeItem(`ephemeral_keys_${tempUserId}`);
}