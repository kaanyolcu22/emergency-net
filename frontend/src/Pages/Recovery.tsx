// src/Pages/Recovery.tsx - Türkçe toast bildirimleri ile geliştirilmiş

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/Components/ui/card";
import { Button } from "@/Components/ui/button";
import { Input } from "@/Components/ui/input";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/Components/ui/use-toast";
import { ArrowLeft, KeyRound, RefreshCw, Loader2} from "lucide-react";
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
      title: "Senkronizasyon başlatıldı...",
      description: "Kurtarma verileri kontrol ediliyor."
    });
    
    try {
      await sync();
      
      if (combinedUsername && combinedUsername.includes('@')) {
        const [username, apIdentifier] = combinedUsername.split('@');
        const exists = checkLocalRecoveryData(username, apIdentifier);
        
        if (exists) {
          toast({
            title: "✅ Kurtarma verisi bulundu!",
            description: "Hesap bilgileriniz yerel olarak mevcut.",
          });
        } else {
          toast({
            title: "🔍 Yerel veri bulunamadı",
            description: "Gönderdiğinizde çapraz-AP kurtarma denenecek.",
            variant: "default"
          });
        }
      }
    } catch (error) {
      console.error("Sync error:", error);
      toast({
        title: "❌ Senkronizasyon başarısız",
        description: "Kurtarma verileri senkronize edilemedi. Yine de kurtarma deneyebilirsiniz.",
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
          // YEREL KURTARMA BAŞARILI - Kutlama mesajı göster
          console.log("✅ Local recovery successful - redirecting to home");
          
          toast({
            title: "🎉 Hoş geldiniz!",
            description: "Kimliğiniz başarıyla kurtarıldı. Anasayfaya yönlendiriliyorsunuz...",
            duration: 3000,
          });
          
          await handleSuccessfulRecovery(data.token!);
          
        } else if (data.type === 'cross_ap_initiated') {
          // ÇAPRAZ-AP KURTARMA BAŞLATILDI - Geçici erişim hakkında bilgi ver
          console.log("✅ Cross-AP recovery initiated - redirecting to home with temp identity");
          
          toast({
            title: "🔄 Çapraz-AP Kurtarma Başlatıldı",
            description: `Asıl kimliğiniz aranırken geçici kimlikle sistemi kullanabilirsiniz.`,
            duration: 5000,
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
        
        // Sunucudan gelen hata mesajını analiz et ve uygun Türkçe toast göster
        if (error.response && error.response.data) {
          const errorData = error.response.data;
          const status = error.response.status;
          
          // Hesap kilitlenme durumu (423 Locked)
          if (status === 423) {
            const lockedUntil = errorData.lockedUntil;
            let lockMessage = "Hesabınız geçici olarak kilitlendi.";
            
            if (lockedUntil) {
              const unlockDate = new Date(lockedUntil);
              const now = new Date();
              const hoursRemaining = Math.ceil((unlockDate.getTime() - now.getTime()) / (1000 * 60 * 60));
              
              if (hoursRemaining > 1) {
                lockMessage = `Hesabınız ${hoursRemaining} saat daha kilitli kalacak.`;
              } else {
                lockMessage = `Hesabınız yaklaşık 1 saat daha kilitli kalacak.`;
              }
            }
            
            toast({
              title: "🔒 Hesap Kilitlendi",
              description: `${lockMessage} Çok fazla yanlış deneme yapıldı. Güvenlik için 24 saat bekleyin.`,
              variant: "destructive",
              duration: 8000,
            });
            return;
          }
          
          // Yanlış kimlik bilgileri (401 Unauthorized)
          if (status === 401) {
            const attemptsRemaining = errorData.attemptsRemaining;
            
            if (attemptsRemaining !== undefined) {
              let attemptMessage = "";
              let warningLevel = "default";
              
              if (attemptsRemaining === 1) {
                attemptMessage = "⚠️ SON DENEME HAKKI! Bir kez daha yanlış girerseniz hesabınız 24 saat kilitlenecek.";
                warningLevel = "destructive";
              } else if (attemptsRemaining === 2) {
                attemptMessage = `⚠️ Dikkat! ${attemptsRemaining} deneme hakkınız kaldı. Kurtarma kelimelerinizi kontrol edin.`;
                warningLevel = "destructive";
              } else if (attemptsRemaining <= 0) {
                attemptMessage = "Tüm deneme haklarınız tükendi. Hesabınız güvenlik için kilitlendi.";
                warningLevel = "destructive";
              } else {
                attemptMessage = `${attemptsRemaining} deneme hakkınız kaldı. Kurtarma kelimelerinizi dikkatli kontrol edin.`;
              }
              
              toast({
                title: "❌ Kurtarma Bilgileri Yanlış",
                description: attemptMessage,
                variant: warningLevel as any,
                duration: 6000,
              });
            } else {
              // Deneme sayısı bilgisi yoksa genel mesaj
              toast({
                title: "❌ Kurtarma Bilgileri Yanlış",
                description: "Kullanıcı adını ve kurtarma kelimelerini kontrol edin.",
                variant: "destructive",
                duration: 4000,
              });
            }
            return;
          }
          
          // Kullanıcı bulunamadı (404 Not Found)
          if (status === 404) {
            toast({
              title: "👤 Kullanıcı Bulunamadı",
              description: "Bu kullanıcı adı ve AP kombinasyonu bulunamadı. Kullanıcı adınızı ve AP adresini kontrol edin.",
              variant: "destructive",
              duration: 5000,
            });
            return;
          }
          
          // Sunucu hatası (500 Internal Server Error)
          if (status >= 500) {
            toast({
              title: "🔧 Sunucu Hatası",
              description: "Geçici bir teknik sorun oluştu. Birkaç dakika sonra tekrar deneyin.",
              variant: "destructive",
              duration: 5000,
            });
            return;
          }
          
          // Genel hata mesajı göster
          if (errorData.error) {
            toast({
              title: "❌ Kurtarma Hatası",
              description: errorData.error,
              variant: "destructive",
              duration: 4000,
            });
            return;
          }
        }
        
        // Eğer hiçbir özel durum yoksa, genel hata mesajı göster
        toast({
          title: "❌ Beklenmeyen Hata",
          description: error.message || "Kurtarma işlemi başarısız oldu. Ağ bağlantınızı kontrol edin.",
          variant: "destructive",
          duration: 4000,
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
        // Sync hatası olsa bile kullanıcıyı uyarmayalım, ana işlev çalışıyor
      }
      
      localStorage.setItem("recovery_completed", "true");
      
      // Anasayfaya hemen yönlendir
      navigate("/home");
    }
  };
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!combinedUsername.trim()) {
      toast({
        title: "❌ Eksik Bilgi",
        description: "Lütfen kullanıcı adınızı girin.",
        variant: "destructive"
      });
      return;
    }
    
    if (!combinedUsername.includes('@')) {
      toast({
        title: "❌ Yanlış Format", 
        description: "Kullanıcı adı formatı 'kullanici@ap' şeklinde olmalı (örn: kaan@ap1).",
        variant: "destructive"
      });
      return;
    }
    
    if (words.some(word => !word.trim())) {
      toast({
        title: "❌ Eksik Kelimeler",
        description: "Lütfen tüm kurtarma kelimelerini girin.",
        variant: "destructive"
      });
      return;
    }
    
    // Kurtarma işlemi başlatılıyor bildirimi
    toast({
      title: "🔍 Kurtarma İşlemi Başlatıldı",
      description: "Kimlik bilgileriniz doğrulanıyor...",
      duration: 2000,
    });
    
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
                  Senkronize Et
                </Button>
              </div>
              <Input
                value={combinedUsername}
                onChange={(e) => setCombinedUsername(e.target.value)}
                placeholder="örn: kaan@ap1"
                className="mt-1"
                disabled={isRecovering}
              />
              <p className="text-xs text-gray-500 mt-1">
                Kullanıcı adınızı ve hangi AP'de kayıt yaptığınızı kullanici@ap formatında belirtiniz.
              </p>
            </div>
            
            <div>
              <label className="text-sm font-medium">Kurtarma Kelimeleri</label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {words.map((word: string, index: number) => (
                  <div key={index} className="flex items-center gap-1">
                    <span className="text-gray-500 text-xs w-4">{index + 1}.</span>
                    <Input
                      value={word}
                      onChange={(e) => handleWordChange(index, e.target.value)}
                      placeholder={`${index + 1}. kelime`}
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