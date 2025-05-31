// src/Components/CameraCapture.tsx - with fixes
import { useState, useRef, useEffect } from 'react';
import { Button } from "@/Components/ui/button";
import { compressImageForEmergencyNetwork } from "@/Services/message";
import { CameraCaptureProps } from '@/types/types';

function CameraCapture({ onImageCaptured, onCancel }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isFrontCamera, setIsFrontCamera] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const startCamera = async () => {
    console.log("Starting camera...");
    try {
      const constraints = {
        video: { 
          facingMode: isFrontCamera ? "user" : "environment",
          width: { ideal: 640 },
          height: { ideal: 480 }
        }
      };
      
      console.log("Requesting camera with constraints:", constraints);
      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      if (!videoRef.current) {
        console.error("Video element is not available");
        setErrorMessage("Video element is not available");
        return;
      }
      
      console.log("Media stream obtained:", mediaStream);
      videoRef.current.srcObject = mediaStream;
      setStream(mediaStream);
      setIsCameraActive(true);
      setErrorMessage("");
    } catch (err: unknown) {
      console.error("Error accessing camera:", err);
      setErrorMessage("Camera access failed: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  };

  const stopCamera = () => {
    console.log("Stopping camera...");
    if (stream) {
      stream.getTracks().forEach((track: MediaStreamTrack) => {
        console.log("Stopping track:", track.kind);
        track.stop();
      });
      setStream(null);
      setIsCameraActive(false);
    }
  };

  const switchCamera = () => {
    console.log("Switching camera...");
    stopCamera();
    setIsFrontCamera(!isFrontCamera);
  };

  const capturePhoto = async () => {
    console.log("Capture photo called");
    if (!isCameraActive) {
      console.log("Camera not active, can't capture");
      return;
    }
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (!video || !canvas) {
      console.error("Video or canvas not available");
      setErrorMessage("Video or canvas not available");
      return;
    }
    
    console.log("Video dimensions:", video.videoWidth, video.videoHeight);
  
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      console.error("No video data available yet");
      setErrorMessage("Video stream is not ready yet. Please wait a moment.");
      return;
    }
    
    const context = canvas.getContext('2d');
    
    if (!context) {
      console.error("Could not get canvas context");
      return;
    }
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    canvas.toBlob(async (blob) => {
      if (!blob) {
        console.error("Failed to create image blob");
        setErrorMessage("Failed to create image");
        return;
      }
      
      try {
        console.log("Raw image size:", blob.size);
        const compressedImage = await compressImageForEmergencyNetwork(
          new File([blob], "camera-capture.jpg", { type: "image/jpeg" })
        );
        
        if (compressedImage) {
        console.log("Compressed image size:", compressedImage.size);
        onImageCaptured(compressedImage);
        stopCamera();
        } else {
          setErrorMessage("Failed to compress image");
        }
      } catch (error: unknown) {
        console.error("Error processing captured image:", error);
        setErrorMessage("Failed to process image: " + (error instanceof Error ? error.message : "Unknown error"));
      }
    }, 'image/jpeg', 0.8);
  };

  useEffect(() => {
    console.log("Camera component mounted or front camera changed");
    startCamera();
    
    return () => {
      console.log("Camera component unmounting");
      stopCamera();
    };
  }, [isFrontCamera]); 

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 z-50 flex flex-col items-center justify-center">
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg max-w-md w-full">
        <h3 className="text-lg font-medium mb-2">Fotoğraf Çek</h3>
        
        {errorMessage && (
          <div className="mb-2 p-2 bg-red-100 text-red-700 rounded-md text-sm">
            {errorMessage}
          </div>
        )}
        
        <div className="relative bg-black rounded-md overflow-hidden aspect-video mb-4">
          <video 
            ref={videoRef} 
            autoPlay
            playsInline
            muted 
            className="w-full h-full object-cover"
            onCanPlay={() => console.log("Video can play now")}
          />
          <canvas ref={canvasRef} className="hidden" />
        </div>
        
        <div className="flex justify-between gap-2">
          <Button 
            variant="outline" 
            onClick={onCancel} 
            className="w-full"
          >
            İptal
          </Button>
          
          <Button 
            variant="outline" 
            onClick={switchCamera} 
            className="flex-none"
            disabled={!navigator.mediaDevices?.getUserMedia}
          >
            Çevir
          </Button>
          
          <Button 
            onClick={capturePhoto} 
            className="w-full"
            disabled={!isCameraActive}
          >
            Çek
          </Button>
        </div>
      </div>
    </div>
  );
}

export default CameraCapture;