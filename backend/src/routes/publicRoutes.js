// src/routes/publicRoutes.js - Complete unified recovery system
import express from 'express';
import { registerController } from "../controller/RegisterController.js";
import { passwordController } from '../controller/PasswordController.js';
import { recoveryController } from "../controller/RecoveryController.js";
import { syncController } from "../controller/SyncController.js";

const publicRouter = express.Router();

// User registration and authentication
publicRouter.post("/register", registerController.register.bind(registerController));
publicRouter.get("/get-password", passwordController.getPassword.bind(passwordController));

// Unified Recovery System Routes
// This is the main endpoint that handles both local and cross-AP recovery
publicRouter.post("/recover-identity", (req, res) => recoveryController.recoverIdentity(req, res));

// Cross-AP Recovery Support Routes
// These are needed for the advanced cross-AP recovery with key synchronization
publicRouter.post("/initiate-cross-ap-recovery-with-key-sync", (req, res) => recoveryController.initiateCrossAPRecoveryWithKeySync(req, res));
publicRouter.post("/initiate-cross-ap-recovery-with-temp", (req, res) => recoveryController.initiateCrossAPRecoveryWithTempIdentity(req, res));

// Recovery status and completion routes (these need to be public for cross-AP scenarios)
publicRouter.post("/check-cross-ap-recovery-status", (req, res) => recoveryController.checkCrossAPRecoveryStatus(req, res));
publicRouter.post("/get-recovery-response", (req, res) => recoveryController.getRecoveryResponse(req, res));

// Emergency sync (no auth required) - critical for recovery scenarios
publicRouter.get("/emergency-sync", (req, res) => syncController.emergencySync(req, res));

// Cross-AP recovery data sync (needed for recovery request propagation)
publicRouter.post("/cross-ap-recovery-sync", (req, res) => recoveryController.processCrossAPRecoverySync(req, res));

export default publicRouter;