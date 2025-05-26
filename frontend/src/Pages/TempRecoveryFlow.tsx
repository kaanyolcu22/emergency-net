// src/Pages/TempRecoveryFlow.tsx

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
      console.log("=== RECOVERY FLOW DEBUG START ===");
      console.log("Recovery data:", data);
      
      // Get AP's public key first
      console.log("Fetching AP info...");
      const apInfoResponse = await axios.get(getApiURL() + "/hello");
        let apCert;
        if (apInfoResponse.data.content?.cert) {
          apCert = apInfoResponse.data.content.cert;
        } else if (apInfoResponse.data.cert) {
          apCert = apInfoResponse.data.cert;
        } else {
          throw new Error("Could not find certificate in AP response");
        }

      // Extract AP public key from certificate
      const apPublicKey = extractPublicKeyFromCert(apCert);
      console.log("Extracted public key length:", apPublicKey.length);
      
      if (!apPublicKey) {
        throw new Error("Could not extract public key from certificate");
      }
      
      // Generate temp user ID
      const tempUserId = generateTempUserId(data.username, data.apIdentifier);
      console.log("Generated temp user ID:", tempUserId);
      
      // Create client-side encrypted recovery request
      console.log("Creating client-side recovery request...");
      const { encryptedData, ephemeralKeyPair } = await createClientSideRecoveryRequest(
        data.username,
        data.apIdentifier,
        data.recoveryWords,
        tempUserId,
        apPublicKey
      );
      
      console.log("Encrypted data length:", encryptedData.length);
      console.log("Ephemeral public key:", ephemeralKeyPair.publicKeyPem.substring(0, 100) + "...");
      
      // Store ephemeral keys for later use
      storeEphemeralKeys(tempUserId, ephemeralKeyPair);
      console.log("Stored ephemeral keys");
      
      // Send the properly formatted request
      const requestPayload = {
        tempUserId,
        encryptedRecoveryData: encryptedData,
        destinationApId: data.apIdentifier,
        tod: Date.now()
      };
      
      console.log("Sending request payload:", requestPayload);
      console.log("=== RECOVERY FLOW DEBUG END ===");
      
      return axios.post(
        getApiURL() + "/initiate-cross-ap-recovery",
        requestPayload
      );
    },
    {
      onMutate: () => {
        setIsSubmitting(true);
      },
      onSuccess: (response) => {
        try {
          console.log("=== SUCCESS RESPONSE ===");
          console.log("Response:", response.data);
          
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
          
          // For now, create a temporary token (this should come from server in full implementation)
          const tempToken = createTempToken(tempUsername);
          console.log("Created temp token:", tempToken);
          
          setCookie("token", tempToken, {
            sameSite: "Lax",
            secure: location.protocol === 'https:',
            expires: 365,
            path: '/'
          });
          
          localStorage.setItem("emergency_token", tempToken);
          axios.defaults.headers.common['Authorization'] = tempToken;
          
          setTimeout(() => {
            navigate("/home");
          }, 1500);
        } catch (error) {
          console.error("Error processing response:", error);
          toast({
            title: "Error",
            description: "Error processing server response",
            variant: "destructive"
          });
          setIsSubmitting(false);
        }
      },
      onError: (error) => {
        console.error("=== RECOVERY ERROR ===");
        console.error("Background recovery error:", error);
        
        // More detailed error logging
        if (axios.isAxiosError(error)) {
          console.error("Axios error details:", {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            headers: error.response?.headers
          });
        }
        
        toast({
          title: "Error",
          description: error.message || "Failed to initiate cross-AP recovery",
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
    
    initiateBackgroundRecovery({
      username,
      apIdentifier,
      recoveryWords: words.join(" "),
      tempUsername
    });
  };
  
  // Helper function to extract public key from certificate
  function extractPublicKeyFromCert(cert: string): string {
    try {
      const parts = cert.split('.');
      if (parts.length < 1) {
        throw new Error("Invalid certificate format");
      }
      
      // Decode the first part which contains the AP data
      const decoded = atob(parts[0]);
      const certData = JSON.parse(decoded);
      
      // EmergencyNet stores the public key in 'apPub' field
      const publicKey = certData.apPub;
      
      if (!publicKey) {
        throw new Error(`Public key not found. Available fields: ${Object.keys(certData).join(', ')}`);
      }
      
      // Validate it's proper PEM format
      if (!publicKey.includes('-----BEGIN PUBLIC KEY-----')) {
        throw new Error("Invalid PEM format in certificate");
      }
      
      console.log("Successfully extracted public key from certificate");
      return publicKey;
      
    } catch (error : any) {
      console.error("Certificate parsing failed:", error);
      throw new Error(`Failed to extract public key: ${error.message}`);
    }
}
  
  // Helper function to create temporary token (simplified)
  function createTempToken(username: string): string {
    const tokenData = {
      mtUsername: username,
      apReg: "temp",
      todReg: Date.now()
    };
    return btoa(JSON.stringify(tokenData)) + ".temp_signature.temp_cert";
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
        </CardContent>
      </Card>
    </div>
  );
}

export default TempRecoveryFlow;