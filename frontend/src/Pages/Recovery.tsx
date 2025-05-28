// src/Pages/Recovery.tsx - Unified recovery system
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/Components/ui/card";
import { Button } from "@/Components/ui/button";
import { Input } from "@/Components/ui/input";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/Components/ui/use-toast";
import { ArrowLeft, KeyRound, RefreshCw, Clock, UserCheck, Loader2 } from "lucide-react";
import { useMutation, useQuery } from "react-query";
import { recoverIdentity, checkRecoveryStatus, completeRecovery } from "@/Services/recovery"; 
import { setCookie } from "typescript-cookie";
import { emergencySync } from '../Services/sync';
import axios from "axios";
import useSyncStore from "@/Hooks/useSyncStore";

type RecoveryState = 'input' | 'local_processing' | 'cross_ap_waiting' | 'cross_ap_ready' | 'completed' | 'error';

function Recovery() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [combinedUsername, setCombinedUsername] = useState("");
  const [words, setWords] = useState(Array(8).fill(""));
  const [recoveryState, setRecoveryState] = useState<RecoveryState>('input');
  const [tempUserId, setTempUserId] = useState("");
  const [tempUsername, setTempUsername] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const { sync, isLoading: isSyncLoading } = useSyncStore();
  
  const handleWordChange = (index: number, value: string) => {
    const newWords = [...words];
    newWords[index] = value;
    setWords(newWords);
  };
  
  // Check for existing cross-AP recovery
  useEffect(() => {
    const pendingRecovery = localStorage.getItem("pending_cross_ap_recovery");
    if (pendingRecovery) {
      const data = JSON.parse(pendingRecovery);
      setTempUserId(data.tempUserId);
      setTempUsername(data.tempUsername);
      setCombinedUsername(data.originalUsername);
      setRecoveryState('cross_ap_waiting');
    }
  }, []);
  
  // Check recovery status periodically when waiting
  const { refetch: checkStatus } = useQuery(
    ["recoveryStatus", tempUserId],
    () => checkRecoveryStatus(tempUserId),
    {
      enabled: recoveryState === 'cross_ap_waiting' && !!tempUserId,
      refetchInterval: 10000,
      onSuccess: (data) => {
        if (data.status === "completed" || data.hasResponse) {
          setRecoveryState('cross_ap_ready');
          toast({
            title: "Recovery Ready!",
            description: "Your identity response has arrived. Complete the recovery process.",
          });
        } else if (data.status === "expired") {
          setRecoveryState('error');
          setErrorMessage("Recovery request expired. Please try again.");
        }
      },
      onError: (error: any) => {
        console.error("Error checking status:", error);
      }
    }
  );
  
  const forceSync = async () => {
    toast({
      title: "Syncing...",
      description: "Checking for recovery data."
    });
    
    try {
      await sync();
      
      if (combinedUsername && combinedUsername.includes('@')) {
        const [username, apIdentifier] = combinedUsername.split('@');
        const exists = checkLocalRecoveryData(username, apIdentifier);
        
        if (exists) {
          toast({
            title: "Recovery data found!",
            description: "Local recovery data is available.",
          });
        } else {
          toast({
            title: "No local data",
            description: "Will attempt cross-AP recovery when you submit.",
            variant: "default"
          });
        }
      }
    } catch (error) {
      console.error("Sync error:", error);
      toast({
        title: "Sync failed",
        description: "Could not sync recovery data.",
        variant: "destructive"
      });
    }
  };
  
  const { mutate: recover, isLoading: isRecovering } = useMutation(
    async (recoveryData: any) => {
      console.log("Starting unified recovery for:", recoveryData.username);
      return await recoverIdentity(recoveryData);
    },
    {
      onSuccess: async (data) => {
        console.log("Recovery response:", data);
        
        if (data.type === 'local_success') {
          // Local recovery succeeded
          setRecoveryState('completed');
          toast({
            title: "Success!",
            description: "Identity recovered successfully. Redirecting..."
          });
          
          await handleSuccessfulRecovery(data.token);
          
        } else if (data.type === 'cross_ap_initiated') {
          // Cross-AP recovery initiated with temporary identity
          setRecoveryState('cross_ap_waiting');
          setTempUserId(data.tempUserId);
          setTempUsername(data.tempUsername);
          
          // Store for persistence
          localStorage.setItem("pending_cross_ap_recovery", JSON.stringify({
            tempUserId: data.tempUserId,
            tempUsername: data.tempUsername,
            originalUsername: combinedUsername
          }));
          
          toast({
            title: "Cross-AP Recovery Started",
            description: `You can now use the system as ${data.tempUsername} while waiting for recovery.`
          });
          
          // Set temporary token for immediate access
          if (data.tempToken) {
            setCookie("token", data.tempToken, {
              sameSite: "Lax",
              secure: location.protocol === 'https:',
              expires: 365,
              path: '/'
            });
            
            localStorage.setItem("emergency_token", data.tempToken);
            axios.defaults.headers.common['Authorization'] = data.tempToken;
            localStorage.setItem("is_temporary_identity", "true");
          }
        }
      },
      onError: (error: any) => {
        console.error("Recovery error:", error);
        setRecoveryState('error');
        setErrorMessage(error.message || "Recovery failed.");
        toast({
          title: "Recovery Error",
          description: error.message || "Recovery failed.",
          variant: "destructive"
        });
      }
    }
  );
  
  const { mutate: completeRecoveryMutation, isLoading: isCompleting } = useMutation(
    () => completeRecovery(tempUserId, words.join(" ")),
    {
      onSuccess: async (data) => {
        console.log("Recovery completion response:", data);
        setRecoveryState('completed');
        
        // Clear temporary state
        localStorage.removeItem("pending_cross_ap_recovery");
        localStorage.removeItem("is_temporary_identity");
        
        toast({
          title: "Success!",
          description: "Original identity restored. Redirecting..."
        });
        
        await handleSuccessfulRecovery(data.token);
      },
      onError: (error: any) => {
        console.error("Recovery completion error:", error);
        toast({
          title: "Completion Failed",
          description: error.message || "Failed to complete recovery.",
          variant: "destructive"
        });
      }
    }
  );
  
  const handleSuccessfulRecovery = async (token: string) => {
    if (token) {
      setCookie("token", token, {
        sameSite: "Lax",
        secure: location.protocol === 'https:',
        expires: 365,
        path: '/'
      });
      
      localStorage.setItem("emergency_token", token);
      axios.defaults.headers.common['Authorization'] = token;
      
      try {
        await emergencySync();
      } catch (syncError) {
        console.error("Emergency sync failed:", syncError);
      }
      
      localStorage.setItem("recovery_completed", "true");
      
      setTimeout(() => {
        window.location.href = "/";
      }, 1500);
    }
  };
  
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
        description: "Username format should be 'user@AP' (e.g., kaan@ap1).",
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
    
    if (recoveryState === 'cross_ap_ready') {
      // Complete cross-AP recovery
      completeRecoveryMutation();
    } else {
      // Start recovery process
      setRecoveryState('local_processing');
      recover({
        username,
        apIdentifier,
        recoveryWords: words.join(" ")
      });
    }
  };
  
  const handleCancel = () => {
    if (recoveryState === 'cross_ap_waiting' || recoveryState === 'cross_ap_ready') {
      localStorage.removeItem("pending_cross_ap_recovery");
      localStorage.removeItem("is_temporary_identity");
      setRecoveryState('input');
      setTempUserId("");
      setTempUsername("");
    }
    navigate("/");
  };
  
  const checkLocalRecoveryData = (username: string, apIdentifier: string): boolean => {
    try {
      const storeString = localStorage.getItem("store");
      if (!storeString) return false;
      
      const store = JSON.parse(storeString);
      if (!store.recoveryData || !Array.isArray(store.recoveryData)) return false;
      
      const fullUsername = `${username}@${apIdentifier}`;
      
      return store.recoveryData.some((data: any) => 
        data.username === fullUsername || data.username === username
      );
    } catch (error) {
      console.error("Error checking local recovery data:", error);
      return false;
    }
  };
  
  // Render different states
  const renderContent = () => {
    switch (recoveryState) {
      case 'cross_ap_waiting':
        return (
          <div className="text-center py-6 space-y-4">
            <div className="flex justify-center">
              <Clock size={48} className="text-blue-500 animate-pulse" />
            </div>
            <h3 className="text-xl font-semibold">Processing Cross-AP Recovery</h3>
            <p className="text-gray-500 dark:text-gray-400">
              You're now using temporary identity: <strong>{tempUsername}</strong>
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              You can send messages while waiting. Your original identity <strong>{combinedUsername}</strong> is being recovered from another AP.
            </p>
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="animate-spin h-5 w-5" />
              <span>Checking for response...</span>
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="outline" onClick={handleCancel}>
                Cancel & Use Temp Identity
              </Button>
              <Button variant="outline" onClick={() => checkStatus()}>
                Check Now
              </Button>
              <Button onClick={() => navigate("/home")}>
                Continue as {tempUsername}
              </Button>
            </div>
          </div>
        );
        
      case 'cross_ap_ready':
        return (
          <div className="space-y-4">
            <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-md border border-green-200 dark:border-green-800">
              <div className="flex items-start gap-2 text-green-800 dark:text-green-400">
                <UserCheck size={20} className="flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Recovery Response Received!</p>
                  <p className="text-sm">
                    Your original identity {combinedUsername} is ready to be restored.
                  </p>
                </div>
              </div>
            </div>
            
            <Button 
              onClick={handleSubmit}
              className="w-full"
              disabled={isCompleting}
            >
              {isCompleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Restoring Identity...
                </>
              ) : `Switch to ${combinedUsername}`}
            </Button>
            
            <Button 
              variant="outline"
              onClick={() => navigate("/home")}
              className="w-full"
            >
              Continue as {tempUsername}
            </Button>
          </div>
        );
        
      case 'error':
        return (
          <div className="text-center py-6 space-y-4">
            <h3 className="text-xl font-semibold text-red-600">Recovery Error</h3>
            <p className="text-red-500">{errorMessage}</p>
            <Button onClick={() => setRecoveryState('input')}>
              Try Again
            </Button>
          </div>
        );
        
      default:
        return (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <div className="flex justify-between items-center">
                <label className="text-sm font-medium">Username</label>
                <Button 
                  type="button" 
                  variant="ghost" 
                  size="sm"
                  onClick={forceSync}
                  disabled={isSyncLoading}
                  className="flex items-center gap-1 text-xs h-7"
                >
                  <RefreshCw size={12} className={isSyncLoading ? "animate-spin" : ""} />
                  Sync
                </Button>
              </div>
              <Input
                value={combinedUsername}
                onChange={(e) => setCombinedUsername(e.target.value)}
                placeholder="e.g., kaan@ap1"
                className="mt-1"
                disabled={isRecovering}
              />
              <p className="text-xs text-gray-500 mt-1">
                Enter your username and the AP where you registered (user@AP format).
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
                  {recoveryState === 'local_processing' ? 'Processing...' : 'Recovering...'}
                </>
              ) : "Recover Identity"}
            </Button>
          </form>
        );
    }
  };

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
              disabled={isRecovering || isCompleting}
            >
              <ArrowLeft size={16} />
            </Button>
            <div>
              <CardTitle className="flex items-center gap-2">
                <KeyRound size={20} />
                Identity Recovery
              </CardTitle>
              <CardDescription>
                {recoveryState === 'cross_ap_waiting' 
                  ? "Cross-AP recovery in progress..."
                  : recoveryState === 'cross_ap_ready'
                  ? "Ready to restore original identity"
                  : "Recover your identity with recovery words"
                }
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>
    </div>
  );
}

export default Recovery;