import { apId } from "../../bin/www.js";
import { jsonToBase64, sign, signByAdmin } from "./CryptoUtil.js";
import { getApCert } from "../scripts/readcert.js";


export function createToken(mtUsername, mtPubKey) {
  const tod = Date.now();

  const registerContent = {
    apReg: apId,
    todReg: tod,
    mtUsername: mtUsername,
    mtPubKey: mtPubKey.toString(),
  };

  let registerContentStringified = JSON.stringify(registerContent);

  var encoded = jsonToBase64(registerContent);
  var signed = sign(registerContentStringified);

  return `${encoded}.${signed}.${getApCert()}`;
}

export async function generatePUCert(puPubKey) {
  const pubPem = puPubKey.export({ format: "pem", type: "spki" });

  const puContent = {
    pubKey: pubPem,
  };
  const encodedPUContent = jsonToBase64(puContent);
  const signedPUContent = signByAdmin(JSON.stringify(puContent));
  const cert = `${encodedPUContent}.${signedPUContent}`;
  return cert;
}

async function convertCryptoKeyToPem(cryptoKey) {
  const spki = await crypto.subtle.exportKey("spki", cryptoKey);

  const pem = Buffer.from(spki).toString("base64");

  const lines = pem.match(/.{1,64}/g).join("\n");

  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
}


