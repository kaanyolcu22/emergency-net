import { getApiURL } from "@/Library/getApiURL";
import { APResponseVerifier, MTResponseSigner } from "@/Library/interceptors";
import axios from "axios";

interface CustomProgressEvent {
  loaded: number;
  total?: number;
}

interface RecoveryRequest {
  id: string;
  status: string;
  responseReceived?: boolean;
  responseData?: any;
  expiresAt: string;
}

export async function emergencySync() {
  try {
    console.log("Starting emergency sync...");
    
    const minimalStore = {
      messages: {},
      channels: [],
      blacklist: [],
      recoveryData: [],
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
          recoveryData: response.content.recoveryData || currentStore.recoveryData || []
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
    const recoveryRequests = JSON.parse(localStorage.getItem("pendingRecoveryRequests") || "[]");
    const recoveryResponses = JSON.parse(localStorage.getItem("pendingRecoveryResponses") || "[]");
    
    const syncPayload = {
      messages: localStore.messages || {},
      channels: localStore.channels || [],
      blacklist: localStore.blacklist || [],
      recoveryRequests: recoveryRequests || [],
      recoveryResponses: recoveryResponses || [],
      tod: Date.now() 
    };
    
    console.log(`Including ${recoveryRequests.length} recovery requests and ${recoveryResponses.length} recovery responses in sync`);
    
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
      if (verifiedResponse.content.recoveryRequests && Array.isArray(verifiedResponse.content.recoveryRequests)) {
        console.log(`Received ${verifiedResponse.content.recoveryRequests.length} recovery requests`);
        localStorage.setItem("receivedRecoveryRequests", JSON.stringify(verifiedResponse.content.recoveryRequests));
      }
      
      if (verifiedResponse.content.recoveryResponses && Array.isArray(verifiedResponse.content.recoveryResponses)) {
        console.log(`Received ${verifiedResponse.content.recoveryResponses.length} recovery responses`);
        localStorage.setItem("receivedRecoveryResponses", JSON.stringify(verifiedResponse.content.recoveryResponses));
        processRecoveryResponses(verifiedResponse.content.recoveryResponses);
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

function processRecoveryResponses(responses: any[]) {
  if (!responses || responses.length === 0) return;
  
  try {
    const pendingRequests = JSON.parse(localStorage.getItem("pendingRecoveryRequests") || "[]");
    const updatedRequests = [...pendingRequests];
    let hasChanges = false;
    
    for (const response of responses) {
      const requestIndex = updatedRequests.findIndex(req => req.id === response.requestId);
      
      if (requestIndex >= 0) {
        updatedRequests[requestIndex].status = "COMPLETED";
        updatedRequests[requestIndex].responseReceived = true;
        updatedRequests[requestIndex].responseData = response;
        hasChanges = true;
        
        console.log(`Matched response to request ${response.requestId}`);
      }
    }
  
    if (hasChanges) {
      localStorage.setItem("pendingRecoveryRequests", JSON.stringify(updatedRequests));
      console.log("Updated pending recovery requests with response data");
    }
  } catch (error) {
    console.error("Error processing recovery responses:", error);
  }
}

export function addRecoveryRequest(request: any) {
  try {
    const pendingRequests = JSON.parse(localStorage.getItem("pendingRecoveryRequests") || "[]");
    pendingRequests.push(request);
    localStorage.setItem("pendingRecoveryRequests", JSON.stringify(pendingRequests));
    console.log(`Added recovery request ${request.id} to pending requests`);
    return true;
  } catch (error) {
    console.error("Error adding recovery request:", error);
    return false;
  }
}

export function addRecoveryResponse(response: any) {
  try {
    const pendingResponses = JSON.parse(localStorage.getItem("pendingRecoveryResponses") || "[]");
    pendingResponses.push(response);
    localStorage.setItem("pendingRecoveryResponses", JSON.stringify(pendingResponses));
    console.log(`Added recovery response for request ${response.requestId} to pending responses`);
    return true;
  } catch (error) {
    console.error("Error adding recovery response:", error);
    return false;
  }
}


export function getRecoveryRequestStatus(requestId: string) {
  try {
    const pendingRequests = JSON.parse(localStorage.getItem("pendingRecoveryRequests") || "[]");
    const request = pendingRequests.find((req: RecoveryRequest) => req.id === requestId);
    
    if (!request) {
      console.log(`Recovery request ${requestId} not found`);
      return null;
    }
    
    return {
      id: request.id,
      status: request.status,
      responseReceived: !!request.responseReceived,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt
    };
  } catch (error) {
    console.error("Error getting recovery request status:", error);
    return null;
  }
}

export function cleanupRecoveryData() {
  try {
    const now = new Date().toISOString();
    const pendingRequests = JSON.parse(localStorage.getItem("pendingRecoveryRequests") || "[]");
    const updatedRequests = pendingRequests.filter((req: RecoveryRequest) => {
      return req.status !== "COMPLETED" && new Date(req.expiresAt) > new Date(now);
    });
    
    localStorage.setItem("pendingRecoveryRequests", JSON.stringify(updatedRequests));
    localStorage.setItem("pendingRecoveryResponses", "[]");
    
    console.log(`Cleaned up recovery data. Remaining requests: ${updatedRequests.length}`);
  } catch (error) {
    console.error("Error cleaning up recovery data:", error);
  }
}

export async function syncRecoveryData() {
  try {
    const requests = JSON.parse(localStorage.getItem("pendingRecoveryRequests") || "[]");
    const responses = JSON.parse(localStorage.getItem("pendingRecoveryResponses") || "[]");
    
    if (requests.length === 0 && responses.length === 0) {
      return { noData: true };
    }
    
    const response = await axios.post(
      getApiURL() + "/recovery-sync",
      {
        recoveryRequests: requests,
        recoveryResponses: responses,
        tod: Date.now()
      }
    );
    
    return response.data;
  } catch (error) {
    console.error("Recovery sync error:", error);
    throw error;
  }
}