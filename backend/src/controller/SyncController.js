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
  processIncomingCrossAPRequests, 
  processIncomingCrossAPResponses,
  cleanupExpiredRequests,
  getPendingCrossAPRequests,
  getCrossAPResponses
} from "../util/CrossApRecoveryUtil.js";
import { checkTod } from "../util/Util.js";
import { getBlacklistAsArray } from "../util/DatabaseUtil.js";
import { addMissingBlacklistedPUs } from "../util/BlacklistUtil.js";
import { CrossAPRecoveryRequest } from "../database/entity/CrossAPRecoveryRequest.js";
import { CrossAPRecoveryResponse } from "../database/entity/CrossAPRecoveryResponse.js";
import { User } from "../database/entity/User.js"; 

class SyncController {

  async emergencySync(req, res) {
    try {
      console.log("Emergency sync requested");
      const channels = await AppDataSource.getRepository(Channel).find({
        where: { isActive: true }
      });
      
      const pendingCrossAPRequests = await getPendingCrossAPRequests();
      const crossAPResponses = await getCrossAPResponses();

      console.log(`Returning ${channels.length} channels, ${pendingCrossAPRequests.length} cross-AP requests, and ${crossAPResponses.length} cross-AP responses in emergency sync`);
      
      return res.status(200).json({
        tod: Date.now(),
        priority: -1,
        type: "MT_EMERGENCY_SYNC_ACK",
        content: {
          channels: channels,
          missingMessages: {},
          blacklist: [],
          crossAPRequests: pendingCrossAPRequests,
          crossAPResponses: crossAPResponses
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
      const receivedCrossAPRequests = req.body.crossAPRequests || [];
      const receivedCrossAPResponses = req.body.crossAPResponses || [];
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
      console.log(`Processing ${receivedCrossAPRequests.length} cross-AP requests and ${receivedCrossAPResponses.length} cross-AP responses`);

      if (receivedCrossAPRequests.length > 0) {
        await processIncomingCrossAPRequests(receivedCrossAPRequests);
      }

      if (receivedCrossAPResponses.length > 0) {
        await processIncomingCrossAPResponses(receivedCrossAPResponses);
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
          try {
            const messageVerificationResult = verifyMessage(message);
            if (messageVerificationResult?.isMessageVerified) {
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
            } else {
              if (!unverifiedMessages[message.channel]) {
                unverifiedMessages[message.channel] = [];
              }
              unverifiedMessages[message.channel].push(message.hashKey);
            }
          } catch (error) {
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
        select: [
          "username", 
          "recoveryKeyHash", 
          "recoveryKeySalt", 
          "recoveryKeyUpdatedAt",
          "recoverySignature",
          "id"
        ]
      });
      
      const pendingCrossAPRequests = await getPendingCrossAPRequests();
      const crossAPResponses = await getCrossAPResponses();

      const crossAPStats = {
        pendingRequestsCount: pendingCrossAPRequests.length,
        completedRequestsCount: await AppDataSource.getRepository(CrossAPRecoveryRequest).count({
          where: { requestingApId: apId, status: "COMPLETED" }
        }),
        expiredRequestsCount: await AppDataSource.getRepository(CrossAPRecoveryRequest).count({
          where: { requestingApId: apId, status: "EXPIRED" }
        }),
        responsesCount: crossAPResponses.length
      };

      const apInfo = {
        id: apId,
        knownAPs: await this.getKnownAPs(),
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
          crossAPRequests: pendingCrossAPRequests,
          crossAPResponses: crossAPResponses,
          crossAPStats: crossAPStats,
          apInfo: apInfo
        },
      });
    } catch (error) {
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