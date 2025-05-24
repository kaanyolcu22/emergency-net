
import { getApiURL } from "@/Library/getApiURL";
import { MTResponseSigner } from "@/Library/interceptors";
import axios from "axios";

export async function compressImageForEmergencyNetwork(file : any) {
  console.log(`Starting compression for ${Math.round(file.size/1024)} KB image`);
  
  const createImageBitmap = async (file : any) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e : any) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };
  
  const compressWithParams = async (img : any, maxWidth : any , maxHeight : any,  quality : any) => {
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

    if(ctx){
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);
    }
  
    return new Promise(resolve => {
      canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality);
    });
  };
  
  try {
    const img = await createImageBitmap(file);
    console.log(`Original dimensions: ${img.width}x${img.height}, size: ${Math.round(file.size/1024)}KB`);
    
    // Progressive compression strategy - try different parameters until target size is reached
    const compressionLevels = [
      { maxWidth: 1200, maxHeight: 1200, quality: 0.7 },  // Level 1: Good quality
      { maxWidth: 800, maxHeight: 800, quality: 0.5 },    // Level 2: Medium quality
      { maxWidth: 600, maxHeight: 600, quality: 0.3 },    // Level 3: Lower quality
      { maxWidth: 400, maxHeight: 400, quality: 0.2 },    // Level 4: Low quality
      { maxWidth: 200, maxHeight: 200, quality: 0.1 },    // Level 5: Very low quality (emergency)
    ];
    
    // Target maximum size in KB (adjust based on your network constraints)
    const TARGET_SIZE_KB = 50;
    
    // Try each compression level until we get under target size
    for (const level of compressionLevels) {
      const blob = await compressWithParams(img, level.maxWidth, level.maxHeight, level.quality);
      
      const compressedSizeKB = Math.round(blob.size / 1024);
      console.log(`Compression level (${level.maxWidth}x${level.maxHeight}, quality ${level.quality}): ${compressedSizeKB}KB`);
      
      // If we're under target size or at the last level, use this result
      if (compressedSizeKB <= TARGET_SIZE_KB || level === compressionLevels[compressionLevels.length - 1]) {
        const compressedFile = new File([blob], file.name, {
          type: 'image/jpeg',
          lastModified: Date.now()
        });
        
        console.log(`Final image: ${Math.round(compressedFile.size / 1024)}KB, dimensions: ${level.maxWidth}x${level.maxHeight}`);
        return compressedFile;
      }
    }
    
    // If we reach here, use the most aggressive compression as fallback
    const lastLevel = compressionLevels[compressionLevels.length - 1];
    const finalBlob = await compressWithParams(img, lastLevel.maxWidth, lastLevel.maxHeight, 0.05);
    
    return new File([finalBlob], file.name, {
      type: 'image/jpeg',
      lastModified: Date.now()
    });
    
  } catch (error) {
    console.error("Compression error:", error);
    
    // Create a tiny placeholder image as absolute fallback
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 80;
      
      const ctx = canvas.getContext('2d');
      if(ctx){
        ctx.fillStyle = '#eeeeee';
        ctx.fillRect(0, 0, 100, 80);
        
        ctx.fillStyle = '#333333';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Image Error', 50, 40);
      }
     
      
      const fallbackBlob = await new Promise(resolve => {
        canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.6);
      });
      
      return new File([fallbackBlob], 'error.jpg', {
        type: 'image/jpeg',
        lastModified: Date.now()
      });
    } catch (fallbackError) {
      console.error("Fallback creation failed:", fallbackError);
      return null;
    }
  }
}


// Modified message service with enhanced image handling
export async function message({ msgContent, channel, imageData }) {
  console.log(`Processing message: ${msgContent?.length || 0} chars text, image: ${imageData ? Math.round(imageData.size/1024) + 'KB' : 'none'}`);
  
  if (imageData) {
    try {
      // Use the new compression function
      const compressedImage = await compressImageForEmergencyNetwork(imageData);
      
      if (!compressedImage) {
        throw new Error("Image compression failed");
      }
      
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result.toString().split(',')[1];
          resolve(result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(compressedImage);
      });
      
      // Create message content
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
      
      console.log(`Message sent successfully: ${response.status}`);
      return response.data;
      
    } catch (error) {
      console.error("Error in image message:", error);
      
      // Text-only fallback
      console.log("Sending text-only fallback");
      const textContent = {
        message: {
          content: msgContent + " [Image could not be processed]",
          channel,
          tod: Date.now(),
        },
        priority: 1,
        type: "MT_MSG",
      };
      
      const signedText = await MTResponseSigner(textContent);
      const textResponse = await axios.post(
        getApiURL() + "/message",
        signedText
      );
      
      return textResponse.data;
    }
  } else {
    // Text-only message (unchanged)
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
}