import { Message } from "../database/entity/Message.js";
import { Channel } from "../database/entity/Channel.js";
import { AppDataSource } from "../database/newDbSetup.js";
import { apId } from "../../bin/www.js";
import {
  getChannelsToSend,
  findMissingMessages,
  findMissingChannels,
  getMessagesToSend,
  verifyMessage,
  verifyChannel,
} from "../util/SyncUtil.js";
import { 
  processIncomingRecoveryRequests, 
  processIncomingRecoveryResponses,
  cleanupExpiredRequests
} from "../util/CrossApRecoveryUtil.js";
import { checkTod } from "../util/Util.js";
import { getBlacklistAsArray } from "../util/DatabaseUtil.js";
import { addMissingBlacklistedPUs } from "../util/BlacklistUtil.js";
import { RecoveryRequest } from "../database/entity/RecoveryRequest.js";
import { RecoveryResponse } from "../database/entity/RecoveryResponse.js";
import { User } from "../database/entity/User.js"; 
import { verify } from "../util/CryptoUtil.js";
import { getAdminPublicKey } from "../scripts/readkeys.js";

class SyncController {

  async emergencySync(req, res) {
    try {
      console.log("Emergency sync requested");
      const channels = await AppDataSource.getRepository(Channel).find({
        where: { isActive: true }
      });
      
      const activeRecoveryRequests = await AppDataSource.getRepository(RecoveryRequest).find({
        where: { 
          requestingApId: apId,
          status: "PENDING" 
        }
      });

      const recoveryResponses = await AppDataSource.getRepository(RecoveryResponse).find({
        where: { targetApId: apId }
      });

      console.log(`Returning ${channels.length} channels, ${activeRecoveryRequests.length} recovery requests, and ${recoveryResponses.length} recovery responses in emergency sync`);
      
      return res.status(200).json({
        tod: Date.now(),
        priority: -1,
        type: "MT_EMERGENCY_SYNC_ACK",
        content: {
          channels: channels,
          missingMessages: {},
          blacklist: [],
          recoveryRequests: activeRecoveryRequests,
          recoveryResponses: recoveryResponses
        }
      });
    } catch (error) {
      console.error("Emergency sync error:", error);
      return res.status(500).json({
        tod: Date.now(),
        priority: -1,
        type: "MT_EMERGENCY_SYNC_RJT",
        error: "Internal server error during emergency sync."
      });
    }
  }



  async sync(req, res, next) {
    try {
      const receivedMessages = req.body.messages;
      const receivedChannels = req.body.channels;
      const receivedRecoveryRequests = req.body.recoveryRequests || [];
      const receivedRecoveryResponses = req.body.recoveryResponses || [];
      const tod_received = req.body.tod;

      if (!checkTod(tod_received)) {
        return res.status(408).json({
          tod: Date.now(),
          priority: -1,
          type: "MT_SYNC_RJT",
          error: "Timeout error.",
        });
      }

      if (!req.auth.contentVerified) {
        return res.status(400).json({
          tod: Date.now(),
          priority: -1,
          type: "MT_SYNC_RJT",
          error: req.auth.errorMessage
            ? req.auth.errorMessage
            : "Signature check is failed.",
        });
      }



      await cleanupExpiredRequests();
      console.log(`Processing ${receivedRecoveryRequests.length} recovery requests and ${receivedRecoveryResponses.length} recovery responses`);


      if(receivedRecoveryRequests.length > 0){
        await processIncomingRecoveryRequests(receivedRecoveryRequests);
      }

      if(receivedRecoveryResponses.length > 0){
        await processIncomingRecoveryResponses(receivedRecoveryResponses);
      }
      
      const blacklistedPUs = await addMissingBlacklistedPUs(req.body.blacklist || []);

      const flattenedReceivedMessages = Object.values(receivedMessages).flatMap(
        (messages) => Object.values(messages)
      );

      const missingMessages = await findMissingMessages(
        flattenedReceivedMessages
      );

      const missingChannels = await findMissingChannels(receivedChannels);

      const unverifiedMessages = {};

      await Promise.all(
        missingMessages.map(async (message) => {
          try{
            const messageVerificationResult = verifyMessage(message);
            if(messageVerificationResult?.isMessageVerified){
              await AppDataSource.manager.save(Message, {
                content: message.content,
                usernick: message.usernick,
                origin: message.origin,
                certificate: message.certificate,
                hashKey: message.hashKey,
                channel: message.channel,
                tod: message.tod,
                isSafe: messageVerificationResult.isSafe,
                hasImage: message.hasImage || false,
                imageData: message.imageData || null,
                imageWidth: message.imageWidth || null,
                imageHeight: message.imageHeight || null
              });

            }
            else{
              if (!unverifiedMessages[message.channel]) {
                unverifiedMessages[message.channel] = [];
              }
              unverifiedMessages[message.channel].push(message.hashKey);
            }
          }
          catch(error){
            console.error("Error saving message:", error);
          }
        })

      );

      await Promise.all(
        missingChannels.map(async (channel) => {
          try {
            const channelVerificationResult = verifyChannel(channel);
            if (channelVerificationResult?.isChannelVerified) {
              await AppDataSource.manager.save(Channel, {
                channelName: channel.channelName,
                isActive: channel.isActive,
                channelCert: channel.channelCert,
                tod: channel.tod,
              });
            }
          } catch (error) {
            console.error("Error processing channel:", error);
          }
        })
      );

      const channelsToSend = await getChannelsToSend();
      const messagesToSend = await getMessagesToSend(receivedMessages);
      const blacklist = await getBlacklistAsArray();


      const recoveryData = await AppDataSource.manager.find(User, {
        select : [
          "username", 
          "recoveryKeyHash", 
          "recoveryKeySalt", 
          "recoveryKeyUpdatedAt",
          "recoverySignature",
          "id"
        ]
      });
      
      const activeRecoveryRequests = await AppDataSource.getRepository(RecoveryRequest).find({
        where: { 
          requestingApId: apId,
          status: "PENDING" 
        }
      });


      const recoveryResponses = await AppDataSource.getRepository(RecoveryResponse).find({
        where: { targetApId: apId }
      });

      const recoveryStats = {
        pendingRequestsCount: activeRecoveryRequests.length,
        completedRequestsCount: await AppDataSource.getRepository(RecoveryRequest).count({
          where: { requestingApId: apId, status: "COMPLETED" }
        }),
        expiredRequestsCount: await AppDataSource.getRepository(RecoveryRequest).count({
          where: { requestingApId: apId, status: "EXPIRED" }
        })
      };


      const apInfo = {
        id: apId,
        knownAPs: await this.getKnownAPs(), // This would be a function that returns APs this AP has seen
        lastSyncTime: Date.now()
      };

      return res.status(200).json({
        tod: Date.now(),
        priority: -1,
        type: "MT_SYNC_ACK",
        content: {
          missingMessages: messagesToSend,
          unverifiedMessages: unverifiedMessages,
          channels: channelsToSend,
          blacklist: blacklist,
          recoveryData: recoveryData,
          recoveryRequests: activeRecoveryRequests,
          recoveryResponses: recoveryResponses,
          recoveryStats: recoveryStats,
          apInfo: apInfo
        },
      });
    }
    catch(error){
      console.error("Sync error:", error);
      return res.status(500).json({
        tod: Date.now(),
        priority: -1,
        type: "MT_SYNC_RJT",
        error: "Internal server error during sync."
      });
    }
}

async getKnownAPs() {
  return [
    { apId: "AP1", lastSeen: Date.now() - 3600000 },
    { apId: "AP2", lastSeen: Date.now() - 7200000 }
  ];
}

}

export const syncController = new SyncController();