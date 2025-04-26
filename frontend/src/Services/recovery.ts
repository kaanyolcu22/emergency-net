import { getApiURL } from "@/Library/getApiURL";
import axios from "axios";  
import { setCookie } from "typescript-cookie";
import { emergencySync } from "./sync";

export async function recoverIdentity(recoveryData) {
  try {
    const content = {
      username: recoveryData.username,
      apIdentifier: recoveryData.apIdentifier,
      recoveryWords: recoveryData.recoveryWords,
      tod: Date.now(),
      type: "MT_RECOVERY",
      priority: 1
    };
    
    console.log("Sending recovery request:", {
      username: content.username,
      apIdentifier: content.apIdentifier,
      wordCount: content.recoveryWords.split(" ").length
    });
    
    const response = await axios.post(
      getApiURL() + "/recover-identity",
      content
    );
    
    console.log("Recovery response status:", response.status);
    console.log("Full response data:", response.data);
    
    let token = null;
    if (response.data.token) {
      token = response.data.token;
      console.log("Found token directly in response.data");
    } 
    else if (response.data.content && response.data.content.token) {
      token = response.data.content.token;
      console.log("Found token in response.data.content");
    }
    
    if (token) {
      console.log("Token found:", token.substring(0, 20) + "...");
      
      // Store token in both cookie and localStorage for redundancy
      setCookie("token", token, {
        sameSite: "Lax",
        secure: location.protocol === 'https:',
        expires: 365,
        path: '/'
      });
      
      axios.defaults.headers.common['Authorization'] = token;
      localStorage.setItem("emergency_token", token);
      
      try {
        // Perform emergency sync to get updated data from the current AP
        console.log("Performing emergency sync after recovery");
        await emergencySync();
        console.log("Emergency sync completed successfully");
      } catch (syncError) {
        console.error("Emergency sync failed:", syncError);
        // Continue with recovery even if sync fails
      }
      
      return {
        ...response.data,
        token: token
      };
    } else {
      console.error("No token found in recovery response");
      throw new Error("Kimlik doğrulama tokeni alınamadı. Lütfen tekrar deneyin.");
    }
  } catch (error) {
    console.error("Recovery error:", error);
    
    // If there's a specific error message from the server, use it
    if (error.response && error.response.data && error.response.data.error) {
      throw new Error(error.response.data.error);
    }
    
    // Otherwise, throw a generic error
    throw error;
  }
}

// Function to check if a user's recovery data exists in the local store
export function checkLocalRecoveryData(username, apIdentifier) {
  try {
    const storeString = localStorage.getItem("store");
    if (!storeString) return false;
    
    const store = JSON.parse(storeString);
    if (!store.recoveryData || !Array.isArray(store.recoveryData)) return false;
    
    // Check for exact username@ap match
    const fullUsername = `${username}@${apIdentifier}`;
    
    // Check both formats: username@ap and just username
    return store.recoveryData.some(data => 
      data.username === fullUsername || 
      data.username === username
    );
  } catch (error) {
    console.error("Error checking local recovery data:", error);
    return false;
  }
}


export async function checkRecoveryStatus(recoveryRequestId) {
  try {
    const response = await axios.post(
      getApiURL() + "/check-recovery-status",
      {
        recoveryRequestId,
        tod: Date.now()
      }
    );
    
    return {
      status: response.data.status,
      message: response.data.message
    };
  } catch (error) {
    console.error("Error checking recovery status:", error);
    throw error;
  }
}

export async function completeRecovery(recoveryRequestId, recoveryWords) {
  try {
    const response = await axios.post(
      getApiURL() + "/complete-recovery",
      {
        recoveryRequestId,
        recoveryWords,
        tod: Date.now()
      }
    );
    
    if (response.data.token) {
      return {
        token: response.data.token,
        adminPubKey: response.data.adminPubKey
      };
    } else {
      throw new Error("Token not received");
    }
  } catch (error) {
    console.error("Error completing recovery:", error);
    throw error;
  }
}