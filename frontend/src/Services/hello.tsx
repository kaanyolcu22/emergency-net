import { getApiURL } from "@/Library/getApiURL";
import axios from "axios";


export async function hello(token?: string, isRecovered = false) {
  try {
    // Add the query parameter if isRecovered is true
    const url = isRecovered 
      ? `${getApiURL()}/hello?recovered=true` 
      : `${getApiURL()}/hello`;
      
    // Prepare headers
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = token;
    }
    
    if (isRecovered) {
      headers["X-Recovery-Completed"] = "true";
    }
    
    console.log("Sending hello request to:", url);
    
    // Send hello request
    const response = await axios.get(url, { 
      headers,
      timeout: 10000 // 10 second timeout
    });
    
    console.log("Hello request successful, status:", response.status);
    return response;
  } catch (error) {
    console.error("Hello request failed:", error);
    
    if (axios.isAxiosError(error) && error.response) {
      // Log response data for debugging
      console.error("Server response:", error.response.status, error.response.data);
    }
    
    throw error;
  }
}