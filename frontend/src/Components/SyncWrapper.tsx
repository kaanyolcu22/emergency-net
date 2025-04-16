import { Outlet, useNavigate } from "react-router-dom";
import SyncButton from "./SyncButton";
import useSyncStore from "@/Hooks/useSyncStore";
import { useState, useCallback, useEffect } from "react";

interface SyncWrapperProps {}

const SyncWrapper: React.FC<SyncWrapperProps> = () => {
  const navigate = useNavigate();
  const [tick, setTick] = useState<boolean>(false);
  
  const onSyncSuccess = useCallback(() => {
    setTick(true);
    setTimeout(() => setTick(false), 100);
  }, []);
  
  const { sync, isLoading } = useSyncStore(onSyncSuccess);
  
  useEffect(() => {
    const directNavigation = sessionStorage.getItem("direct_home_navigation") === "true";
    if (directNavigation) {
      sessionStorage.removeItem("direct_home_navigation");
      sync();
    }
  }, [sync]);
  
  return (
    <>
      <SyncButton
        className="absolute top-0 right-8"
        onClick={sync}
        isLoading={isLoading}
        tick={tick}
      />
      <Outlet />
    </>
  );
}

export default SyncWrapper;