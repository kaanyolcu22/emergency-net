// RecoveryStatusChecker.tsx

import { useEffect, useState } from 'react';
import { useToast } from "@/Components/ui/use-toast";
import { Button } from "@/Components/ui/button";
import { Input } from "@/Components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/Components/ui/dialog';
import { checkRecoveryStatus, completeRecovery } from "@/Services/recovery";
import { setCookie } from "typescript-cookie";
import axios from "axios";
import { Loader2, RefreshCw, UserCheck } from 'lucide-react';

function RecoveryStatusChecker() {
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [words, setWords] = useState(Array(8).fill(""));
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  useEffect(() => {
    const pending = localStorage.getItem("recovery_pending") === "true";
    if (pending) {
      setIsPending(true);
      const storedRequestId = localStorage.getItem("recovery_request_id");
      if (storedRequestId) {
        setRequestId(storedRequestId);
        checkStatus(storedRequestId);
      }
    }
  }, []);
  
  const handleWordChange = (index : any, value : any) => {
    const newWords = [...words];
    newWords[index] = value;
    setWords(newWords);
  };
  
  const checkStatus = async (id : any) => {
    try {
      const { status } = await checkRecoveryStatus(id);
      
      if (status === "completed") {
        setIsComplete(true);
        toast({
          title: "Recovery Ready!",
          description: "Your identity has been found! You can now recover it."
        });
      }
    } catch (error) {
      console.error("Error checking recovery status:", error);
    }
  };
  
  const handleComplete = async () => {
    setIsSubmitting(true);
    
    try {
      const response = await completeRecovery(requestId);
      
      if (response.token) {
        toast({
          title: "Success!",
          description: "Your identity has been recovered. You'll be switched to your original account."
        });

        setCookie("token", response.token, {
          sameSite: "Lax",
          secure: location.protocol === 'https:',
          expires: 365,
          path: '/'
        });
        
        localStorage.setItem("emergency_token", response.token);
        axios.defaults.headers.common['Authorization'] = response.token;

        localStorage.removeItem("recovery_pending");
        localStorage.removeItem("recovery_request_id");
        localStorage.removeItem("original_username");
        
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    } catch (error : any) {
      toast({
        title: "Error",
        description: error.message || "Failed to complete recovery",
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
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
          Switch to Recovered Identity
        </Button>
      ) : (
        <Button 
          variant="outline" 
          className="fixed bottom-4 right-4 gap-2 shadow-lg"
          onClick={() => checkStatus(requestId)}
        >
          <RefreshCw size={16} className="animate-spin" />
          Checking Recovery...
        </Button>
      )}
      
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete Identity Recovery</DialogTitle>
            <DialogDescription>
              Enter your recovery words to switch to your original identity: 
              <span className="font-medium">{localStorage.getItem("original_username")}</span>
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid grid-cols-2 gap-2 py-4">
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
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleComplete} disabled={isSubmitting}>
              {isSubmitting ? (
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