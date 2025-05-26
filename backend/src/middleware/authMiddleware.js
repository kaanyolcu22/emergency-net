// Production-ready authMiddleware.js - Remove development bypass, add proper fixes

import {
  base64toJson,
  comparePEMStrings,
  getTokenData,
  verify,
} from "../util/CryptoUtil.js";
import { verifyToken } from "../util/HelloUtil.js";
import { getAdminPublicKey } from "../scripts/readkeys.js";
import { AppDataSource } from "../database/newDbSetup.js";
import { BlacklistedPU } from "../database/entity/BlacklistedPU.js";

const PUBLIC_ROUTES = ['/get-password', '/register', '/recover-identity', '/emergency-sync'];

export const authMiddleware = async (req, res, next) => {
  console.log(`\n=== AUTH MIDDLEWARE for ${req.method} ${req.path} ===`);
  
  if (PUBLIC_ROUTES.includes(req.path)) {
    console.log("✅ Public route - skipping auth");
    return next();
  }

  let auth = {
    tokenVerified: false,
    contentVerified: false,
    apVerified: "INVALID",
    puVerified: false,
    errorMessage: "",
    puCert: "",
    applicable: true,
  };
  
  try {
    if (getAdminPublicKey() === null) {
      auth.applicable = false;
      console.log("⚠️ Admin public key not available");
    }
    
    const token = req.header("authorization");
    
    if (!token) {
      console.log("❌ No token in Authorization header");
      if (req.path === '/hello') {
        auth.errorMessage = "Token does not exist";
        req.auth = auth;
        return next();
      } else {
        throw new Error("Token does not exist");
      }
    }
    
    console.log("🎫 Token found");
    
    // Parse token data with better error handling
    let tokenData;
    try {
      tokenData = await getTokenData(token);
      console.log("📋 Token data extracted for user:", tokenData?.mtUsername);
    } catch (tokenError) {
      console.error("❌ Token parsing failed:", tokenError.message);
      throw new Error(`Invalid token format: ${tokenError.message}`);
    }

    // Verify token
    const tokenVerification = await verifyToken(token, auth.applicable);
    auth.tokenVerified = tokenVerification.isTokenVerified;
    auth.apVerified = tokenVerification.isApVerified;
    
    if (!auth.tokenVerified) {
      console.error("❌ Token verification failed:", tokenVerification.reason);
      throw new Error(tokenVerification.reason || "Token verification failed");
    }
    
    console.log("✅ Token verified successfully");
    
    // Content verification for non-GET requests
    if (req.method !== 'GET') {
      console.log("📦 Processing content verification for", req.method, "request");
      
      if (!req.body?.signature || !req.body?.content) {
        console.error("❌ Missing signature or content in request body");
        throw new Error("Request must include both content and signature");
      }
      
      const contentToVerify = JSON.stringify(req.body.content);
      
      console.log("🔐 Performing signature verification...");
      console.log("   - Content length:", contentToVerify.length);
      console.log("   - Using public key from token");
      
      try {
        auth.contentVerified = await verify(
          contentToVerify,
          req.body.signature,
          tokenData.mtPubKey
        );
        
        console.log("🔐 Signature verification result:", auth.contentVerified);
        
        if (!auth.contentVerified) {
          console.error("❌ Content signature verification failed");
          
          // Provide helpful error message for key mismatch
          throw new Error(
            "Content signature verification failed. This usually indicates a key mismatch. " +
            "Your local signing key doesn't match the public key in your authentication token. " +
            "Please try logging out and logging back in, or use account recovery if available."
          );
        }
        
        console.log("✅ Content signature verified successfully");
        
      } catch (verifyError) {
        console.error("❌ Signature verification error:", verifyError.message);
        throw new Error(`Signature verification failed: ${verifyError.message}`);
      }
    } else {
      console.log("📖 GET request - skipping content verification");
      auth.contentVerified = true;
    }
    
    // Handle PU certificate verification (unchanged)
    if (req.body?.pu_cert) {
      console.log("🎯 Processing PU certificate...");
      
      if (tokenData.mtUsername && tokenData.apReg) {
        let nickname = tokenData.mtUsername + "@" + tokenData.apReg;
        if (await AppDataSource.manager.findOneBy(BlacklistedPU, { puNickname: nickname })) {
          throw new Error("User is blacklisted");
        }
      }
      
      auth.puCert = req.body.pu_cert;
      const fragmentedPUCert = req.body.pu_cert.split(".");
      
      if (fragmentedPUCert.length !== 2) {
        throw new Error("Invalid PU certificate format");
      }
      
      let puContent = base64toJson(fragmentedPUCert[0]);
      let puSignature = fragmentedPUCert[1];
      
      if (!puContent.pubKey) {
        throw new Error("PU certificate missing public key");
      }
      
      let pu_pub_cert = puContent.pubKey;
      let pu_pub_token = tokenVerification.mtPubKey || "";
      
      if (!comparePEMStrings(pu_pub_cert, pu_pub_token)) {
        throw new Error("PU certificate public key mismatch");
      }
      
      if (auth.applicable) {
        auth.puVerified = await verify(
          JSON.stringify(puContent),
          puSignature,
          getAdminPublicKey()
        );
      }
    }
    
    // Merge authentication data
    auth = { ...tokenData, ...auth };
    
    // Extract content from nested structure
    if (req.body?.content) {
      req.body = req.body.content;
    }
    
    req.auth = auth;
    
    console.log("✅ Authentication successful");
    console.log("=== END AUTH MIDDLEWARE ===\n");
    
    next();
    
  } catch (err) {
    console.error("❌ Authentication failed:", err.message);
    
    auth.errorMessage = err.message;
    
    if (req.body?.content) {
      req.body = req.body.content;
    }
    
    req.auth = auth;
    console.log("=== END AUTH MIDDLEWARE (FAILED) ===\n");
    
    next();
  }
};