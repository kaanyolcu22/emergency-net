// src/routes/protectedRoutes.js - Updated with cross-AP recovery endpoints

import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { messageController } from '../controller/MessageController.js';
import { syncController } from "../controller/SyncController.js";
import { helloController } from "../controller/HelloController.js";
import { channelController } from "../controller/ChannelController.js";
import { certifyController } from "../controller/CertifyController.js";
import { recoveryController } from "../controller/RecoveryController.js";

const protectedRouter = express.Router();
protectedRouter.use(authMiddleware);

// ============================================================================
// EXISTING ROUTES
// ============================================================================

protectedRouter.get("/hello", helloController.hello.bind(helloController));
protectedRouter.post("/message", messageController.receiveMessage.bind(messageController));
protectedRouter.post("/sync", (req, res, next) => syncController.sync(req, res, next));
protectedRouter.post("/channel", channelController.createChannel.bind(channelController));
protectedRouter.delete("/channel", channelController.destroyChannel.bind(channelController));
protectedRouter.post("/request-to-certify", certifyController.requestToCertify.bind(certifyController));
protectedRouter.post("/certify", certifyController.certify.bind(certifyController));

protectedRouter.post("/submit-cross-ap-request", 
  recoveryController.submitCrossAPRequest.bind(recoveryController)
);
protectedRouter.post("/check-cross-ap-recovery-status", 
  recoveryController.checkCrossAPRecoveryStatus.bind(recoveryController)
);

protectedRouter.post("/get-cross-ap-recovery-response", 
  recoveryController.getCrossAPRecoveryResponse.bind(recoveryController)
);
protectedRouter.post("/cross-ap-recovery-sync", 
  recoveryController.processCrossAPRecoverySync.bind(recoveryController)
);

export default protectedRouter;