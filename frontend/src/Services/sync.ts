import { getApiURL } from "@/Library/getApiURL";
import { APResponseVerifier, MTResponseSigner } from "@/Library/interceptors";
import axios from "axios";


export async function sync({ localStore }: { localStore: any }) {
  console.log("Starting sync operation...");
  
  try {
    console.log("Preparing to sign data for sync...");
    const syncPayload = {
      messages: localStore.messages || {},
      channels: localStore.channels || [],
      blacklist: localStore.blacklist || [],
      tod: Date.now() 
    };
    const signedData = await MTResponseSigner(syncPayload);
    console.log("Data signed successfully");
    
    console.log("Sending sync request to:", getApiURL() + "/sync");
    const response = await axios.post(
      getApiURL() + "/sync",
      signedData,
      {
        timeout: 30000,
        onUploadProgress: (progressEvent) => {
          console.log(`Upload progress: ${Math.round(progressEvent.loaded / progressEvent.total * 100)}%`);
        }
      }
    );
    
    console.log("Received sync response:", response.status);
    console.log("Response structure:", Object.keys(response.data));
    
    if (response.data.content && response.data.content.channels) {
      console.log("Channels in response:", response.data.content.channels.length);
      console.log("Sample channels:", response.data.content.channels.slice(0, 3));
    } else {
      console.error("No channels in response data.content");
    }
    
    const verifiedResponse = await APResponseVerifier(response.data);
    
    if (verifiedResponse.content && verifiedResponse.content.channels) {
      console.log("Channels after verification:", verifiedResponse.content.channels.length);
    } else {
      console.error("No channels in verified response");
    }
    
    return verifiedResponse;
  }  catch (error) {
    console.error("Sync operation failed with error:", error);
    
    if (axios.isAxiosError(error)) {
      console.error("Axios error details:", {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        headers: error.response?.headers
      });
      
      if (error.response?.status === 413) {
        console.error("Server rejected payload as too large despite trimming");
      }
    }
    
    // Re-throw the error so it can be handled by the caller
    throw error;
  }
}

// Add this to sync.ts
export async function testEmergencyEndpoint() {
  try {
    console.log("Testing emergency endpoint...");
    const response = await axios.get(getApiURL() + "/test-emergency");
    console.log("Test successful:", response.data);
    return response.data;
  } catch (error) {
    console.error("Test failed:", error);
    throw error;
  }
}

export async function emergencySync() {
  try {
    console.log("Starting emergency sync operation...");
    
    const token = localStorage.getItem("emergency_token") || "";
    
    console.log("Making emergency sync request with token:", token.substring(0, 20) + "...");
    
    const response = await axios.get(
      getApiURL() + "/emergency-sync", 
      { 
        headers: { 
          'Authorization': token
        }
      }
    );
    
    console.log("Emergency sync successful, response status:", response.status);
    
    if (response.data && response.data.content && response.data.content.channels) {
      console.log("Received channels:", response.data.content.channels.length);
      
      const localStore = {
        channels: response.data.content.channels || [],
        messages: response.data.content.missingMessages || {},
        blacklist: response.data.content.blacklist || []
      };
      
      console.log("Storing channels in localStorage");
      localStorage.setItem("store", JSON.stringify(localStore));
    } else {
      console.error("Invalid response format:", response.data);
    }
    
    return response.data;
  } catch (error) {
    console.error("Emergency sync failed:", error);
    console.error("Error details:", error.response?.data || error.message);
    throw error;
  }
}