// src/Pages/TempRecoveryFlow.tsx - Fixed to use hybrid encryption

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/Components/ui/card";
import { Button } from "@/Components/ui/button";
import { Input } from "@/Components/ui/input";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/Components/ui/use-toast";
import { ArrowLeft, Loader2, UserPlus } from "lucide-react";
import { useMutation } from "react-query";
import axios from "axios";
import { setCookie } from "typescript-cookie";
import { getApiURL } from "@/Library/getApiURL";
import { 
  createClientSideRecoveryRequest,
  generateTempUserId,
  storeEphemeralKeys
} from "@/Library/recoveryUtil";

interface RecoveryData {
  username: string;
  apIdentifier: string;
  recoveryWords: string;
  tempUsername: string;
}

function TempRecoveryFlow() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [combinedUsername, setCombinedUsername] = useState("");
  const [tempUsername, setTempUsername] = useState("");
  const [words, setWords] = useState<string[]>(Array(8).fill(""));
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const handleWordChange = (index: number, value: string) => {
    const newWords = [...words];
    newWords[index] = value;
    setWords(newWords);
  };
  
  const { mutate: initiateBackgroundRecovery } = useMutation<any, Error, RecoveryData>(
    async (data) => {
      console.log("=== TEMP RECOVERY FLOW DEBUG START ===");
      console.log("Recovery data:", data);
      
      try {
        // Get AP's certificate (same as regular recovery)
        console.log("📡 Fetching AP certificate...");
        const apInfoResponse = await axios.get(getApiURL() + "/hello");
        console.log("AP info response status:", apInfoResponse.status);
        
        // Extract certificate from response
        let apCertificate;
        if (apInfoResponse.data?.content?.cert) {
          apCertificate = apInfoResponse.data.content.cert;
          console.log("✅ Found certificate in content.cert");
        } else if (apInfoResponse.data?.cert) {
          apCertificate = apInfoResponse.data.cert;
          console.log("✅ Found certificate in cert");
        } else {
          console.error("❌ Certificate not found in response");
          console.log("Available response keys:", Object.keys(apInfoResponse.data || {}));
          throw new Error("Could not find certificate in AP response");
        }
        
        console.log("📜 Certificate preview:", apCertificate.substring(0, 100) + "...");
        
        // Generate temp user ID
        const tempUserId = generateTempUserId(data.username, data.apIdentifier);
        console.log("Generated temp user ID:", tempUserId);
        
        // Create client-side encrypted recovery request using hybrid encryption
        console.log("🔐 Creating encrypted recovery request with hybrid encryption...");
        const { encryptedData, ephemeralKeyPair } = await createClientSideRecoveryRequest(
          data.username,
          data.apIdentifier,
          data.recoveryWords,
          tempUserId,
          apCertificate // Pass the full certificate
        );
        
        console.log("✅ Recovery request encrypted successfully");
        console.log("Encrypted data size:", encryptedData.length, "characters");
        
        // Store ephemeral keys for later use
        storeEphemeralKeys(tempUserId, ephemeralKeyPair);
        console.log("💾 Ephemeral keys stored");
        
        // Send the recovery request to server
        const requestPayload = {
          tempUserId,
          encryptedRecoveryData: encryptedData,
          destinationApId: data.apIdentifier,
          tod: Date.now()
        };
        
        console.log("📤 Sending recovery request to server...");
        console.log("Request payload keys:", Object.keys(requestPayload));
        
        const response = await axios.post(
          getApiURL() + "/initiate-cross-ap-recovery",
          requestPayload
        );
        
        console.log("✅ Server response received:", response.status);
        console.log("=== TEMP RECOVERY FLOW DEBUG END ===");
        
        return response;
        
      } catch (error: any) {
        console.error("❌ Temp recovery flow error:", error);
        
        // Enhanced error logging
        if (axios.isAxiosError(error)) {
          console.error("Axios error details:", {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            message: error.message
          });
        }
        
        throw error;
      }
    },
    {
      onMutate: () => {
        setIsSubmitting(true);
      },
      onSuccess: (response) => {
        try {
          console.log("=== SUCCESS RESPONSE PROCESSING ===");
          console.log("Response status:", response.status);
          console.log("Response data:", response.data);
          
          const data = response.data;
          
          toast({
            title: "Success!",
            description: "Cross-AP recovery initiated. You can now use the system while waiting for your original identity."
          });
          
          // Store recovery info for status checking
          const tempUserId = generateTempUserId(
            combinedUsername.split('@')[0], 
            combinedUsername.split('@')[1]
          );
          
          localStorage.setItem("cross_ap_recovery_temp_user", tempUserId);
          localStorage.setItem("cross_ap_recovery_original_user", combinedUsername);
          
          // Create a temporary token for immediate access
          // In a real implementation, the server would provide this
          const tempToken = createTempToken(tempUsername);
          console.log("Created temp token for:", tempUsername);
          
          setCookie("token", tempToken, {
            sameSite: "Lax",
            secure: location.protocol === 'https:',
            expires: 365,
            path: '/'
          });
          
          localStorage.setItem("emergency_token", tempToken);
          axios.defaults.headers.common['Authorization'] = tempToken;
          
          // Mark that this is a temporary identity
          localStorage.setItem("is_temporary_identity", "true");
          localStorage.setItem("temp_username", tempUsername);
          
          setTimeout(() => {
            navigate("/home");
          }, 1500);
          
        } catch (error) {
          console.error("❌ Error processing success response:", error);
          toast({
            title: "Error",
            description: "Error processing server response",
            variant: "destructive"
          });
          setIsSubmitting(false);
        }
      },
      onError: (error: any) => {
        console.error("=== RECOVERY ERROR ===");
        console.error("Background recovery error:", error);
        
        // Enhanced error handling
        let errorMessage = "Failed to initiate cross-AP recovery";
        
        if (error.message?.includes("Certificate")) {
          errorMessage = "Failed to get AP certificate. Please try again.";
        } else if (error.message?.includes("encrypt")) {
          errorMessage = "Failed to encrypt recovery request. Please check your recovery words.";
        } else if (error.message?.includes("network")) {
          errorMessage = "Network error. Please check your connection.";
        } else if (axios.isAxiosError(error)) {
          if (error.response?.status === 500) {
            errorMessage = "Server error during recovery processing. Please try again.";
          } else if (error.response?.status === 400) {
            errorMessage = "Invalid recovery request. Please check your information.";
          }
        }
        
        toast({
          title: "Recovery Error",
          description: errorMessage,
          variant: "destructive"
        });
        setIsSubmitting(false);
      },
      onSettled: () => {
        setIsSubmitting(false);
      }
    }
  );
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation
    if (!combinedUsername.trim()) {
      toast({
        title: "Error",
        description: "Please enter your original username.",
        variant: "destructive"
      });
      return;
    }
    
    if (!tempUsername.trim()) {
      toast({
        title: "Error",
        description: "Please enter a temporary username.",
        variant: "destructive"
      });
      return;
    }
    
    if (!combinedUsername.includes('@')) {
      toast({
        title: "Error",
        description: "Username format is incorrect. Use 'user@AP' format.",
        variant: "destructive"
      });
      return;
    }
    
    if (words.some(word => !word.trim())) {
      toast({
        title: "Error",
        description: "Please enter all recovery words.",
        variant: "destructive"
      });
      return;
    }
    
    const [username, apIdentifier] = combinedUsername.split('@');
    
    console.log("🚀 Initiating temporary recovery...");
    console.log("Username:", username);
    console.log("AP Identifier:", apIdentifier);
    console.log("Temp Username:", tempUsername);
    
    initiateBackgroundRecovery({
      username,
      apIdentifier,
      recoveryWords: words.join(" "),
      tempUsername
    });
  };
  
  // Helper function to create temporary token (simplified)
  function createTempToken(username: string): string {
    const tokenData = {
      mtUsername: username,
      apReg: "temp",
      todReg: Date.now(),
      isTemporary: true
    };
    
    // Create a simple token structure
    // In production, this should be properly signed by the server
    const encodedData = btoa(JSON.stringify(tokenData));
    return `${encodedData}.temp_signature.temp_cert`;
  }
  
  return (
    <div className="flex flex-col justify-center items-center h-full p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => navigate("/recovery")}
              className="h-8 w-8"
              disabled={isSubmitting}
            >
              <ArrowLeft size={16} />
            </Button>
            <div>
              <CardTitle className="flex items-center gap-2">
                <UserPlus size={20} />
                Temporary Identity
              </CardTitle>
              <CardDescription>
                Create a temporary account while your original identity is being recovered
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="text-sm font-medium">
                Original Username to Recover
              </label>
              <Input
                value={combinedUsername}
                onChange={(e) => setCombinedUsername(e.target.value)}
                placeholder="e.g: tuna@AP1"
                className="mt-1"
                disabled={isSubmitting}
              />
              <p className="text-xs text-gray-500 mt-1">
                Enter your original username and AP identifier in 'user@AP' format.
              </p>
            </div>
            
            <div>
              <label className="text-sm font-medium">
                Temporary Username
              </label>
              <Input
                value={tempUsername}
                onChange={(e) => setTempUsername(e.target.value)}
                placeholder="e.g: temp_tuna"
                className="mt-1"
                disabled={isSubmitting}
              />
              <p className="text-xs text-gray-500 mt-1">
                You'll use this temporary username until recovery completes.
              </p>
            </div>
            
            <div>
              <label className="text-sm font-medium">
                Original Account Recovery Words
              </label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {words.map((word, index) => (
                  <div key={index} className="flex items-center gap-1">
                    <span className="text-gray-500 text-xs w-4">{index+1}.</span>
                    <Input
                      value={word}
                      onChange={(e) => handleWordChange(index, e.target.value)}
                      placeholder={`${index+1}. word`}
                      className="text-sm"
                      disabled={isSubmitting}
                    />
                  </div>
                ))}
              </div>
            </div>
            
            <Button 
              type="submit" 
              className="mt-2"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : "Create Temporary Account & Start Recovery"}
            </Button>
          </form>
          
          {/* Progress indicator */}
          {isSubmitting && (
            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md border border-blue-200 dark:border-blue-800">
              <div className="flex items-center gap-2 text-blue-800 dark:text-blue-400 text-sm">
                <Loader2 className="animate-spin h-4 w-4" />
                <span>Encrypting recovery request and sending to network...</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default TempRecoveryFlow;