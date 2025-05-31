import { useTokenData } from "@/Components/HelloWrapper";
import { Button } from "@/Components/ui/button";
import { Input } from "@/Components/ui/input";
import useSyncStore from "@/Hooks/useSyncStore";
import { cn } from "@/Library/cn";
import { convertTodToDate } from "@/Library/date";
import { message } from "@/Services/message";
import CameraCapture from '@/Components/CameraCapture';

import {
  AlertCircle,
  ArrowLeftCircle,
  MessagesSquare,
  SendHorizonal,
  Camera,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "react-query";
import { Link, useParams } from "react-router-dom";

interface MessageData {
  content: string;
  usernick: string;
  tod: number;
  hasImage?: boolean;
  imageData?: string;
  imageUrl?: string;
  isSafe: boolean;
}

interface MessageProps {
  msg: MessageData;
  my: boolean;
  loading?: boolean;
  isSafe: boolean;
}

interface MessageParams {
  messageStr: string;
  imageData?: File | null;
}


function Message({ msg, my, loading, isSafe }: MessageProps) {
  const imageUrl = msg.imageUrl || (msg.hasImage && msg.imageData ? 
    `data:image/jpeg;base64,${msg.imageData}` : null);

  return (
    <div
      className={cn(
        "p-4 pt-2 rounded-lg relative flex-none bg-gray-200 text-sm pb-6 shadow-lg dark:bg-gray-900 max-w-[80%] self-start overflow-hidden dark:text-gray-300",
        my && "dark:bg-gray-400 bg-gray-200 self-end dark:text-gray-900",
        loading && "opacity-50"
      )}
    >
      <div
        className={cn(
          "w-full text-xs font-bold mb-1 overflow-hidden whitespace-nowrap text-ellipsis",
          my && "text-right"
        )}
      >
        {msg.usernick}
      </div>
      
      {msg.content && <div>{msg.content}</div>}
      
      {imageUrl && (
        <div className="mt-2 max-w-full">
          <img 
            src={imageUrl} 
            alt="Message attachment" 
            className="max-w-full rounded-md max-h-[300px] object-contain cursor-pointer"
            onClick={() => window.open(imageUrl, '_blank')}
          />
        </div>
      )}
      
      <span className="absolute bottom-0 right-2 text-[10px] text-gray-400 font-light">
        {msg.tod && convertTodToDate(msg.tod)}
      </span>
      {!isSafe && (
        <AlertCircle className="bottom-1 left-1 absolute w-4 h-4 text-red-500" />
      )}
    </div>
  );
}

function Channel() {
  const { channelName } = useParams<{ channelName: string }>();
  const [input, setInput] = useState<string>("");
  const tokenData = useTokenData();
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const usernick = `${tokenData?.mtUsername}@${tokenData?.apReg}`;
  
  const { store, sync } = useSyncStore(() => {
    setTimeout(
      () =>
        messagesRef.current &&
        messagesRef.current.scrollTo({
          top: messagesRef.current.scrollHeight,
          behavior: "smooth", 
        }),
      500
    );
  });
  
  const [loadingMsg, setLoadingMsg] = useState<MessageData | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  const { mutate: sendMessage } = useMutation<any, Error, MessageParams>(
    ({ messageStr, imageData }: MessageParams) => {
      const msgContent = messageStr.trim();
      
      return message({
        msgContent: msgContent,
        channel: channelName || "",
        imageData: imageData || undefined
      });
    },
    {
      onSuccess() {
        sync();
        setLoadingMsg(null);
        setSelectedImage(null); 
      },
      onMutate({ messageStr, imageData }) {
        setInput("");
        
        const localImageUrl = imageData ? URL.createObjectURL(imageData) : undefined;
        
        setLoadingMsg({ 
          content: messageStr, 
          usernick,
          tod: Date.now(),
          imageUrl: localImageUrl,
          isSafe: true
        });
        
        setTimeout(
          () =>
            messagesRef.current &&
            messagesRef.current.scrollTo({
              top: messagesRef.current.scrollHeight,
              behavior: "smooth",
            }),
          100 
        );
      },
    }
  );

  function handleImageSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setSelectedImage(file);
      if (event.target) {
        event.target.value = '';
      }
    } catch (error) {
      console.error("Error selecting image:", error);
      if (event.target) {
        event.target.value = '';
      }
    }
  }

  function handleCameraCapture(capturedImage: File) {
    setSelectedImage(capturedImage);
    setIsCameraActive(false);
  }

  function handleCameraCancel() {
    setIsCameraActive(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if ((input.length > 0 || selectedImage) && channelName) {
      sendMessage({
        messageStr: input,
        imageData: selectedImage
      });
    }
  }

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTo({
        top: messagesRef.current.scrollHeight,
        behavior: "instant", 
      });
    }
  }, [messagesRef.current]);

  if (!channelName) {
    return <div>Channel not found</div>;
  }

  return (
    <div className="grid grid-rows-[60px_1fr_60px] h-full">
      <div className="border-b border-gray-200 dark:border-gray-600 dark:text-gray-400 flex items-center dark:bg-gray-900 text-lg">
        <Link
          className="h-full aspect-square flex items-center justify-center transition-transform duration-100 active:scale-95"
          to={"/home"}
        >
          <ArrowLeftCircle size={35} className="text-gray-400" />
        </Link>
        <div className="flex gap-2 items-center ml-2">
          <MessagesSquare /> {channelName}
        </div>
      </div>

      <div
        className="shadow-inner flex flex-col gap-4 py-4 px-2 overflow-auto"
        ref={messagesRef}
      >
        {store?.messages?.[channelName] &&
          Object.values(store?.messages?.[channelName])
            ?.sort((a: any, b: any) => a.tod - b.tod)
            ?.map((msg: any, index: number) => (
              <Message
                msg={msg}
                my={msg.usernick === usernick}
                isSafe={msg.isSafe}
                key={msg.content + msg.usernick + index}
              />
            ))}
        {loadingMsg && (
          <Message msg={loadingMsg} my={true} loading={true} isSafe={true} />
        )}
      </div>
      
      <div className="border-t border-gray-200 dark:border-gray-700 dark:bg-gray-900">
        <form
          className="flex items-stretch justify-stretch h-full w-full gap-2 p-2"
          onSubmit={handleSubmit}
        >
          {selectedImage && (
            <div className="relative h-full aspect-square">
              <img
                src={URL.createObjectURL(selectedImage)}
                className="h-full object-cover rounded-md"
                alt="Preview"
              />
              <button
                className="absolute top-0 right-0 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs"
                onClick={() => setSelectedImage(null)}
                type="button"
              >
                ×
              </button>
            </div>
          )}

          <Input
            className="flex-1 h-full border-2 dark:bg-gray-200 bg-white text-gray-950"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />

          <Button
            type="button"
            className="h-full aspect-square p-0 dark:bg-gray-700 dark:text-gray-100"
            onClick={() => setIsCameraActive(true)}
          >
            <Camera size={20} />
          </Button>

          <input
            type="file"
            accept="image/*"
            className="hidden"
            ref={fileInputRef}
            onChange={handleImageSelect}
          />

          <Button
            type="submit"
            className="h-full aspect-square p-0 transition-transform duration-100 active:scale-95 dark:bg-gray-700 dark:text-gray-100"
          >
            <SendHorizonal />
          </Button>
        </form>
      </div>
      
      {isCameraActive && (
        <CameraCapture
          onImageCaptured={handleCameraCapture}
          onCancel={handleCameraCancel}
        />
      )}
    </div>
  );
}

export default Channel;