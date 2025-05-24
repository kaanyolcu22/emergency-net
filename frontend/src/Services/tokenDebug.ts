// src/Services/tokenDebug.ts - Debug and fix token issues

import { getCookie } from "typescript-cookie";

export function debugTokenFormat() {
  console.log("=== TOKEN DEBUG ===");
  
  // Check all possible token sources
  const cookieToken = getCookie("token");
  const emergencyToken = localStorage.getItem("emergency_token");
  const storedToken = localStorage.getItem("token");
  
  console.log("Token sources:");
  console.log("Cookie token exists:", !!cookieToken);
  console.log("Emergency token exists:", !!emergencyToken);
  console.log("Stored token exists:", !!storedToken);
  
  // Check the formats
  const tokens = [
    { name: "Cookie", token: cookieToken },
    { name: "Emergency", token: emergencyToken },
    { name: "Stored", token: storedToken }
  ];
  
  tokens.forEach(({ name, token }) => {
    if (token) {
      console.log(`\n${name} token analysis:`);
      console.log("Length:", token.length);
      console.log("First 50 chars:", token.substring(0, 50) + "...");
      
      const fragments = token.split(".");
      console.log("Fragment count:", fragments.length);
      console.log("Fragment lengths:", fragments.map(f => f.length));
      
      if (fragments.length >= 3) {
        console.log("✅ Token format appears correct");
        
        // Try to decode the first fragment (user data)
        try {
          const userData = JSON.parse(atob(fragments[0]));
          console.log("User data:", {
            username: userData.mtUsername,
            ap: userData.apReg,
            hasPublicKey: !!userData.mtPubKey
          });
        } catch (e) {
          console.log("❌ Failed to decode user data:", e.message);
        }
      } else {
        console.log("❌ Token format incorrect - needs at least 3 fragments");
      }
    }
  });
  
  console.log("=== TOKEN DEBUG END ===");
  
  // Return the best token to use
  return cookieToken || emergencyToken || storedToken;
}

export function fixTokenAuth() {
  console.log("=== FIXING TOKEN AUTH ===");
  
  const bestToken = debugTokenFormat();
  
  if (bestToken) {
    // Make sure it's in the right places
    if (!getCookie("token")) {
      console.log("Setting token in cookie");
      document.cookie = `token=${bestToken}; path=/; max-age=31536000`; // 1 year
    }
    
    if (!localStorage.getItem("emergency_token")) {
      console.log("Setting emergency token");
      localStorage.setItem("emergency_token", bestToken);
    }
    
    console.log("✅ Token auth fixed");
    return bestToken;
  } else {
    console.log("❌ No valid token found");
    return null;
  }
}