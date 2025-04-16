import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/Components/ui/card";
import { Button } from "@/Components/ui/button";
import { useLocation, useNavigate } from "react-router-dom";
import { useToast } from "@/Components/ui/use-toast";
import { Copy, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";

function RecoveryWords() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  
  const recoveryWords = location.state?.recoveryWords || [];
  const isAfterRecovery = location.state?.isAfterRecovery || false;
  
  useEffect(() => {
    if (!recoveryWords || recoveryWords.length === 0) {
      navigate("/home");
    }
  }, [recoveryWords, navigate]);
  
  const copyToClipboard = () => {
    navigator.clipboard.writeText(recoveryWords.join(" "));
    setCopied(true);
    toast({
      title: "Kopyalandı!",
      description: "Kurtarma kelimeleri panoya kopyalandı."
    });
    
    setTimeout(() => setCopied(false), 2000);
  };
  
  const continueToHome = () => {
    if (confirmed) {
      navigate("/home");
    } else {
      toast({
        title: "Dikkat!",
        description: "Devam etmeden önce güvenli bir şekilde kaydettiğinizi onaylayın.",
        variant: "destructive"
      });
    }
  };

  return (
    <div className="flex flex-col justify-center items-center h-full p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {isAfterRecovery ? <RefreshCw size={20} /> : null}
            {isAfterRecovery ? "Yeni Kurtarma Anahtarınız" : "Kurtarma Anahtarınız"}
          </CardTitle>
          <CardDescription>
            {isAfterRecovery 
              ? "Kimlik kurtarma işlemi başarılı oldu. Güvenlik nedeniyle yeni kurtarma kelimeleri oluşturuldu. Bu kelimeleri güvenli bir yerde saklayın."
              : "Bu 8 kelimeyi güvenli bir yerde saklayın. Kimliğinizi kaybederseniz, bu kelimeler hesabınıza tekrar erişmenizi sağlar."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-col flex gap-6">
          <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-md">
            <div className="grid grid-cols-2 gap-2">
              {recoveryWords.map((word, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="text-gray-500 w-6 text-right">{index+1}.</span>
                  <span className="font-mono font-medium">{word}</span>
                </div>
              ))}
            </div>
            
            <Button 
              variant="outline"
              className="w-full mt-4 flex items-center justify-center gap-2"
              onClick={copyToClipboard}
            >
              {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
              {copied ? "Kopyalandı!" : "Panoya Kopyala"}
            </Button>
          </div>
          
          <div className={`p-4 rounded-md border ${isAfterRecovery 
            ? "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800" 
            : "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800"}`}>
            <div className={`flex items-start gap-2 ${isAfterRecovery 
              ? "text-blue-800 dark:text-blue-400" 
              : "text-yellow-800 dark:text-yellow-400"}`}>
              <AlertTriangle size={20} className="flex-shrink-0 mt-0.5" />
              <p className="text-sm">
                {isAfterRecovery 
                  ? "DİKKAT: Eski kurtarma kelimeleriniz artık geçerli değil. Yalnızca bu yeni kelimeleri kullanabilirsiniz. Bu kelimeleri bir kağıda yazın ve güvenli bir yerde saklayın."
                  : "Bu kelimeleri bir kağıda yazın ve güvenli bir yerde saklayın. Bu kelimeleri kaybederseniz, hesabınıza bir daha erişemeyebilirsiniz. Kimseyle paylaşmayın!"}
              </p>
            </div>
          </div>
          
          <label className="flex items-center gap-2 cursor-pointer">
            <input 
              type="checkbox" 
              checked={confirmed}
              onChange={() => setConfirmed(!confirmed)}
              className="w-4 h-4"
            />
            <span className="text-sm">
              {isAfterRecovery 
                ? "Yeni kurtarma kelimelerimi güvenli bir şekilde kaydettim ve eski kelimelerimin artık çalışmayacağını anlıyorum."
                : "Kurtarma kelimelerimi güvenli bir şekilde kaydettim ve kimseyle paylaşmayacağım."}
            </span>
          </label>
          
          <Button 
            onClick={continueToHome}
            className={!confirmed ? "opacity-70" : ""}
          >
            Devam Et
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default RecoveryWords;