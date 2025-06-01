
import express from 'express';
import { registerController } from "../controller/RegisterController.js";
import { passwordController } from '../controller/PasswordController.js';
import { recoveryController } from "../controller/RecoveryController.js";
import { syncController } from "../controller/SyncController.js";

const publicRouter = express.Router();


publicRouter.post("/register", registerController.register.bind(registerController));
publicRouter.get("/get-password", passwordController.getPassword.bind(passwordController));

publicRouter.get("/emergency-sync", (req, res) => syncController.emergencySync(req, res));

publicRouter.post("/recover-identity", 
  recoveryController.recoverIdentity.bind(recoveryController)
);

export default publicRouter;