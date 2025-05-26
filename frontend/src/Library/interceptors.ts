import { APDataReference } from "./APData";
import { sign, verify } from "./crypt";
import { readPrivateKey } from "./keys";
import { readPublicKey } from "./keys";
import { keyToJwk } from "./crypt";

export async function APResponseVerifier({
  content,
  signature,
}: {
  content: Record<string, any>;
  signature: string;
}) {
  const APData = APDataReference.current;
  console.log("APDATA", APData);
  if (!APData) {
    throw new Error("AP Data Unknown");
  }

  const stringContent = JSON.stringify(content);

  const verified = await verify(APData.key, signature, stringContent);

  if (verified) {
    return content;
  } else {
    throw new Error(
      `Signature invalid on content:\n${JSON.stringify(content, null, 2)}`
    );
  }
}

export async function MTResponseSigner(content: Record<string, any>) {
  content.tod = Date.now();
  
  console.log("=== MTResponseSigner Debug ===");
  console.log("Content to sign:", JSON.stringify(content));
  
  try {
    const MTKey = await readPrivateKey();
    console.log("Private key loaded successfully");
    
    // Get the public key to compare
    const MTPublicKey = await readPublicKey();
    const publicKeyJwk = await keyToJwk(MTPublicKey);
    console.log("Client public key (JWK):", JSON.stringify(publicKeyJwk, null, 2));
    
    const signature = await sign(MTKey, JSON.stringify(content));
    console.log("Generated signature:", signature.substring(0, 50) + "...");
    
    const result: any = { content, signature };
    
    const cert = localStorage.getItem("pu_cert");
    if (cert) {
      result.pu_cert = cert;
    }
    
    console.log("=== End MTResponseSigner Debug ===");
    return result;
    
  } catch (error) {
    console.error("Signing failed:", error);
    throw error;
  }
}