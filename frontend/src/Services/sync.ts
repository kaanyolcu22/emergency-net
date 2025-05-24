import { getApiURL } from "@/Library/getApiURL";
import { APResponseVerifier, MTResponseSigner } from "@/Library/interceptors";
import axios from "axios";

interface CustomProgressEvent {
  loaded: number;
  total?: number;
}

interface CrossAPRequest {
  tempUserId: string;
  requestingApId: string;
  destinationApId: string;
  hash: string;
  realUserId: string;
  sourceApId: string;
  ephemeralPublicKey: string;
  timestamp: number;
  status: string;
  expiresAt: string;
}

interface CrossAPResponse {
  tempUserId: string;
  encryptedTokenData: string;
  requestingApId: string;
  sourceApId: string;
  signature: string;
  createdAt: string;
}

export async function emergencySync() {
  try {
    console.log("Starting emergency sync...");
    
    const minimalStore = {
      messages: {},
      channels: [],
      blacklist: [],
      recoveryData: [],
      crossAPRequests: [],
      crossAPResponses: [],
      tod: Date.now()
    };

    const response = await sync({ 
      localStore: minimalStore
    });
    
    try {
      const storeString = localStorage.getItem("store");
      if (storeString) {
        const currentStore = JSON.parse(storeString);
        
        const updatedStore = {
          messages: currentStore.messages || {},
          channels: response.content.channels || currentStore.channels || [],
          blacklist: response.content.blacklist || currentStore.blacklist || [],
          recoveryData: response.content.recoveryData || currentStore.recoveryData || [],
          crossAPRequests: response.content.crossAPRequests || [],
          crossAPResponses: response.content.crossAPResponses || []
        };
        
        localStorage.setItem("store", JSON.stringify(updatedStore));
        console.log("Emergency sync completed successfully");
      }
    } catch (storageError) {
      console.error("Error updating local storage after emergency sync:", storageError);
    }
    
    return response;
  } catch (error) {
    console.error("Emergency sync failed:", error);
    throw error;
  }
}

export async function sync({ localStore }: { localStore: any }) {
  console.log("Starting enhanced sync operation...");
  
  try {
    console.log("Preparing to sign data for sync...");
    const crossAPRequests = JSON.parse(localStorage.getItem("pendingCrossAPRequests") || "[]");
    const crossAPResponses = JSON.parse(localStorage.getItem("pendingCrossAPResponses") || "[]");
    
    const syncPayload = {
      messages: localStore.messages || {},
      channels: localStore.channels || [],
      blacklist: localStore.blacklist || [],
      crossAPRequests: crossAPRequests || [],
      crossAPResponses: crossAPResponses || [],
      tod: Date.now() 
    };
    
    console.log(`Including ${crossAPRequests.length} cross-AP requests and ${crossAPResponses.length} cross-AP responses in sync`);
    
    const signedData = await MTResponseSigner(syncPayload);
    console.log("Data signed successfully");
    
    console.log("Sending sync request to:", getApiURL() + "/sync");
    const response = await axios.post(
      getApiURL() + "/sync",
      signedData,
      {
        timeout: 30000,
        onUploadProgress: (progressEvent: CustomProgressEvent) => {
          if (progressEvent.total) {
            console.log(`Upload progress: ${Math.round(progressEvent.loaded / progressEvent.total * 100)}%`);
          } else {
            console.log(`Uploaded ${progressEvent.loaded} bytes`);
          }
        }
      }
    );
    
    console.log("Received sync response:", response.status);
    
    const verifiedResponse = await APResponseVerifier(response.data);
    
    if (verifiedResponse.content) {
      if (verifiedResponse.content.crossAPRequests && Array.isArray(verifiedResponse.content.crossAPRequests)) {
        console.log(`Received ${verifiedResponse.content.crossAPRequests.length} cross-AP requests`);
        localStorage.setItem("receivedCrossAPRequests", JSON.stringify(verifiedResponse.content.crossAPRequests));
      }
      
      if (verifiedResponse.content.crossAPResponses && Array.isArray(verifiedResponse.content.crossAPResponses)) {
        console.log(`Received ${verifiedResponse.content.crossAPResponses.length} cross-AP responses`);
        localStorage.setItem("receivedCrossAPResponses", JSON.stringify(verifiedResponse.content.crossAPResponses));
        processCrossAPResponses(verifiedResponse.content.crossAPResponses);
      }
    }
    
    return verifiedResponse;
  } catch (error) {
    console.error("Sync operation failed with error:", error);
    
    if (axios.isAxiosError(error)) {
      console.error("Axios error details:", {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        headers: error.response?.headers
      });
    }
  
    throw error;
  }
}

function processCrossAPResponses(responses: CrossAPResponse[]) {
  if (!responses || responses.length === 0) return;
  
  try {
    const pendingRequests = JSON.parse(localStorage.getItem("pendingCrossAPRequests") || "[]");
    const updatedRequests = [...pendingRequests];
    let hasChanges = false;
    
    for (const response of responses) {
      const requestIndex = updatedRequests.findIndex((req: CrossAPRequest) => req.tempUserId === response.tempUserId);
      
      if (requestIndex >= 0) {
        updatedRequests[requestIndex].status = "COMPLETED";
        updatedRequests[requestIndex].responseReceived = true;
        updatedRequests[requestIndex].responseData = response;
        hasChanges = true;
        
        console.log(`Matched response to request ${response.tempUserId}`);
      }
    }
  
    if (hasChanges) {
      localStorage.setItem("pendingCrossAPRequests", JSON.stringify(updatedRequests));
      console.log("Updated pending cross-AP requests with response data");
    }
  } catch (error) {
    console.error("Error processing cross-AP responses:", error);
  }
}

export function addCrossAPRequest(request: CrossAPRequest) {
  try {
    const pendingRequests = JSON.parse(localStorage.getItem("pendingCrossAPRequests") || "[]");
    pendingRequests.push(request);
    localStorage.setItem("pendingCrossAPRequests", JSON.stringify(pendingRequests));
    console.log(`Added cross-AP request ${request.tempUserId} to pending requests`);
    return true;
  } catch (error) {
    console.error("Error adding cross-AP request:", error);
    return false;
  }
}

export function addCrossAPResponse(response: CrossAPResponse) {
  try {
    const pendingResponses = JSON.parse(localStorage.getItem("pendingCrossAPResponses") || "[]");
    pendingResponses.push(response);
    localStorage.setItem("pendingCrossAPResponses", JSON.stringify(pendingResponses));
    console.log(`Added cross-AP response for request ${response.tempUserId} to pending responses`);
    return true;
  } catch (error) {
    console.error("Error adding cross-AP response:", error);
    return false;
  }
}

export function getCrossAPRequestStatus(tempUserId: string) {
  try {
    const pendingRequests = JSON.parse(localStorage.getItem("pendingCrossAPRequests") || "[]");
    const request = pendingRequests.find((req: CrossAPRequest) => req.tempUserId === tempUserId);
    
    if (!request) {
      console.log(`Cross-AP request ${tempUserId} not found`);
      return null;
    }
    
    return {
      tempUserId: request.tempUserId,
      status: request.status,
      responseReceived: !!request.responseReceived,
      timestamp: request.timestamp,
      expiresAt: request.expiresAt
    };
  } catch (error) {
    console.error("Error getting cross-AP request status:", error);
    return null;
  }
}

export function cleanupCrossAPData() {
  try {
    const now = new Date().toISOString();
    const pendingRequests = JSON.parse(localStorage.getItem("pendingCrossAPRequests") || "[]");
    const updatedRequests = pendingRequests.filter((req: CrossAPRequest) => {
      return req.status !== "COMPLETED" && new Date(req.expiresAt) > new Date(now);
    });
    
    localStorage.setItem("pendingCrossAPRequests", JSON.stringify(updatedRequests));
    localStorage.setItem("pendingCrossAPResponses", "[]");
    
    console.log(`Cleaned up cross-AP data. Remaining requests: ${updatedRequests.length}`);
  } catch (error) {
    console.error("Error cleaning up cross-AP data:", error);
  }
}

export async function syncCrossAPData() {
  try {
    const requests = JSON.parse(localStorage.getItem("pendingCrossAPRequests") || "[]");
    const responses = JSON.parse(localStorage.getItem("pendingCrossAPResponses") || "[]");
    
    if (requests.length === 0 && responses.length === 0) {
      return { noData: true };
    }
    
    const response = await axios.post(
      getApiURL() + "/cross-ap-recovery-sync",
      {
        crossAPRequests: requests,
        crossAPResponses: responses,
        tod: Date.now()
      }
    );
    
    return response.data;
  } catch (error) {
    console.error("Cross-AP sync error:", error);
    throw error;
  }
}