// src/Services/debugSync.ts - Debug version with token fix

import { getApiURL } from "@/Library/getApiURL";
import { MTResponseSigner } from "@/Library/interceptors";
import axios from "axios";

export async function debugSync() {
  try {
    console.log("=== DEBUG SYNC START ===");
    
    // First fix token authentication
    const { fixTokenAuth } = await import("@/Services/tokenDebug");
    const token = fixTokenAuth();
    
    if (!token) {
      console.log("❌ No valid token available");
      return;
    }
    
    // Set the token in axios headers
    axios.defaults.headers.common["Authorization"] = token;
    console.log("✅ Authorization header set with fixed token");
    
    // Step 1: Test direct API call to see what server returns
    console.log("\n--- Step 1: Testing direct /sync call ---");
    
    const basicPayload = {
      messages: {}, // Empty to get all messages
      channels: [],
      blacklist: [],
      recoveryRequests: [],
      recoveryResponses: [],
      tod: Date.now()
    };
    
    console.log("Sending payload:", basicPayload);
    
    const signedData = await MTResponseSigner(basicPayload);
    console.log("Signed data structure:", {
      hasContent: !!signedData.content,
      hasSignature: !!signedData.signature,
      contentLength: signedData.content ? signedData.content.length : 0
    });
    
    const response = await axios.post(
      getApiURL() + "/sync",
      signedData,
      { timeout: 30000 }
    );
    
    console.log("Raw response status:", response.status);
    console.log("Raw response data keys:", Object.keys(response.data));
    
    // The response might be nested differently
    let actualContent = response.data;
    if (response.data.content && response.data.content.content) {
      actualContent = response.data.content.content;
      console.log("Found double-nested content");
    } else if (response.data.content) {
      actualContent = response.data.content;
      console.log("Found single-nested content");
    }
    
    console.log("Actual content keys:", Object.keys(actualContent));
    console.log("Actual content:", actualContent);
    
    // Check for different possible property names
    const possibleMessageProps = ['missingMessages', 'messages', 'messagesToSend'];
    let foundMessages = null;
    
    for (const prop of possibleMessageProps) {
      if (actualContent[prop]) {
        foundMessages = actualContent[prop];
        console.log(`Found messages in property '${prop}':`, foundMessages);
        break;
      }
    }
    
    if (!foundMessages) {
      console.log("❌ No messages found in any expected property");
      console.log("Available properties:", Object.keys(actualContent));
    } else {
      console.log("✅ Found messages:", {
        channels: Object.keys(foundMessages),
        totalMessages: Object.values(foundMessages).reduce((total, channelMsgs) => 
          total + Object.keys(channelMsgs || {}).length, 0)
      });
    }
    
    // Step 2: Test localStorage update
    console.log("\n--- Step 2: Testing localStorage update ---");
    
    const currentStore = localStorage.getItem("store");
    console.log("Current localStorage store:", {
      exists: !!currentStore,
      size: currentStore ? currentStore.length : 0
    });
    
    if (currentStore) {
      try {
        const parsed = JSON.parse(currentStore);
        console.log("Parsed store structure:", {
          hasMessages: !!parsed.messages,
          messageChannels: parsed.messages ? Object.keys(parsed.messages) : [],
          hasChannels: !!parsed.channels,
          channelsCount: parsed.channels ? parsed.channels.length : 0
        });
      } catch (e) {
        console.log("Error parsing stored data:", e);
      }
    }
    
    // Step 3: Update store with response data
    if (response.data?.content?.missingMessages) {
      console.log("\n--- Step 3: Updating store ---");
      
      const newStore = {
        messages: response.data.content.missingMessages,
        channels: response.data.content.channels || [],
        blacklist: response.data.content.blacklist || [],
        recoveryData: response.data.content.recoveryData || []
      };
      
      console.log("New store to save:", {
        messageChannels: Object.keys(newStore.messages),
        totalMessages: Object.values(newStore.messages).reduce((total, channelMsgs) => 
          total + Object.keys(channelMsgs || {}).length, 0),
        channelsCount: newStore.channels.length
      });
      
      localStorage.setItem("store", JSON.stringify(newStore));
      console.log("✅ Store updated in localStorage");
      
      // Verify the save
      const verifyStore = localStorage.getItem("store");
      if (verifyStore) {
        const verified = JSON.parse(verifyStore);
        console.log("Verified saved store:", {
          messageChannels: Object.keys(verified.messages || {}),
          totalMessages: Object.values(verified.messages || {}).reduce((total, channelMsgs) => 
            total + Object.keys(channelMsgs || {}).length, 0)
        });
      }
    }
    
    // Step 4: Test if we can get messages directly from emergency-sync
    console.log("\n--- Step 4: Testing emergency-sync for message comparison ---");
    
    try {
      const emergencyResponse = await axios.get(getApiURL() + "/emergency-sync");
      console.log("Emergency sync response:", emergencyResponse.status);
      
      let emergencyContent = emergencyResponse.data;
      if (emergencyResponse.data.content) {
        emergencyContent = emergencyResponse.data.content;
      }
      
      console.log("Emergency response structure:", Object.keys(emergencyContent));
      
      // Check if emergency sync has any message-related data
      if (emergencyContent.messages || emergencyContent.missingMessages) {
        console.log("Emergency sync contains message data");
      } else {
        console.log("Emergency sync has no message data");
      }
    } catch (emergencyError) {
      console.log("Emergency sync failed:", emergencyError.message);
    }
    
    console.log("=== DEBUG SYNC END ===\n");
    
    return response.data;
  } catch (error) {
    console.error("DEBUG SYNC ERROR:", error);
    
    if (axios.isAxiosError(error)) {
      console.error("Axios error details:", {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      });
    }
    
    throw error;
  }
}