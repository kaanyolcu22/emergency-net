import { getApiURL } from "@/Library/getApiURL";
import axios from "axios";  
import { setCookie } from "typescript-cookie";


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
    console.log("Response data keys:", Object.keys(response.data));
    
    console.log("Direct token access:", response.data.token);
    console.log("Token via content:", response.data.content?.token);
    console.log("Token via id:", response.data.id);
    console.log("Token via type:", response.data.type);
    
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
    throw error;
  }
}