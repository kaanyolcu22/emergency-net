import express from 'express';
import { registerController } from "../controller/RegisterController.js";
import { passwordController } from '../controller/PasswordController.js';
import { recoveryController } from "../controller/RecoveryController.js";
import { syncController } from "../controller/SyncController.js";

const publicRouter = express.Router();

publicRouter.post("/register", registerController.register.bind(registerController));
publicRouter.get("/get-password", passwordController.getPassword.bind(passwordController));

publicRouter.post("/recover-identity", (req, res) => recoveryController.recoverIdentity(req, res));
publicRouter.post("/check-recovery", (req, res) => recoveryController.checkPendingRecovery(req, res));

publicRouter.get("/emergency-sync", (req, res) => syncController.emergencySync(req, res));

publicRouter.get("/test-emergency", (req, res) => {
    return res.status(200).json({
      message: "Emergency endpoint is working",
      timestamp: Date.now()
    });
  });

export default publicRouter;