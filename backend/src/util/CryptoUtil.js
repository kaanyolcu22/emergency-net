import crypto, { createHash } from "crypto";
import { webcrypto } from 'crypto';
import {
  getAdminPublicKey,
  getAdminPrivateKey,
  getPrivateKey,
} from "../scripts/readkeys.js";

export function jsonToBase64(object) {
  const json = JSON.stringify(object);
  return Buffer.from(json).toString("base64");
}

export function base64toJson(base64String) {
  const json = Buffer.from(base64String, "base64").toString();
  return JSON.parse(json);
}

export function publicEncrypt(pubKey, token) {
  return crypto.publicEncrypt(pubKey, Buffer.from(token)).toString("base64");
}

export function publicDecrypt(pubKey, token) {
  return crypto.publicDecrypt(pubKey, Buffer.from(token, "base64")).toString();
}

export function privateEncrypt(privateKey, token) {
  return crypto
    .privateEncrypt(privateKey, Buffer.from(token))
    .toString("base64");
}

export function privateDecrypt(privateKey, encryptedToken) {
  return crypto
    .privateDecrypt(privateKey, Buffer.from(encryptedToken, "base64"))
    .toString();
}

export function sign(data) {
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(data);
  const signAlgorithm = {
    key: getPrivateKey(),
    saltLength: 0,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
  };
  return sign.sign(signAlgorithm, "base64");
}

export function pemToPrivateKeyObject(pemContent) {
  try {
    const privateKey = crypto.createPublicKey({
      key: pemContent,
      format: "pem",
      type: "spki",
    });
    return privateKey;
  } catch (error) {
    console.error("Error converting PEM to Private KeyObject:", error);
    return null;
  }
}

export function signByAdmin(data) {
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(data);
  const signAlgorithm = {
    key: getAdminPrivateKey(),
    saltLength: 0,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
  };
  sign.end();
  return sign.sign(signAlgorithm, "base64");
}

export async function verify(data, signature, publicKey) {
  try {
    if (typeof publicKey === 'string' && publicKey.includes('-----BEGIN PUBLIC KEY-----')) {
      const pubKeyObj = crypto.createPublicKey({
        key: publicKey,
        format: 'pem'
      });

      const verify = crypto.createVerify("RSA-SHA256");
      verify.update(data);
      
      return verify.verify({
        key: pubKeyObj,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 0
      }, Buffer.from(signature, 'base64'));
    }
    
    const verify = crypto.createVerify("RSA-SHA256");
    verify.update(data);
    const signAlgorithm = {
      key: publicKey,
      saltLength: 0,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    };
    
    return verify.verify(signAlgorithm, signature, "base64");
  } catch (error) {
    console.error("Verification error:", error);
    return false;
  }
}

export function hashBase64(base64String, algorithm = "sha256") {
  return createHash(algorithm).update(base64String).digest("base64");
}

export function verifyACAP(encodedData, adminSignature) {
  const stringifiedData = JSON.stringify(base64toJson(encodedData));
  return verifySync(stringifiedData, adminSignature, getAdminPublicKey());
}

export function verifySync(data, signature, publicKey) {
  try {
    if (typeof publicKey === 'string' && publicKey.includes('-----BEGIN PUBLIC KEY-----')) {
      const pubKeyObj = crypto.createPublicKey({
        key: publicKey,
        format: 'pem'
      });
      
      const verify = crypto.createVerify("RSA-SHA256");
      verify.update(data);
      
      return verify.verify({
        key: pubKeyObj,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 0
      }, Buffer.from(signature, 'base64'));
    }
    
    const verify = crypto.createVerify("RSA-SHA256");
    verify.update(data);
    const signAlgorithm = {
      key: publicKey,
      saltLength: 0,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    };
    
    return verify.verify(signAlgorithm, signature, "base64");
  } catch (error) {
    console.error("Synchronous verification error:", error);
    return false;
  }
}

export function verifyPUAP(
  encodedAPData,
  PUsignature,
  encodedPUData,
  adminSignature
) {
  const PUData = base64toJson(encodedPUData);
  const stringifiedPUData = JSON.stringify(PUData);
  if (verifySync(stringifiedPUData, adminSignature, getAdminPublicKey())) {
    const stringifiedAPData = JSON.stringify(base64toJson(encodedAPData));
    const PUkey = PUData.pubKey;
    return verifySync(stringifiedAPData, PUsignature, PUkey);
  }
  return false;
}

function verifyAPIdentity(obj1, obj2) {
  if (obj1 === undefined || obj2 === undefined) {
    return false;
  }
  return obj1.apId === obj2.apId && obj1.apPub === obj2.apPub;
}

export function comparePEMStrings(pem1, pem2) {
  const sanitizePEM = (pem) => {
    return pem
      .replace(/-----(BEGIN|END)[^-]*-----/g, "")
      .replace(/\s+/g, "");
  };

  const sanitizedPem1 = sanitizePEM(pem1);
  const sanitizedPem2 = sanitizePEM(pem2);

  return sanitizedPem1 === sanitizedPem2;
}

export async function spkiToCryptoKey(spki) {
  const encryptAlgorithm = {
    name: "RSA-OAEP",
    modulusLength: 2048,
    publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
    hash: "SHA-256",
  };

  const bufferspki = Buffer.from(spki);
  const subtleKey = await crypto.subtle.importKey(
    "spki",
    bufferspki,
    encryptAlgorithm,
    true,
    ["decrypt"]
  );
  console.log(bufferspki);
  console.log(subtleKey);
  const keyObject = crypto.KeyObject.from(subtleKey);
  return keyObject;
}

export async function keyObjectToJwk(key) {
  return key.export({ format: "jwk" });
}

export async function jwkToKeyObject(jwk) {
  const signAlgorithm = {
    name: "RSA-PSS",
    modulusLength: 2048,
    publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
    hash: "SHA-256",
    saltLength: 0,
  };

  const CryptoKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    signAlgorithm,
    true,
    ["verify"]
  );

  const keyObject = crypto.KeyObject.from(CryptoKey);
  return keyObject;
}

export function getTokenData(token) {
  if (!token) return null;
  
  try {
    const fragmentedToken = token.split(".");
    if (fragmentedToken.length < 1) return null;
    
    const encodedData = fragmentedToken[0];
    const data = base64toJson(encodedData);
    
    if (data && data.mtPubKey) {
      data.mtPubKey = data.mtPubKey.toString().trim();
    }
    
    console.log("Extracted token data:", data);
    return data;
  } catch (error) {
    console.error("Error extracting token data:", error);
    return null;
  }
}

// New functions for cross-AP recovery

/**
 * Encrypt data with AP's public key for cross-AP recovery
 */
export function encryptWithAPPublicKey(data, apPublicKeyPem) {
  try {
    const publicKey = crypto.createPublicKey({
      key: apPublicKeyPem,
      format: 'pem',
      type: 'spki'
    });
    
    const encrypted = crypto.publicEncrypt(
      {
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
      },
      Buffer.from(data)
    );
    
    return encrypted.toString('base64');
  } catch (error) {
    console.error("Encryption with AP public key failed:", error);
    throw error;
  }
}

/**
 * Decrypt data with AP's private key for cross-AP recovery
 */
export function decryptWithAPPrivateKey(encryptedData) {
  try {
    const decrypted = crypto.privateDecrypt(
      {
        key: getPrivateKey(),
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
      },
      Buffer.from(encryptedData, 'base64')
    );
    
    return decrypted.toString();
  } catch (error) {
    console.error("Decryption with AP private key failed:", error);
    throw error;
  }
}

/**
 * Encrypt data with ephemeral public key (PEM format)
 */
export function encryptWithEphemeralKey(data, ephemeralPublicKeyPem) {
  try {
    const publicKey = crypto.createPublicKey({
      key: ephemeralPublicKeyPem,
      format: 'pem',
      type: 'spki'
    });
    
    const encrypted = crypto.publicEncrypt(
      {
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
      },
      Buffer.from(data)
    );
    
    return encrypted.toString('base64');
  } catch (error) {
    console.error("Encryption with ephemeral key failed:", error);
    throw error;
  }
}

/**
 * Hash data for cross-AP recovery verification
 */
export function hashForRecovery(data, salt = null) {
  const hash = crypto.createHash('sha256');
  hash.update(data);
  if (salt) {
    hash.update(salt);
  }
  return hash.digest('base64');
}

/**
 * Generate random salt for recovery operations
 */
export function generateSalt() {
  return crypto.randomBytes(16).toString('base64');
}