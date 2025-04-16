import { base64toJson, verify, verifyACAP, verifyPUAP } from "./CryptoUtil.js";

export function verifyAPReg(data, cert) {
  let isVerified = false;
  const fragmentedCert = cert.split(".");

  let encodedAPData;
  const decodedData = base64toJson(data);
  if (fragmentedCert.length === 2) {
    encodedAPData = fragmentedCert[0];
    let adminSignature = fragmentedCert[1];
    if (adminSignature === "NO_CERT") {
      const decodedAPData = base64toJson(encodedAPData);
      if (decodedAPData.apId === decodedData.apReg) {
        return {
          isApVerified: "NO_CERT",
          apPubKey: decodedAPData.apPub,
          reason: "No certificate",
        };
      }
    } else {
      isVerified = verifyACAP(encodedAPData, adminSignature);
    }
  } else if (fragmentedCert.length === 4) {
    encodedAPData = fragmentedCert[0];
    const PUsignature = fragmentedCert[1];
    const encodedPUData = fragmentedCert[2];
    const adminSignature = fragmentedCert[3];
    isVerified = verifyPUAP(
      encodedAPData,
      PUsignature,
      encodedPUData,
      adminSignature
    );
  } else {
    return {
      isApVerified: "INVALID",
      reason: "Certificate is not in the correct format",
    };
  }
  //console.log("isVerified " + isVerified);

  var decodedAPData = base64toJson(encodedAPData);

  if (decodedData.apReg !== decodedAPData.apId) {
    return {
      isApVerified: "INVALID",
      reason: "Registered AP id does not match",
    };
  } else if (!isVerified) {
    return {
      isApVerified: "INVALID",
      reason: "Certificate is not valid",
    };
  }
  return { isApVerified: "VALID", apPubKey: decodedAPData.apPub };
}

export function verifyToken(token, isApplicable) {
  const fragmentedToken = token.split(".");
  if (fragmentedToken.length < 3) {
    return {
      isApVerified: "INVALID",
      isTokenVerified: false,
      reason: "Token is not in the correct format",
    };
  }
  const encodedData = fragmentedToken[0];
  const signature = fragmentedToken[1];
  const cert = fragmentedToken.slice(2).join(".");

  const decodedData = base64toJson(encodedData);
  const decodedApData = base64toJson(cert.split(".")[0]);
  console.log("decodedData " + JSON.stringify(decodedApData));
  if (!isApplicable) {
    const apPubKey = decodedApData.apPub;
    let isTokenVerified = verify(
      JSON.stringify(base64toJson(encodedData)),
      signature,
      apPubKey
    );
    return {
      isApVerified: "NO_CERT",
      isTokenVerified: isTokenVerified,
      mtPubKey: decodedData.mtPubKey ? decodedData.mtPubKey : "",
    };
  }
  const verificationResult = verifyAPReg(encodedData, cert);
  if (verificationResult.isApVerified === "VALID") {
    let isTokenVerified = verify(
      JSON.stringify(base64toJson(encodedData)),
      signature,
      Buffer.from(verificationResult.apPubKey)
    );
    return {
      isApVerified: "VALID",
      isTokenVerified: isTokenVerified,
      mtPubKey: decodedData.mtPubKey ? decodedData.mtPubKey : "",
    };
  } 
  else if (
    verificationResult.isApVerified === "NO_CERT" &&
    verificationResult.reason === "No certificate"
  ) {
    let isTokenVerified = verify(
      JSON.stringify(base64toJson(encodedData)),
      signature,
      Buffer.from(verificationResult.apPubKey)
    );
    return {
      isApVerified: "NO_CERT",
      isTokenVerified: isTokenVerified,
      mtPubKey: decodedData.mtPubKey ? decodedData.mtPubKey : "",
    };
  }
  return {
    isApVerified: "INVALID",
    isTokenVerified: false,
    reason: verificationResult.reason,
  };
}
