// src/Components/HelloWrapper.tsx - Production-ready version
import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { getCookie, setCookie, removeCookie } from "typescript-cookie";
import axios, { AxiosError } from "axios";
import { verifyApCert } from "@/Library/cert";
import { APDataReference } from "@/Library/APData";
import { APResponseVerifier } from "@/Library/interceptors";
import { getTokenData } from "@/Library/token";
import { hello } from "@/Services/hello";
import { Button } from "./ui/button";
import { logout } from "@/Library/util";

interface TokenData {
  mtUsername?: string;
  apReg?: string;
  mtPubKey?: string;
  todReg?: number;
  isTemporary?: boolean;
  tempUserId?: string;
  originalUsername?: string;
}

interface InitializationState {
  loading: boolean;
  error: string | null;
  retryCount: number;
  lastAttempt: number;
}

interface NetworkError {
  type: 'timeout' | 'auth_invalid' | 'server_error' | 'unknown';
  message: string;
}

const TokenDataContext = createContext<TokenData | null>(null);
const TokenDataUpdateContext = createContext<React.Dispatch<React.SetStateAction<TokenData | null>>>(() => {});

export const useTokenData = () => useContext(TokenDataContext);
export const useTokenDataUpdate = () => useContext(TokenDataUpdateContext);

// Constants for production reliability
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_BASE = 1000; // 1 second
const NETWORK_TIMEOUT = 15000; // 15 seconds
const RECOVERY_COMPLETED_KEY = "recovery_completed";
const EMERGENCY_TOKEN_KEY = "emergency_token";

function HelloWrapper() {
  const navigate = useNavigate();
  const location = useLocation();
  const [initState, setInitState] = useState<InitializationState>({
    loading: true,
    error: null,
    retryCount: 0,
    lastAttempt: 0
  });
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const initializationRef = useRef<boolean>(false);
  const timeoutRef = useRef<number>();

  // Utility functions
  const clearAuthData = useCallback(() => {
    removeCookie("token");
    localStorage.removeItem(EMERGENCY_TOKEN_KEY);
    delete axios.defaults.headers.common['Authorization'];
    setTokenData(null);
  }, []);

  const setAuthToken = useCallback((token: string) => {
    const isSecure = window.location.protocol === 'https:';
    setCookie("token", token, {
      sameSite: "Lax",
      secure: isSecure,
      expires: 365,
      path: '/'
    });
    localStorage.setItem(EMERGENCY_TOKEN_KEY, token);
    axios.defaults.headers.common['Authorization'] = token;
  }, []);

  const parseTokenSafely = useCallback((token: string): TokenData | null => {
    try {
      const data = getTokenData(token);
      return data as TokenData;
    } catch (error) {
      console.error("Token parsing failed:", error);
      return null;
    }
  }, []);

  const handleNetworkError = useCallback((error: unknown, context: string): NetworkError => {
    console.error(`Network error in ${context}:`, error);
    
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      
      if (axiosError.code === 'ECONNABORTED' || axiosError.message.includes('timeout')) {
        return { type: 'timeout', message: 'Connection timeout - please check your network' };
      }
      if (axiosError.response?.status === 400) {
        return { type: 'auth_invalid', message: 'Authentication invalid' };
      }
      if (axiosError.response && axiosError.response.status >= 500) {
        return { type: 'server_error', message: 'Server error - please try again' };
      }
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown network error';
    return { type: 'unknown', message: errorMessage };
  }, []);

  const performHelloRequest = useCallback(async (token?: string, retryAttempt = 0): Promise<any> => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), NETWORK_TIMEOUT);
    
    try {
      const response = await hello(token);
      window.clearTimeout(timeoutId);
      return response;
    } catch (error) {
      window.clearTimeout(timeoutId);
      
      const errorInfo = handleNetworkError(error, 'hello request');
      
      // Retry logic for network errors
      if (errorInfo.type === 'timeout' || errorInfo.type === 'server_error') {
        if (retryAttempt < MAX_RETRY_ATTEMPTS) {
          const delay = RETRY_DELAY_BASE * Math.pow(2, retryAttempt);
          console.log(`Retrying hello request in ${delay}ms (attempt ${retryAttempt + 1})`);
          
          await new Promise(resolve => window.setTimeout(resolve, delay));
          return performHelloRequest(token, retryAttempt + 1);
        }
      }
      
      throw error;
    }
  }, [handleNetworkError]);

  const handleAuthenticationFailure = useCallback(async () => {
    console.log("Handling authentication failure - clearing auth data");
    clearAuthData();
    
    try {
      // Try unauthenticated hello to determine next step
      const response = await performHelloRequest();
      
      if (response.status === 202) {
        const content = await APResponseVerifier(response.data);
        const targetRoute = content.isAdmin ? "/PUregister" : "/register";
        
        if (!["/register", "/PUregister", "/recovery"].includes(location.pathname)) {
          navigate(targetRoute);
        }
      }
    } catch (retryError) {
      console.error("Unauthenticated hello also failed:", retryError);
      if (location.pathname !== "/recovery") {
        navigate("/register");
      }
    }
  }, [clearAuthData, performHelloRequest, location.pathname, navigate]);

  const processSuccessfulAuth = useCallback(async (response: any, isRecoveryCompleted: boolean) => {
    try {
      // Verify AP certificate
      const APData = await verifyApCert(response.data.content.cert);
      APDataReference.current = APData;
      
      // Verify response signature
      const content = await APResponseVerifier(response.data);
      
      // Handle post-recovery flow
      if (isRecoveryCompleted) {
        navigate("/home");
        return;
      }
      
      // Route based on authentication status
      if (response.status === 202) {
        if (!["/register", "/PUregister", "/recovery"].includes(location.pathname)) {
          navigate(content.isAdmin ? "/PUregister" : "/register");
        }
      } else if (response.status === 200) {
        if (["/", "/register", "/PUregister", "/recovery"].includes(location.pathname)) {
          navigate("/home");
        }
      }
    } catch (verificationError) {
      console.error("Response verification failed:", verificationError);
      throw verificationError;
    }
  }, [navigate, location.pathname]);

  const initializeAuthentication = useCallback(async () => {
    // Prevent concurrent initialization
    if (initializationRef.current) {
      return;
    }
    
    initializationRef.current = true;
    
    try {
      setInitState(prev => ({
        ...prev,
        loading: true,
        error: null,
        lastAttempt: Date.now()
      }));

      // Check for recovery completion
      const recoveryCompleted = localStorage.getItem(RECOVERY_COMPLETED_KEY) === "true";
      if (recoveryCompleted) {
        localStorage.removeItem(RECOVERY_COMPLETED_KEY);
      }

      // Get authentication token
      let token = getCookie("token");
      
      // Fallback to emergency token
      if (!token) {
        const emergencyToken = localStorage.getItem(EMERGENCY_TOKEN_KEY);
        if (emergencyToken) {
          token = emergencyToken;
          setAuthToken(emergencyToken);
        }
      }

      // Parse token data if available
      if (token) {
        const parsedTokenData = parseTokenSafely(token);
        if (parsedTokenData) {
          setTokenData(parsedTokenData);
          axios.defaults.headers.common["Authorization"] = token;
        } else {
          // Invalid token - clear it
          clearAuthData();
          token = undefined;
        }
      }

      // Perform hello request
      const response = await performHelloRequest(token);
      await processSuccessfulAuth(response, recoveryCompleted);

      setInitState(prev => ({
        ...prev,
        loading: false,
        error: null,
        retryCount: 0
      }));

    } catch (error: unknown) {
      console.error("Authentication initialization failed:", error);
      
      const errorInfo = handleNetworkError(error, 'initialization');
      
      if (errorInfo.type === 'auth_invalid') {
        await handleAuthenticationFailure();
      } else {
        // Handle other errors
        setInitState(prev => ({
          ...prev,
          loading: false,
          error: errorInfo.message,
          retryCount: prev.retryCount + 1
        }));
        
        if (location.pathname !== "/recovery") {
          navigate("/register");
        }
      }
    } finally {
      initializationRef.current = false;
    }
  }, [
    clearAuthData,
    setAuthToken,
    parseTokenSafely,
    performHelloRequest,
    processSuccessfulAuth,
    handleAuthenticationFailure,
    handleNetworkError,
    location.pathname,
    navigate
  ]);

  const retryInitialization = useCallback(() => {
    if (initState.retryCount < MAX_RETRY_ATTEMPTS) {
      initializeAuthentication();
    }
  }, [initState.retryCount, initializeAuthentication]);

  // Main initialization effect
  useEffect(() => {
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set a timeout for the initialization
    timeoutRef.current = window.setTimeout(() => {
      initializeAuthentication();
    }, 100); // Small delay to ensure component is mounted

    // Cleanup timeout on unmount
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []); // Empty dependency array - only run once

  // Cleanup effect
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Loading state with error handling
  if (initState.loading) {
    return (
      <div className="h-full w-full flex flex-col gap-4 relative items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-gray-100"></div>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Initializing...
          </span>
        </div>
        
        <Button
          className="opacity-50 text-xs absolute bottom-2 right-2"
          variant="outline"
          size="sm"
          onClick={logout}
        >
          Emergency Logout
        </Button>
      </div>
    );
  }

  // Error state with retry option
  if (initState.error && initState.retryCount < MAX_RETRY_ATTEMPTS) {
    return (
      <div className="h-full w-full flex flex-col gap-4 relative items-center justify-center p-4">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 max-w-md">
          <h3 className="text-red-800 dark:text-red-400 font-medium mb-2">
            Connection Error
          </h3>
          <p className="text-red-700 dark:text-red-300 text-sm mb-4">
            {initState.error}
          </p>
          <div className="flex gap-2">
            <Button
              onClick={retryInitialization}
              size="sm"
              className="flex-1"
            >
              Retry ({MAX_RETRY_ATTEMPTS - initState.retryCount} attempts left)
            </Button>
            <Button
              onClick={() => navigate("/register")}
              variant="outline"
              size="sm"
              className="flex-1"
            >
              Continue Offline
            </Button>
          </div>
        </div>
        
        <Button
          className="opacity-50 text-xs absolute bottom-2 right-2"
          variant="outline"
          size="sm"
          onClick={logout}
        >
          Reset App
        </Button>
      </div>
    );
  }

  // Fatal error state
  if (initState.error && initState.retryCount >= MAX_RETRY_ATTEMPTS) {
    return (
      <div className="h-full w-full flex flex-col gap-4 relative items-center justify-center p-4">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 max-w-md">
          <h3 className="text-red-800 dark:text-red-400 font-medium mb-2">
            Unable to Connect
          </h3>
          <p className="text-red-700 dark:text-red-300 text-sm mb-4">
            After multiple attempts, we couldn't establish a connection. Please check your network and try again.
          </p>
          <div className="flex gap-2">
            <Button
              onClick={() => window.location.reload()}
              size="sm"
              className="flex-1"
            >
              Reload App
            </Button>
            <Button
              onClick={logout}
              variant="outline"
              size="sm"
              className="flex-1"
            >
              Reset
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Success state - render the app
  return (
    <TokenDataUpdateContext.Provider value={setTokenData}>
      <TokenDataContext.Provider value={tokenData}>
        <Outlet />
      </TokenDataContext.Provider>
    </TokenDataUpdateContext.Provider>
  );
}

export default HelloWrapper;