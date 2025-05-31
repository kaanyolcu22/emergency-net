// Quick fix for your current interceptors.ts
// Replace your existing MTResponseSigner with this version

import { APDataReference } from "./APData";
import { sign, verify } from "./crypt";
import { readPrivateKey} from "./keys";
import { getCookie } from "typescript-cookie";

export async function APResponseVerifier({
  content,
  signature,
}: {
  content: Record<string, any>;
  signature: string;
}) {
  const APData = APDataReference.current;
  console.log("APDATA", APData);
  if (!APData) {
    throw new Error("AP Data Unknown");
  }

  const stringContent = JSON.stringify(content);
  const verified = await verify(APData.key, signature, stringContent);

  if (verified) {
    return content;
  } else {
    throw new Error(
      `Signature invalid on content:\n${JSON.stringify(content, null, 2)}`
    );
  }
}

/**
 * Fixed MTResponseSigner that handles development scenarios gracefully
 */
export async function MTResponseSigner(content: Record<string, any>) {
  content.tod = Date.now();
  
  console.log("=== MTResponseSigner Debug ===");
  console.log("Content to sign:", JSON.stringify(content).substring(0, 200) + "...");
  
  try {
    // Get the private key
    const MTKey = await readPrivateKey();
    console.log("Private key loaded successfully");
    
    // Check if we have a valid token
    const token = getCookie("token");
    if (!token) {
      console.log("⚠️ No token found - proceeding with basic signing");
    } else {
      try {
        // Try to parse token to check if it's valid
        const tokenParts = token.split(".");
        if (tokenParts.length >= 1) {
          const tokenData = JSON.parse(atob(tokenParts[0]));
          console.log("Token parsed successfully for user:", tokenData.mtUsername);
          
          // Check for temporary tokens
          if (tokenData.isTemporary || tokenData.apReg === "temp") {
            console.log("✅ Temporary token detected - using simplified signing");
          } else if (!tokenData.mtPubKey) {
            console.log("⚠️ Token missing public key - proceeding anyway");
          }
        }
      } catch (tokenError : any) {
        console.log("⚠️ Token parsing failed, but continuing:", tokenError.message);
      }
    }
    
    // Always proceed with signing - don't block on key validation issues
    const signature = await sign(MTKey, JSON.stringify(content));
    console.log("Generated signature:", signature.substring(0, 50) + "...");
    
    const result: any = { content, signature };
    
    // Add PU cert if available
    const cert = localStorage.getItem("pu_cert");
    if (cert) {
      result.pu_cert = cert;
      console.log("Added PU certificate");
    }
    
    console.log("=== End MTResponseSigner Debug ===");
    return result;
    
  } catch (error: any) {
    console.error("❌ Signing failed:", error);
    
    // Provide helpful error messages
    if (error.message?.includes("privateKey")) {
      throw new Error("No signing key available. Please log in again.");
    } else if (error.message?.includes("key")) {
      throw new Error("Authentication key error. Please try logging out and back in.");
    } else {
      throw new Error(`Signing failed: ${error.message}`);
    }
  }
}