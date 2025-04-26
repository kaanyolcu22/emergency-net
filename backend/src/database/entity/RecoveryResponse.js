import { EntitySchema } from "typeorm";

export const RecoveryResponse = new EntitySchema({
  name: "RecoveryResponse",
  tableName: "recovery_responses",
  columns: {
    requestId: {
      primary: true,
      type: "varchar",
      comment: "Corresponds to RecoveryRequest.id"
    },
    encryptedUserData: {
      type: "text",
      comment: "User credentials encrypted with ephemeral public key"
    },
    targetApId: {
      type: "varchar",
      comment: "AP that should receive this response"
    },
    sourceApId: {
      type: "varchar",
      comment: "AP that created this response"
    },
    signature: {
      type: "text",
      comment: "Signature from the original AP that registered the user"
    },
    createdAt: {
      type: "datetime",
      createDate: true
    }
  }
});