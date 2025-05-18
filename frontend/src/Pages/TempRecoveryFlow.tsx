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
    (data) => {
      return axios.post(
        getApiURL() + "/initiate-background-recovery",
        {
          username: data.username,
          apIdentifier: data.apIdentifier,
          recoveryWords: data.recoveryWords,
          tempUsername: data.tempUsername,
          tod: Date.now()
        }
      );
    },
    {
      onMutate: () => {
        setIsSubmitting(true);
      },
      onSuccess: (response) => {
        try {
          // Make sure we have the expected data structure
          const data = response.data;
          
          if (!data.token || !data.recoveryRequestId) {
            throw new Error("Invalid response format from server");
          }
          
          toast({
            title: "Başarılı!",
            description: "Geçici kimlikle kayıt oldunuz. Eski kimliğiniz arka planda kurtarılmaya çalışılacak."
          });
          
          // Store token and recovery data
          setCookie("token", data.token, {
            sameSite: "Lax",
            secure: location.protocol === 'https:',
            expires: 365,
            path: '/'
          });
          
          localStorage.setItem("emergency_token", data.token);
          localStorage.setItem("recovery_pending", "true");
          localStorage.setItem("recovery_request_id", data.recoveryRequestId);
          localStorage.setItem("original_username", combinedUsername);
          
          if (data.tempRecoveryWords) {
            localStorage.setItem("temp_recovery_words", JSON.stringify(data.tempRecoveryWords));
          }
          
          // Set authorization header for future requests
          axios.defaults.headers.common['Authorization'] = data.token;
          
          // Navigate to home
          setTimeout(() => {
            navigate("/home");
          }, 1500);
        } catch (error) {
          console.error("Error processing response:", error);
          toast({
            title: "Hata",
            description: "Sunucu yanıtı işlenirken bir hata oluştu",
            variant: "destructive"
          });
          setIsSubmitting(false);
        }
      },
      onError: (error) => {
        console.error("Background recovery error:", error);
        toast({
          title: "Hata",
          description: error.message || "Geçici kayıt sırasında bir hata oluştu",
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
        title: "Hata",
        description: "Lütfen asıl kullanıcı adınızı girin.",
        variant: "destructive"
      });
      return;
    }
    
    if (!tempUsername.trim()) {
      toast({
        title: "Hata",
        description: "Lütfen geçici kullanıcı adı girin.",
        variant: "destructive"
      });
      return;
    }
    
    if (!combinedUsername.includes('@')) {
      toast({
        title: "Hata",
        description: "Kullanıcı adı formatı yanlış. 'kullanıcı@AP' formatında olmalıdır.",
        variant: "destructive"
      });
      return;
    }
    
    if (words.some(word => !word.trim())) {
      toast({
        title: "Hata",
        description: "Lütfen tüm kurtarma kelimelerini girin.",
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
                Geçici Kimlik Oluştur
              </CardTitle>
              <CardDescription>
                Kimlik kurtarma işlemi tamamlanana kadar kullanabileceğiniz geçici bir kimlik oluşturun
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="text-sm font-medium">
                Kurtarılacak Asıl Kullanıcı Adı
              </label>
              <Input
                value={combinedUsername}
                onChange={(e) => setCombinedUsername(e.target.value)}
                placeholder="Örn: tuna@AP1"
                className="mt-1"
              />
              <p className="text-xs text-gray-500 mt-1">
                Asıl kullanıcı adınızı ve AP kimliğini 'kullanıcı@AP' formatında girin.
              </p>
            </div>
            
            <div>
              <label className="text-sm font-medium">
                Kullanılacak Geçici Kullanıcı Adı
              </label>
              <Input
                value={tempUsername}
                onChange={(e) => setTempUsername(e.target.value)}
                placeholder="Örn: gecici_tuna"
                className="mt-1"
              />
              <p className="text-xs text-gray-500 mt-1">
                Kimlik kurtarma işlemi tamamlanana kadar bu geçici kullanıcı adını kullanacaksınız.
              </p>
            </div>
            
            <div>
              <label className="text-sm font-medium">
                Asıl Hesabın Kurtarma Kelimeleri
              </label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {words.map((word, index) => (
                  <div key={index} className="flex items-center gap-1">
                    <span className="text-gray-500 text-xs w-4">{index+1}.</span>
                    <Input
                      value={word}
                      onChange={(e) => handleWordChange(index, e.target.value)}
                      placeholder={`${index+1}. kelime`}
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
                  İşleniyor...
                </>
              ) : "Geçici Hesap Oluştur ve Kurtarmayı Başlat"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default TempRecoveryFlow;