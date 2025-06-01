import { apId } from "../../bin/www.js";
import { User } from "../database/entity/User.js";
import { AppDataSource } from "../database/newDbSetup.js";
import { jwkToKeyObject } from "../util/CryptoUtil.js";
import "../util/RegisterUtils.js";
import { createToken, generatePUCert } from "../util/RegisterUtils.js";
import { getAdminPublicKey } from "../scripts/readkeys.js";
import { useOneTimePassword } from "../util/PasswordUtil.js";
import { generateRecoveryWords } from "../util/RecoveryUtil.js";
import { signByAdmin } from "../util/CryptoUtil.js";
import crypto from "crypto";

export class RegisterController {
  async register(req, res) {
    const tod_reg = Date.now();
    let username = req.body.username;
    let mtPubKey = await jwkToKeyObject(req.body.mtPubKey);
    
    if (username === "" || await AppDataSource.manager.findOneBy(User, { username })) {
      return res.status(409).json({
        id: apId,
        tod: tod_reg,
        type: "MT_REG_RJT",
        error: "Username already exists",
      });
    }
    
    const mtPubBuffer = Buffer.from(mtPubKey.export({ format: "pem", type: "spki" }));
    const token = createToken(username, mtPubBuffer);
    const otp = req.body.password;
    
    try {
      const recoveryWords = generateRecoveryWords();
      const recoveryPhrase = recoveryWords.join(" ");
      
      const recoveryKeyHash = crypto.createHash('sha256').update(recoveryPhrase).digest('hex');
      
      console.log("Recovery hash created:", recoveryKeyHash.substring(0, 20) + "...");

      const recoveryData = {
        username,
        recoveryKeyHash,
        recoveryKeySalt: null, 
        recoveryKeyUpdatedAt: new Date()
      };

      const recoverySignature = signByAdmin(JSON.stringify(recoveryData));

      await AppDataSource.manager.save(User, { 
        username,
        recoveryKeyHash,
        recoveryKeySalt: null, 
        recoveryKeyUpdatedAt: new Date(),
        recoverySignature: recoverySignature,
        recoverySource: apId
      });
      
      if (otp && useOneTimePassword(otp)) {
        const puCert = await generatePUCert(mtPubKey);
        return res.status(200).json({
          id: apId,
          tod: tod_reg,
          type: "MT_REG_ACK",
          adminPubKey: getAdminPublicKey().toString(),
          pu_cert: puCert,
          token,
          recoveryWords: recoveryWords 
        });
      }
      
      return res.status(200).json({
        id: apId,
        tod: tod_reg,
        type: "MT_REG_ACK",
        adminPubKey: getAdminPublicKey().toString(),
        token,
        recoveryWords: recoveryWords
      });
    } catch (error) {
      console.error("Registration error:", error);
      return res.status(500).json({
        type: "MT_REG_RJT",
        error: error.message
      });
    }
  }
}

export const registerController = new RegisterController();