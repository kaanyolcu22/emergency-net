// src/Pages/CrossAPRecovery.tsx
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/Components/ui/card";
import { Button } from "@/Components/ui/button";
import { Input } from "@/Components/ui/input";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/Components/ui/use-toast";
import { 
  ArrowLeft, 
  KeyRound, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  Clock 
} from "lucide-react";
import { useMutation, useQuery } from "react-query";
import { 
  recoverIdentity,
  checkCrossAPRecoveryStatus, 
  completeCrossAPRecovery,
  getPendingCrossAPRecovery,
  cancelCrossAPRecovery
} from "@/Services/recovery"; 
import { setCookie } from "typescript-cookie";
import axios from "axios";

function CrossAPRecovery() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [combinedUsername, setCombinedUsername] = useState("");
  const [words, setWords] = useState(Array(8).fill(""));
  const [recoveryState, setRecoveryState] = useState("initial"); 
  const [errorMessage, setErrorMessage] = useState("");
  const [tempUserId, setTempUserId] = useState("");
  
  // Check for pending recovery on mount
  useEffect(() => {
    const pendingRecovery = getPendingCrossAPRecovery();
    if (pendingRecovery) {
      setTempUserId(pendingRecovery.tempUserId);
      setCombinedUsername(pendingRecovery.originalUser);
      setRecoveryState("checking");
    }
  }, []);
  
  const handleWordChange = (index: number, value: string) => {
    const newWords = [...words];
    newWords[index] = value;
    setWords(newWords);
  };
  
  // Check recovery status periodically
  const { refetch: refetchStatus } = useQuery(
    ["crossAPRecoveryStatus", tempUserId],
    () => checkCrossAPRecoveryStatus(tempUserId),
    {
      enabled: recoveryState === "checking" && !!tempUserId,
      refetchInterval: 10000,
      onSuccess: (data) => {
        console.log("Recovery status:", data);
        
        if (data.hasResponse) {
          setRecoveryState("ready");
          toast({
            title: "Recovery Ready!",
            description: "Your identity response has arrived. Complete the recovery process.",
            variant: "default"
          });
        } else if (data.status === "expired") {
          setRecoveryState("error");
          setErrorMessage("Recovery request expired. Please try again.");
          toast({
            title: "Request Expired",
            description: "Recovery request has expired. Please try again.",
            variant: "destructive"
          });
        }
      },
      onError: (error) => {
        console.error("Error checking status:", error);
      }
    }
  );
  
  // Initiate recovery
  const { mutate: recover, isLoading: isRecovering } = useMutation(
    (recoveryData: any) => recoverIdentity(recoveryData),
    {
      onSuccess: (data: any) => {
        console.log("Recovery response:", data);
        
        if (data.token && data.local) {
          // Local recovery succeeded immediately
          handleSuccessfulRecovery(data.token);
        } else if (data.status === "cross_ap_initiated") {
          // Cross-AP recovery initiated
          setTempUserId(data.tempUserId);
          setRecoveryState("checking");
          toast({
            title: "Cross-AP Recovery Initiated",
            description: "Recovery request sent to network. Checking for response...",
          });
        } else {
          setRecoveryState("error");
          setErrorMessage("Unexpected response. Please try again.");
        }
      },
      onError: (error: any) => {
        console.error("Recovery error:", error);
        setRecoveryState("error");
        setErrorMessage(error.message || "Recovery initiation failed.");
        toast({
          title: "Recovery Error",
          description: error.message || "Recovery initiation failed.",
          variant: "destructive"
        });
      }
    }
  );
  
  // Complete cross-AP recovery
  const { mutate: finishRecovery, isLoading: isFinishing } = useMutation(
    () => completeCrossAPRecovery(tempUserId),
    {
      onSuccess: (data) => {
        console.log("Recovery completion response:", data);
        handleSuccessfulRecovery(data.token);
      },
      onError: (error: any) => {
        console.error("Recovery completion error:", error);
        toast({
          title: "Recovery Failed",
          description: error.message || "Failed to complete recovery.",
          variant: "destructive"
        });
      }
    }
  );
  
  // Handle successful recovery
  const handleSuccessfulRecovery = (token: string) => {
    toast({
      title: "Success!",
      description: "Identity recovered successfully. Redirecting to home."
    });
    
    if (token) {
      setCookie("token", token, {
        sameSite: "Lax",
        secure: location.protocol === 'https:',
        expires: 365,
        path: '/'
      });
      
      localStorage.setItem("emergency_token", token);
      axios.defaults.headers.common['Authorization'] = token;
      localStorage.setItem("recovery_completed", "true");
      
      setTimeout(() => {
        window.location.href = "/";
      }, 1500);
    }
  };
  
  // Handle form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!combinedUsername.trim()) {
      toast({
        title: "Error",
        description: "Please enter your username.",
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
    
    const [username, apIdentifier] = combinedUsername.split('@');
    
    if (!username || !apIdentifier) {
      toast({
        title: "Error",
        description: "Username and AP identifier are required.",
        variant: "destructive"
      });
      return;
    }
    
    if (recoveryState === "ready") {
      // Complete cross-AP recovery (no words needed - keys already generated)
      finishRecovery();
    } else {
      // Check words for initial recovery
      if (words.some(word => !word.trim())) {
        toast({
          title: "Error",
          description: "Please enter all recovery words.",
          variant: "destructive"
        });
        return;
      }
      
      // Initiate recovery
      setRecoveryState("submitted");
      recover({
        username,
        apIdentifier,
        recoveryWords: words.join(" ")
      });
    }
  };
  
  // Cancel recovery
  const handleCancel = () => {
    cancelCrossAPRecovery();
    setRecoveryState("initial");
    setTempUserId("");
    setErrorMessage("");
    navigate("/");
  };
  
  // Render different UI states
  let content;
  
  if (recoveryState === "checking") {
    content = (
      <div className="text-center py-6 space-y-4">
        <div className="flex justify-center">
          <Clock size={48} className="text-blue-500 animate-pulse" />
        </div>
        <h3 className="text-xl font-semibold">Processing Recovery Request</h3>
        <p className="text-gray-500 dark:text-gray-400">
          Your identity is registered at a different AP. The request is propagating through the network.
        </p>
        <div className="flex items-center justify-center gap-2">
          <Loader2 className="animate-spin h-5 w-5" />
          <span>Checking status...</span>
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400 mt-4">
          This may take several minutes to hours depending on network mobility.
        </div>
        <div className="flex gap-2 mt-4">
          <Button variant="outline" onClick={handleCancel}>
            Cancel Recovery
          </Button>
          <Button variant="outline" onClick={() => refetchStatus()}>
            Check Now
          </Button>
        </div>
      </div>
    );
  } else if (recoveryState === "error") {
    content = (
      <div className="text-center py-6 space-y-4">
        <div className="flex justify-center">
          <XCircle size={48} className="text-red-500" />
        </div>
        <h3 className="text-xl font-semibold">Recovery Error</h3>
        <p className="text-red-500 dark:text-red-400">
          {errorMessage || "An error occurred during recovery."}
        </p>
        <Button onClick={() => setRecoveryState("initial")}>
          Try Again
        </Button>
      </div>
    );
  } else if (recoveryState === "ready") {
    content = (
      <div className="space-y-4">
        <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-md border border-green-200 dark:border-green-800">
          <div className="flex items-start gap-2 text-green-800 dark:text-green-400">
            <CheckCircle2 size={20} className="flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Recovery Response Received!</p>
              <p className="text-sm">
                Your identity has been located. Click below to complete the recovery process.
              </p>
            </div>
          </div>
        </div>
        
        <Button 
          onClick={handleSubmit}
          className="w-full"
          disabled={isFinishing}
        >
          {isFinishing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Completing Recovery...
            </>
          ) : "Complete Recovery"}
        </Button>
      </div>
    );
  } else {
    // Initial state or submitted state
    content = (
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="text-sm font-medium">Username</label>
          <Input
            value={combinedUsername}
            onChange={(e) => setCombinedUsername(e.target.value)}
            placeholder="e.g: tuna@AP1"
            className="mt-1"
            disabled={isRecovering}
          />
          <p className="text-xs text-gray-500 mt-1">
            Enter your username and AP identifier in 'user@AP' format.
          </p>
        </div>
        
        <div>
          <label className="text-sm font-medium">Recovery Words</label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            {words.map((word, index) => (
              <div key={index} className="flex items-center gap-1">
                <span className="text-gray-500 text-xs w-4">{index+1}.</span>
                <Input
                  value={word}
                  onChange={(e) => handleWordChange(index, e.target.value)}
                  placeholder={`${index+1}. word`}
                  className="text-sm"
                  disabled={isRecovering}
                />
              </div>
            ))}
          </div>
        </div>
        
        <Button 
          type="submit" 
          className="mt-2"
          disabled={isRecovering}
        >
          {isRecovering ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : "Recover Identity"}
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-col justify-center items-center h-full p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => navigate("/")}
              className="h-8 w-8"
              disabled={isRecovering || isFinishing || recoveryState === "checking"}
            >
              <ArrowLeft size={16} />
            </Button>
            <div>
              <CardTitle className="flex items-center gap-2">
                <KeyRound size={20} />
                Cross-AP Identity Recovery
              </CardTitle>
              <CardDescription>
                Recover accounts registered at different access points
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {content}
        </CardContent>
      </Card>
    </div>
  );
}

export default CrossAPRecovery;