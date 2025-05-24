// /src/database/entity/CrossAPRecoveryResponse.js
import { EntitySchema } from "typeorm";

export const CrossAPRecoveryResponse = new EntitySchema({
  name: "CrossAPRecoveryResponse",
  tableName: "cross_ap_recovery_responses",
  columns: {
    tempUserId: {
      primary: true,
      type: "varchar",
      comment: "Temporary user ID matching the recovery request"
    },
    encryptedTokenData: {
      type: "text",
      comment: "Token and recovery data encrypted with ephemeral public key"
    },
    requestingApId: {
      type: "varchar",
      comment: "AP that should receive this response"
    },
    sourceApId: {
      type: "varchar",
      comment: "AP that created this response (where user was found)"
    },
    signature: {
      type: "text",
      comment: "Digital signature from the source AP"
    },
    createdAt: {
      type: "datetime",
      createDate: true
    }
  }
});