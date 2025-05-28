// src/Components/HelloWrapper.tsx - Updated for unified recovery
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
import { autoFixAuthenticationIssues } from '../Library/client-key-sync-fix.js';

interface TokenData {
  mtUsername?: string;
  apReg?: string;
  mtPubKey?: string;
  todReg?: number;
  isTemporary?: boolean;
  tempUserId?: string;
  originalUsername?: string;
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
        const fixResult = await autoFixAuthenticationIssues();
        if (fixResult.action === "redirect_register") {
          navigate("/register");
          return;
        } else if (fixResult.action === "offer_recovery") {
          navigate("/recovery");
          return;
        }
        
        const recoveryCompleted = localStorage.getItem("recovery_completed") === "true";
        if (recoveryCompleted) {
          localStorage.removeItem("recovery_completed");
        }
        
        let token = getCookie("token");
        
        if (!token && localStorage.getItem("emergency_token")) {
          token = localStorage.getItem("emergency_token") || undefined;
          if (token) { 
            setCookie("token", token, {
              sameSite: "Lax",
              secure: location.pathname.startsWith('https:'), 
              expires: 365,
              path: '/'
            });
          }
        }
        
        if (token) {
          axios.defaults.headers.common["Authorization"] = token;
          
          try {
            const data = getTokenData(token);
            setTokenData(data as TokenData); 
          } catch (error) {
            console.error("Error parsing token data:", error);
          }
        }
        
        try {
          const res = await hello(token);
          
          const APData = await verifyApCert(res.data.content.cert);
          APDataReference.current = APData;
          
          const content = await APResponseVerifier(res.data);
          
          if (recoveryCompleted) {
            navigate("/home");
            setLoading(false);
            return;
          }
          
          if (res.status === 202) {
            if (!["/register", "/PUregister", "/recovery"].includes(location.pathname)) {
              navigate(content.isAdmin ? "/PUregister" : "/register");
            }
          } else if (res.status === 200) {
            if (["/", "/register", "/PUregister", "/recovery"].includes(location.pathname)) {
              navigate("/home");
            }
          }
        } catch (error: unknown) {
          console.error("Error in hello call:", error);

          const axiosError = error as { response?: { status: number } };
          
          if (axiosError.response && axiosError.response.status === 400) {
            setCookie("token", "", { path: '/', expires: -1 });
            localStorage.removeItem("emergency_token");
            delete axios.defaults.headers.common['Authorization'];
            
            try {
              const res = await hello();
              
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
        <span>Loading...</span>
        <Button
          className="opacity-50 text-xs absolute bottom-2 right-2"
          variant={"outline"}
          size={"sm"}
          onClick={logout}
        >
          Logout
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