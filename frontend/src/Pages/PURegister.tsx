import { Button } from "@/Components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../Components/ui/card";
import { Input } from "../Components/ui/input";
import { useMutation, useQueryClient } from "react-query";
import { register } from "@/Services/register";
import axios from "axios";
import useKeys from "@/Hooks/useKeys";
import { useState } from "react";
import { setCookie } from "typescript-cookie";
import useErrorToast from "@/Hooks/useErrorToast";
import { importPublicKeyPem } from "@/Library/crypt";
import { APResponseVerifier } from "@/Library/interceptors";
import { getPassword } from "@/Services/password";
import { useToast } from "@/Components/ui/use-toast";
import { useNavigate } from "react-router-dom";
import { hello } from "@/Services/hello";

function PURegister() {
  const { MTpublic, setAdminKey } = useKeys();
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const handleError = useErrorToast();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { mutate: sendPURegister } = useMutation(
    () => {
      if (username.length < 3) {
        throw new Error("Kullanıcı ismi geçersiz.");
      }
      return register({ key: MTpublic!, username: username, password });
    },
    {
      async onSuccess(data) {
        try {
          console.log("Registration response:", data);
          const content = await APResponseVerifier(data);
          console.log("Verified content:", content);
          
          const adminKey = await importPublicKeyPem(content.adminPubKey);
          setAdminKey(adminKey);
          queryClient.invalidateQueries(["adminKey"]);
          
          setCookie("token", content.token, {
            sameSite: "Lax",
            secure: location.protocol === 'https:',
            expires: 365,
            path: '/'
          });
          
          if (content.pu_cert) {
            localStorage.setItem("pu_cert", content.pu_cert);
          }
          
          axios.defaults.headers.common['Authorization'] = content.token;
          
          toast.toast({ 
            title: "Kayıt Başarılı!",
            description: "Anasayfaya yönlendiriliyorsunuz..." 
          });
          
          try {
            await hello(content.token);
            navigate("/home");
          } catch (error : any) {
            console.error("Hello verification failed:", error);
            handleError(error);
          }
        } catch (error : any) {
          console.error("Registration error:", error);
          handleError(error);
        }
      },
      onError: handleError,
    }
  );

  const { mutate: requestPassword } = useMutation(getPassword, {
    onSuccess() {
      toast.toast({ description: "Şifre istendi!" });
    },
    onError: handleError
  });

  return (
    <div className="flex flex-col justify-center items-center h-full">
      <Card className="w-[90%]">
        <CardHeader>
          <CardTitle>PU olarak kayıt Ol</CardTitle>
          <CardDescription>
            Bir isim seç ve tek kullanımlık şifreyi gir
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-col flex gap-4">
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Kullanıcı İsmi..."
          />
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Tek kullanımlık şifre..."
          />
          <div className="flex justify-end gap-4">
            <Button
              className="mt-8"
              onClick={() => requestPassword()}
              variant={"outline"}
            >
              Şifre iste
            </Button>
            <Button className="mt-8" onClick={() => sendPURegister()}>
              Gönder
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default PURegister;