import { getApiURL } from "@/Library/getApiURL";
import axios from "axios";


export async function hello(token, isRecovered = false) {
  // Add the query parameter if isRecovered is true
  const url = isRecovered 
    ? `${getApiURL()}/hello?recovered=true` 
    : `${getApiURL()}/hello`;
    
  const headers = {};
  if (token) {
    headers.Authorization = token;
  }
  if (isRecovered) {
    headers['X-Recovery-Completed'] = 'true';
  }
  
  return axios.get(url, { headers });
}