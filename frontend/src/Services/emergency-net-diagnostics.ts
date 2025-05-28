// src/Services/emergency-net-diagnostics.ts
// Comprehensive diagnostic tool for EmergencyNet authentication issues

import { getCookie } from "typescript-cookie";
import { jwkToKey } from "@/Library/crypt";
import { base64ToJson } from "@/Library/util";

interface DiagnosticResult {
  category: string;
  status: 'success' | 'warning' | 'error';
  message: string;
  details?: any;
}

/**
 * Run comprehensive diagnostics on the authentication system
 * This helps identify exactly what's causing signature verification failures
 */
export async function runEmergencyNetDiagnostics(): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];
  
  console.log("🔍 Starting EmergencyNet Authentication Diagnostics...");
  console.log("=" .repeat(60));
  
  // Test 1: Token Presence and Format
  await diagnoseTokenPresence(results);
  
  // Test 2: Token Structure and Content
  await diagnoseTokenStructure(results);
  
  // Test 3: Local Key Storage
  await diagnoseLocalKeys(results);
  
  // Test 4: Key Format and Validity
  await diagnoseKeyValidity(results);
  
  // Test 5: Key Pair Consistency
  await diagnoseKeyConsistency(results);
  
  // Test 6: Token-Key Compatibility
  await diagnoseTokenKeyCompatibility(results);
  
  // Test 7: Signature Generation Test
  await diagnoseSignatureGeneration(results);
  
  // Test 8: End-to-End Authentication Test
  await diagnoseEndToEndAuth(results);
  
  // Print comprehensive report
  printDiagnosticReport(results);
  
  return results;
}

/**
 * Test 1: Check if authentication tokens exist and are accessible
 */
async function diagnoseTokenPresence(results: DiagnosticResult[]) {
  const cookieToken = getCookie("token");
  const emergencyToken = localStorage.getItem("emergency_token");
  const storedToken = localStorage.getItem("token");
  
  const tokenSources = [
    { name: "Cookie", token: cookieToken },
    { name: "Emergency", token: emergencyToken },
    { name: "LocalStorage", token: storedToken }
  ];
  
  const availableTokens = tokenSources.filter(source => source.token);
  
  if (availableTokens.length === 0) {
    results.push({
      category: "Token Presence",
      status: "error",
      message: "No authentication tokens found",
      details: "User needs to register or log in"
    });
  } else {
    results.push({
      category: "Token Presence",
      status: "success",
      message: `Found ${availableTokens.length} token(s)`,
      details: availableTokens.map(t => `${t.name}: ${t.token?.substring(0, 20)}...`)
    });
  }
}

/**
 * Test 2: Analyze token structure and extract user data
 */
async function diagnoseTokenStructure(results: DiagnosticResult[]) {
  const token = getCookie("token") || localStorage.getItem("emergency_token");
  
  if (!token) {
    results.push({
      category: "Token Structure",
      status: "error",
      message: "No token available for structure analysis"
    });
    return;
  }
  
  try {
    const tokenParts = token.split(".");
    
    if (tokenParts.length < 3) {
      results.push({
        category: "Token Structure",
        status: "error",
        message: `Invalid token format - has ${tokenParts.length} parts, needs at least 3`,
        details: `Token parts: ${tokenParts.map((p, i) => `Part ${i}: ${p.length} chars`)}`
      });
      return;
    }
    
    // Try to decode the user data portion
    const userData = JSON.parse(atob(tokenParts[0]));
    
    results.push({
      category: "Token Structure",
      status: "success",
      message: "Token structure is valid",
      details: {
        totalParts: tokenParts.length,
        username: userData.mtUsername,
        apId: userData.apReg,
        hasPublicKey: !!userData.mtPubKey,
        isTemporary: !!userData.isTemporary,
        registrationTime: new Date(userData.todReg).toISOString()
      }
    });
    
  } catch (error) {
    results.push({
      category: "Token Structure",
      status: "error",
      message: "Failed to parse token data",
      details: error.message
    });
  }
}

/**
 * Test 3: Check local cryptographic key storage
 */
async function diagnoseLocalKeys(results: DiagnosticResult[]) {
  const privateKeyJwk = localStorage.getItem("privateKey");
  const publicKeyJwk = localStorage.getItem("publicKey");
  const adminKey = localStorage.getItem("adminKey");
  const puCert = localStorage.getItem("pu_cert");
  
  const keyStatus = {
    privateKey: !!privateKeyJwk,
    publicKey: !!publicKeyJwk,
    adminKey: !!adminKey,
    puCertificate: !!puCert
  };
  
  const missingKeys = Object.entries(keyStatus)
    .filter(([key, exists]) => !exists)
    .map(([key]) => key);
  
  if (missingKeys.length > 0) {
    results.push({
      category: "Local Key Storage",
      status: "warning",
      message: `Missing keys: ${missingKeys.join(", ")}`,
      details: keyStatus
    });
  } else {
    results.push({
      category: "Local Key Storage",
      status: "success",
      message: "All expected keys are present",
      details: keyStatus
    });
  }
}

/**
 * Test 4: Validate the format and structure of stored keys
 */
async function diagnoseKeyValidity(results: DiagnosticResult[]) {
  const privateKeyJwk = localStorage.getItem("privateKey");
  const publicKeyJwk = localStorage.getItem("publicKey");
  
  if (!privateKeyJwk || !publicKeyJwk) {
    results.push({
      category: "Key Validity",
      status: "error",
      message: "Cannot validate keys - private or public key missing"
    });
    return;
  }
  
  try {
    // Try to parse as JSON
    const privateKey = JSON.parse(privateKeyJwk);
    const publicKey = JSON.parse(publicKeyJwk);
    
    // Check JWK structure
    const privateKeyValid = privateKey.kty === "RSA" && privateKey.n && privateKey.d;
    const publicKeyValid = publicKey.kty === "RSA" && publicKey.n && publicKey.e;
    
    if (!privateKeyValid || !publicKeyValid) {
      results.push({
        category: "Key Validity",
        status: "error",
        message: "Invalid JWK structure",
        details: {
          privateKeyValid,
          publicKeyValid,
          privateKeyFields: Object.keys(privateKey),
          publicKeyFields: Object.keys(publicKey)
        }
      });
      return;
    }
    
    // Try to import the keys
    await jwkToKey(privateKey);
    await jwkToKey(publicKey);
    
    results.push({
      category: "Key Validity",
      status: "success",
      message: "Local keys are valid and importable",
      details: {
        privateKeyModulusLength: privateKey.n?.length || 0,
        publicKeyModulusLength: publicKey.n?.length || 0,
        keyAlgorithm: privateKey.alg || "RSA-PSS"
      }
    });
    
  } catch (error) {
    results.push({
      category: "Key Validity",
      status: "error",
      message: "Key validation failed",
      details: error.message
    });
  }
}

/**
 * Test 5: Verify that the local key pair is mathematically consistent
 */
async function diagnoseKeyConsistency(results: DiagnosticResult[]) {
  try {
    const privateKeyJwk = JSON.parse(localStorage.getItem("privateKey")!);
    const publicKeyJwk = JSON.parse(localStorage.getItem("publicKey")!);
    
    const privateKey = await jwkToKey(privateKeyJwk);
    const publicKey = await jwkToKey(publicKeyJwk);
    
    // Test message
    const testMessage = "EmergencyNet Key Consistency Test " + Date.now();
    
    // Sign with private key
    const signature = await signTestMessage(privateKey, testMessage);
    
    // Verify with public key
    const isValid = await verifyTestMessage(publicKey, signature, testMessage);
    
    if (isValid) {
      results.push({
        category: "Key Consistency",
        status: "success",
        message: "Local key pair is mathematically consistent",
        details: "Private key can sign, public key can verify"
      });
    } else {
      results.push({
        category: "Key Consistency",
        status: "error",
        message: "Local key pair is inconsistent",
        details: "Signature created by private key cannot be verified by public key"
      });
    }
    
  } catch (error) {
    results.push({
      category: "Key Consistency",
      status: "error",
      message: "Key consistency test failed",
      details: error.message
    });
  }
}

/**
 * Test 6: Check if local keys match the public key in the token
 */
async function diagnoseTokenKeyCompatibility(results: DiagnosticResult[]) {
  try {
    const token = getCookie("token") || localStorage.getItem("emergency_token");
    if (!token) {
      results.push({
        category: "Token-Key Compatibility",
        status: "error",
        message: "No token available for compatibility check"
      });
      return;
    }
    
    const tokenData = JSON.parse(atob(token.split(".")[0]));
    
    if (tokenData.isTemporary || !tokenData.mtPubKey) {
      results.push({
        category: "Token-Key Compatibility",
        status: "success",
        message: "Temporary token - key compatibility check skipped",
        details: "Temporary tokens don't require key matching"
      });
      return;
    }
    
    // Get local keys
    const privateKeyJwk = JSON.parse(localStorage.getItem("privateKey")!);
    const localPrivateKey = await jwkToKey(privateKeyJwk);
    
    // Import token's public key
    const tokenPublicKey = await importPublicKeyFromPem(tokenData.mtPubKey);
    
    // Test compatibility
    const testMessage = "Token compatibility test " + Date.now();
    const signature = await signTestMessage(localPrivateKey, testMessage);
    const isCompatible = await verifyTestMessage(tokenPublicKey, signature, testMessage);
    
    if (isCompatible) {
      results.push({
        category: "Token-Key Compatibility",
        status: "success",
        message: "Local private key matches token's public key",
        details: "Signatures will verify correctly"
      });
    } else {
      results.push({
        category: "Token-Key Compatibility",
        status: "error",
        message: "KEY MISMATCH DETECTED - This is the source of your authentication problem",
        details: {
          issue: "Local private key doesn't match token's public key",
          impact: "All authenticated requests will fail signature verification",
          solution: "Use the key synchronization fix to resolve this"
        }
      });
    }
    
  } catch (error) {
    results.push({
      category: "Token-Key Compatibility",
      status: "error",
      message: "Token-key compatibility check failed",
      details: error.message
    });
  }
}

/**
 * Test 7: Test the signature generation process
 */
async function diagnoseSignatureGeneration(results: DiagnosticResult[]) {
  try {
    const { MTResponseSigner } = await import("@/Library/interceptors");
    
    const testContent = {
      test: true,
      message: "Diagnostic signature test",
      timestamp: Date.now()
    };
    
    const result = await MTResponseSigner(testContent);
    
    if (result.content && result.signature) {
      results.push({
        category: "Signature Generation",
        status: "success",
        message: "MTResponseSigner is working correctly",
        details: {
          contentSigned: !!result.content,
          signatureGenerated: !!result.signature,
          signatureLength: result.signature.length,
          hasPUCert: !!result.pu_cert
        }
      });
    } else {
      results.push({
        category: "Signature Generation",
        status: "error",
        message: "MTResponseSigner did not produce expected output",
        details: result
      });
    }
    
  } catch (error) {
    results.push({
      category: "Signature Generation",
      status: "error",
      message: "Signature generation failed",
      details: error.message
    });
  }
}

/**
 * Test 8: Attempt a real authentication request to test end-to-end
 */
async function diagnoseEndToEndAuth(results: DiagnosticResult[]) {
  try {
    const { hello } = await import("@/Services/hello");
    
    const token = getCookie("token") || localStorage.getItem("emergency_token");
    const response = await hello(token);
    
    if (response.status === 200) {
      results.push({
        category: "End-to-End Authentication",
        status: "success",
        message: "Authentication is working correctly",
        details: {
          responseStatus: response.status,
          responseType: response.data?.content?.type
        }
      });
    } else {
      results.push({
        category: "End-to-End Authentication",
        status: "warning",
        message: `Unexpected response status: ${response.status}`,
        details: response.data
      });
    }
    
  } catch (error) {
    if (error.response?.status === 400 && 
        error.response?.data?.content?.error?.includes("signature")) {
      results.push({
        category: "End-to-End Authentication",
        status: "error",
        message: "SIGNATURE VERIFICATION FAILED - This confirms the key mismatch issue",
        details: {
          serverError: error.response.data.content.error,
          recommendation: "Use the key synchronization fix to resolve this issue"
        }
      });
    } else {
      results.push({
        category: "End-to-End Authentication",
        status: "error",
        message: "Authentication request failed",
        details: error.response?.data || error.message
      });
    }
  }
}

/**
 * Helper function to sign a test message
 */
async function signTestMessage(privateKey: CryptoKey, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  
  const signature = await crypto.subtle.sign(
    {
      name: "RSA-PSS",
      saltLength: 0,
    },
    privateKey,
    data
  );
  
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/**
 * Helper function to verify a test message signature
 */
async function verifyTestMessage(publicKey: CryptoKey, signature: string, message: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const signatureBuffer = base64ToArrayBuffer(signature);
    
    return await crypto.subtle.verify(
      {
        name: "RSA-PSS",
        saltLength: 0,
      },
      publicKey,
      signatureBuffer,
      data
    );
  } catch (error) {
    return false;
  }
}

/**
 * Helper function to import PEM public key
 */
async function importPublicKeyFromPem(pem: string): Promise<CryptoKey> {
  const pemHeader = "-----BEGIN PUBLIC KEY-----";
  const pemFooter = "-----END PUBLIC KEY-----";
  const pemContents = pem.substring(
    pemHeader.length,
    pem.length - pemFooter.length
  ).replace(/\s/g, '');
  
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
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Print a comprehensive diagnostic report
 */
function printDiagnosticReport(results: DiagnosticResult[]) {
  console.log("\n" + "=".repeat(60));
  console.log("🔍 EMERGENCYNET AUTHENTICATION DIAGNOSTIC REPORT");
  console.log("=".repeat(60));
  
  const successCount = results.filter(r => r.status === 'success').length;
  const warningCount = results.filter(r => r.status === 'warning').length;
  const errorCount = results.filter(r => r.status === 'error').length;
  
  console.log(`\n📊 SUMMARY: ${successCount} ✅ | ${warningCount} ⚠️  | ${errorCount} ❌`);
  
  console.log("\n📋 DETAILED RESULTS:");
  
  results.forEach((result, index) => {
    const icon = result.status === 'success' ? '✅' : 
                 result.status === 'warning' ? '⚠️' : '❌';
    
    console.log(`\n${index + 1}. ${icon} ${result.category}`);
    console.log(`   ${result.message}`);
    
    if (result.details) {
      console.log(`   Details:`, result.details);
    }
  });
  
  // Provide recommendations based on results
  console.log("\n" + "=".repeat(60));
  console.log("💡 RECOMMENDATIONS:");
  
  const hasKeyMismatch = results.some(r => 
    r.category === "Token-Key Compatibility" && r.status === 'error'
  );
  
  const hasSignatureFailure = results.some(r => 
    r.category === "End-to-End Authentication" && 
    r.message.includes("SIGNATURE VERIFICATION FAILED")
  );
  
  if (hasKeyMismatch || hasSignatureFailure) {
    console.log("🎯 PRIMARY ISSUE: Key mismatch detected");
    console.log("🔧 SOLUTION: Use the EmergencyNet Key Synchronization Fix");
    console.log("   1. Import the fix: import { fixEmergencyNetKeySync } from '@/Library/emergency-key-sync-fix'");
    console.log("   2. Run the fix: await fixEmergencyNetKeySync()");
    console.log("   3. The fix will automatically regenerate keys and update your token");
  } else if (errorCount === 0) {
    console.log("✅ GOOD NEWS: No critical issues detected");
    console.log("   Your authentication system appears to be working correctly");
  } else {
    console.log("⚠️  MIXED RESULTS: Some issues detected");
    console.log("   Review the detailed results above for specific recommendations");
  }
  
  console.log("=".repeat(60));
}

/**
 * Quick diagnostic function for immediate use in browser console
 */
export async function quickDiagnostic() {
  console.log("🚀 Running Quick EmergencyNet Diagnostic...");
  
  const token = getCookie("token") || localStorage.getItem("emergency_token");
  const hasPrivateKey = !!localStorage.getItem("privateKey");
  const hasPublicKey = !!localStorage.getItem("publicKey");
  
  console.log("Token present:", !!token);
  console.log("Private key present:", hasPrivateKey);
  console.log("Public key present:", hasPublicKey);
  
  if (token && hasPrivateKey && hasPublicKey) {
    try {
      const { MTResponseSigner } = await import("@/Library/interceptors");
      const testResult = await MTResponseSigner({ test: true, timestamp: Date.now() });
      console.log("✅ Signature generation: SUCCESS");
      console.log("Signature:", testResult.signature?.substring(0, 20) + "...");
    } catch (error) {
      console.log("❌ Signature generation: FAILED");
      console.log("Error:", error.message);
    }
  }
  
  console.log("\nFor detailed diagnostics, run: runEmergencyNetDiagnostics()");
}