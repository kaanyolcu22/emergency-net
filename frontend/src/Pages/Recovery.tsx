import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/Components/ui/card";
import { Button } from "@/Components/ui/button";
import { Input } from "@/Components/ui/input";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/Components/ui/use-toast";
import { ArrowLeft, KeyRound } from "lucide-react";
import { useMutation } from "react-query";
import { recoverIdentity } from "@/Services/recovery"; 
import { setCookie } from "typescript-cookie";
import { emergencySync } from '../Services/sync';
import axios from "axios";  

function Recovery() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [combinedUsername, setCombinedUsername] = useState("");
  const [words, setWords] = useState(Array(8).fill(""));
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const handleWordChange = (index, value) => {
    const newWords = [...words];
    newWords[index] = value;
    setWords(newWords);
  };
  
  const { mutate: recover } = useMutation(
    (recoveryData) => recoverIdentity(recoveryData),
    {
      onMutate: () => {
        setIsSubmitting(true);
      },
      onSuccess: async (data) => {
        console.log("Recovery successful, received data:", data);
        
        toast({
          title: "Başarılı!",
          description: "Kimliğiniz başarıyla kurtarıldı. Anasayfaya yönlendiriliyorsunuz."
        });
      
        if (data.token) {
          console.log("Using token from recovery response");
          
          setCookie("token", data.token, {
            sameSite: "Lax",
            secure: location.protocol === 'https:',
            expires: 365,
            path: '/'
          });
      
          localStorage.setItem("emergency_token", data.token);
          axios.defaults.headers.common['Authorization'] = data.token;
          
          try {
            console.log("Attempting emergency sync after recovery");
            await emergencySync();
            console.log("Emergency sync completed");
          } catch (syncError) {
            console.error("Emergency sync failed:", syncError);
          }
          localStorage.setItem("recovery_completed", "true");
          localStorage.setItem("force_home_navigation", "true");
          
          setTimeout(() => {
            window.location.href = "/";
          }, 1500);
        } else {
          console.error("No token in recovery response");
          toast({
            title: "Uyarı",
            description: "Token alınamadı. Lütfen tekrar deneyin.",
            variant: "destructive"
          });
        }
      },
      onSettled: () => {
        setIsSubmitting(false);
      }
    }
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!combinedUsername.trim()) {
      toast({
        title: "Hata",
        description: "Lütfen kullanıcı adınızı girin.",
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
    
    const [username, apIdentifier] = combinedUsername.split('@');
    
    if (!username || !apIdentifier) {
      toast({
        title: "Hata",
        description: "Kullanıcı adı ve AP kimliği gereklidir.",
        variant: "destructive"
      });
      return;
    }
    
    // Check if all words are filled
    if (words.some(word => !word.trim())) {
      toast({
        title: "Hata",
        description: "Lütfen tüm kurtarma kelimelerini girin.",
        variant: "destructive"
      });
      return;
    }
    
    console.log(`Attempting recovery for user: ${username}@${apIdentifier}`);
    
    // Submit recovery request
    recover({
      username,
      apIdentifier,
      recoveryWords: words.join(" ")
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
              onClick={() => navigate("/")}
              className="h-8 w-8"
            >
              <ArrowLeft size={16} />
            </Button>
            <div>
              <CardTitle className="flex items-center gap-2">
                <KeyRound size={20} />
                Kimlik Kurtarma
              </CardTitle>
              <CardDescription>
                Kurtarma kelimelerinizi girerek kimliğinizi geri kazanın
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="text-sm font-medium">
                Kullanıcı Adı
              </label>
              <Input
                value={combinedUsername}
                onChange={(e) => setCombinedUsername(e.target.value)}
                placeholder="Örn: tuna@AP1"
                className="mt-1"
              />
              <p className="text-xs text-gray-500 mt-1">
                Kullanıcı adınızı ve kayıt olduğunuz AP kimliğini 'kullanıcı@AP' formatında girin.
              </p>
            </div>
            
            <div>
              <label className="text-sm font-medium">
                Kurtarma Kelimeleri
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
              {isSubmitting ? "İşleniyor..." : "Kimliği Kurtar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default Recovery;