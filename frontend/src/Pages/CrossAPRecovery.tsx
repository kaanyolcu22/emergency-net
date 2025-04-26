// src/Components/CrossAPRecovery.tsx
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
  AlertTriangle, 
  Clock 
} from "lucide-react";
import { useMutation, useQuery } from "react-query";
import { 
  checkRecoveryStatus, 
  completeRecovery 
} from "@/Services/recovery"; 
import { setCookie } from "typescript-cookie";
import axios from "axios";

function CrossAPRecovery() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [combinedUsername, setCombinedUsername] = useState("");
  const [words, setWords] = useState(Array(8).fill(""));
  const [recoveryRequestId, setRecoveryRequestId] = useState("");
  const [recoveryState, setRecoveryState] = useState("initial"); // initial, submitted, checking, completed, error
  const [errorMessage, setErrorMessage] = useState("");
  
  // Handle word input change
  const handleWordChange = (index, value) => {
    const newWords = [...words];
    newWords[index] = value;
    setWords(newWords);
  };
  
  // Check recovery status periodically
  const { data: statusData, refetch: refetchStatus } = useQuery(
    ["recoveryStatus", recoveryRequestId],
    () => checkRecoveryStatus(recoveryRequestId),
    {
      enabled: recoveryState === "checking" && !!recoveryRequestId,
      refetchInterval: 10000, // Check every 10 seconds
      onSuccess: (data) => {
        console.log("Recovery status:", data);
        
        if (data.status === "completed") {
          setRecoveryState("ready");
          toast({
            title: "Kurtarma hazır!",
            description: "Kimliğiniz bulundu. Kurtarma kelimelerinizle işlemi tamamlayın.",
            variant: "default"
          });
        } else if (data.status === "expired") {
          setRecoveryState("error");
          setErrorMessage("Kurtarma isteği süresi doldu. Lütfen tekrar deneyin.");
          toast({
            title: "İstek süresi doldu",
            description: "Kurtarma isteği süresi doldu. Lütfen tekrar deneyin.",
            variant: "destructive"
          });
        }
      },
      onError: (error) => {
        console.error("Error checking status:", error);
        // Don't change state yet, continue checking
      }
    }
  );
  
  // Initiate recovery
  const { mutate: recover, isLoading: isRecovering } = useMutation(
    (recoveryData) => initiateRecovery(recoveryData),
    {
      onSuccess: (data) => {
        console.log("Recovery initiation response:", data);
        
        if (data.status === "completed" && data.token) {
          // Local recovery succeeded immediately
          handleSuccessfulRecovery(data.token, data.adminPubKey);
        } else if (data.status === "pending" && data.recoveryRequestId) {
          // Cross-AP recovery initiated
          setRecoveryRequestId(data.recoveryRequestId);
          setRecoveryState("checking");
          toast({
            title: "Kurtarma başlatıldı",
            description: "Kurtarma isteği oluşturuldu ve diğer cihazlara yayılıyor. Durum kontrol ediliyor...",
          });
        } else {
          setRecoveryState("error");
          setErrorMessage("Beklenmeyen yanıt. Lütfen tekrar deneyin.");
        }
      },
      onError: (error) => {
        console.error("Recovery error:", error);
        setRecoveryState("error");
        setErrorMessage(error.response?.data?.error || "Kurtarma başlatılırken bir hata oluştu.");
        toast({
          title: "Kurtarma hatası",
          description: error.response?.data?.error || "Kurtarma başlatılırken bir hata oluştu.",
          variant: "destructive"
        });
      }
    }
  );
  
  // Complete recovery with recovery words
  const { mutate: finishRecovery, isLoading: isFinishing } = useMutation(
    (data) => completeRecovery(data.requestId, data.recoveryWords),
    {
      onSuccess: (data) => {
        console.log("Recovery completion response:", data);
        handleSuccessfulRecovery(data.token, data.adminPubKey);
      },
      onError: (error) => {
        console.error("Recovery completion error:", error);
        toast({
          title: "Kurtarma tamamlanamadı",
          description: error.response?.data?.error || "Kurtarma tamamlanırken bir hata oluştu.",
          variant: "destructive"
        });
      }
    }
  );
  
  // Handle successful recovery
  const handleSuccessfulRecovery = (token, adminPubKey) => {
    toast({
      title: "Başarılı!",
      description: "Kimliğiniz başarıyla kurtarıldı. Anasayfaya yönlendiriliyorsunuz."
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
      
      if (adminPubKey) {
        localStorage.setItem("adminPubKey", adminPubKey);
      }
      
      localStorage.setItem("recovery_completed", "true");
      
      setTimeout(() => {
        window.location.href = "/";
      }, 1500);
    }
  };
  
  // Handle form submission
  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Validate combined username
    if (!combinedUsername.trim()) {
      toast({
        title: "Hata",
        description: "Lütfen kullanıcı adınızı girin.",
        variant: "destructive"
      });
      return;
    }
    
    // Check for @ symbol
    if (!combinedUsername.includes('@')) {
      toast({
        title: "Hata",
        description: "Kullanıcı adı formatı yanlış. 'kullanıcı@AP' formatında olmalıdır.",
        variant: "destructive"
      });
      return;
    }
    
    // Split the combined username
    const [username, apIdentifier] = combinedUsername.split('@');
    
    if (!username || !apIdentifier) {
      toast({
        title: "Hata",
        description: "Kullanıcı adı ve AP kimliği gereklidir.",
        variant: "destructive"
      });
      return;
    }
    
    // Check if all words are filled for initial recovery
    if (recoveryState !== "ready" && words.some(word => !word.trim())) {
      toast({
        title: "Hata",
        description: "Lütfen tüm kurtarma kelimelerini girin.",
        variant: "destructive"
      });
      return;
    }
    
    if (recoveryState === "ready" && recoveryRequestId) {
      // Complete cross-AP recovery
      finishRecovery({
        requestId: recoveryRequestId,
        recoveryWords: words.join(" ")
      });
    } else {
      // Initiate recovery
      setRecoveryState("submitted");
      recover({
        username,
        apIdentifier,
        recoveryWords: words.join(" ")
      });
    }
  };
  
  // Render different UI states
  let content;
  
  if (recoveryState === "checking") {
    content = (
      <div className="text-center py-6 space-y-4">
        <div className="flex justify-center">
          <Clock size={48} className="text-blue-500 animate-pulse" />
        </div>
        <h3 className="text-xl font-semibold">Kurtarma isteği işleniyor</h3>
        <p className="text-gray-500 dark:text-gray-400">
          Kimliğiniz başka bir erişim noktasında (AP) kayıtlı. İsteğiniz ağ üzerinden yayılıyor ve kimliğinizi bulmak için çalışıyoruz.
        </p>
        <div className="flex items-center justify-center gap-2">
          <Loader2 className="animate-spin h-5 w-5" />
          <span>Durum kontrol ediliyor...</span>
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400 mt-4">
          Bu işlem kullanıcıların hareketliliğine bağlı olarak birkaç dakika ile birkaç saat arasında sürebilir.
        </div>
        <Button 
          variant="outline" 
          onClick={() => navigate("/")}
          className="mt-4"
        >
          Ana sayfaya dön
        </Button>
      </div>
    );
  }   else if (recoveryState === "error") {
    content = (
      <div className="text-center py-6 space-y-4">
        <div className="flex justify-center">
          <XCircle size={48} className="text-red-500" />
        </div>
        <h3 className="text-xl font-semibold">Kurtarma hatası</h3>
        <p className="text-red-500 dark:text-red-400">
          {errorMessage || "Kurtarma işlemi sırasında bir hata oluştu."}
        </p>
        <Button 
          onClick={() => setRecoveryState("initial")}
          className="mt-2"
        >
          Tekrar dene
        </Button>
      </div>
    );
  } else if (recoveryState === "ready") {
    content = (
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-md border border-green-200 dark:border-green-800">
          <div className="flex items-start gap-2 text-green-800 dark:text-green-400">
            <CheckCircle2 size={20} className="flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Kimliğiniz bulundu!</p>
              <p className="text-sm">
                Lütfen kurtarma kelimelerinizi girerek kimliğinizi doğrulayın. Bu işlem, kimliğinizi kurtarmak için son adımdır.
              </p>
            </div>
          </div>
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
          className="w-full"
          disabled={isFinishing}
        >
          {isFinishing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              İşleniyor...
            </>
          ) : "Kimliği Kurtar"}
        </Button>
      </form>
    );
  } else {
    // Initial state or submitted state
    content = (
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
            disabled={isRecovering}
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
              İşleniyor...
            </>
          ) : "Kimliği Kurtar"}
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
                Uzak AP Kimlik Kurtarma
              </CardTitle>
              <CardDescription>
                Farklı erişim noktalarında kayıtlı hesapları kurtarın
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