// src/Components/RecoveryStatusChecker.tsx

import { useEffect, useState } from 'react';
import { useToast } from "@/Components/ui/use-toast";
import { Button } from "@/Components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/Components/ui/dialog';
import { 
  checkCrossAPRecoveryStatus, 
  completeCrossAPRecovery,
  getPendingCrossAPRecovery,
  cancelCrossAPRecovery
} from "@/Services/recovery";
import { setCookie } from "typescript-cookie";
import axios from "axios";
import { Loader2, RefreshCw, UserCheck, X } from 'lucide-react';

function RecoveryStatusChecker() {
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [tempUserId, setTempUserId] = useState("");
  const [originalUser, setOriginalUser] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  
  useEffect(() => {
    const pendingRecovery = getPendingCrossAPRecovery();
    if (pendingRecovery) {
      setIsPending(true);
      setTempUserId(pendingRecovery.tempUserId);
      setOriginalUser(pendingRecovery.originalUser);
      checkStatus(pendingRecovery.tempUserId);
    }
  }, []);
  
  const checkStatus = async (userId: string) => {
    try {
      const response = await checkCrossAPRecoveryStatus(userId);
      
      if (response.hasResponse) {
        setIsComplete(true);
        toast({
          title: "Recovery Ready!",
          description: "Your identity response has arrived. You can now complete recovery."
        });
      }
    } catch (error) {
      console.error("Error checking recovery status:", error);
    }
  };
  
  const handleComplete = async () => {
    setIsCompleting(true);
    
    try {
      const response = await completeCrossAPRecovery(tempUserId);
      
      if (response.token) {
        toast({
          title: "Success!",
          description: "Your identity has been recovered. Switching to original account."
        });
        
        // Set new token
        setCookie("token", response.token, {
          sameSite: "Lax",
          secure: location.protocol === 'https:',
          expires: 365,
          path: '/'
        });
        
        localStorage.setItem("emergency_token", response.token);
        axios.defaults.headers.common['Authorization'] = response.token;
        
        // Clear recovery state
        setIsPending(false);
        setIsComplete(false);
        
        // Set recovery completed flag
        localStorage.setItem("recovery_completed", "true");
        
        // Refresh the page to apply new identity
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
    } finally {
      setIsCompleting(false);
    }
  };
  
  const handleCancel = () => {
    cancelCrossAPRecovery();
    setIsPending(false);
    setIsComplete(false);
    setDialogOpen(false);
    
    toast({
      title: "Recovery Cancelled",
      description: "Cross-AP recovery has been cancelled."
    });
  };
  
  if (!isPending) return null;
  
  return (
    <>
      {isComplete ? (
        <Button 
          variant="outline" 
          className="fixed bottom-4 right-4 gap-2 shadow-lg bg-green-50 border-green-300 hover:bg-green-100 text-green-800"
          onClick={() => setDialogOpen(true)}
        >
          <UserCheck size={16} />
          Complete Recovery
        </Button>
      ) : (
        <div className="fixed bottom-4 right-4 flex gap-2">
          <Button 
            variant="outline" 
            className="gap-2 shadow-lg"
            onClick={() => checkStatus(tempUserId)}
          >
            <RefreshCw size={16} className="animate-spin" />
            Checking Recovery...
          </Button>
          <Button 
            variant="outline" 
            size="icon"
            className="shadow-lg text-red-600 hover:text-red-700"
            onClick={handleCancel}
          >
            <X size={16} />
          </Button>
        </div>
      )}
      
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete Identity Recovery</DialogTitle>
            <DialogDescription>
              Your original identity <span className="font-medium">{originalUser}</span> is ready to be restored.
              This will replace your current temporary access.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-md border border-blue-200 dark:border-blue-800">
              <div className="flex items-start gap-2 text-blue-800 dark:text-blue-400">
                <UserCheck size={20} className="flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Recovery Response Received</p>
                  <p className="text-sm">
                    Your identity has been successfully located and verified. 
                    Click "Complete Recovery" to switch to your original account.
                  </p>
                </div>
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleComplete} disabled={isCompleting}>
              {isCompleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : "Complete Recovery"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default RecoveryStatusChecker;