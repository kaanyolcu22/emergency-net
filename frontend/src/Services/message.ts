import { getApiURL } from "@/Library/getApiURL";
import { MTResponseSigner } from "@/Library/interceptors";
import axios from "axios";

interface MessageParams {
  msgContent: string;
  channel: string;
  imageData?: File | null;
}

export async function compressImageForEmergencyNetwork(file: File): Promise<File | null> {
  try {
    const img = await createImageBitmap(file);
    
    const compressionLevels = [
      { maxWidth: 1200, maxHeight: 1200, quality: 0.7 },
      { maxWidth: 800, maxHeight: 800, quality: 0.5 },
      { maxWidth: 600, maxHeight: 600, quality: 0.3 },
      { maxWidth: 400, maxHeight: 400, quality: 0.2 },
      { maxWidth: 200, maxHeight: 200, quality: 0.1 },
    ];
    
    const TARGET_SIZE_KB = 50;
    
    for (const level of compressionLevels) {
      const blob = await compressWithParams(img, level.maxWidth, level.maxHeight, level.quality);
      
      if (!blob) continue;
      
      const compressedSizeKB = Math.round(blob.size / 1024);
      
      if (compressedSizeKB <= TARGET_SIZE_KB || level === compressionLevels[compressionLevels.length - 1]) {
        const compressedFile = new File([blob], file.name, {
          type: 'image/jpeg',
          lastModified: Date.now()
        });
        
        return compressedFile;
      }
    }
    
    return createFallbackImage();
    
  } catch (error) {
    return createFallbackImage();
  }
}

function createImageBitmap(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function compressWithParams(
  img: HTMLImageElement, 
  maxWidth: number, 
  maxHeight: number, 
  quality: number
): Promise<Blob | null> {
  let width = img.width;
  let height = img.height;
  
  if (width > maxWidth) {
    height = (maxWidth / width) * height;
    width = maxWidth;
  }
  
  if (height > maxHeight) {
    width = (maxHeight / height) * width;
    height = maxHeight;
  }
  
  width = Math.round(width);
  height = Math.round(height);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);
  }

  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality);
  });
}

function createFallbackImage(): Promise<File> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 80;
    
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#eeeeee';
      ctx.fillRect(0, 0, 100, 80);
      
      ctx.fillStyle = '#333333';
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Image Error', 50, 40);
    }
   
    canvas.toBlob((blob) => {
      if (blob) {
        const fallbackFile = new File([blob], 'error.jpg', {
          type: 'image/jpeg',
          lastModified: Date.now(),
        });
        resolve(fallbackFile);
      } else {
        const emptyBlob = new Blob([''], { type: 'image/jpeg' });
        const emptyFile = new File([emptyBlob], 'empty.jpg', {
          type: 'image/jpeg',
          lastModified: Date.now(),
        });
        resolve(emptyFile);
      }
    }, 'image/jpeg', 0.6);
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        const base64 = result.split(',')[1];
        resolve(base64);
      } else {
        reject(new Error('Failed to convert file to base64'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function message({ msgContent, channel, imageData }: MessageParams) {
  try {
    if (imageData) {
      const compressedImage = await compressImageForEmergencyNetwork(imageData);
      
      if (!compressedImage) {
        return await sendTextMessage(msgContent + " [Image could not be processed]", channel);
      }
      
      const base64 = await fileToBase64(compressedImage);
      
      const content = {
        message: {
          content: msgContent,
          channel: channel,
          tod: Date.now(),
          hasImage: true,
          imageData: base64
        },
        priority: 1,
        type: "MT_MSG",
      };
      
      const signedContent = await MTResponseSigner(content);
      const response = await axios.post(
        getApiURL() + "/message",
        signedContent
      );
      
      return response.data;
      
    } else {
      return await sendTextMessage(msgContent, channel);
    }
    
  } catch (error) {
    return await sendTextMessage(msgContent + " [Image could not be processed]", channel);
  }
}

async function sendTextMessage(msgContent: string, channel: string) {
  const content = {
    message: {
      content: msgContent,
      channel,
      tod: Date.now(),
    },
    priority: 1,
    type: "MT_MSG",
  };
  
  const signedContent = await MTResponseSigner(content);
  const response = await axios.post(
    getApiURL() + "/message",
    signedContent
  );
  
  return response.data;
}