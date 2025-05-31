// src/Pages/Recovery.tsx - Fixed to handle proper recovery flow

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/Components/ui/card";
import { Button } from "@/Components/ui/button";
import { Input } from "@/Components/ui/input";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/Components/ui/use-toast";
import { ArrowLeft, KeyRound, RefreshCw, Loader2 } from "lucide-react";
import { useMutation } from "react-query";
import { recoverIdentity } from "@/Services/recovery"; 
import { setCookie } from "typescript-cookie";
import { emergencySync } from '../Services/sync';
import axios from "axios";
import useSyncStore from "@/Hooks/useSyncStore";

function Recovery() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [combinedUsername, setCombinedUsername] = useState("");
  const [words, setWords] = useState(Array(8).fill(""));
  const { sync, isLoading: isSyncLoading } = useSyncStore();
  
  const handleWordChange = (index: number, value: string) => {
    const newWords = [...words];
    newWords[index] = value;
    setWords(newWords);
  };
  
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
      console.log("Starting recovery for:", recoveryData.username);
      return await recoverIdentity(recoveryData);
    },
    {
      onSuccess: async (data) => {
        console.log("Recovery response:", data);
        
        if (data.type === 'local_success') {
          // LOCAL RECOVERY - immediate access with original identity
          console.log("✅ Local recovery successful - redirecting to home");
          
          toast({
            title: "Success!",
            description: "Identity recovered successfully. Redirecting to home..."
          });
          
          await handleSuccessfulRecovery(data.token!);
          
        } else if (data.type === 'cross_ap_initiated') {
          console.log("✅ Cross-AP recovery initiated - redirecting to home with temp identity");
          
          toast({
            title: "Cross-AP Recovery Started",
            description: `You can now use the system with temporary identity while your original identity is being recovered.`
          });
          
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
          
          navigate("/home");
        }
      },
      onError: (error: any) => {
        console.error("Recovery error:", error);
        toast({
          title: "Recovery Error",
          description: error.message || "Recovery failed.",
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
      
      // Redirect to home immediately
      navigate("/home");
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
    
    recover({
      username,
      apIdentifier,
      recoveryWords: words.join(" ")
    });
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
              disabled={isRecovering}
            >
              <ArrowLeft size={16} />
            </Button>
            <div>
              <CardTitle className="flex items-center gap-2">
                <KeyRound size={20} />
                Kimliğini Kurtar
              </CardTitle>
              <CardDescription>
                Hesabınızı kurtarmak için kullanıcı adınızı ve kurtarma kelimelerinizi girin.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <div className="flex justify-between items-center">
                <label className="text-sm font-medium">Kullanıcı adı</label>
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
                Kullanıcı adınızı ve hangi APde kayıt yaptığınızı user@AP formatında belirtiniz.
              </p>
            </div>
            
            <div>
              <label className="text-sm font-medium">Kurtarma Kelimeleri</label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {words.map((word, index) => (
                  <div key={index} className="flex items-center gap-1">
                    <span className="text-gray-500 text-xs w-4">{index+1}.</span>
                    <Input
                      value={word}
                      onChange={(e) => handleWordChange(index, e.target.value)}
                      placeholder={`${index+1}. kelime`}
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
                  Hesap Kurtarılıyor...
                </>
              ) : "Kimliği Kurtar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default Recovery;