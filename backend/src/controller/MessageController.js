import { apId } from "../../bin/www.js";
import { createMessageCert } from "../util/MessageUtil.js";
import { AppDataSource } from "../database/newDbSetup.js";
import { Message } from "../database/entity/Message.js";
import { hashBase64, jsonToBase64 } from "../util/CryptoUtil.js";
import { checkTod } from "../util/Util.js";

class MessageController {
  async receiveMessage(req, res, next) {
    let tod_received = req.body.tod;
    let message = req.body.message;
    console.log("Message received:", message);

    const messageToSave = {
      content: message.content,
      tod: message.tod,
      usernick: req.auth.mtUsername + "@" + req.auth.apReg,
      origin: apId,
    };

    if (!checkTod(tod_received)) {
      res.status(408).json({
        id: apId,
        tod: Date.now(),
        priority: -1,
        type: "MT_MSG_RJT",
        error: "Timeout error.",
      });
    } else {
      const isTokenVerified = req.auth.tokenVerified;
      const isAPVerified = req.auth.apVerified;
      const mtPubKey = req.auth.mtPubKey;

      if (!isTokenVerified) {
        res.status(400).json({
          id: apId,
          tod: Date.now(),
          priority: -1,
          type: "MT_MSG_RJT",
          error: req.auth.errorMessage
            ? req.auth.errorMessage
            : "Signature check is failed.",
        });
      } else {
        if (!req.auth.contentVerified) {
          res.status(400).json({
            id: apId,
            tod: Date.now(),
            priority: -1,
            type: "MT_MSG_RJT",
            error: "Message could not be verified.",
          });
        } else {
          if (isAPVerified === "INVALID") {
            res.status(400).json({
              id: apId,
              tod: Date.now(),
              priority: -1,
              type: "MT_MSG_RJT",
              error: "AP verification is invalid.",
            });
          } else {
            const hasImage = message.hasImage || false;
            const imageData = message.imageData || null;
            
            AppDataSource.manager
              .save(Message, {
                content: message.content,
                usernick: messageToSave.usernick,
                origin: apId,
                certificate: createMessageCert(messageToSave),
                hashKey: hashBase64(jsonToBase64(messageToSave)),
                channel: message.channel,
                tod: tod_received,
                isSafe: isAPVerified === "VALID",
                hasImage: hasImage,
                imageData: imageData
              })
              .then((savedMessage) => {
                console.log("Message saved successfully:", savedMessage);
                res.status(200).json({
                  id: apId,
                  tod: Date.now(),
                  priority: -1,
                  type: "MT_MSG_ACK",
                  usernick: message.usernick,
                });
              })
              .catch((error) => {
                console.error("Error saving message:", error);
                res.status(500).json({
                  id: apId,
                  tod: Date.now(),
                  priority: -1,
                  type: "MT_MSG_RJT",
                  error: "Database error while saving message.",
                });
              });
          }
        }
      }
    }
  }
}

export const messageController = new MessageController();