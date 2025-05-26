// Enhanced authMiddleware.js with detailed debugging
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

const PUBLIC_ROUTES = ['/get-password', '/register'];

export const authMiddleware = async (req, res, next) => {
  console.log(`\n=== AUTH MIDDLEWARE DEBUG for ${req.method} ${req.path} ===`);
  
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
      console.log("⚠️ Admin public key not available - non-applicable mode");
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
    
    console.log("🎫 Token found, length:", token.length);
    console.log("🎫 Token preview:", token.substring(0, 50) + "...");
    
    // Enhanced token parsing with error handling
    let tokenData;
    try {
      tokenData = await getTokenData(token);
      console.log("📋 Token data extracted:");
      console.log("   - Username:", tokenData?.mtUsername);
      console.log("   - AP:", tokenData?.apReg);
      console.log("   - Has PubKey:", !!tokenData?.mtPubKey);
      console.log("   - PubKey preview:", tokenData?.mtPubKey?.substring(0, 100) + "...");
    } catch (tokenError) {
      console.error("❌ Token parsing failed:", tokenError);
      throw new Error(`Token parsing failed: ${tokenError.message}`);
    }

    // Token verification with detailed logging
    console.log("🔍 Starting token verification...");
    const tokenVerification = await verifyToken(token, auth.applicable);
    
    console.log("🔍 Token verification results:");
    console.log("   - Token verified:", tokenVerification.isTokenVerified);
    console.log("   - AP verified:", tokenVerification.isApVerified);
    console.log("   - Reason:", tokenVerification.reason || "none");
    
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
        console.log("   - Has signature:", !!req.body?.signature);
        console.log("   - Has content:", !!req.body?.content);
        console.log("   - Body keys:", Object.keys(req.body || {}));
        throw new Error("There is no content or signature in body.");
      }
      
      // Detailed content and signature logging
      const contentToVerify = JSON.stringify(req.body.content);
      console.log("🔍 Content verification details:");
      console.log("   - Content length:", contentToVerify.length);
      console.log("   - Content preview:", contentToVerify.substring(0, 200) + "...");
      console.log("   - Signature length:", req.body.signature?.length);
      console.log("   - Signature preview:", req.body.signature?.substring(0, 50) + "...");
      
      // Public key analysis
      if (tokenData.mtPubKey) {
        console.log("🔑 Public key analysis:");
        console.log("   - Key length:", tokenData.mtPubKey.length);
        console.log("   - Key format check:", tokenData.mtPubKey.includes('-----BEGIN PUBLIC KEY-----'));
        console.log("   - Key preview:", tokenData.mtPubKey.substring(0, 100).replace(/\n/g, '\\n'));
      }
      
      // Skip verification for sync in development mode
      if (req.path === '/sync' && process.env.NODE_ENV === 'development') {
        console.log("🚧 DEVELOPMENT: Bypassing content verification for sync");
        auth.contentVerified = true;
      } else {
        console.log("🔐 Performing signature verification...");
        
        try {
          auth.contentVerified = await verify(
            contentToVerify,
            req.body.signature,
            tokenData.mtPubKey
          );
          
          console.log("🔐 Signature verification result:", auth.contentVerified);
          
          if (!auth.contentVerified) {
            console.error("❌ Content signature verification failed");
            console.log("Debug info for signature failure:");
            console.log("   - Content string exact:", JSON.stringify(contentToVerify));
            console.log("   - Signature exact:", req.body.signature);
            console.log("   - Public key exact:", tokenData.mtPubKey);
            
            // Additional debugging: try to identify the issue
            console.log("🔍 Additional signature debugging:");
            
            // Check if it's a content serialization issue
            const alternativeContent = JSON.stringify(req.body.content, null, 0);
            if (alternativeContent !== contentToVerify) {
              console.log("⚠️ Content serialization difference detected!");
              console.log("   - Original:", contentToVerify.substring(0, 100));
              console.log("   - Alternative:", alternativeContent.substring(0, 100));
            }
            
            throw new Error("Content signature is invalid.");
          }
          
          console.log("✅ Content signature verified successfully");
          
        } catch (verifyError) {
          console.error("❌ Signature verification error:", verifyError);
          throw new Error(`Signature verification failed: ${verifyError.message}`);
        }
      }
    } else {
      console.log("📖 GET request - skipping content verification");
      auth.contentVerified = true;
    }
    
    // PU certificate verification
    if (req.body?.pu_cert) {
      console.log("🎯 Processing PU certificate...");
      
      if (tokenData.mtUsername && tokenData.apReg) {
        let nickname = tokenData.mtUsername + "@" + tokenData.apReg;
        console.log("🔍 Checking blacklist for:", nickname);
        
        if (await AppDataSource.manager.findOneBy(BlacklistedPU, { puNickname: nickname })) {
          console.error("❌ PU is blacklisted:", nickname);
          auth.puVerified = false;
          throw new Error("PU is blacklisted.");
        }
      }
      
      auth.puCert = req.body.pu_cert;
      const fragmentedPUCert = req.body.pu_cert.split(".");
      
      if (fragmentedPUCert.length != 2) {
        console.error("❌ PU certificate format invalid:", fragmentedPUCert.length, "parts");
        throw new Error("PU certificate is not in the correct format.");
      }
      
      let puContent = base64toJson(fragmentedPUCert[0]);
      let puSignature = fragmentedPUCert[1];
      
      console.log("🎯 PU certificate content:", puContent);
      
      if (!puContent.pubKey) {
        console.error("❌ PU certificate missing public key");
        throw new Error("PU certificate does not contain public key.");
      }
      
      let pu_pub_cert = puContent.pubKey;
      let pu_pub_token = tokenVerification.mtPubKey ? tokenVerification.mtPubKey : "";
      
      console.log("🔑 PU key comparison:");
      console.log("   - Cert key length:", pu_pub_cert?.length);
      console.log("   - Token key length:", pu_pub_token?.length);
      
      if (!comparePEMStrings(pu_pub_cert, pu_pub_token)) {
        console.error("❌ PU certificate public key mismatch");
        console.log("   - PU cert key preview:", pu_pub_cert?.substring(0, 100));
        console.log("   - Token key preview:", pu_pub_token?.substring(0, 100));
        throw new Error("PU certificate does not match token.");
      }
      
      if (auth.applicable) {
        console.log("🔐 Verifying PU certificate with admin key...");
        auth.puVerified = await verify(
          JSON.stringify(puContent),
          puSignature,
          getAdminPublicKey()
        );
        console.log("🔐 PU verification result:", auth.puVerified);
      } else {
        console.log("⚠️ Admin key not applicable - skipping PU verification");
        auth.puVerified = false;
      }
      
      if (!req.body) {
        throw new Error("There is no body.");
      }
    }
    
    // Merge authentication data
    auth = { ...tokenData, ...auth };
    
    // Extract content from nested structure if present
    if (req.body && req.body.content) {
      console.log("📦 Extracting content from nested request body");
      req.body = req.body.content;
    }
    
    req.auth = auth;
    
    console.log("✅ Authentication successful:");
    console.log("   - Token verified:", auth.tokenVerified);
    console.log("   - Content verified:", auth.contentVerified);
    console.log("   - AP verified:", auth.apVerified);
    console.log("   - PU verified:", auth.puVerified);
    console.log("   - Username:", auth.mtUsername);
    console.log("=== END AUTH MIDDLEWARE DEBUG ===\n");
    
    next();
    
  } catch (err) {
    console.error("❌ Authentication failed:", err.message);
    
    if (req.path !== '/hello' || (req.path === '/hello' && err.message !== "Token does not exist")) {
      console.error("Full error details:", err);
    }
    
    auth.errorMessage = err.message;
    
    // Extract content from nested structure if present
    if (req.body && req.body.content) {
      req.body = req.body.content;
    }
    
    req.auth = auth;
    
    console.log("❌ Authentication failed summary:");
    console.log("   - Error:", auth.errorMessage);
    console.log("   - Token verified:", auth.tokenVerified);
    console.log("   - Content verified:", auth.contentVerified);
    console.log("   - AP verified:", auth.apVerified);
    console.log("=== END AUTH MIDDLEWARE DEBUG (FAILED) ===\n");
    
    next();
  }
};