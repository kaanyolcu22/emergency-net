// src/routes/publicRoutes.js - Updated with unified recovery endpoints
import express from 'express';
import { registerController } from "../controller/RegisterController.js";
import { passwordController } from '../controller/PasswordController.js';
import { recoveryController } from "../controller/RecoveryController.js";
import { syncController } from "../controller/SyncController.js";

const publicRouter = express.Router();

publicRouter.post("/register", registerController.register.bind(registerController));
publicRouter.get("/get-password", passwordController.getPassword.bind(passwordController));

// Unified Recovery Routes
publicRouter.post("/recover-identity", (req, res) => recoveryController.recoverIdentity(req, res));
publicRouter.post("/initiate-cross-ap-recovery-with-temp", (req, res) => recoveryController.initiateCrossAPRecoveryWithTempIdentity(req, res));

// Emergency sync (no auth required)
publicRouter.get("/emergency-sync", (req, res) => syncController.emergencySync(req, res));

export default publicRouter;