// src/Services/testMessageFlow.ts - Test the complete message flow

import { getApiURL } from "@/Library/getApiURL";
import { MTResponseSigner } from "@/Library/interceptors";
import { message } from "@/Services/message";
import { debugSync } from "@/Services/debugSync";
import axios from "axios";

export async function testCompleteMessageFlow() {
  try {
    console.log("=== TESTING COMPLETE MESSAGE FLOW ===");
    
    // Step 0: Fix token authentication first
    console.log("\n--- Step 0: Fixing token authentication ---");
    const { fixTokenAuth } = await import("@/Services/tokenDebug");
    const token = fixTokenAuth();
    
    if (!token) {
      console.log("❌ No valid token, cannot proceed");
      return;
    }
    
    // Step 1: Send a test message
    console.log("\n--- Step 1: Sending test message ---");
    
    const testMessage = "Test message " + Date.now();
    const testChannel = "Yardım"; // Use existing channel
    
    console.log(`Sending message "${testMessage}" to channel "${testChannel}"`);
    
    const messageResponse = await message({
      msgContent: testMessage,
      channel: testChannel
    });
    
    console.log("Message send response:", messageResponse);
    
    // Step 2: Wait a moment for server processing
    console.log("\n--- Step 2: Waiting for server processing ---");
    await new Promise(resolve => setTimeout(resolve, 2000)); // Longer wait
    
    // Step 3: Try to fetch the message back with fixed auth
    console.log("\n--- Step 3: Testing sync after message send ---");
    
    const syncResult = await debugSync();
    
    console.log("=== MESSAGE FLOW TEST COMPLETE ===");
    
  } catch (error) {
    console.error("Message flow test failed:", error);
  }
}