import { apId } from "../../bin/www.js";
import { getAdminPrivateKey, getAdminPublicKey } from "../scripts/readkeys.js";
import { getApCert } from "../scripts/readcert.js";

class HelloController {
  async hello(req, res, next) {
    let token = req.header("authorization");
    let tod = Date.now();
    
    // First check if there's a valid token
    if (token != null) {
      if (req.auth.tokenVerified) {
        // User is authenticated with a valid token
        console.log("User has valid token - returning status 200");
        return res.status(200).json({
          id: apId,
          tod: tod,
          priority: -1,
          type: "MT_HELLO_ACK",
          cert: getApCert(),
          adminPubKey: getAdminPublicKey()?.toString(),
        });
      } else {
        // Token is present but invalid - clear rejection
        console.log("Token validation failed:", req.auth.errorMessage);
        return res.status(400).json({
          id: apId,
          tod: tod,
          priority: -1,
          type: "MT_HELLO_RJT",
          error: req.auth.errorMessage
            ? req.auth.errorMessage
            : "Signature check for token has failed",
        });
      }
    }
    
    return res.status(202).json({
      id: apId,
      tod: tod,
      priority: -1,
      type: "MT_HELLO_ACK",
      cert: getApCert(),
      adminPubKey: getAdminPublicKey()?.toString(),
      isAdmin: getAdminPrivateKey() != null,
    });
  }
}

export const helloController = new HelloController();
