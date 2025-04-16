import { combineMessages, removeMessages } from "@/Library/sync";
import { sync } from "@/Services/sync";
import { useQuery, useQueryClient } from "react-query";
import { getCookie } from "typescript-cookie";

interface Store {
  messages: Record<string, Record<string, any>>;
  channels: any[];
  blacklist: any[];
}

interface SyncStoreResult {
  store: Store | undefined;
  sync: () => void;
  isLoading: boolean;
}

function calculateStoreSize(store) {
  return new Blob([JSON.stringify(store)]).size;
}

function trimImageDataForSync(store) {
  const trimmedStore = JSON.parse(JSON.stringify(store));
  
  if (trimmedStore.messages) {
    let totalImagesSaved = 0;
    let totalBytesSaved = 0;
    
    Object.keys(trimmedStore.messages).forEach(channelKey => {
      const channel = trimmedStore.messages[channelKey];
      
      const messageKeys = Object.keys(channel).sort((a, b) => {
        return channel[b].tod - channel[a].tod;
      });
      
      messageKeys.forEach(messageKey => {
        const message = channel[messageKey];
        
        if (message.hasImage && message.imageData) {
          message._originalImageSize = message.imageData.length;
          
          if (totalImagesSaved >= 5) { 
            message.imageData = null;
            message._imageRemoved = true;
            totalBytesSaved += message._originalImageSize;
          } else {
            if (message._originalImageSize > 20000) {
              message.imageData = message.imageData.substring(0, 20000);
              message._imageReducedForSync = true;
              totalBytesSaved += (message._originalImageSize - 20000);
            }
            totalImagesSaved++;
          }
        }
      });
    });
    
    console.log(`Trimmed ${totalBytesSaved} bytes from images for sync. Kept ${totalImagesSaved} images.`);
  }
  
  return trimmedStore;
}

function preserveLocalImages(originalMessages, updatedMessages) {
  const result = {...updatedMessages};
  
  if (!originalMessages) return result;
  
  Object.keys(originalMessages).forEach(channelKey => {
    if (!result[channelKey]) result[channelKey] = {};
    
    const channel = originalMessages[channelKey];
    Object.keys(channel).forEach(messageKey => {
      const originalMessage = channel[messageKey];
      
      if (originalMessage?.hasImage && originalMessage?.imageData && 
          result[channelKey]?.[messageKey]) {
        console.log(`Restoring image for message ${messageKey} in channel ${channelKey}`);
        result[channelKey][messageKey].imageData = originalMessage.imageData;
        result[channelKey][messageKey].hasImage = true;
        delete result[channelKey][messageKey]._imageRemoved;
        delete result[channelKey][messageKey]._originalImageSize;
      }
    });
  });
  
  console.log("Image restoration complete");
  return result;
}

function useSyncStore(onSuccess?: () => void) : SyncStoreResult {
  const queryClient = useQueryClient();
  const tokenExists = !!getCookie("token");
  const recoveryCompleted = localStorage.getItem("recovery_completed") === "true";
  
  const { data: syncStore, isLoading: isSyncLoading } = useQuery<Store>(
    ["store"],
    async () => {
      let localStore: Store;
      if (recoveryCompleted) {
        console.log("Recovery just completed, using stored data");
        localStorage.removeItem("recovery_completed");
        
        try {
          const storeString = localStorage.getItem("store");
          if (storeString) {
            localStore = JSON.parse(storeString);
            console.log("Using store from localStorage after recovery");
            return localStore;
          }
        } catch (error) {
          console.error("Error parsing store:", error);
        }
      }



      try {
        const storeString = localStorage.getItem("store");
        if (storeString) {
          localStore = JSON.parse(storeString);
        } else {
          localStore = {
            messages: {},
            channels: [],
            blacklist: []
          };
          localStorage.setItem("store", JSON.stringify(localStore));
        }

        console.log("Store structure:", Object.keys(localStore));
        if (localStore.messages) {
          console.log("Channel count:", Object.keys(localStore.messages).length);
          Object.keys(localStore.messages).forEach(channelKey => {
            const messageCount = Object.keys(localStore.messages[channelKey]).length;
            console.log(`Channel ${channelKey}: ${messageCount} messages`);
            
            let imageCount = 0;
            let largestImageSize = 0;
            Object.values(localStore.messages[channelKey]).forEach(message => {
              if (message.hasImage && message.imageData) {
                imageCount++;
                const imageSize = message.imageData.length;
                largestImageSize = Math.max(largestImageSize, imageSize);
              }
            });
            
            console.log(`Channel ${channelKey}: ${imageCount} images, largest: ${largestImageSize} bytes`);
          });
        }
       


      } catch (error) {
        console.error("Error parsing store:", error);
        localStore = { messages: {}, channels: [], blacklist: [] };
      }
      
      const storeSize = calculateStoreSize(localStore);
      const MAX_SYNC_SIZE = 100000; 
      let syncResponse;
      let usedTrimmedData = false;
      
      try {
        if (storeSize <= MAX_SYNC_SIZE) {
          console.log(`Syncing with full data (${storeSize} bytes)`);
          syncResponse = await sync({
            localStore: {
              messages: localStore.messages || {},
              channels: localStore.channels || [],
              blacklist: localStore.blacklist || [],
              tod: Date.now()
            }
          });
        } else {
          console.warn(`Store size too large (${storeSize} bytes), trimming images for sync`);
          const trimmedStore = trimImageDataForSync(localStore);
          const trimmedSize = calculateStoreSize(trimmedStore);
          console.log(`Trimmed store size: ${trimmedSize} bytes`);
          
          usedTrimmedData = true;
          syncResponse = await sync({
            localStore: {
              messages: trimmedStore.messages || {},
              channels: trimmedStore.channels || [],
              blacklist: trimmedStore.blacklist || [],
              tod: Date.now()
            }
          });
        }
        
        const { missingMessages, unverifiedMessages, channels, blacklist } = syncResponse.content;
        
        const sterileMessages = removeMessages(
          localStore.messages || {},
          unverifiedMessages || {}
        );
        
        const updatedMessages = combineMessages(sterileMessages, missingMessages || {});
        
        const newStore = {
          channels: channels || [],
          messages: usedTrimmedData 
            ? preserveLocalImages(localStore.messages, updatedMessages) 
            : updatedMessages,
          blacklist: blacklist || []
        };
        
        localStorage.setItem("store", JSON.stringify(newStore));
        return newStore;
        
      } catch (error) {
        console.error("Sync operation failed:", error);
        
        if (error.message && error.message.includes("too large")) {
          console.warn("Payload too large error caught, attempting emergency sync...");
          
          try {
            const emergencyStore = {
              channels: localStore.channels || [],
              blacklist: localStore.blacklist || [],
              messages: {},
              tod: Date.now()
            };
            
            const emergencyResponse = await sync({
              localStore: emergencyStore
            });
            
            const emergencyNewStore = {
              channels: emergencyResponse.content.channels || localStore.channels || [],
              messages: localStore.messages || {},
              blacklist: emergencyResponse.content.blacklist || localStore.blacklist || []
            };
            
            localStorage.setItem("store", JSON.stringify(emergencyNewStore));
            console.log("Emergency sync completed");
            return emergencyNewStore;
            
          } catch (emergencyError) {
            console.error("Emergency sync also failed:", emergencyError);
            return localStore;
          }
        }
        
        return localStore;
      }
    },
    {
      enabled: tokenExists,
      onSuccess,
      onError: (error) => {
        console.error("Sync query error:", error);
      },
      retry: (failureCount, error) => {
        if (error.message && error.message.includes("network")) {
          return failureCount < 3;
        }
        return false; 
      },
      staleTime: 10000 
    }
  );
  
  function initSync() {
    queryClient.invalidateQueries(["store"]);
  }
  
  return {
    store: syncStore,
    sync: initSync,
    isLoading: isSyncLoading,
  };
}

export default useSyncStore;