import { getApiURL } from "@/Library/getApiURL";
import { MTResponseSigner } from "@/Library/interceptors";
import axios from "axios";

export async function createChannel(channelName: string) {
  const response = await axios.post(
    getApiURL() + "/channel",
    await MTResponseSigner({ channelName })
  );

  return response.data;
}

export async function destroyChannel(channelName: string) {
  const content = { 
    channelName,
    tod: Date.now()
  };
  
  console.log("Sending channel deletion request:", content);
  
  const response = await axios.delete(getApiURL() + "/channel", {
    data: await MTResponseSigner(content),
  });
  
  return response.data;
}
