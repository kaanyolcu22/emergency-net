import { Button } from "@/Components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../Components/ui/card";
import { Input } from "../Components/ui/input";
import axios from "axios";
import { useMutation, useQueryClient } from "react-query";
import { register } from "@/Services/register";
import useKeys from "@/Hooks/useKeys";
import { useState } from "react";
import { setCookie } from "typescript-cookie";
import { removeCookie } from "typescript-cookie";
import useErrorToast from "@/Hooks/useErrorToast";
import { importPublicKeyPem } from "@/Library/crypt";
import { APResponseVerifier } from "@/Library/interceptors";
import { useNavigate } from "react-router-dom";
import { KeyRound } from "lucide-react";

function Register() {
  const { MTpublic, setAdminKey } = useKeys();
  const [username, setUsername] = useState<string>("");
  const handleError = useErrorToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  
  const { mutate: sendRegister } = useMutation(
    () => {
      if (username.length < 3) {
        throw new Error("Kullanıcı ismi geçersiz.");
      }
      return register({ key: MTpublic!, username: username });
    },
    {
      async onSuccess(data) {
        try {
          const content = await APResponseVerifier(data);
          const adminKey = await importPublicKeyPem(content.adminPubKey);
          setAdminKey(adminKey);
          const tokenParts = content.token.split('.');
          const tokenData = JSON.parse(atob(tokenParts[0]));
          console.log("Token's public key:", tokenData.mtPubKey.substring(0, 50) + "...");
          
          setCookie("token", content.token, {
            sameSite: "Lax",
            secure: location.protocol === 'https:',
            expires: 365,
            path: '/'
          });
          
          axios.defaults.headers.common['Authorization'] = content.token;
          localStorage.setItem("tokenData", JSON.stringify(tokenData));
          
          if (content.recoveryWords) {
            navigate("/recovery-words", { state: { recoveryWords: content.recoveryWords } });
          } else {
            navigate("/home");
          }
        }
        catch (error) {
          handleError(error as Error)
          localStorage.removeItem("adminKey");
          removeCookie("token");
        }
      },
      onError: handleError,
    }
  );
  
  const navigateToRecovery = () => {
    navigate("/recovery");
  };

  return (
    <div className="flex flex-col justify-center items-center h-full">
      <Card className="w-[90%]">
        <CardHeader>
          <CardTitle>Kayıt Ol</CardTitle>
          <CardDescription>Bir isim seç</CardDescription>
        </CardHeader>
        <CardContent className="flex-col flex gap-4">
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Kullanıcı İsmi..."
          />
          
          <div className="flex justify-between items-center mt-8">
            <Button 
              variant="outline" 
              onClick={navigateToRecovery}
              className="flex items-center gap-2"
            >
              <KeyRound size={16} />
              Kimliğini Kurtar
            </Button>
            
            <Button onClick={() => sendRegister()}>
              Gönder
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default Register;