// src/database/entity/RecoveryRequest.js
import { EntitySchema } from "typeorm";

export const RecoveryRequest = new EntitySchema({
  name: "RecoveryRequest",
  tableName: "recovery_requests",
  columns: {
    id: {
      primary: true,
      type: "varchar",
      comment: "Unique identifier for this recovery request"
    },
    username: {
      type: "varchar",
      comment: "Username without AP identifier"
    },
    sourceApId: {
      type: "varchar",
      comment: "AP where the user originally registered"
    },
    requestingApId: {
      type: "varchar",
      comment: "AP where the recovery request was initiated"
    },
    ephemeralPublicKey: {
      type: "text",
      comment: "Temporary public key used for encrypting the response"
    },
    recoveryKeyHash: {
      type: "varchar",
      nullable: true,
      comment: "Hash of recovery words for validation"
    },
    signature: {
      type: "text",
      comment: "Signature from the requesting AP"
    },
    status: {
      type: "varchar",
      comment: "Status of recovery request: PENDING, COMPLETED, EXPIRED"
    },
    createdAt: {
      type: "datetime",
      createDate: true
    },
    expiresAt: {
      type: "datetime",
      comment: "Timestamp when this request expires"
    }
  }
});