import { createContext, useContext, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { getCookie, setCookie} from "typescript-cookie";
import axios from "axios";
import useErrorToast from "@/Hooks/useErrorToast";
import { verifyApCert } from "@/Library/cert";
import { APDataReference } from "@/Library/APData";
import { APResponseVerifier } from "@/Library/interceptors";
import { getTokenData } from "@/Library/token";
import { hello } from "@/Services/hello";
import { Button } from "./ui/button";
import { logout } from "@/Library/util";

// Define the TokenData interface
interface TokenData {
  mtUsername?: string;
  apReg?: string;
  mtPubKey?: string;
  todReg?: number;
  // Add other properties your token might have
}

const TokenDataContext = createContext<TokenData | null>(null);
const TokenDataUpdateContext = createContext<React.Dispatch<React.SetStateAction<TokenData | null>>>(() => {});

export const useTokenData = () => useContext(TokenDataContext);
export const useTokenDataUpdate = () => useContext(TokenDataUpdateContext);

function HelloWrapper() {
  const navigate = useNavigate();
  const location = useLocation();
  const handleError = useErrorToast();
  const [loading, setLoading] = useState(true);
  const [tokenData, setTokenData] = useState<TokenData | null>(null);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        const recoveryCompleted = localStorage.getItem("recovery_completed") === "true";
        if (recoveryCompleted) {
          console.log("Recovery completed flag found, clearing it");
          localStorage.removeItem("recovery_completed");
        }
        
        let token = getCookie("token");
        
        if (!token && localStorage.getItem("emergency_token")) {
          console.log("Using emergency token from localStorage");
          token = localStorage.getItem("emergency_token") || undefined;
          if (token) { 
          setCookie("token", token, {
            sameSite: "Lax",
              secure: location.pathname.startsWith('https:'), // Fix for protocol access
            expires: 365,
            path: '/'
          });
        }
        }
        
        if (token) {
          console.log("Token found, setting in axios headers");
          axios.defaults.headers.common["Authorization"] = token;
          
          try {
            const data = getTokenData(token);
            console.log("Token data:", data);
            setTokenData(data as TokenData); // Type assertion
          } catch (error) {
            console.error("Error parsing token data:", error);
          }
        }
        
        try {
          const res = await hello(token);
          console.log("Hello response:", res.status);
          
          const APData = await verifyApCert(res.data.content.cert);
          APDataReference.current = APData;
          console.log("AP certificate verified");
          
          const content = await APResponseVerifier(res.data);
          console.log("Response content verified");
          
          if (recoveryCompleted) {
            console.log("Recovery completed, navigating to home");
            navigate("/home");
            setLoading(false);
            return;
          }
          
          if (res.status === 202) {
            console.log("User needs to register");
            if (!["/register", "/PUregister", "/recovery"].includes(location.pathname)) {
              navigate(content.isAdmin ? "/PUregister" : "/register");
            }
          } else if (res.status === 200) {
            console.log("Status 200 - User is authenticated");
            if (["/", "/register", "/PUregister", "/recovery"].includes(location.pathname)) {
              navigate("/home");
            }
          }
        } catch (error: unknown) {
          console.error("Error in hello call:", error);
          
          // Proper error type handling
          const axiosError = error as { response?: { status: number } };
          
          if (axiosError.response && axiosError.response.status === 400) {
            console.log("Token invalid, clearing and trying without token");
            
            // Use imported setCookie and proper cookie removal
            setCookie("token", "", { path: '/', expires: -1 });
            localStorage.removeItem("emergency_token");
            delete axios.defaults.headers.common['Authorization'];
            
            try {
              const res = await hello();
              console.log("Hello response without token:", res.status);
              
              if (res.status === 202) {
                if (!["/register", "/PUregister", "/recovery"].includes(location.pathname)) {
                  const content = await APResponseVerifier(res.data);
                  navigate(content.isAdmin ? "/PUregister" : "/register");
                }
              }
            } catch (retryError) {
              console.error("Error in retry:", retryError);
              navigate("/register");
            }
          } else {
            // Properly handle error for useErrorToast by casting
            handleError(error instanceof Error ? error.message : "Unknown error");
            if (location.pathname !== "/recovery") {
              navigate("/register");
            }
          }
        }
        
        setLoading(false);
      } catch (outerError) {
        console.error("Outer error in HelloWrapper:", outerError);
        setLoading(false);
        navigate("/register");
      }
    };
  
    initializeApp();
  }, []);

  if (loading) {
    return (
      <div className="h-full w-full flex flex-col gap-4 relative items-center justify-center">
        <span>Yükleniyor...</span>
        <Button
          className="opacity-50 text-xs absolute bottom-2 right-2"
          variant={"outline"}
          size={"sm"}
          onClick={logout}
        >
          Hesabı Kapa
        </Button>
      </div>
    );
  } else {
    return (
      <TokenDataUpdateContext.Provider value={setTokenData}>
        <TokenDataContext.Provider value={tokenData}>
          <Outlet />
        </TokenDataContext.Provider>
      </TokenDataUpdateContext.Provider>
    );
  }
}

export default HelloWrapper;