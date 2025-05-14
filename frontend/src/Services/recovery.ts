import { getApiURL } from "@/Library/getApiURL";
import axios, { AxiosError } from "axios";  
import { setCookie } from "typescript-cookie";
import { emergencySync } from "./sync";

interface RecoveryData {
  username: string;
  apIdentifier: string;
  recoveryWords: string;
}


export async function recoverIdentity(recoveryData: RecoveryData) {
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
      
      setCookie("token", token, {
        sameSite: "Lax",
        secure: location.protocol === 'https:',
        expires: 365,
        path: '/'
      });
      
      axios.defaults.headers.common['Authorization'] = token;
      localStorage.setItem("emergency_token", token);
      
      try {
        console.log("Performing emergency sync after recovery");
        await emergencySync();
        console.log("Emergency sync completed successfully");
      } catch (syncError) {
        console.error("Emergency sync failed:", syncError);
      }
      
      return {
        ...response.data,
        token: token
      };
    } else {
      console.error("No token found in recovery response");
      throw new Error("Kimlik doğrulama tokeni alınamadı. Lütfen tekrar deneyin.");
    }
  } catch (error: unknown) {
    console.error("Recovery error:", error);
    
    // TypeScript safe error handling
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.data && typeof axiosError.response.data === 'object' && 'error' in axiosError.response.data) {
        const errorData = axiosError.response.data as { error: string };
        throw new Error(errorData.error);
    }
    }
    
    if (error instanceof Error) {
    throw error;
    } else {
      throw new Error("Unknown recovery error occurred");
    }
  }
}

export function checkLocalRecoveryData(username: string, apIdentifier: string): boolean {
  try {
    const storeString = localStorage.getItem("store");
    if (!storeString) return false;
    
    const store = JSON.parse(storeString);
    if (!store.recoveryData || !Array.isArray(store.recoveryData)) return false;
    
    const fullUsername = `${username}@${apIdentifier}`;
    
    return store.recoveryData.some((data: any) => 
      data.username === fullUsername || 
      data.username === username
    );
  } catch (error: unknown) {
    console.error("Error checking local recovery data:", error);
    return false;
  }
}

export async function checkRecoveryStatus(recoveryRequestId: string) {
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
  } catch (error: unknown) {
    console.error("Error checking recovery status:", error);
    throw error;
  }
}

export async function completeRecovery(recoveryRequestId: string, recoveryWords: string) {
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
  } catch (error: unknown) {
    console.error("Error completing recovery:", error);
    throw error;
  }
}