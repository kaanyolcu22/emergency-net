// src/Pages/Home.tsx - Updated to show temporary identity status
import AreYouSureDialog from "@/Components/AreYouSureDialog";
import { useTokenData } from "@/Components/HelloWrapper";
import { Button } from "@/Components/ui/button";
import { Card } from "@/Components/ui/card";
import { Input } from "@/Components/ui/input";
import { useAPData } from "@/Hooks/useAPData";
import useKeys from "@/Hooks/useKeys";
import useSyncStore from "@/Hooks/useSyncStore";
import { giveSignatureToAp } from "@/Library/cert";
import { logout } from "@/Library/util";
import { certify, requestToCertify } from "@/Services/certify";
import { createChannel, destroyChannel } from "@/Services/channel";
import { AlertTriangle, MessagesSquare, Trash2, Clock, UserCheck } from "lucide-react";
import { useState } from "react";
import { useMutation } from "react-query";
import { useNavigate } from "react-router-dom";

function Home() {
  const { store, sync } = useSyncStore();
  const { isPU } = useKeys();
  const [channelName, setChannelName] = useState("");
  const navigate = useNavigate();
  const APData = useAPData();
  const tokenData = useTokenData();
  const usernick = `${tokenData?.mtUsername}@${tokenData?.apReg}`;
  
  // Check if user has temporary identity
  const isTemporary = tokenData?.isTemporary || localStorage.getItem("is_temporary_identity") === "true";
  const originalUsername = tokenData?.originalUsername || localStorage.getItem("pending_cross_ap_recovery") ? 
    JSON.parse(localStorage.getItem("pending_cross_ap_recovery") || "{}").originalUsername : null;

  const { mutate: addChannel } = useMutation<void, Error, string>(
    (channelName: string) => createChannel(channelName),
    {
      onSuccess() {
        sync();
        setChannelName("");
      },
    }
  );

  const { mutate: deleteChannel } = useMutation<void, Error, string>(
    (channelName: string) => {
      return destroyChannel(channelName);
    },
    {
      onSuccess() {
        sync();
      },
      onError(error) {
        console.error("Channel deletion failed:", error);
      }
    }
  );

  const { mutate: certifyAP } = useMutation(
    async () => {
      const { apContent } = (await requestToCertify()).content;
      const signature = await giveSignatureToAp(JSON.stringify(apContent));
      const response = (await certify({ signature })).content;
      return response;
    },
    {
      onSuccess() {
        location.reload();
      },
    }
  );

  return (
    <div className="p-1 relative">
      <div className="flex flex-col m-5 items-stretch gap-4">
        {/* Temporary Identity Banner */}
        {isTemporary && (
          <Card className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
            <div className="flex items-start gap-2 text-blue-800 dark:text-blue-400">
              <Clock size={20} className="flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium">Using Temporary Identity</p>
                <p className="text-sm">
                  You're currently using <strong>{usernick}</strong> while recovering <strong>{originalUsername}</strong>
                </p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-2 text-blue-700 border-blue-300 hover:bg-blue-100"
                  onClick={() => navigate("/recovery")}
                >
                  <UserCheck size={16} className="mr-1" />
                  Check Recovery Status
                </Button>
              </div>
            </div>
          </Card>
        )}

        <div className="w-full flex items-center justify-start gap-2">
          <AreYouSureDialog
            title="Çıkmak istediğinize emin misiniz?"
            onAccept={logout}
          >
            <Button className="!bg-red-500 w-min text-xs">
              Çıkış Yap
            </Button>
          </AreYouSureDialog>
          <span className="text-sm">{usernick}</span>
          {isTemporary && (
            <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-400 rounded-full border">
              TEMP
            </span>
          )}
        </div>

        {isPU && APData?.type === "non_certified" && (
          <div className="flex justify-stretch items-stretch h-10">
            <Button className="h-full" onClick={() => certifyAP()}>
              Make AP Trusted
            </Button>
          </div>
        )}

        {APData?.type === "non_certified" && (
          <Card className="p-4 flex gap-2 text-sm">
            <AlertTriangle className="flex-none" /> 
            The AP you're connected to is not secure, messages sent from here will be marked as unsafe.
          </Card>
        )}

        <Card className="p-4 flex gap-4">
          <MessagesSquare /> Kanallar
        </Card>

        {isPU && !isTemporary && (
          <div className="flex justify-stretch items-stretch h-10 gap-4">
            <Input
              placeholder="Channel Name..."
              value={channelName}
              onChange={(e) => setChannelName(e.target.value)}
              className="h-full"
            />
            <Button
              onClick={() => addChannel(channelName)}
              className="h-full"
            >
              Add
            </Button>
          </div>
        )}

        {isTemporary && (
          <Card className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
            <p className="text-sm text-yellow-800 dark:text-yellow-400">
              <strong>Note:</strong> Channel management is disabled for temporary identities.
            </p>
          </Card>
        )}

        {store?.channels?.filter((c) => c.isActive)
          ?.map((channel) => (
            <Card
              onClick={() => navigate(`/channel/${channel.channelName}`)}
              className="p-8 flex gap-8 transition-transform duration-100 active:scale-95 relative"
              key={channel.channelName}
            >
              {channel.channelName}
              {isPU && !isTemporary && (
                <AreYouSureDialog
                  title="Are you sure you want to delete this channel?"
                  onAccept={() => deleteChannel(channel.channelName)}
                  className="absolute right-2 text-red-500"
                >
                  <Trash2 />
                </AreYouSureDialog>
              )}
            </Card>
          ))}
      </div>
      <span className="text-xs text-gray-400 fixed bottom-1 right-1">
        {APData?.id} - {APData?.type}
      </span>
    </div>
  );
}

export default Home;