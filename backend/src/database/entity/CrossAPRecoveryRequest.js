// /src/database/entity/CrossAPRecoveryRequest.js
import { EntitySchema } from "typeorm";

export const CrossAPRecoveryRequest = new EntitySchema({
  name: "CrossAPRecoveryRequest",
  tableName: "cross_ap_recovery_requests",
  columns: {
    tempUserId: {
      primary: true,
      type: "varchar",
      comment: "Temporary user ID for this recovery request"
    },
    requestingApId: {
      type: "varchar",
      comment: "AP where the recovery request was initiated"
    },
    destinationApId: {
      type: "varchar", 
      comment: "AP where the user should be found (sourceApId)"
    },
    hash: {
      type: "varchar",
      comment: "Hash of recovery words for verification"
    },
    realUserId: {
      type: "varchar",
      comment: "Real username to recover"
    },
    sourceApId: {
      type: "varchar",
      comment: "AP where user originally registered"
    },
    ephemeralPublicKey: {
      type: "text",
      comment: "Client-generated ephemeral public key for response encryption"
    },
    timestamp: {
      type: "bigint",
      comment: "Request creation timestamp"
    },
    status: {
      type: "varchar",
      comment: "Request status: PENDING, COMPLETED, EXPIRED"
    },
    expiresAt: {
      type: "datetime",
      comment: "When this request expires"
    },
    responseReceived: {
      type: "boolean",
      default: false,
      comment: "Whether response has been received"
    },
    responseData: {
      type: "text",
      nullable: true,
      comment: "JSON data of response when received"
    },
    createdAt: {
      type: "datetime",
      createDate: true
    },
    updatedAt: {
      type: "datetime",
      updateDate: true
    }
  }
});