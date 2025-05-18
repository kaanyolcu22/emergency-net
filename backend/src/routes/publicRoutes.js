import express from 'express';
import { registerController } from "../controller/RegisterController.js";
import { passwordController } from '../controller/PasswordController.js';
import { recoveryController } from "../controller/RecoveryController.js";
import { syncController } from "../controller/SyncController.js";

const publicRouter = express.Router();

publicRouter.post("/register", registerController.register.bind(registerController));
publicRouter.get("/get-password", passwordController.getPassword.bind(passwordController));
publicRouter.post("/recover-identity", (req, res) => recoveryController.recoverIdentity(req, res));
publicRouter.post("/initiate-background-recovery", recoveryController.initiateBackgroundRecovery.bind(recoveryController));
// Fix: Use the emergencySync method from syncController
publicRouter.get("/emergency-sync", (req, res) => syncController.emergencySync(req, res));


export default publicRouter;