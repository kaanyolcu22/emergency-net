import { Message } from "../database/entity/Message.js";
import { Channel } from "../database/entity/Channel.js";
import { AppDataSource } from "../database/newDbSetup.js";
import {
  getChannelsToSend,
  findMissingMessages,
  findMissingChannels,
  getMessagesToSend,
  verifyMessage,
  verifyChannel,
} from "../util/SyncUtil.js";
import { checkTod } from "../util/Util.js";
import { getBlacklistAsArray } from "../util/DatabaseUtil.js";
import { addMissingBlacklistedPUs } from "../util/BlacklistUtil.js";
import { User } from "../database/entity/User.js"; 

class SyncController {

  async emergencySync(req, res) {
    try {
      console.log("Emergency sync requested");
      const channels = await AppDataSource.getRepository(Channel).find({
        where: { isActive: true }
      });
      
      console.log(`Returning ${channels.length} channels in emergency sync`);
      
      return res.status(200).json({
        tod: Date.now(),
        priority: -1,
        type: "MT_EMERGENCY_SYNC_ACK",
        content: {
          channels: channels,
          missingMessages: {},
          blacklist: []
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

      const receivedRecoveryData = req.body.recoveryData || [];

      await Promise.all(
        receivedRecoveryData.map(async (userData) => {
          try {
          } catch (error) {
            console.error("Error processing recovery data:", error);
          }
        })
      );

      const blacklistedPUs = await addMissingBlacklistedPUs(req.body.blacklist || []);

      const flattenedReceivedMessages = Object.values(receivedMessages).flatMap(
        (messages) => Object.values(messages)
      );

      const missingMessages = await findMissingMessages(
        flattenedReceivedMessages
      );
      const missingChannels = await findMissingChannels(receivedChannels);

      await Promise.all(
        missingChannels.map(async (channel) => {
          try {
          } catch (error) {
            console.error("Error processing channel:", error);
          }
        })
      );

      const unverifiedMessages = {};

      await Promise.all(
        missingMessages.map(async (message) => {
          try {
          } catch (error) {
            console.error("Error saving message:", error);
          }
        })
      );

      const channelsToSend = await getChannelsToSend();
      const messagesToSend = await getMessagesToSend(receivedMessages);
      const blacklist = await getBlacklistAsArray();
      const recoveryData = await AppDataSource.manager.find(User, {
        select: ["username", "recoveryKeyHash", "recoveryKeySalt", "recoveryKeyUpdatedAt"]
      });

      return res.status(200).json({
        tod: Date.now(),
        priority: -1,
        type: "MT_SYNC_ACK",
        content: {
          missingMessages: messagesToSend,
          unverifiedMessages: unverifiedMessages,
          channels: channelsToSend,
          blacklist: blacklist,
          recoveryData: recoveryData 
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
}

export const syncController = new SyncController();