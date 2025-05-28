// src/Components/RecoveryStatusChecker.tsx - Updated for unified recovery
import { useEffect, useState } from 'react';
import { useToast } from "@/Components/ui/use-toast";
import { Button } from "@/Components/ui/button";
import { checkRecoveryStatus, completeRecovery } from "@/Services/recovery";
import { setCookie } from "typescript-cookie";
import axios from "axios";
import { Loader2, RefreshCw, UserCheck } from 'lucide-react';

function RecoveryStatusChecker() {
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [tempUserId, setTempUserId] = useState("");
  const [originalUsername, setOriginalUsername] = useState("");
  const [tempUsername, setTempUsername] = useState("");
  
  useEffect(() => {
    const pendingRecovery = localStorage.getItem("pending_cross_ap_recovery");
    if (pendingRecovery) {
      const data = JSON.parse(pendingRecovery);
      setIsPending(true);
      setTempUserId(data.tempUserId);
      setOriginalUsername(data.originalUsername);
      setTempUsername(data.tempUsername);
      checkStatus(data.tempUserId);
    }
  }, []);
  
  const checkStatus = async (userId: string) => {
    try {
      const response = await checkRecoveryStatus(userId);
      
      if (response.hasResponse || response.status === "completed") {
        setIsComplete(true);
        toast({
          title: "Recovery Ready!",
          description: "Your original identity is ready to be restored."
        });
      }
    } catch (error) {
      console.error("Error checking recovery status:", error);
    }
  };
  
  const handleComplete = async () => {
    try {
      const response = await completeRecovery(tempUserId, "");
      
      if (response.token) {
        toast({
          title: "Success!",
          description: "Original identity restored successfully."
        });

        setCookie("token", response.token, {
          sameSite: "Lax",
          secure: location.protocol === 'https:',
          expires: 365,
          path: '/'
        });
        
        localStorage.setItem("emergency_token", response.token);
        axios.defaults.headers.common['Authorization'] = response.token;

        localStorage.removeItem("pending_cross_ap_recovery");
        localStorage.removeItem("is_temporary_identity");
        
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to complete recovery",
        variant: "destructive"
      });
    }
  };
  
  if (!isPending) return null;
  
  return (
    <>
      {isComplete ? (
        <Button 
          variant="outline" 
          className="fixed bottom-4 right-4 gap-2 shadow-lg bg-green-50 border-green-300 hover:bg-green-100 text-green-800"
          onClick={handleComplete}
        >
          <UserCheck size={16} />
          Switch to {originalUsername}
        </Button>
      ) : (
        <Button 
          variant="outline" 
          className="fixed bottom-4 right-4 gap-2 shadow-lg"
          onClick={() => checkStatus(tempUserId)}
        >
          <RefreshCw size={16} className="animate-spin" />
          Checking Recovery...
        </Button>
      )}
    </>
  );
}

export default RecoveryStatusChecker;